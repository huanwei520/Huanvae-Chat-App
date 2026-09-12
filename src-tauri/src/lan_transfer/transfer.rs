/*!
 * 文件传输模块
 *
 * 实现文件发送逻辑
 *
 * 功能：
 * - 点对点连接管理（请求、响应、断开）
 * - 连接请求失败自动重试（刷新设备信息后重试一次）
 * - 向已连接设备发送文件（无需再次确认）
 * - 多文件并行批量传输（可配置并行度）
 * - 单文件取消支持（CancellationToken）
 * - 会话级批量取消支持
 * - 断点续传支持
 * - 传输进度跟踪（单文件 + 批量进度同步更新）
 * - 取消传输
 * - 详细传输调试日志
 * - 块上传自动重试（最多 3 次）
 *
 * 连接请求重试机制：
 * - 如果 HTTP 请求失败（连接超时/拒绝），可能是设备 IP 已变化
 * - 自动调用 discovery::refresh_device() 刷新设备信息
 * - 等待 1.5 秒让 mDNS 事件处理
 * - 使用最新 IP 地址重试一次（只重试一次）
 *
 * 并行传输说明：
 * - 默认并行度: 3 个文件同时传输
 * - 使用 Semaphore 限制并发数，避免带宽竞争
 * - 每个文件有独立的 CancellationToken，支持单独取消
 * - 会话取消时批量取消所有正在传输的文件
 * - 一个文件失败不影响其他文件继续传输
 *
 * 进度更新机制：
 * - 单文件进度: TransferProgress 事件，每 100ms 更新一次
 * - 批量进度: BatchProgress 事件，与单文件进度同步更新
 * - 使用原子操作（AtomicU64/AtomicU32）保证并行更新安全
 *
 * 调试日志说明：
 * - 📤 开始传输: 文件名、大小、目标地址
 * - 📡 HTTP请求: prepare-upload、upload、finish 请求和响应状态
 * - 📦 分块上传: 块大小、块数量、传输进度
 * - 📊 进度日志: 每传输 5MB 打印一次进度（百分比、速度、剩余时间）
 * - 🔄 断点续传/重试: 恢复偏移量、重试次数
 * - 📛 取消传输: 单文件取消或会话取消
 * - ❌ 错误信息: 详细的错误位置和原因
 *
 * 更新日志：
 * - 2026-02-04: cancel_file_transfer 现在同时支持发送方和接收方取消，调用 server::cancel_receiver_file
 * - 2026-02-04: 修复单文件取消后 UI 不消失问题，cancel_file_transfer 现在会更新文件状态并发送 BatchProgress
 * - 2026-02-04: 发送方取消文件时通知接收方（发送 /api/cancel 请求），实现双端同步
 * - 2026-02-03: 修复发送端速度显示为 0 的问题，添加 start_time 到 ParallelProgress
 * - 2026-02-03: 在 BatchTransferProgress 中添加 files 字段，包含每个文件的进度信息
 * - 2026-01-25: 添加连接请求失败自动重试机制（刷新设备 IP 后重试）
 * - 2026-01-25: 修复批量进度不更新问题，在并行传输中同步发送 BatchProgress 事件
 * - 2026-01-25: 修复会话取消不生效问题，取消时正确触发所有文件的 CancellationToken
 * - 2026-01-25: 重构为并行传输，添加单文件取消支持
 * - 2026-01-21: 添加详细传输调试日志，用于排查跨平台传输问题
 * - 2026-01-21: 添加块上传重试机制（最多 3 次），提高传输稳定性
 */

use super::discovery::get_event_sender;
use super::protocol::*;
use super::speed::SpeedTracker;
use super::{emit_lan_event, get_lan_transfer_state};
use chrono::Utc;
use futures::future::join_all;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// 偏移重对齐的最大连续次数（D-03：防止对端异常时无限循环）
const MAX_RESYNC_ATTEMPTS: u32 = 8;

// ============================================================================
// 并行传输配置
// ============================================================================

/// 最大并行传输数
const MAX_PARALLEL_TRANSFERS: usize = 3;

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum TransferError {
    #[error("设备未找到: {0}")]
    DeviceNotFound(String),
    #[error("请求未找到: {0}")]
    RequestNotFound(String),
    #[error("会话未找到: {0}")]
    SessionNotFound(String),
    #[error("连接失败: {0}")]
    ConnectionFailed(String),
    #[error("文件读取失败: {0}")]
    FileReadFailed(String),
    #[error("传输失败: {0}")]
    TransferFailed(String),
}

// ============================================================================
// 传输会话管理
// ============================================================================

/// 活跃的传输会话
static ACTIVE_SESSIONS: once_cell::sync::OnceCell<Arc<RwLock<HashMap<String, TransferSession>>>> =
    once_cell::sync::OnceCell::new();

/// 获取活跃会话
fn get_active_sessions() -> Arc<RwLock<HashMap<String, TransferSession>>> {
    ACTIVE_SESSIONS
        .get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
        .clone()
}

// ============================================================================
// 接收侧会话镜像（D-01：接收会话进统一会话表，前端会话桥可见）
// ============================================================================

/// 插入/更新接收方向的传输会话（server.rs 在 batch-prepare / prepare-upload 时调用）
pub fn upsert_receive_session(session: TransferSession) {
    let sessions = get_active_sessions();
    let mut sessions = sessions.write();
    sessions.insert(session.session_id.clone(), session);
}

/// 同步接收会话中单个文件的状态/字节（发送侧会话不受影响）
pub fn update_receive_session_file(
    session_id: &str,
    file_id: &str,
    transferred_bytes: u64,
    status: TransferStatus,
) {
    let sessions = get_active_sessions();
    let mut sessions = sessions.write();
    if let Some(session) = sessions.get_mut(session_id)
        && session.direction == TransferDirection::Receive
        && let Some(file_state) = session.files.iter_mut().find(|f| f.file.file_id == file_id)
    {
        file_state.transferred_bytes = transferred_bytes;
        file_state.status = status;
    }
}

/// 设置接收会话的整体状态
pub fn set_session_status(session_id: &str, status: SessionStatus) {
    let sessions = get_active_sessions();
    let mut sessions = sessions.write();
    if let Some(session) = sessions.get_mut(session_id)
        && session.direction == TransferDirection::Receive
    {
        session.status = status;
    }
}

/// 移除会话（任意方向；测试清理用）
#[allow(dead_code)]
pub fn remove_session(session_id: &str) {
    let sessions = get_active_sessions();
    let mut sessions = sessions.write();
    sessions.remove(session_id);
}

// ============================================================================
// 文件级错误信息暂存（供收尾时组装 failed_files，D-15）
// ============================================================================

static FILE_ERRORS: once_cell::sync::OnceCell<
    Arc<RwLock<HashMap<String, String>>>,
> = once_cell::sync::OnceCell::new();

fn get_file_errors() -> Arc<RwLock<HashMap<String, String>>> {
    FILE_ERRORS
        .get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
        .clone()
}

/// 记录文件级错误（哈希阶段/传输阶段），收尾组装 failed_files 时消费
fn record_file_error(file_id: &str, error: String) {
    get_file_errors().write().insert(file_id.to_string(), error);
}

/// 取出并移除文件级错误
fn take_file_error(file_id: &str) -> Option<String> {
    get_file_errors().write().remove(file_id)
}

/// 文件取消令牌存储（file_id -> CancellationToken）
static FILE_CANCEL_TOKENS: once_cell::sync::OnceCell<
    Arc<RwLock<HashMap<String, CancellationToken>>>,
> = once_cell::sync::OnceCell::new();

/// 获取文件取消令牌存储
fn get_file_cancel_tokens() -> Arc<RwLock<HashMap<String, CancellationToken>>> {
    FILE_CANCEL_TOKENS
        .get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
        .clone()
}

/// 为文件创建取消令牌
fn create_cancel_token(file_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    let tokens = get_file_cancel_tokens();
    tokens.write().insert(file_id.to_string(), token.clone());
    token
}

/// 移除取消令牌
fn remove_cancel_token(file_id: &str) {
    let tokens = get_file_cancel_tokens();
    tokens.write().remove(file_id);
}

/// 取消单个文件传输
/// 
/// 支持发送方和接收方取消：
/// - 发送方取消：取消本地任务 + 通知接收方
/// - 接收方取消：更新接收状态 + 通知发送方（TODO: 需要发送方支持）
/// 
/// 流程：
/// 1. 取消本地传输任务（如果是发送方）
/// 2. 查找会话（先查发送方会话，再查接收方会话）
/// 3. 更新文件状态为 Cancelled
/// 4. 通知对方取消
/// 5. 发送 BatchProgress 事件更新前端 UI
pub async fn cancel_file_transfer(file_id: &str) -> Result<(), TransferError> {
    let tokens = get_file_cancel_tokens();
    let token = {
        let tokens = tokens.read();
        tokens.get(file_id).cloned()
    };

    // 1. 取消本地传输任务（仅发送方有 token）
    let is_sender = token.is_some();
    if let Some(token) = token {
        token.cancel();
        println!("[LanTransfer] 📛 发送方取消文件传输: {}", file_id);
    }

    // 2. 查找包含此文件的会话
    // 先检查发送方会话（get_active_sessions）
    let (session_info, target_device) = {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        
        let mut found_session: Option<(String, u64, u64, u32, Vec<FileProgressInfo>)> = None;
        let mut found_device: Option<DiscoveredDevice> = None;
        
        for session in sessions.values_mut() {
            for file_state in &mut session.files {
                if file_state.file.file_id == file_id {
                    // 更新文件状态为 Cancelled
                    file_state.status = TransferStatus::Cancelled;
                    
                    // 收集会话信息用于发送 BatchProgress
                    let total_bytes: u64 = session.files.iter().map(|f| f.file.file_size).sum();
                    let transferred_bytes: u64 = session.files.iter().map(|f| f.transferred_bytes).sum();
                    // D-23：Cancelled 不计入 completed_files（否则头部 n/3 与总进度条互相矛盾）
                    let completed_files = session.files.iter()
                        .filter(|f| f.status == TransferStatus::Completed)
                        .count() as u32;
                    
                    let files_info: Vec<FileProgressInfo> = session.files.iter()
                        .map(|f| FileProgressInfo {
                            file_id: f.file.file_id.clone(),
                            file_name: f.file.file_name.clone(),
                            file_size: f.file.file_size,
                            transferred_bytes: f.transferred_bytes,
                            status: f.status.clone(),
                        })
                        .collect();
                    
                    found_session = Some((
                        session.session_id.clone(),
                        total_bytes,
                        transferred_bytes,
                        completed_files,
                        files_info,
                    ));
                    found_device = Some(session.target_device.clone());
                    break;
                }
            }
            if found_session.is_some() {
                break;
            }
        }
        
        (found_session, found_device)
    };

    // 如果在发送方会话中未找到，检查接收方会话
    // 返回: Option<(session_id, 对端设备, files_progress, 会话是否已收尾)>
    let receiver_session_info = if session_info.is_none() {
        super::server::cancel_receiver_file(file_id)
    } else {
        None
    };

    // 3. 通知对方取消（异步发送，不阻塞）
    if is_sender {
        // 发送方通知接收方
        if let Some(target) = target_device.clone() {
            let file_id_owned = file_id.to_string();
            let session_id = session_info.as_ref().map(|s| s.0.clone()).unwrap_or_default();
            
            tokio::spawn(async move {
                let cancel_url = format!(
                    "http://{}:{}/api/cancel",
                    target.ip_address, target.port
                );
                
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct CancelRequest {
                    session_id: String,
                    file_id: Option<String>,
                    keep_partial: bool,
                }
                
                let request = CancelRequest {
                    session_id,
                    file_id: Some(file_id_owned.clone()),
                    keep_partial: false,
                };
                
                let client = reqwest::Client::new();
                match client
                    .post(&cancel_url)
                    .json(&request)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                {
                    Ok(_) => println!("[LanTransfer] 已通知接收方取消文件: {}", file_id_owned),
                    Err(e) => println!("[LanTransfer] 通知接收方取消失败（不影响本地取消）: {}", e),
                }
            });
        }
    }
    // 注意：接收方取消时不需要主动通知发送方，发送方会在下次上传块时收到错误

    // 4. 发送事件更新前端 UI
    // 发送 TransferFailed 事件（兼容旧逻辑）
    let failed_event = LanTransferEvent::TransferFailed {
        task_id: file_id.to_string(),
        error: "用户取消".to_string(),
    };
    let _ = get_event_sender().send(failed_event.clone());
    emit_lan_event(&failed_event);

    // 发送 BatchProgress 事件（更新批量进度中的文件状态）
    if let Some((session_id, total_bytes, transferred_bytes, completed_files, files_info)) = session_info {
        // 发送方会话
        let total_files = files_info.len() as u32;

        let batch_progress = BatchTransferProgress {
            session_id,
            total_files,
            completed_files,
            total_bytes,
            transferred_bytes,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_info,
            direction: Some(TransferDirection::Send),
            peer_device_id: target_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: target_device.as_ref().map(|d| d.device_name.clone()),
        };

        let progress_event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(progress_event.clone());
        emit_lan_event(&progress_event);
    } else if let Some((session_id, peer_device, files_info, finished)) = receiver_session_info {
        // 接收方会话
        let total_files = files_info.len() as u32;
        // D-23：Cancelled 不计入 completed_files
        let completed_files = files_info.iter()
            .filter(|f| f.status == TransferStatus::Completed)
            .count() as u32;
        let total_bytes: u64 = files_info.iter().map(|f| f.file_size).sum();
        let transferred_bytes: u64 = files_info.iter().map(|f| f.transferred_bytes).sum();

        let batch_progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files,
            completed_files,
            total_bytes,
            transferred_bytes,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_info.clone(),
            direction: Some(TransferDirection::Receive),
            peer_device_id: peer_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: peer_device.as_ref().map(|d| d.device_name.clone()),
        };

        let progress_event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(progress_event.clone());
        emit_lan_event(&progress_event);

        // 接收会话再无活跃文件时收尾（D-05 同源口径：发 completed 收尾事件）
        if finished {
            let statuses: Vec<TransferStatus> = files_info.iter().map(|f| f.status.clone()).collect();
            let completed_event = LanTransferEvent::BatchTransferCompleted {
                session_id,
                total_files,
                save_directory: String::new(),
                outcome: Some(compute_batch_outcome(&statuses).to_string()),
                failed_files: Some(Vec::new()),
            };
            let _ = get_event_sender().send(completed_event.clone());
            emit_lan_event(&completed_event);
        }
    }

    Ok(())
}

/// 并行传输进度跟踪
struct ParallelProgress {
    /// 总字节数
    total_bytes: u64,
    /// 已传输字节数（原子更新）
    transferred_bytes: AtomicU64,
    /// 已完成文件数（原子更新）
    completed_files: AtomicU32,
    /// 总文件数
    total_files: u32,
    /// 会话 ID
    session_id: String,
    /// 对端设备（D-01/D-22：批量进度事件携带 peer 字段）
    peer_device: DiscoveredDevice,
    /// 速度滑窗采样器（D-21；多文件任务并发 record，用互斥锁保护）
    speed_tracker: std::sync::Mutex<SpeedTracker>,
}

// ============================================================================
// 连接管理（旧版兼容）
// ============================================================================

/// 发送连接请求（旧版兼容）
pub async fn send_connection_request(device_id: &str) -> Result<String, TransferError> {
    let state = get_lan_transfer_state();

    // 获取目标设备信息
    let target_device = {
        let devices = state.devices.read();
        devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| TransferError::DeviceNotFound(device_id.to_string()))?
    };

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| TransferError::ConnectionFailed("本地服务未启动".to_string()))?
    };

    // 构建请求数据
    let request_device = DiscoveredDevice {
        device_id: local_device.device_id.clone(),
        device_name: local_device.device_name.clone(),
        user_id: local_device.user_id.clone(),
        user_nickname: local_device.user_nickname.clone(),
        ip_address: local_device.ip_address.clone(),
        port: local_device.port,
        discovered_at: Utc::now().to_rfc3339(),
        last_seen: Utc::now().to_rfc3339(),
    };

    // 发送 HTTP 请求
    let url = format!(
        "http://{}:{}/api/connect",
        target_device.ip_address, target_device.port
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request_device)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    if !response.status().is_success() {
        return Err(TransferError::ConnectionFailed(format!(
            "服务器返回错误: {}",
            response.status()
        )));
    }

    #[derive(serde::Deserialize)]
    struct ConnectResponse {
        request_id: String,
    }

    let resp: ConnectResponse = response
        .json()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    println!(
        "[LanTransfer] 连接请求已发送到 {} ({})",
        target_device.device_name, target_device.ip_address
    );

    Ok(resp.request_id)
}

/// 响应连接请求（旧版本）
///
/// 注：前端 useLanTransfer.ts 仍在通过 `respond_to_connection_request` 命令调用；
/// 新点对点接口为 `respond_peer_connection`，两者并存。
#[allow(deprecated)]
pub async fn respond_to_request(request_id: &str, accept: bool) -> Result<(), TransferError> {
    let state = get_lan_transfer_state();

    // 获取请求
    let request = {
        let mut pending = state.pending_requests.write();
        pending
            .remove(request_id)
            .ok_or_else(|| TransferError::RequestNotFound(request_id.to_string()))?
    };

    // 发送事件
    let _ = get_event_sender().send(LanTransferEvent::ConnectionResponse {
        request_id: request_id.to_string(),
        accepted: accept,
    });

    println!(
        "[LanTransfer] 连接请求 {} 已{}: {} ({})",
        request_id,
        if accept { "接受" } else { "拒绝" },
        request.from_device.device_name,
        request.from_device.ip_address
    );

    Ok(())
}

// ============================================================================
// 点对点连接管理（新版）
// ============================================================================

/// 请求建立点对点连接
///
/// 如果已与该设备建立连接，则返回现有连接 ID（防止重复连接）
///
/// 失败重试机制：
/// - 如果 HTTP 请求失败（连接超时/拒绝），可能是设备 IP 已变化
/// - 自动触发 mDNS 刷新，等待短暂时间后用最新 IP 重试一次
pub async fn request_peer_connection(device_id: &str) -> Result<String, TransferError> {
    use super::server::get_active_peer_connections_map;

    // ========== 检查是否已存在与该设备的连接（去重）==========
    {
        let connections = get_active_peer_connections_map();
        let connections = connections.lock();
        for (conn_id, conn) in connections.iter() {
            if conn.peer_device.device_id == device_id
                && conn.status == PeerConnectionStatus::Connected
            {
                println!(
                    "[LanTransfer] 已存在与 {} 的连接: {}，跳过重复请求",
                    device_id, conn_id
                );
                return Ok(conn_id.clone());
            }
        }
    }

    // 尝试发送请求，失败后刷新设备信息并重试一次
    match do_request_peer_connection(device_id).await {
        Ok(connection_id) => Ok(connection_id),
        Err(first_error) => {
            println!(
                "[LanTransfer] ⚠️ 连接请求失败: {}，尝试刷新设备信息后重试",
                first_error
            );

            // 触发 mDNS 刷新
            if let Err(e) = super::discovery::refresh_device(device_id) {
                println!("[LanTransfer] 刷新设备失败: {}", e);
            }

            // 等待 mDNS 事件处理（1.5 秒）
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

            // 用最新信息重试一次
            println!("[LanTransfer] 🔄 使用最新设备信息重试连接请求...");
            do_request_peer_connection(device_id).await.map_err(|retry_error| {
                println!(
                    "[LanTransfer] ❌ 重试失败: {}（原始错误: {}）",
                    retry_error, first_error
                );
                retry_error
            })
        }
    }
}

/// 实际执行连接请求的内部函数
async fn do_request_peer_connection(device_id: &str) -> Result<String, TransferError> {
    let state = get_lan_transfer_state();

    println!("[LanTransfer] ========== 发起连接请求 ==========");
    println!("[LanTransfer] 目标设备 ID: {}", device_id);

    // 获取目标设备信息
    let target_device = {
        let devices = state.devices.read();
        println!("[LanTransfer] 当前设备列表 ({} 个):", devices.len());
        for (id, dev) in devices.iter() {
            println!("[LanTransfer]   - {} ({}) @ {}:{}", 
                dev.device_name, id, dev.ip_address, dev.port);
        }
        devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| {
                println!("[LanTransfer] ❌ 目标设备不在列表中: {}", device_id);
                TransferError::DeviceNotFound(device_id.to_string())
            })?
    };

    println!("[LanTransfer] ✓ 找到目标设备: {} @ {}:{}", 
        target_device.device_name, target_device.ip_address, target_device.port);

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| {
                println!("[LanTransfer] ❌ 本地服务未启动");
                TransferError::ConnectionFailed("本地服务未启动".to_string())
            })?
    };

    println!("[LanTransfer] 本机信息: {} @ {}:{}", 
        local_device.device_name, local_device.ip_address, local_device.port);

    // 构建请求数据
    let from_device = DiscoveredDevice {
        device_id: local_device.device_id.clone(),
        device_name: local_device.device_name.clone(),
        user_id: local_device.user_id.clone(),
        user_nickname: local_device.user_nickname.clone(),
        ip_address: local_device.ip_address.clone(),
        port: local_device.port,
        discovered_at: Utc::now().to_rfc3339(),
        last_seen: Utc::now().to_rfc3339(),
    };

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RequestBody {
        from_device: DiscoveredDevice,
    }

    // 发送 HTTP 请求
    let url = format!(
        "http://{}:{}/api/peer-connection-request",
        target_device.ip_address, target_device.port
    );

    println!("[LanTransfer] 📡 HTTP POST 请求:");
    println!("[LanTransfer]   URL: {}", url);
    println!("[LanTransfer]   本机 IP: {}:{}", local_device.ip_address, local_device.port);
    println!("[LanTransfer]   目标 IP: {}:{}", target_device.ip_address, target_device.port);
    println!("[LanTransfer]   超时: 5 秒");

    let start_time = std::time::Instant::now();
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&RequestBody { from_device })
        .timeout(std::time::Duration::from_secs(5)) // 缩短超时时间以加快重试
        .send()
        .await
        .map_err(|e| {
            let elapsed = start_time.elapsed();
            println!("[LanTransfer] ❌ HTTP 请求失败 (耗时 {:?}): {}", elapsed, e);
            TransferError::ConnectionFailed(format!("{} (目标: {}:{})", e, target_device.ip_address, target_device.port))
        })?;

    let elapsed = start_time.elapsed();
    println!("[LanTransfer] ✓ HTTP 响应收到 (耗时 {:?}): 状态码 {}", elapsed, response.status());

    if !response.status().is_success() {
        println!("[LanTransfer] ❌ 服务器返回错误状态码");
        return Err(TransferError::ConnectionFailed(format!(
            "服务器返回错误: {}",
            response.status()
        )));
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Response {
        connection_id: String,
    }

    let resp: Response = response
        .json()
        .await
        .map_err(|e| {
            println!("[LanTransfer] ❌ 解析响应 JSON 失败: {}", e);
            TransferError::ConnectionFailed(e.to_string())
        })?;

    // 注意：不在此处保存连接！
    // 连接只在对方接受后，通过 handle_peer_connection_response 创建
    // 这样可以避免去重检查误判，以及拒绝后需要清理的问题

    println!("[LanTransfer] ✅ 连接请求成功，connection_id: {}", resp.connection_id);
    println!("[LanTransfer] ========== 等待对方确认 ==========");

    Ok(resp.connection_id)
}

/// 响应点对点连接请求（接收方调用）
pub async fn respond_peer_connection(
    connection_id: &str,
    accept: bool,
) -> Result<(), TransferError> {
    use super::server::{get_active_peer_connections_map, get_pending_peer_connection_requests_map};

    println!("[LanTransfer] ========== 响应连接请求 ==========");
    println!("[LanTransfer] 连接 ID: {}", connection_id);
    println!("[LanTransfer] 接受连接: {}", accept);

    // 获取待处理的连接请求
    let request = {
        let requests = get_pending_peer_connection_requests_map();
        let mut requests = requests.lock();
        println!("[LanTransfer] 待处理请求列表 ({} 个):", requests.len());
        for (id, req) in requests.iter() {
            println!("[LanTransfer]   - {} 来自 {} @ {}:{}", 
                id, req.from_device.device_name, req.from_device.ip_address, req.from_device.port);
        }
        requests
            .remove(connection_id)
            .ok_or_else(|| {
                println!("[LanTransfer] ❌ 找不到连接请求: {}", connection_id);
                TransferError::RequestNotFound(connection_id.to_string())
            })?
    };

    println!("[LanTransfer] ✓ 找到请求，来自: {} @ {}:{}", 
        request.from_device.device_name, request.from_device.ip_address, request.from_device.port);

    let state = get_lan_transfer_state();

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| {
                println!("[LanTransfer] ❌ 本地服务未启动");
                TransferError::ConnectionFailed("本地服务未启动".to_string())
            })?
    };

    println!("[LanTransfer] 本机信息: {} @ {}:{}", 
        local_device.device_name, local_device.ip_address, local_device.port);

    // 构建响应数据
    let from_device = if accept {
        Some(DiscoveredDevice {
            device_id: local_device.device_id.clone(),
            device_name: local_device.device_name.clone(),
            user_id: local_device.user_id.clone(),
            user_nickname: local_device.user_nickname.clone(),
            ip_address: local_device.ip_address.clone(),
            port: local_device.port,
            discovered_at: Utc::now().to_rfc3339(),
            last_seen: Utc::now().to_rfc3339(),
        })
    } else {
        None
    };

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ResponseBody {
        connection_id: String,
        accepted: bool,
        from_device: Option<DiscoveredDevice>,
    }

    // 发送响应到发起方
    let url = format!(
        "http://{}:{}/api/peer-connection-response",
        request.from_device.ip_address, request.from_device.port
    );

    println!("[LanTransfer] 📡 发送 HTTP 响应:");
    println!("[LanTransfer]   URL: {}", url);
    println!("[LanTransfer]   本机 IP: {}:{}", local_device.ip_address, local_device.port);
    println!("[LanTransfer]   目标 IP: {}:{}", request.from_device.ip_address, request.from_device.port);
    println!("[LanTransfer]   超时: 10 秒");

    let start_time = std::time::Instant::now();
    let client = reqwest::Client::new();
    let _ = client
        .post(&url)
        .json(&ResponseBody {
            connection_id: connection_id.to_string(),
            accepted: accept,
            from_device: from_device.clone(),
        })
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            let elapsed = start_time.elapsed();
            println!("[LanTransfer] ❌ HTTP 响应发送失败 (耗时 {:?}): {}", elapsed, e);
            TransferError::ConnectionFailed(format!("{} (目标: {}:{})", e, request.from_device.ip_address, request.from_device.port))
        })?;

    let elapsed = start_time.elapsed();
    println!("[LanTransfer] ✓ HTTP 响应发送成功 (耗时 {:?})", elapsed);

    if accept {
        // 接收方也创建连接
        let connection = PeerConnection {
            connection_id: connection_id.to_string(),
            peer_device: request.from_device.clone(),
            established_at: Utc::now().to_rfc3339(),
            status: PeerConnectionStatus::Connected,
            is_initiator: false, // 接收方
        };

        {
            let connections = get_active_peer_connections_map();
            let mut connections = connections.lock();
            connections.insert(connection_id.to_string(), connection.clone());
            println!("[LanTransfer] ✓ 连接已保存 (共 {} 个活跃连接)", connections.len());
        }

        // 发送事件通知前端
        let event = LanTransferEvent::PeerConnectionEstablished { connection };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
        println!("[LanTransfer] ✓ 已发送 PeerConnectionEstablished 事件到前端");
    }

    println!(
        "[LanTransfer] ========== {} 完成 ==========",
        if accept { "接受连接" } else { "拒绝连接" }
    );
    println!(
        "[LanTransfer] 连接请求 {} 已{}: {} ({})",
        connection_id,
        if accept { "接受" } else { "拒绝" },
        request.from_device.device_name,
        request.from_device.ip_address
    );

    Ok(())
}

/// 断开点对点连接
pub async fn disconnect_peer(connection_id: &str) -> Result<(), TransferError> {
    use super::server::get_active_peer_connections_map;

    // 获取连接信息
    let connection = {
        let connections = get_active_peer_connections_map();
        let mut connections = connections.lock();
        connections.remove(connection_id)
    };

    if let Some(conn) = connection {
        // 通知对方断开
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct DisconnectBody {
            connection_id: String,
        }

        let url = format!(
            "http://{}:{}/api/peer-disconnect",
            conn.peer_device.ip_address, conn.peer_device.port
        );

        let client = reqwest::Client::new();
        let _ = client
            .post(&url)
            .json(&DisconnectBody {
                connection_id: connection_id.to_string(),
            })
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        // 发送事件通知前端
        let event = LanTransferEvent::PeerConnectionClosed {
            connection_id: connection_id.to_string(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        println!("[LanTransfer] 连接已断开: {}", connection_id);
    }

    Ok(())
}

/// 获取活跃的点对点连接
pub fn get_active_peer_connections() -> Vec<PeerConnection> {
    use super::server::get_active_peer_connections_map;

    let connections = get_active_peer_connections_map();
    let connections = connections.lock();
    connections.values().cloned().collect()
}

/// 获取待处理的连接请求
pub fn get_pending_peer_connection_requests() -> Vec<PeerConnectionRequest> {
    use super::server::get_pending_peer_connection_requests_map;

    let requests = get_pending_peer_connection_requests_map();
    let requests = requests.lock();
    requests.values().cloned().collect()
}

/// 向已连接的设备发送文件（无需再次确认）
pub async fn send_files_to_peer(
    connection_id: &str,
    file_paths: Vec<String>,
) -> Result<String, TransferError> {
    use super::server::get_active_peer_connections_map;

    // 获取连接信息
    let connection = {
        let connections = get_active_peer_connections_map();
        let connections = connections.lock();
        connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| TransferError::ConnectionFailed("连接不存在".to_string()))?
    };

    if connection.status != PeerConnectionStatus::Connected {
        return Err(TransferError::ConnectionFailed("连接已断开".to_string()));
    }

    // 使用现有的批量传输逻辑
    let session_id = start_direct_batch_transfer(
        connection_id,
        &connection.peer_device,
        file_paths,
    )
    .await?;

    Ok(session_id)
}

/// 直接开始批量传输（已建立连接，无需确认）
///
/// D-07a：本函数只做「快速枚举元信息 + 建会话」，立即返回 sessionId；
/// 哈希计算（原先阻塞命令返回，GB 级文件会让「发送已开始」迟滞数十秒）
/// 移交到后台任务中用 `spawn_blocking` 执行，进度经 hashing_progress 事件呈现。
async fn start_direct_batch_transfer(
    connection_id: &str,
    target_device: &DiscoveredDevice,
    file_paths: Vec<String>,
) -> Result<String, TransferError> {
    let state = get_lan_transfer_state();

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| TransferError::ConnectionFailed("本地服务未启动".to_string()))?
    };

    // 1. 快速枚举文件元信息（只读 metadata，不读内容、不算哈希）
    let mut files: Vec<FileMetadata> = Vec::new();
    let mut total_size: u64 = 0;

    for file_path in &file_paths {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(TransferError::FileReadFailed(format!(
                "文件不存在: {}",
                file_path
            )));
        }

        let metadata = std::fs::metadata(path)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let file_size = metadata.len();
        total_size += file_size;

        let mime_type = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();

        files.push(FileMetadata {
            file_id: Uuid::new_v4().to_string(),
            file_name,
            file_size,
            mime_type,
            // D-07a：哈希延后到后台任务计算，此处占位
            sha256: String::new(),
        });
    }

    let session_id = Uuid::new_v4().to_string();

    // 2. 先建会话并立即返回 sessionId（哈希不阻塞命令）
    let session = TransferSession {
        session_id: session_id.clone(),
        connection_id: connection_id.to_string(),
        request_id: String::new(),
        files: files
            .iter()
            .map(|f| FileTransferState {
                file: f.clone(),
                status: TransferStatus::Pending,
                transferred_bytes: 0,
                resume_info: None,
            })
            .collect(),
        file_paths: file_paths.clone(),
        status: SessionStatus::Transferring,
        created_at: Utc::now().to_rfc3339(),
        target_device: target_device.clone(),
        direction: TransferDirection::Send,
    };

    // 保存会话
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        sessions.insert(session_id.clone(), session);
    }

    // 3. 立即发一次初始批量进度（前端马上能看到批次卡片，哈希阶段走 hashing_progress）
    {
        let total_files = files.len() as u32;
        let batch_progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files,
            completed_files: 0,
            total_bytes: total_size,
            transferred_bytes: 0,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files
                .iter()
                .map(|f| FileProgressInfo {
                    file_id: f.file_id.clone(),
                    file_name: f.file_name.clone(),
                    file_size: f.file_size,
                    transferred_bytes: 0,
                    status: TransferStatus::Pending,
                })
                .collect(),
            direction: Some(TransferDirection::Send),
            peer_device_id: Some(target_device.device_id.clone()),
            peer_device_name: Some(target_device.device_name.clone()),
        };
        let event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
    }

    // 4. 后台任务：spawn_blocking 哈希 → batch-prepare → 批量传输
    let session_id_clone = session_id.clone();
    let file_paths_clone = file_paths.clone();
    let target = target_device.clone();
    let conn_id = connection_id.to_string();
    let file_count = files.len();
    tokio::spawn(async move {
        if let Err(e) = prepare_and_start_batch(
            &session_id_clone,
            &conn_id,
            &target,
            &local_device,
            files,
            file_paths_clone,
        )
        .await
        {
            eprintln!("[LanTransfer] 批量传输失败: {}", e);
        }
    });

    println!(
        "[LanTransfer] 开始向 {} 传输 {} 个文件（会话 {}，哈希后台计算中）",
        target_device.device_name,
        file_count,
        session_id
    );

    Ok(session_id)
}

/// 后台：哈希 → batch-prepare → 启动批量传输（D-07a 拆分出的后半程）
async fn prepare_and_start_batch(
    session_id: &str,
    connection_id: &str,
    target_device: &DiscoveredDevice,
    local_device: &DeviceInfo,
    files: Vec<FileMetadata>,
    file_paths: Vec<String>,
) -> Result<(), TransferError> {
    let total_files = files.len() as u32;

    // 1. spawn_blocking 计算全部文件哈希（同步 IO 不再阻塞异步运行时）
    let mut jobs: Vec<(usize, String, String, u32)> = Vec::new();
    for (index, meta) in files.iter().enumerate() {
        jobs.push((
            index,
            file_paths[index].clone(),
            meta.file_name.clone(),
            (index + 1) as u32,
        ));
    }
    let hash_results = tokio::task::spawn_blocking(move || {
        let mut results: Vec<(usize, Result<String, String>)> = Vec::new();
        for (index, path, file_name, current_file) in jobs {
            let res = calculate_file_hash_with_progress(Path::new(&path), Some(move |processed, total| {
                emit_lan_event(&LanTransferEvent::HashingProgress {
                    file_name: file_name.clone(),
                    file_size: total,
                    processed_bytes: processed,
                    current_file,
                    total_files,
                });
            }))
            .map_err(|e| e.to_string());
            results.push((index, res));
        }
        results
    })
    .await
    .map_err(|e| TransferError::TransferFailed(format!("哈希任务执行失败: {}", e)))?;

    // 2. 哈希写回会话；失败的文件标 Failed 并记录错误（收尾时进 failed_files）
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        // 哈希期间整批被取消：cancel_session 已发过终态事件，这里直接退出
        let cancelled_during_hashing = sessions
            .get(session_id)
            .map(|s| s.status == SessionStatus::Cancelled)
            .unwrap_or(false);
        if cancelled_during_hashing {
            println!("[LanTransfer] 会话 {} 在哈希阶段被取消，跳过传输", session_id);
            return Ok(());
        }
        if let Some(s) = sessions.get_mut(session_id) {
            for (index, res) in &hash_results {
                match res {
                    Ok(hash) => {
                        if let Some(fs) = s.files.get_mut(*index) {
                            fs.file.sha256 = hash.clone();
                        }
                    }
                    Err(err) => {
                        if let Some(fs) = s.files.get_mut(*index) {
                            fs.status = TransferStatus::Failed;
                            record_file_error(&fs.file.file_id, err.clone());
                            let event = LanTransferEvent::TransferFailed {
                                task_id: fs.file.file_id.clone(),
                                error: format!("哈希计算失败: {}", err),
                            };
                            let _ = get_event_sender().send(event.clone());
                            emit_lan_event(&event);
                        }
                    }
                }
            }
        }
    }

    // 3. 会话可能在哈希期间被取消：cancel_session 已发过终态事件，直接退出
    {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        if sessions
            .get(session_id)
            .map(|s| s.status == SessionStatus::Cancelled)
            .unwrap_or(false)
        {
            println!("[LanTransfer] 会话 {} 在启动传输前被取消", session_id);
            return Ok(());
        }
    }

    // 4. 通知对方准备接收（batch-prepare：携带真实哈希的元信息）
    let from_device = DiscoveredDevice {
        device_id: local_device.device_id.clone(),
        device_name: local_device.device_name.clone(),
        user_id: local_device.user_id.clone(),
        user_nickname: local_device.user_nickname.clone(),
        ip_address: local_device.ip_address.clone(),
        port: local_device.port,
        discovered_at: Utc::now().to_rfc3339(),
        last_seen: Utc::now().to_rfc3339(),
    };

    use super::protocol::{BatchPrepareRequest, BatchPrepareResponse};

    let total_size: u64 = files.iter().map(|f| f.file_size).sum();
    let batch_prepare_url = format!(
        "http://{}:{}/api/batch-prepare",
        target_device.ip_address, target_device.port
    );

    let batch_prepare_request = BatchPrepareRequest {
        session_id: session_id.to_string(),
        files: files.clone(),
        total_size,
        from_device,
    };

    let client = reqwest::Client::new();
    let batch_prepare_result = client
        .post(&batch_prepare_url)
        .json(&batch_prepare_request)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    match batch_prepare_result {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(resp) = response.json::<BatchPrepareResponse>().await {
                    println!(
                        "[LanTransfer] 📦 batch-prepare 成功: session={}, 文件数={}",
                        resp.session_id, resp.file_count
                    );
                }
            } else {
                println!(
                    "[LanTransfer] ⚠ batch-prepare 响应非成功状态: {}",
                    response.status()
                );
            }
        }
        Err(e) => {
            // batch-prepare 失败不阻止传输，接收端会在 prepare-upload 时创建会话
            println!("[LanTransfer] ⚠ batch-prepare 请求失败 (将降级为单文件模式): {}", e);
        }
    }

    // 5. 启动批量传输（只为 Pending 状态的文件创建任务，哈希失败的已被跳过）
    start_batch_transfer(session_id, file_paths).await?;

    let _ = connection_id; // 连接 ID 目前仅记录在会话中
    Ok(())
}


// ============================================================================
// 批量文件传输
// ============================================================================

/// 开始批量传输（并行）
///
/// 使用 Semaphore 限制并发数，每个文件有独立的 CancellationToken
/// 一个文件失败不影响其他文件继续传输
///
/// 传输期间会暂停设备验证任务，避免高负载时误判设备离线
pub async fn start_batch_transfer(
    session_id: &str,
    file_paths: Vec<String>,
) -> Result<(), TransferError> {
    // 获取会话信息
    let session = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        sessions.get(session_id).cloned()
    };

    let session = session.ok_or_else(|| TransferError::SessionNotFound(session_id.to_string()))?;

    // 哈希/等待阶段会话可能已被整批取消：cancel_session 已发过终态事件，直接退出
    if session.status == SessionStatus::Cancelled {
        println!("[LanTransfer] 会话 {} 已取消，不启动批量传输", session_id);
        return Ok(());
    }

    // 设置活跃传输标志（暂停设备验证，D-10：引用计数）
    // 在确认会话存在后设置，避免无效请求也暂停验证
    super::discovery::set_active_transfer(true);

    let target_device = session.target_device.clone();
    let session_id_owned = session_id.to_string();
    let files = session.files.clone();

    // 更新会话状态
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(s) = sessions.get_mut(session_id) {
            s.status = SessionStatus::Transferring;
        }
    }

    let total_files = files.len() as u32;
    let total_bytes: u64 = files.iter().map(|f| f.file.file_size).sum();

    // 创建并行进度跟踪
    let progress = Arc::new(ParallelProgress {
        total_bytes,
        transferred_bytes: AtomicU64::new(0),
        completed_files: AtomicU32::new(0),
        total_files,
        session_id: session_id.to_string(),
        peer_device: target_device.clone(),
        speed_tracker: std::sync::Mutex::new(SpeedTracker::new()),
    });

    // 发送初始进度
    emit_batch_progress(&progress, None);

    // 创建信号量限制并发数
    let semaphore = Arc::new(Semaphore::new(MAX_PARALLEL_TRANSFERS));

    println!(
        "[LanTransfer] 🚀 开始并行批量传输: {} 个文件, 并行度 {}",
        total_files, MAX_PARALLEL_TRANSFERS
    );

    // 为每个待传输文件创建并行任务
    // （哈希阶段失败的文件已标 Failed，不再是 Pending，不创建任务）
    let handles: Vec<_> = files
        .iter()
        .zip(file_paths.iter())
        .enumerate()
        .filter(|(_, (file_state, _))| file_state.status == TransferStatus::Pending)
        .map(|(index, (file_state, file_path))| {
            let file_meta = file_state.file.clone();
            let file_path = file_path.clone();
            let target_device = target_device.clone();
            let session_id = session_id_owned.clone();
            let sem = semaphore.clone();
            let progress = progress.clone();

            // 为每个文件创建取消令牌
            let cancel_token = create_cancel_token(&file_meta.file_id);

            tokio::spawn(async move {
                // 获取信号量许可（限制并发）
                let _permit = sem.acquire().await.expect("Semaphore closed");

                // 检查是否已被取消
                if cancel_token.is_cancelled() {
                    return (index, file_meta.clone(), Err(TransferError::TransferFailed("用户取消".to_string())));
                }

                // 使用 select! 支持取消
                let result = tokio::select! {
                    result = do_file_transfer_with_resume_parallel(
                        &target_device,
                        &session_id,
                        &file_meta,
                        &file_path,
                        index,
                        progress.clone(),
                    ) => result,
                    _ = cancel_token.cancelled() => {
                        Err(TransferError::TransferFailed("用户取消".to_string()))
                    }
                };

                // 移除取消令牌
                remove_cancel_token(&file_meta.file_id);

                (index, file_meta, result)
            })
        })
        .collect();

    // 等待所有任务完成
    let results = join_all(handles).await;

    // 逐文件落账：D-06 —— Cancelled 保留不回退 Failed；
    // 同时收集失败文件的错误信息供收尾组装 failed_files（D-15）
    let mut failed_files: Vec<FailedFileInfo> = Vec::new();
    for result in results {
        match result {
            Ok((index, file_meta, transfer_result)) => {
                let sessions = get_active_sessions();
                let mut sessions = sessions.write();

                match transfer_result {
                    Ok(_bytes) => {
                        if let Some(s) = sessions.get_mut(&session_id_owned)
                            && let Some(fs) = s.files.get_mut(index)
                        {
                            fs.status = settle_transfer_status(&fs.status, false);
                            fs.transferred_bytes = file_meta.file_size;
                        }
                    }
                    Err(e) => {
                        if let Some(s) = sessions.get_mut(&session_id_owned)
                            && let Some(fs) = s.files.get_mut(index)
                        {
                            let was_cancelled = fs.status == TransferStatus::Cancelled;
                            fs.status = settle_transfer_status(&fs.status, true);
                            if was_cancelled {
                                // 用户主动跳过：cancel_file_transfer 已发过事件，不重复发 failed
                                continue;
                            }
                            record_file_error(&file_meta.file_id, e.to_string());
                            failed_files.push(FailedFileInfo {
                                file_id: file_meta.file_id.clone(),
                                file_name: file_meta.file_name.clone(),
                                error: e.to_string(),
                            });

                            // 发送失败事件
                            let event = LanTransferEvent::TransferFailed {
                                task_id: file_meta.file_id.clone(),
                                error: e.to_string(),
                            };
                            let _ = get_event_sender().send(event.clone());
                            emit_lan_event(&event);
                        } else {
                            eprintln!(
                                "[LanTransfer] 文件传输失败: {} - {}",
                                file_meta.file_name, e
                            );
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[LanTransfer] 任务执行错误: {}", e);
            }
        }
    }

    // 读取最终文件状态（含哈希阶段失败的文件）
    let (files_info, statuses) = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        match sessions.get(&session_id_owned) {
            Some(s) => (
                s.files
                    .iter()
                    .map(|f| FileProgressInfo {
                        file_id: f.file.file_id.clone(),
                        file_name: f.file.file_name.clone(),
                        file_size: f.file.file_size,
                        transferred_bytes: f.transferred_bytes,
                        status: f.status.clone(),
                    })
                    .collect::<Vec<_>>()
                    ,
                s.files.iter().map(|f| f.status.clone()).collect::<Vec<_>>(),
            ),
            None => (Vec::new(), Vec::new()),
        }
    };

    // 补齐 failed_files：哈希阶段失败 / join 失败的文件不在上面循环里
    for f in &files_info {
        if f.status == TransferStatus::Failed
            && !failed_files.iter().any(|ff| ff.file_id == f.file_id)
        {
            failed_files.push(FailedFileInfo {
                file_id: f.file_id.clone(),
                file_name: f.file_name.clone(),
                error: take_file_error(&f.file_id)
                    .unwrap_or_else(|| "传输失败".to_string()),
            });
        }
    }

    // 会话终态（与 outcome 一致；partial 沿用旧口径标 Completed，失败详情走 failed_files）
    let outcome = compute_batch_outcome(&statuses);
    let session_status = match outcome {
        "failed" => SessionStatus::Failed,
        "cancelled" => SessionStatus::Cancelled,
        _ => SessionStatus::Completed,
    };
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(s) = sessions.get_mut(&session_id_owned) {
            s.status = session_status;
        }
    }

    // D-15：先发带最终 files 的 batch_progress（已取消会话跳过，避免覆盖取消终态），
    // 再发带 outcome / failed_files 的 completed 事件
    if outcome != "cancelled" {
        let transferred: u64 = files_info.iter().map(|f| f.transferred_bytes).sum();
        let completed = files_info
            .iter()
            .filter(|f| f.status == TransferStatus::Completed)
            .count() as u32;
        let batch_progress = BatchTransferProgress {
            session_id: session_id_owned.clone(),
            total_files: files_info.len() as u32,
            completed_files: completed,
            total_bytes: files_info.iter().map(|f| f.file_size).sum(),
            transferred_bytes: transferred,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_info,
            direction: Some(TransferDirection::Send),
            peer_device_id: Some(progress.peer_device.device_id.clone()),
            peer_device_name: Some(progress.peer_device.device_name.clone()),
        };
        let progress_event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(progress_event.clone());
        emit_lan_event(&progress_event);
    }

    // 发送批量完成事件
    let event = LanTransferEvent::BatchTransferCompleted {
        session_id: session_id_owned.clone(),
        total_files,
        save_directory: String::new(),
        outcome: Some(outcome.to_string()),
        failed_files: Some(failed_files),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    let success_count = statuses.iter().filter(|s| **s == TransferStatus::Completed).count();
    let fail_count = statuses.iter().filter(|s| **s == TransferStatus::Failed).count();
    println!(
        "[LanTransfer] 批量传输完成: {}/{} 成功, {} 失败 (outcome={}) -> {}",
        success_count,
        total_files,
        fail_count,
        outcome,
        target_device.device_name
    );

    // 清除活跃传输标志（恢复设备验证）
    super::discovery::set_active_transfer(false);

    if fail_count > 0 && success_count == 0 && outcome == "failed" {
        Err(TransferError::TransferFailed("所有文件传输失败".to_string()))
    } else {
        Ok(())
    }
}

/// 传输结果落账（纯函数）：Cancelled 不回退为 Failed（D-06）。
/// - 结果成功 → Completed
/// - 结果失败 → 当前已是 Cancelled 则保留，否则 Failed
fn settle_transfer_status(current: &TransferStatus, result_failed: bool) -> TransferStatus {
    if *current == TransferStatus::Cancelled {
        return TransferStatus::Cancelled;
    }
    if result_failed {
        TransferStatus::Failed
    } else {
        TransferStatus::Completed
    }
}

/// 发送批量进度事件
/// 如果会话已取消，则不发送事件（避免取消后进度事件覆盖完成事件）
fn emit_batch_progress(progress: &ParallelProgress, current_file: Option<FileMetadata>) {
    // 检查会话状态，如果已取消则不发送进度事件
    // 同时获取文件列表用于前端显示
    let files_info = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        if let Some(session) = sessions.get(&progress.session_id) {
            if session.status == SessionStatus::Cancelled {
                return;
            }
            // 将 FileTransferState 转换为 FileProgressInfo
            session
                .files
                .iter()
                .map(|f| FileProgressInfo {
                    file_id: f.file.file_id.clone(),
                    file_name: f.file.file_name.clone(),
                    file_size: f.file.file_size,
                    transferred_bytes: f.transferred_bytes,
                    status: f.status.clone(),
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        }
    };

    // 计算传输速度和剩余时间（D-21：滑动窗口，而非全程平均）
    let transferred = progress.transferred_bytes.load(Ordering::Relaxed);
    // 毒化恢复：锁内只做采样计算，panic 后仍可用（跳过脏状态不现实，直接续用）
    let speed = progress
        .speed_tracker
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .record(transferred);
    let remaining = progress.total_bytes.saturating_sub(transferred);
    let eta_seconds = remaining.checked_div(speed);

    let batch_progress = BatchTransferProgress {
        session_id: progress.session_id.clone(),
        total_files: progress.total_files,
        completed_files: progress.completed_files.load(Ordering::Relaxed),
        total_bytes: progress.total_bytes,
        transferred_bytes: transferred,
        speed,
        current_file,
        eta_seconds,
        files: files_info,
        direction: Some(TransferDirection::Send),
        peer_device_id: Some(progress.peer_device.device_id.clone()),
        peer_device_name: Some(progress.peer_device.device_name.clone()),
    };

    let event = LanTransferEvent::BatchProgress {
        progress: batch_progress,
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);
}

/// 执行单文件传输（并行版本）
async fn do_file_transfer_with_resume_parallel(
    target_device: &DiscoveredDevice,
    session_id: &str,
    file_meta: &FileMetadata,
    file_path: &str,
    file_index: usize,
    progress: Arc<ParallelProgress>,
) -> Result<u64, TransferError> {
    let base_url = format!("http://{}:{}", target_device.ip_address, target_device.port);

    println!(
        "[LanTransfer] 📤 [并行] 开始传输文件: {} ({}) -> {}:{}",
        file_meta.file_name,
        format_bytes(file_meta.file_size),
        target_device.ip_address,
        target_device.port
    );

    let client = reqwest::Client::new();

    // 1. 发送准备上传请求
    let prepare_url = format!("{}/api/prepare-upload", base_url);
    let prepare_request = PrepareUploadRequest {
        session_id: session_id.to_string(),
        file: file_meta.clone(),
        resume: true,
        target_path: None,
    };

    let prepare_response = client
        .post(&prepare_url)
        .json(&prepare_request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| TransferError::TransferFailed(format!("prepare-upload 失败: {}", e)))?;

    let prepare_resp: PrepareUploadResponse = prepare_response
        .json()
        .await
        .map_err(|e| TransferError::TransferFailed(format!("prepare-upload 响应解析失败: {}", e)))?;

    if !prepare_resp.accepted {
        let reason = prepare_resp
            .reject_reason
            .unwrap_or_else(|| "对方拒绝接收".to_string());
        return Err(TransferError::TransferFailed(reason));
    }

    let resume_offset = prepare_resp.resume_offset;

    // 2. 打开文件
    let mut file = std::fs::File::open(file_path)
        .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    if resume_offset > 0 {
        file.seek(SeekFrom::Start(resume_offset))
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;
    }

    // 3. 分块上传
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut offset = resume_offset;
    // D-03：连续偏移重对齐计数（防异常对端导致无限循环）
    let mut consecutive_resyncs: u32 = 0;
    // D-21：单文件速度滑窗（与批量/接收端同一口径）
    let mut speed_tracker = SpeedTracker::new();
    let state = get_lan_transfer_state();
    let mut last_progress_time = Instant::now();

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        let chunk_data = &buffer[..bytes_read];
        let chunk_len = bytes_read as u64;

        // 发送块（带重试 + 偏移重对齐，D-03）
        // URL 携带当前逻辑偏移；接收端校验 offset==已收字节，不匹配回传 next_offset
        const MAX_RETRIES: u32 = 3;
        let mut last_error: Option<TransferError> = None;
        let mut chunk_confirmed = false;
        let mut resync_to: Option<u64> = None;

        for retry in 0..=MAX_RETRIES {
            if retry > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(500 * retry as u64)).await;
            }

            let upload_url = format!(
                "{}/api/upload?sessionId={}&fileId={}&offset={}",
                base_url, session_id, file_meta.file_id, offset
            );

            let response = client
                .post(&upload_url)
                .body(chunk_data.to_vec())
                .timeout(std::time::Duration::from_secs(60))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    // 解析响应体；响应体不是合法 JSON（旧版对端）时按成功处理保持兼容
                    if let Ok(body_text) = resp.text().await
                        && let Ok(chunk_resp) = serde_json::from_str::<ChunkResponse>(&body_text)
                    {
                        match decide_chunk_response(
                            chunk_resp.success,
                            chunk_resp.error.as_deref(),
                            chunk_resp.next_offset,
                            consecutive_resyncs,
                        ) {
                            ChunkResponseAction::Confirmed => {
                                chunk_confirmed = true;
                                consecutive_resyncs = 0;
                                last_error = None;
                                break;
                            }
                            ChunkResponseAction::ResyncTo(new_offset) => {
                                println!(
                                    "[LanTransfer] 🔄 块偏移不匹配，重对齐: 本地 {} → 对端 {} (文件: {})",
                                    offset, new_offset, file_meta.file_name
                                );
                                resync_to = Some(new_offset);
                                break;
                            }
                            ChunkResponseAction::Abort(msg) => {
                                last_error = Some(TransferError::TransferFailed(msg));
                                break;
                            }
                            ChunkResponseAction::Retry(msg) => {
                                last_error = Some(TransferError::TransferFailed(msg));
                                continue;
                            }
                        }
                    } else {
                        chunk_confirmed = true;
                        last_error = None;
                        break;
                    }
                }
                Ok(resp) => {
                    last_error = Some(TransferError::TransferFailed(format!(
                        "上传块失败: HTTP {}",
                        resp.status()
                    )));
                }
                Err(e) => {
                    last_error = Some(TransferError::TransferFailed(format!("网络错误: {}", e)));
                }
            }
        }

        // D-03：按对端权威偏移重新对齐后回到主循环重新读块重发（重发收敛）
        if let Some(new_offset) = resync_to {
            if new_offset != offset {
                file.seek(SeekFrom::Start(new_offset))
                    .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;
                offset = new_offset;
            }
            consecutive_resyncs += 1;
            continue;
        }

        if let Some(e) = last_error {
            return Err(e);
        }
        if !chunk_confirmed {
            return Err(TransferError::TransferFailed(
                "上传块失败: 重试耗尽".to_string(),
            ));
        }

        offset += chunk_len;

        // 更新全局进度
        progress
            .transferred_bytes
            .fetch_add(bytes_read as u64, Ordering::Relaxed);

        // 更新单文件进度（限频）
        let now = Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 100 {
            last_progress_time = now;

            // D-21：滑窗速度（本次运行累计字节 = offset - resume_offset）
            let transferred = offset - resume_offset;
            let speed = speed_tracker.record(transferred);

            let task = TransferTask {
                task_id: file_meta.file_id.clone(),
                session_id: session_id.to_string(),
                file: file_meta.clone(),
                direction: TransferDirection::Send,
                target_device: target_device.clone(),
                status: TransferStatus::Transferring,
                transferred_bytes: offset,
                speed,
                eta_seconds: (file_meta.file_size - offset).checked_div(speed),
                started_at: Utc::now().to_rfc3339(),
            };

            // 保存任务状态
            {
                let mut transfers = state.active_transfers.write();
                transfers.insert(file_meta.file_id.clone(), task.clone());
            }

            // 更新会话中的单文件进度状态（用于 emit_batch_progress 显示）
            {
                let sessions = get_active_sessions();
                let mut sessions = sessions.write();
                if let Some(session) = sessions.get_mut(session_id)
                    && let Some(file_state) = session.files.get_mut(file_index)
                {
                    file_state.transferred_bytes = offset;
                    file_state.status = TransferStatus::Transferring;
                }
            }

            // 发送单文件进度事件
            let event = LanTransferEvent::TransferProgress { task: task.clone() };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);

            // 发送批量进度事件（确保前端批量进度条正确更新）
            emit_batch_progress(&progress, Some(file_meta.clone()));
        }
    }

    // 4. 发送完成请求
    let finish_url = format!("{}/api/finish", base_url);
    let finish_request = FinishUploadRequest {
        session_id: session_id.to_string(),
        file_id: file_meta.file_id.clone(),
    };

    let finish_response = client
        .post(&finish_url)
        .json(&finish_request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| TransferError::TransferFailed(format!("finish 请求失败: {}", e)))?;

    let finish_resp: FinishUploadResponse = finish_response
        .json()
        .await
        .map_err(|e| TransferError::TransferFailed(format!("finish 响应解析失败: {}", e)))?;

    if !finish_resp.success {
        return Err(TransferError::TransferFailed(
            "文件校验失败或保存失败".to_string(),
        ));
    }

    // 更新完成计数
    progress.completed_files.fetch_add(1, Ordering::Relaxed);

    // 从活跃传输中移除
    {
        let mut transfers = state.active_transfers.write();
        transfers.remove(&file_meta.file_id);
    }

    // 发送完成事件
    let saved_path = finish_resp.saved_path.unwrap_or_default();
    let event = LanTransferEvent::TransferCompleted {
        task_id: file_meta.file_id.clone(),
        saved_path: saved_path.clone(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] ✅ [并行] 文件传输完成: {} -> {}",
        file_meta.file_name, saved_path
    );

    Ok(file_meta.file_size)
}

/// 格式化字节大小为人类可读格式
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

// ============================================================================
// 上传块响应处置（D-03，纯函数便于单测）
// ============================================================================

/// 发送端收到 upload 块响应后的处置决策
#[derive(Debug, PartialEq)]
pub(crate) enum ChunkResponseAction {
    /// 块已确认写入，继续下一块
    Confirmed,
    /// 按对端权威偏移重新对齐后重发（重发收敛）
    ResyncTo(u64),
    /// 暂时性失败，可重试同一块
    Retry(String),
    /// 不可恢复，终止传输
    Abort(String),
}

/// 根据接收端 ChunkResponse 决定处置（纯函数）。
///
/// 接收端校验 `offset == 已收字节`，不匹配时回传 `success:false + next_offset`：
/// - 块其实已写入但响应丢失（弱网）→ next_offset 超前本地 → 跳到对端位置（避免重复写）；
/// - 对端会话重建/回滚 → next_offset 落后本地 → 回退到对端位置重发；
/// - 连续重对齐超过 [`MAX_RESYNC_ATTEMPTS`] 次仍不收敛 → 放弃（防异常对端死循环）。
pub(crate) fn decide_chunk_response(
    success: bool,
    error: Option<&str>,
    next_offset: u64,
    consecutive_resyncs: u32,
) -> ChunkResponseAction {
    if success {
        return ChunkResponseAction::Confirmed;
    }
    match error {
        Some("file_cancelled") => {
            ChunkResponseAction::Abort("接收方已取消文件传输".to_string())
        }
        Some("offset_mismatch") => {
            if consecutive_resyncs >= MAX_RESYNC_ATTEMPTS {
                return ChunkResponseAction::Abort(
                    "偏移重对齐次数过多，放弃传输".to_string(),
                );
            }
            ChunkResponseAction::ResyncTo(next_offset)
        }
        Some(other) => ChunkResponseAction::Retry(format!("上传块失败: {}", other)),
        None => ChunkResponseAction::Retry("上传块失败: 未知错误".to_string()),
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 计算文件哈希 (SHA-256)，不带进度回调
///
/// D-04：原先此处是 CRC32 却挂在 sha256 字段名下，现已改为真实 SHA-256（sha2 0.10）。
#[allow(dead_code)]
fn calculate_file_hash(path: &Path) -> Result<String, TransferError> {
    calculate_file_hash_with_progress(path, Option::<fn(u64, u64)>::None)
}

/// 计算文件哈希 (SHA-256)，带进度回调
///
/// # 参数
/// - `path`: 文件路径
/// - `progress_callback`: 可选的进度回调函数，参数为 (已处理字节数, 文件总大小)
fn calculate_file_hash_with_progress<F>(
    path: &Path,
    progress_callback: Option<F>,
) -> Result<String, TransferError>
where
    F: Fn(u64, u64),
{
    use sha2::Digest;

    let mut file =
        std::fs::File::open(path).map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    // 获取文件大小
    let file_size = file
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    let mut hasher = sha2::Sha256::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut processed: u64 = 0;

    // 进度更新频率控制：每处理 100MB 或每 500ms 更新一次
    const PROGRESS_UPDATE_INTERVAL: u64 = 100 * 1024 * 1024; // 100MB
    let mut last_progress_update = 0u64;

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
        processed += bytes_read as u64;

        // 调用进度回调（限制频率）
        if let Some(ref callback) = progress_callback
            && (processed - last_progress_update >= PROGRESS_UPDATE_INTERVAL
                || processed == file_size)
        {
            callback(processed, file_size);
            last_progress_update = processed;
        }
    }

    // SHA-256 输出 64 字符小写十六进制
    Ok(hex::encode(hasher.finalize()))
}

/// 取消传输
pub async fn cancel_transfer(transfer_id: &str) -> Result<(), TransferError> {
    let state = get_lan_transfer_state();

    // 尝试从活跃传输中获取并更新状态
    {
        let mut transfers = state.active_transfers.write();
        if let Some(task) = transfers.get_mut(transfer_id) {
            task.status = TransferStatus::Cancelled;
        }
    }

    // 发送取消事件
    let event = LanTransferEvent::TransferFailed {
        task_id: transfer_id.to_string(),
        error: "用户取消".to_string(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!("[LanTransfer] 传输已取消: {}", transfer_id);

    Ok(())
}

/// 取消会话（取消所有正在传输的文件）
///
/// D-02：先判会话方向 —— 接收侧会话复用 server::cancel_receiver_session
/// （即 /api/cancel 整会话逻辑），不得空操作；发送侧会话取消本地任务。
pub async fn cancel_session(request_id: &str) -> Result<(), TransferError> {
    // 判定会话方向（不存在时也尝试接收侧，覆盖会话尚未入表/仅接收侧有的情况）
    let direction = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        sessions.get(request_id).map(|s| s.direction.clone())
    };

    if direction != Some(TransferDirection::Send) {
        // 接收侧会话 / 未找到：走接收侧整会话取消
        return cancel_receive_session(request_id).await;
    }

    // 收集需要取消的文件 ID
    let file_ids_to_cancel: Vec<String>;

    // 更新会话状态
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(session) = sessions.get_mut(request_id) {
            session.status = SessionStatus::Cancelled;

            // 收集正在传输的文件 ID 并更新状态
            file_ids_to_cancel = session
                .files
                .iter_mut()
                .filter_map(|file_state| {
                    if file_state.status == TransferStatus::Pending
                        || file_state.status == TransferStatus::Transferring
                    {
                        file_state.status = TransferStatus::Cancelled;
                        Some(file_state.file.file_id.clone())
                    } else {
                        None
                    }
                })
                .collect();
        } else {
            file_ids_to_cancel = Vec::new();
        }
    }

    // 取消所有文件的 CancellationToken
    let tokens = get_file_cancel_tokens();
    {
        let tokens_read = tokens.read();
        for file_id in &file_ids_to_cancel {
            if let Some(token) = tokens_read.get(file_id) {
                token.cancel();
                println!("[LanTransfer] 📛 取消文件传输: {}", file_id);
            }
        }
    }

    // 发送批量取消事件（前端立即移除批次卡片；
    // 传输任务收尾会再发一次带 outcome=cancelled 的 completed，重复移除是幂等的）
    let event = LanTransferEvent::BatchTransferCompleted {
        session_id: request_id.to_string(),
        total_files: 0,
        save_directory: String::new(),
        outcome: Some("cancelled".to_string()),
        failed_files: Some(Vec::new()),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] 会话已取消: {}, 取消了 {} 个文件",
        request_id,
        file_ids_to_cancel.len()
    );

    Ok(())
}

/// 取消接收侧会话（D-02：复用 /api/cancel 整会话逻辑，不得空操作）
async fn cancel_receive_session(session_id: &str) -> Result<(), TransferError> {
    match super::server::cancel_receiver_session(session_id, false) {
        Some((sid, peer_device, files_info)) => {
            let total_files = files_info.len() as u32;
            let completed_files = files_info
                .iter()
                .filter(|f| f.status == TransferStatus::Completed)
                .count() as u32;
            let total_bytes: u64 = files_info.iter().map(|f| f.file_size).sum();
            let transferred_bytes: u64 = files_info.iter().map(|f| f.transferred_bytes).sum();
            let statuses: Vec<TransferStatus> = files_info.iter().map(|f| f.status.clone()).collect();

            // 进度事件（D-13：保留已收字节，不归零）
            let batch_progress = BatchTransferProgress {
                session_id: sid.clone(),
                total_files,
                completed_files,
                total_bytes,
                transferred_bytes,
                speed: 0,
                current_file: None,
                eta_seconds: None,
                files: files_info,
                direction: Some(TransferDirection::Receive),
                peer_device_id: peer_device.as_ref().map(|d| d.device_id.clone()),
                peer_device_name: peer_device.as_ref().map(|d| d.device_name.clone()),
            };
            let progress_event = LanTransferEvent::BatchProgress {
                progress: batch_progress,
            };
            let _ = get_event_sender().send(progress_event.clone());
            emit_lan_event(&progress_event);

            // 终态事件（outcome=cancelled）
            let completed_event = LanTransferEvent::BatchTransferCompleted {
                session_id: sid,
                total_files,
                save_directory: String::new(),
                outcome: Some(compute_batch_outcome(&statuses).to_string()),
                failed_files: Some(Vec::new()),
            };
            let _ = get_event_sender().send(completed_event.clone());
            emit_lan_event(&completed_event);

            Ok(())
        }
        None => {
            // 双侧都没有该会话：幂等成功（日志留痕，不做伪操作）
            println!("[LanTransfer] cancel_session: 会话不存在或已结束: {}", session_id);
            Ok(())
        }
    }
}

/// 停止服务时清理全部传输状态（D-09：避免「半死」状态）
///
/// - 取消所有文件取消令牌（在途任务尽快退出）
/// - 所有会话标记 Cancelled 并广播终态事件
/// - 清空 ACTIVE_SESSIONS 与 active_transfers
pub fn shutdown_all_transfers() {
    // 1. 取消所有文件令牌
    {
        let tokens = get_file_cancel_tokens();
        let tokens = tokens.read();
        for (file_id, token) in tokens.iter() {
            token.cancel();
            println!("[LanTransfer] 🛑 停服取消文件传输: {}", file_id);
        }
    }

    // 2. 每个发送侧会话发终态进度 + completed(cancelled)，然后清空。
    // （接收侧镜像会话由 server::clear_all_upload_sessions 以 Receive 方向发事件，这里跳过）
    let session_ids: Vec<String> = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        sessions
            .values()
            .filter(|s| s.direction == TransferDirection::Send)
            .map(|s| s.session_id.clone())
            .collect()
    };

    for sid in &session_ids {
        let (files_info, peer_device) = {
            let sessions = get_active_sessions();
            let sessions = sessions.read();
            match sessions.get(sid) {
                Some(s) => (
                    s.files
                        .iter()
                        .map(|f| FileProgressInfo {
                            file_id: f.file.file_id.clone(),
                            file_name: f.file.file_name.clone(),
                            file_size: f.file.file_size,
                            transferred_bytes: f.transferred_bytes,
                            status: if f.status == TransferStatus::Completed {
                                TransferStatus::Completed
                            } else {
                                TransferStatus::Cancelled
                            },
                        })
                        .collect::<Vec<_>>(),
                    Some(s.target_device.clone()),
                ),
                None => (Vec::new(), None),
            }
        };

        let total_files = files_info.len() as u32;
        let transferred: u64 = files_info.iter().map(|f| f.transferred_bytes).sum();
        let total: u64 = files_info.iter().map(|f| f.file_size).sum();
        let statuses: Vec<TransferStatus> = files_info.iter().map(|f| f.status.clone()).collect();

        let batch_progress = BatchTransferProgress {
            session_id: sid.clone(),
            total_files,
            completed_files: files_info
                .iter()
                .filter(|f| f.status == TransferStatus::Completed)
                .count() as u32,
            total_bytes: total,
            transferred_bytes: transferred,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_info,
            direction: Some(TransferDirection::Send),
            peer_device_id: peer_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: peer_device.as_ref().map(|d| d.device_name.clone()),
        };
        let progress_event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(progress_event.clone());
        emit_lan_event(&progress_event);

        let completed_event = LanTransferEvent::BatchTransferCompleted {
            session_id: sid.clone(),
            total_files,
            save_directory: String::new(),
            outcome: Some(compute_batch_outcome(&statuses).to_string()),
            failed_files: Some(Vec::new()),
        };
        let _ = get_event_sender().send(completed_event.clone());
        emit_lan_event(&completed_event);
    }

    // 3. 清空会话表与任务表
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        sessions.clear();
    }
    {
        let state = get_lan_transfer_state();
        let mut transfers = state.active_transfers.write();
        transfers.clear();
    }
    // 4. 清空令牌表与错误暂存
    get_file_cancel_tokens().write().clear();
    get_file_errors().write().clear();

    println!("[LanTransfer] 🛑 已清理全部传输状态（{} 个会话）", session_ids.len());
}

/// 获取所有活跃会话（发送侧 + 接收侧镜像，D-01）
pub fn get_all_sessions() -> Vec<TransferSession> {
    let sessions = get_active_sessions();
    let sessions = sessions.read();
    sessions.values().cloned().collect()
}
// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn test_device() -> DiscoveredDevice {
        DiscoveredDevice {
            device_id: "initiator-device-1".to_string(),
            device_name: "发起方设备".to_string(),
            user_id: "u1".to_string(),
            user_nickname: "发起方".to_string(),
            ip_address: "192.168.1.20".to_string(),
            port: SERVICE_PORT,
            discovered_at: "2026-02-10T00:00:00Z".to_string(),
            last_seen: "2026-02-10T00:00:00Z".to_string(),
        }
    }

    fn test_file_meta(file_id: &str, size: u64) -> FileMetadata {
        FileMetadata {
            file_id: file_id.to_string(),
            file_name: format!("file-{}.bin", file_id),
            file_size: size,
            mime_type: "application/octet-stream".to_string(),
            sha256: sha256_hex(format!("content-of-{}", file_id).as_bytes()),
        }
    }

    fn insert_test_receive_session(session_id: &str) {
        let session = TransferSession {
            session_id: session_id.to_string(),
            connection_id: String::new(),
            request_id: String::new(),
            files: vec![FileTransferState {
                file: test_file_meta("f-1", 1024),
                status: TransferStatus::Pending,
                transferred_bytes: 0,
                resume_info: None,
            }],
            file_paths: Vec::new(),
            status: SessionStatus::Transferring,
            created_at: Utc::now().to_rfc3339(),
            target_device: test_device(),
            direction: TransferDirection::Receive,
        };
        upsert_receive_session(session);
    }

    /// D-06：单文件取消后收尾不得把 Cancelled 改判 Failed
    #[test]
    fn cancelled_status_survives_failed_result() {
        // 用户取消（Cancelled）+ 任务返回失败 → 保留 Cancelled
        assert_eq!(
            settle_transfer_status(&TransferStatus::Cancelled, true),
            TransferStatus::Cancelled
        );
        // 用户取消 + 任务返回成功（竞态：取消瞬间已完成）→ 保留 Cancelled，不虚报完成
        assert_eq!(
            settle_transfer_status(&TransferStatus::Cancelled, false),
            TransferStatus::Cancelled
        );
        // 普通失败 → Failed
        assert_eq!(
            settle_transfer_status(&TransferStatus::Transferring, true),
            TransferStatus::Failed
        );
        // 成功 → Completed
        assert_eq!(
            settle_transfer_status(&TransferStatus::Transferring, false),
            TransferStatus::Completed
        );
    }

    /// D-01：接收方向会话进入统一会话表，get_all_sessions 合并暴露且字段同构
    #[test]
    fn get_all_sessions_exposes_receive_direction_sessions() {
        let session_id = format!("test-recv-{}", Uuid::new_v4());
        insert_test_receive_session(&session_id);

        let all = get_all_sessions();
        let found = all
            .iter()
            .find(|s| s.session_id == session_id)
            .expect("接收侧会话应出现在统一会话表中");
        assert_eq!(found.direction, TransferDirection::Receive);
        assert_eq!(found.target_device.device_id, "initiator-device-1", "targetDevice 应为发起方");
        assert_eq!(found.files.len(), 1);
        assert_eq!(found.files[0].status, TransferStatus::Pending);

        // 文件状态/字节实时同步（server 侧调用同一入口）
        update_receive_session_file(&session_id, "f-1", 640, TransferStatus::Transferring);
        let all = get_all_sessions();
        let found = all.iter().find(|s| s.session_id == session_id).unwrap();
        assert_eq!(found.files[0].transferred_bytes, 640);
        assert_eq!(found.files[0].status, TransferStatus::Transferring);

        // 整会话状态同步 + 发送侧会话不受影响（direction 守卫）
        set_session_status(&session_id, SessionStatus::Cancelled);
        update_receive_session_file("不存在的会话", "f-1", 999, TransferStatus::Transferring);
        let found = get_all_sessions()
            .into_iter()
            .find(|s| s.session_id == session_id)
            .unwrap();
        assert_eq!(found.status, SessionStatus::Cancelled);
        assert_eq!(found.files[0].transferred_bytes, 640, "无关会话不应被误改");

        // 清理（不污染其他测试）
        remove_session(&session_id);
        assert!(get_all_sessions().iter().all(|s| s.session_id != session_id));
    }

    /// D-03：错位/超限块被对端拒绝后，重发按 next_offset 收敛
    #[test]
    fn chunk_resync_converges_to_server_offset() {
        const MB: u64 = 1024 * 1024;
        // 模拟对端：已收到 2MB（前两块）。本地从 0 开始重发 1MB 块。
        let mut server_offset: u64 = 2 * MB;
        let mut local_offset: u64 = 0;
        let chunk: u64 = MB;
        let mut resyncs: u32 = 0;
        let mut confirmed_count = 0;

        for _ in 0..20 {
            let action = if local_offset == server_offset {
                // 块起点与对端已收偏移一致：写入成功
                server_offset += chunk;
                decide_chunk_response(true, None, server_offset, resyncs)
            } else {
                // 错位：拒绝并回传对端权威偏移
                decide_chunk_response(false, Some("offset_mismatch"), server_offset, resyncs)
            };

            match action {
                ChunkResponseAction::Confirmed => {
                    local_offset += chunk;
                    confirmed_count += 1;
                }
                ChunkResponseAction::ResyncTo(new_offset) => {
                    assert_ne!(new_offset, local_offset, "错位响应的 next_offset 应与本地不同");
                    local_offset = new_offset;
                    resyncs += 1;
                }
                other => panic!("收敛过程不应终止/重试: {:?}", other),
            }

            if local_offset >= 3 * MB {
                break;
            }
        }

        assert_eq!(local_offset, server_offset, "重发应收敛到对端偏移");
        assert!(confirmed_count > 0, "对齐后应有块成功写入");
    }

    /// D-03：场景细分 —— 块已写入但响应丢失（对端超前）与对端落后两种都要重对齐
    #[test]
    fn chunk_resync_handles_ahead_and_behind_server() {
        const MB: u64 = 1024 * 1024;
        // 场景 A：本地发 offset=1MB 的块，实际已写入对端（next_offset=2MB 超前）→ 跳到 2MB
        match decide_chunk_response(false, Some("offset_mismatch"), 2 * MB, 0) {
            ChunkResponseAction::ResyncTo(o) => assert_eq!(o, 2 * MB),
            other => panic!("应重对齐: {:?}", other),
        }
        // 场景 B：对端落后（next_offset=512KB）→ 回退重发
        match decide_chunk_response(false, Some("offset_mismatch"), 512 * 1024, 0) {
            ChunkResponseAction::ResyncTo(o) => assert_eq!(o, 512 * 1024),
            other => panic!("应重对齐: {:?}", other),
        }
    }

    /// D-03：连续重对齐超过上限 → 放弃（防异常对端死循环）
    #[test]
    fn chunk_resync_gives_up_after_max_attempts() {
        match decide_chunk_response(false, Some("offset_mismatch"), 1, MAX_RESYNC_ATTEMPTS) {
            ChunkResponseAction::Abort(_) => {}
            other => panic!("超限应 Abort: {:?}", other),
        }
        // 未超限时仍可重对齐
        match decide_chunk_response(false, Some("offset_mismatch"), 1, MAX_RESYNC_ATTEMPTS - 1) {
            ChunkResponseAction::ResyncTo(1) => {}
            other => panic!("未超限应 Resync: {:?}", other),
        }
    }

    /// D-03：取消与其他错误语义不被偏移逻辑吞掉
    #[test]
    fn chunk_response_preserves_cancel_and_retry_semantics() {
        assert_eq!(
            decide_chunk_response(true, None, 0, 0),
            ChunkResponseAction::Confirmed,
            "成功即确认"
        );
        match decide_chunk_response(false, Some("file_cancelled"), 0, 0) {
            ChunkResponseAction::Abort(_) => {}
            other => panic!("取消应 Abort: {:?}", other),
        }
        match decide_chunk_response(false, Some("disk_error"), 0, 0) {
            ChunkResponseAction::Retry(msg) => assert!(msg.contains("disk_error")),
            other => panic!("普通错误应可重试: {:?}", other),
        }
        match decide_chunk_response(false, None, 0, 0) {
            ChunkResponseAction::Retry(_) => {}
            other => panic!("无错误说明应可重试: {:?}", other),
        }
    }

    /// D-15：outcome 与会话终态映射（partial 沿用旧口径标 Completed）
    #[test]
    fn session_status_follows_outcome() {
        use TransferStatus::*;
        // 全部取消 → 终态 Cancelled
        let statuses = vec![Cancelled, Cancelled];
        let outcome = compute_batch_outcome(&statuses);
        assert_eq!(outcome, "cancelled");
        // 部分成功部分失败 → partial，批次仍标 Completed（旧口径，详情走 failed_files）
        let statuses = vec![Completed, Failed];
        assert_eq!(compute_batch_outcome(&statuses), "partial");
    }
}
