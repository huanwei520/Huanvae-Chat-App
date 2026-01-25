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
 * - 2026-01-25: 添加连接请求失败自动重试机制（刷新设备 IP 后重试）
 * - 2026-01-25: 修复批量进度不更新问题，在并行传输中同步发送 BatchProgress 事件
 * - 2026-01-25: 修复会话取消不生效问题，取消时正确触发所有文件的 CancellationToken
 * - 2026-01-25: 重构为并行传输，添加单文件取消支持
 * - 2026-01-21: 添加详细传输调试日志，用于排查跨平台传输问题
 * - 2026-01-21: 添加块上传重试机制（最多 3 次），提高传输稳定性
 */

use super::discovery::get_event_sender;
use super::protocol::*;
use super::{emit_lan_event, get_lan_transfer_state};
use chrono::Utc;
use crc32fast::Hasher as Crc32Hasher;
use futures::future::join_all;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::error::Error as StdError;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

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
pub async fn cancel_file_transfer(file_id: &str) -> Result<(), TransferError> {
    let tokens = get_file_cancel_tokens();
    let token = {
        let tokens = tokens.read();
        tokens.get(file_id).cloned()
    };

    if let Some(token) = token {
        token.cancel();
        println!("[LanTransfer] 📛 文件传输已取消: {}", file_id);

        // 发送取消事件
        let event = LanTransferEvent::TransferFailed {
            task_id: file_id.to_string(),
            error: "用户取消".to_string(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
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

/// 响应连接请求（旧版兼容）
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

    // 收集文件信息
    let mut files: Vec<FileMetadata> = Vec::new();
    let mut total_size: u64 = 0;

    let total_files = file_paths.len() as u32;
    for (index, file_path) in file_paths.iter().enumerate() {
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

        // 计算文件哈希（大文件时显示进度）
        let file_name_for_progress = file_name.clone();
        let current_file = (index + 1) as u32;
        let sha256 = calculate_file_hash_with_progress(path, Some(|processed, total| {
            emit_lan_event(&LanTransferEvent::HashingProgress {
                file_name: file_name_for_progress.clone(),
                file_size: total,
                processed_bytes: processed,
                current_file,
                total_files,
            });
        }))?;

        let mime_type = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();

        files.push(FileMetadata {
            file_id: Uuid::new_v4().to_string(),
            file_name,
            file_size,
            mime_type,
            sha256,
        });
    }

    let session_id = Uuid::new_v4().to_string();

    // 创建传输会话
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

    // 发送事件通知前端
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

    // 通知对方有文件要传输（使用现有的 transfer-request API，但标记为已确认）
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TransferRequestBody {
        from_device: DiscoveredDevice,
        files: Vec<FileMetadata>,
        total_size: u64,
        connection_id: String,
        auto_accept: bool,
    }

    let url = format!(
        "http://{}:{}/api/transfer-request",
        target_device.ip_address, target_device.port
    );

    let client = reqwest::Client::new();
    let _ = client
        .post(&url)
        .json(&TransferRequestBody {
            from_device,
            files: files.clone(),
            total_size,
            connection_id: connection_id.to_string(),
            auto_accept: true, // 已建立连接，自动接受
        })
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    // 启动批量传输
    let session_id_clone = session_id.clone();
    let file_paths_clone = file_paths.clone();
    tokio::spawn(async move {
        if let Err(e) = start_batch_transfer(&session_id_clone, file_paths_clone).await {
            eprintln!("[LanTransfer] 批量传输失败: {}", e);
        }
    });

    println!(
        "[LanTransfer] 开始向 {} 传输 {} 个文件",
        target_device.device_name,
        files.len()
    );

    Ok(session_id)
}

// ============================================================================
// 传输请求（旧版兼容）
// ============================================================================

/// 发送传输请求（需要对方确认）
pub async fn send_transfer_request(
    device_id: &str,
    file_paths: Vec<String>,
) -> Result<String, TransferError> {
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

    // 收集文件信息
    let mut files: Vec<FileMetadata> = Vec::new();
    let mut total_size: u64 = 0;

    let total_files = file_paths.len() as u32;
    for (index, file_path) in file_paths.iter().enumerate() {
        let path = Path::new(file_path);

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = std::fs::metadata(path)
            .map_err(|e| TransferError::FileReadFailed(format!("{}: {}", file_path, e)))?;

        let file_size = metadata.len();
        total_size += file_size;

        // 计算文件哈希（大文件时显示进度）
        let file_name_for_progress = file_name.clone();
        let current_file = (index + 1) as u32;
        let file_hash = calculate_file_hash_with_progress(path, Some(|processed, total| {
            emit_lan_event(&LanTransferEvent::HashingProgress {
                file_name: file_name_for_progress.clone(),
                file_size: total,
                processed_bytes: processed,
                current_file,
                total_files,
            });
        }))?;

        // 获取 MIME 类型
        let mime_type = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();

        let file_id = Uuid::new_v4().to_string();

        files.push(FileMetadata {
            file_id,
            file_name,
            file_size,
            mime_type,
            sha256: file_hash,
        });
    }

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
    struct TransferRequestBody {
        from_device: DiscoveredDevice,
        files: Vec<FileMetadata>,
        total_size: u64,
    }

    let request_body = TransferRequestBody {
        from_device: from_device.clone(),
        files: files.clone(),
        total_size,
    };

    // 发送 HTTP 请求
    let url = format!(
        "http://{}:{}/api/transfer-request",
        target_device.ip_address, target_device.port
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request_body)
        .timeout(std::time::Duration::from_secs(30))
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
    #[serde(rename_all = "camelCase")]
    struct RequestResponse {
        request_id: String,
        #[serde(default)]
        #[allow(dead_code)]
        status: Option<String>,
        accepted: Option<bool>,
        #[serde(default)]
        #[allow(dead_code)]
        save_directory: Option<String>,
    }

    let resp: RequestResponse = response
        .json()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    let request_id = resp.request_id.clone();
    let session_id = Uuid::new_v4().to_string();

    // 创建传输会话（保存文件路径，用于接收确认后启动传输）
    let session = TransferSession {
        session_id: session_id.clone(),
        connection_id: String::new(), // 旧版模式，无连接 ID
        request_id: request_id.clone(),
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
        status: SessionStatus::Pending,
        created_at: Utc::now().to_rfc3339(),
        target_device: target_device.clone(),
        direction: TransferDirection::Send,
    };

    // 保存会话
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        sessions.insert(request_id.clone(), session);
    }

    // 如果已经被接受（信任设备），直接开始传输
    if resp.accepted == Some(true) {
        println!(
            "[LanTransfer] 传输请求已自动接受: {} -> {}",
            files.len(),
            target_device.device_name
        );

        // 在后台开始传输
        let file_paths_clone = file_paths.clone();
        let request_id_clone = request_id.clone();
        tokio::spawn(async move {
            let _ = start_batch_transfer(&request_id_clone, file_paths_clone).await;
        });
    } else {
        println!(
            "[LanTransfer] 传输请求已发送，等待确认: {} -> {} ({} 个文件, {} 字节)",
            request_id,
            target_device.device_name,
            files.len(),
            total_size
        );
    }

    Ok(request_id)
}

/// 响应传输请求
pub async fn respond_to_transfer_request(
    request_id: &str,
    accept: bool,
) -> Result<(), TransferError> {
    use super::server::get_pending_transfer_requests_map;

    // 获取并移除请求
    let request = {
        let requests = get_pending_transfer_requests_map();
        let mut requests = requests.lock();
        requests.remove(request_id)
    };

    let request = request.ok_or_else(|| TransferError::RequestNotFound(request_id.to_string()))?;

    // 向发送方发送响应
    let url = format!(
        "http://{}:{}/api/transfer-response",
        request.from_device.ip_address, request.from_device.port
    );

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ResponseBody {
        request_id: String,
        accepted: bool,
        reject_reason: Option<String>,
    }

    let body = ResponseBody {
        request_id: request_id.to_string(),
        accepted: accept,
        reject_reason: if accept {
            None
        } else {
            Some("用户拒绝".to_string())
        },
    };

    let client = reqwest::Client::new();
    let _ = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;

    // 发送本地事件
    let event = LanTransferEvent::TransferRequestResponse {
        request_id: request_id.to_string(),
        accepted: accept,
        reject_reason: if accept {
            None
        } else {
            Some("用户拒绝".to_string())
        },
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] 传输请求 {} 已{}: {} 个文件来自 {}",
        request_id,
        if accept { "接受" } else { "拒绝" },
        request.files.len(),
        request.from_device.device_name
    );

    Ok(())
}

// ============================================================================
// 批量文件传输
// ============================================================================

/// 开始批量传输（并行）
///
/// 使用 Semaphore 限制并发数，每个文件有独立的 CancellationToken
/// 一个文件失败不影响其他文件继续传输
pub async fn start_batch_transfer(
    request_id: &str,
    file_paths: Vec<String>,
) -> Result<(), TransferError> {
    // 获取会话信息
    let session = {
        let sessions = get_active_sessions();
        let sessions = sessions.read();
        sessions.get(request_id).cloned()
    };

    let session = session.ok_or_else(|| TransferError::RequestNotFound(request_id.to_string()))?;

    let target_device = session.target_device.clone();
    let session_id = session.session_id.clone();
    let files = session.files.clone();
    let request_id_owned = request_id.to_string();

    // 更新会话状态
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(s) = sessions.get_mut(request_id) {
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
        session_id: session_id.clone(),
    });

    // 发送初始进度
    emit_batch_progress(&progress, None);

    // 创建信号量限制并发数
    let semaphore = Arc::new(Semaphore::new(MAX_PARALLEL_TRANSFERS));

    println!(
        "[LanTransfer] 🚀 开始并行批量传输: {} 个文件, 并行度 {}",
        total_files, MAX_PARALLEL_TRANSFERS
    );

    // 为每个文件创建并行任务
    let handles: Vec<_> = files
        .iter()
        .zip(file_paths.iter())
        .enumerate()
        .map(|(index, (file_state, file_path))| {
            let file_meta = file_state.file.clone();
            let file_path = file_path.clone();
            let target_device = target_device.clone();
            let session_id = session_id.clone();
            let _request_id = request_id_owned.clone();
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

    // 统计结果
    let mut success_count = 0u32;
    let mut fail_count = 0u32;

    for result in results {
        match result {
            Ok((index, file_meta, transfer_result)) => {
                let sessions = get_active_sessions();
                let mut sessions = sessions.write();

                match transfer_result {
                    Ok(_bytes) => {
                        success_count += 1;
                        if let Some(s) = sessions.get_mut(&request_id_owned)
                            && let Some(fs) = s.files.get_mut(index)
                        {
                            fs.status = TransferStatus::Completed;
                            fs.transferred_bytes = file_meta.file_size;
                        }
                    }
                    Err(e) => {
                        fail_count += 1;
                        eprintln!(
                            "[LanTransfer] 文件传输失败: {} - {}",
                            file_meta.file_name, e
                        );
                        if let Some(s) = sessions.get_mut(&request_id_owned)
                            && let Some(fs) = s.files.get_mut(index)
                        {
                            fs.status = TransferStatus::Failed;
                        }

                        // 发送失败事件
                        let event = LanTransferEvent::TransferFailed {
                            task_id: file_meta.file_id.clone(),
                            error: e.to_string(),
                        };
                        let _ = get_event_sender().send(event.clone());
                        emit_lan_event(&event);
                    }
                }
            }
            Err(e) => {
                fail_count += 1;
                eprintln!("[LanTransfer] 任务执行错误: {}", e);
            }
        }
    }

    // 更新会话状态
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(s) = sessions.get_mut(&request_id_owned) {
            s.status = if fail_count == 0 {
                SessionStatus::Completed
            } else if success_count == 0 {
                SessionStatus::Failed
            } else {
                // 部分成功也标记为完成（可以在 UI 显示详情）
                SessionStatus::Completed
            };
        }
    }

    // 发送批量完成事件
    let event = LanTransferEvent::BatchTransferCompleted {
        session_id: session_id.clone(),
        total_files,
        save_directory: String::new(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] 批量传输完成: {}/{} 成功, {} 失败 -> {}",
        success_count, total_files, fail_count, target_device.device_name
    );

    if fail_count > 0 && success_count == 0 {
        return Err(TransferError::TransferFailed("所有文件传输失败".to_string()));
    }

    Ok(())
}

/// 发送批量进度事件
fn emit_batch_progress(progress: &ParallelProgress, current_file: Option<FileMetadata>) {
    let batch_progress = BatchTransferProgress {
        session_id: progress.session_id.clone(),
        total_files: progress.total_files,
        completed_files: progress.completed_files.load(Ordering::Relaxed),
        total_bytes: progress.total_bytes,
        transferred_bytes: progress.transferred_bytes.load(Ordering::Relaxed),
        speed: 0, // 并行传输时速度在单文件级别计算
        current_file,
        eta_seconds: None,
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
    _index: usize,
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
    let state = get_lan_transfer_state();
    let start_time = Instant::now();
    let mut last_progress_time = Instant::now();

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        let chunk_data = &buffer[..bytes_read];

        // 发送块（带重试）
        let upload_url = format!(
            "{}/api/upload?sessionId={}&fileId={}",
            base_url, session_id, file_meta.file_id
        );

        const MAX_RETRIES: u32 = 3;
        let mut last_error: Option<TransferError> = None;

        for retry in 0..=MAX_RETRIES {
            if retry > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(500 * retry as u64)).await;
            }

            let response = client
                .post(&upload_url)
                .body(chunk_data.to_vec())
                .timeout(std::time::Duration::from_secs(60))
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    last_error = None;
                    break;
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

        if let Some(e) = last_error {
            return Err(e);
        }

        offset += bytes_read as u64;

        // 更新全局进度
        progress
            .transferred_bytes
            .fetch_add(bytes_read as u64, Ordering::Relaxed);

        // 更新单文件进度（限频）
        let now = Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 100 {
            last_progress_time = now;

            let elapsed = start_time.elapsed().as_secs_f64();
            let transferred = offset - resume_offset;
            let speed = if elapsed > 0.0 {
                (transferred as f64 / elapsed) as u64
            } else {
                0
            };

            let task = TransferTask {
                task_id: file_meta.file_id.clone(),
                session_id: session_id.to_string(),
                file: file_meta.clone(),
                direction: TransferDirection::Send,
                target_device: target_device.clone(),
                status: TransferStatus::Transferring,
                transferred_bytes: offset,
                speed,
                eta_seconds: if speed > 0 {
                    Some((file_meta.file_size - offset) / speed)
                } else {
                    None
                },
                started_at: Utc::now().to_rfc3339(),
            };

            // 保存任务状态
            {
                let mut transfers = state.active_transfers.write();
                transfers.insert(file_meta.file_id.clone(), task.clone());
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
fn format_bytes(bytes: u64) -> String {
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

/// 执行单文件传输（支持断点续传）
/// 注意: 此函数为旧版顺序传输实现，保留作为备用
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
async fn do_file_transfer_with_resume(
    target_device: &DiscoveredDevice,
    session_id: &str,
    file_meta: &FileMetadata,
    file_path: &str,
    file_index: usize,
    total_files: usize,
    batch_transferred: u64,
    batch_total: u64,
) -> Result<u64, TransferError> {
    let base_url = format!("http://{}:{}", target_device.ip_address, target_device.port);

    // 调试日志：传输开始
    println!(
        "[LanTransfer] 📤 开始传输文件 [{}/{}]: {} ({}) -> {}:{}",
        file_index + 1,
        total_files,
        file_meta.file_name,
        format_bytes(file_meta.file_size),
        target_device.ip_address,
        target_device.port
    );

    let client = reqwest::Client::new();

    // 1. 发送准备上传请求
    let prepare_url = format!("{}/api/prepare-upload", base_url);
    println!("[LanTransfer] 📡 发送 prepare-upload 请求: {}", prepare_url);

    let prepare_request = PrepareUploadRequest {
        session_id: session_id.to_string(),
        file: file_meta.clone(),
        resume: true, // 尝试断点续传
        target_path: None, // 由接收方决定保存路径
    };

    let prepare_response = client
        .post(&prepare_url)
        .json(&prepare_request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            println!("[LanTransfer] ❌ prepare-upload 请求失败: {}", e);
            TransferError::TransferFailed(format!("prepare-upload 失败: {}", e))
        })?;

    println!(
        "[LanTransfer] 📡 prepare-upload 响应状态: {}",
        prepare_response.status()
    );

    let prepare_resp: PrepareUploadResponse = prepare_response.json().await.map_err(|e| {
        println!("[LanTransfer] ❌ prepare-upload 响应解析失败: {}", e);
        TransferError::TransferFailed(format!("prepare-upload 响应解析失败: {}", e))
    })?;

    println!(
        "[LanTransfer] 📡 prepare-upload 结果: accepted={}, resume_offset={}",
        prepare_resp.accepted, prepare_resp.resume_offset
    );

    if !prepare_resp.accepted {
        let reason = prepare_resp
            .reject_reason
            .unwrap_or_else(|| "对方拒绝接收".to_string());
        println!("[LanTransfer] ❌ 传输被拒绝: {}", reason);
        return Err(TransferError::TransferFailed(reason));
    }

    let resume_offset = prepare_resp.resume_offset;
    if resume_offset > 0 {
        println!(
            "[LanTransfer] 🔄 断点续传: {} 从 {} 字节继续",
            file_meta.file_name,
            format_bytes(resume_offset)
        );
    }

    // 2. 打开文件并定位到续传位置
    println!("[LanTransfer] 📂 打开文件: {}", file_path);
    let mut file = std::fs::File::open(file_path).map_err(|e| {
        println!("[LanTransfer] ❌ 文件打开失败: {}", e);
        TransferError::FileReadFailed(e.to_string())
    })?;

    if resume_offset > 0 {
        file.seek(SeekFrom::Start(resume_offset)).map_err(|e| {
            println!("[LanTransfer] ❌ 文件定位失败: {}", e);
            TransferError::FileReadFailed(e.to_string())
        })?;
    }

    // 3. 分块上传文件
    println!(
        "[LanTransfer] 📦 开始分块上传，块大小: {}",
        format_bytes(CHUNK_SIZE as u64)
    );
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut offset = resume_offset;
    let state = get_lan_transfer_state();
    let start_time = Instant::now();
    let mut last_progress_time = Instant::now();
    let mut last_log_offset: u64 = 0;
    let mut chunk_count: u64 = 0;

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| {
            println!("[LanTransfer] ❌ 文件读取失败: {}", e);
            TransferError::FileReadFailed(e.to_string())
        })?;

        if bytes_read == 0 {
            println!("[LanTransfer] 📦 文件读取完成，共 {} 个块", chunk_count);
            break;
        }

        chunk_count += 1;
        let chunk_data = &buffer[..bytes_read];

        // 发送块
        let upload_url = format!(
            "{}/api/upload?sessionId={}&fileId={}",
            base_url, session_id, file_meta.file_id
        );

        // 重试机制：最多重试 3 次
        const MAX_RETRIES: u32 = 3;
        let mut last_error: Option<TransferError> = None;

        for retry in 0..=MAX_RETRIES {
            if retry > 0 {
                println!(
                    "[LanTransfer] 🔄 重试块上传 (块 #{}, 第 {}/{} 次重试)",
                    chunk_count, retry, MAX_RETRIES
                );
                // 重试前等待一小段时间
                tokio::time::sleep(std::time::Duration::from_millis(500 * retry as u64)).await;
            }

            let response = client
                .post(&upload_url)
                .body(chunk_data.to_vec())
                .timeout(std::time::Duration::from_secs(60))
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let response_status = resp.status();
                    match resp.json::<ChunkResponse>().await {
                        Ok(chunk_resp) => {
                            if chunk_resp.success {
                                // 成功，跳出重试循环
                                last_error = None;
                                break;
                            } else {
                                let error =
                                    chunk_resp.error.unwrap_or_else(|| "块传输失败".to_string());
                                println!(
                                    "[LanTransfer] ❌ 块传输失败 (块 #{}, offset={}): {}",
                                    chunk_count, offset, error
                                );
                                last_error = Some(TransferError::TransferFailed(error));
                            }
                        }
                        Err(e) => {
                            println!(
                                "[LanTransfer] ❌ 块响应解析失败 (块 #{}, status={}): {}",
                                chunk_count, response_status, e
                            );
                            last_error =
                                Some(TransferError::TransferFailed(format!("块响应解析失败: {}", e)));
                        }
                    }
                }
                Err(e) => {
                    // 详细分析错误类型
                    let error_type = if e.is_timeout() {
                        "超时"
                    } else if e.is_connect() {
                        "连接失败"
                    } else if e.is_request() {
                        "请求构建失败"
                    } else if e.is_body() {
                        "请求体错误"
                    } else if e.is_decode() {
                        "解码错误"
                    } else {
                        "未知错误"
                    };

                    // 获取底层错误信息
                    let source_error = e
                        .source()
                        .map(|s| format!(" (底层: {})", s))
                        .unwrap_or_default();

                    println!(
                        "[LanTransfer] ❌ 块上传请求失败 (块 #{}, offset={}, 类型={}, 重试={}/{}): {}{}",
                        chunk_count, offset, error_type, retry, MAX_RETRIES, e, source_error
                    );
                    last_error = Some(TransferError::TransferFailed(format!(
                        "块上传失败 ({}): {}",
                        error_type, e
                    )));
                }
            }
        }

        // 如果所有重试都失败了
        if let Some(err) = last_error {
            println!(
                "[LanTransfer] ❌ 块 #{} 在 {} 次重试后仍然失败",
                chunk_count, MAX_RETRIES
            );
            return Err(err);
        }

        offset += bytes_read as u64;

        // 计算速度和 ETA
        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            ((offset - resume_offset) as f64 / elapsed) as u64
        } else {
            0
        };

        let remaining_bytes = file_meta.file_size - offset;
        let eta_seconds = if speed > 0 {
            Some(remaining_bytes / speed)
        } else {
            None
        };

        // 限制进度更新频率（每 100ms 一次）
        if last_progress_time.elapsed().as_millis() >= 100 {
            last_progress_time = Instant::now();

            // 每传输 5MB 打印一次进度日志
            if offset - last_log_offset >= 5 * 1024 * 1024 {
                last_log_offset = offset;
                let progress_pct = (offset as f64 / file_meta.file_size as f64) * 100.0;
                println!(
                    "[LanTransfer] 📊 传输进度: {}/{} ({:.1}%), 速度: {}/s, 剩余: {}",
                    format_bytes(offset),
                    format_bytes(file_meta.file_size),
                    progress_pct,
                    format_bytes(speed),
                    eta_seconds
                        .map(|s| format!("{}s", s))
                        .unwrap_or_else(|| "计算中...".to_string())
                );
            }

            // 创建传输任务用于进度更新
            let task = TransferTask {
                task_id: file_meta.file_id.clone(),
                session_id: session_id.to_string(),
                file: file_meta.clone(),
                direction: TransferDirection::Send,
                target_device: target_device.clone(),
                status: TransferStatus::Transferring,
                transferred_bytes: offset,
                speed,
                started_at: Utc::now().to_rfc3339(),
                eta_seconds,
            };

            // 保存任务状态
            {
                let mut transfers = state.active_transfers.write();
                transfers.insert(file_meta.file_id.clone(), task.clone());
            }

            // 发送单文件进度事件
            let event = LanTransferEvent::TransferProgress { task };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);

            // 发送批量进度事件
            let batch_progress = BatchTransferProgress {
                session_id: session_id.to_string(),
                total_files: total_files as u32,
                completed_files: file_index as u32,
                total_bytes: batch_total,
                transferred_bytes: batch_transferred + offset,
                speed,
                current_file: Some(file_meta.clone()),
                eta_seconds: if speed > 0 {
                    Some((batch_total - batch_transferred - offset) / speed)
                } else {
                    None
                },
            };

            let batch_event = LanTransferEvent::BatchProgress {
                progress: batch_progress,
            };
            let _ = get_event_sender().send(batch_event.clone());
            emit_lan_event(&batch_event);
        }
    }

    // 4. 发送完成请求
    let finish_url = format!(
        "{}/api/finish?sessionId={}&fileId={}",
        base_url, session_id, file_meta.file_id
    );

    let elapsed_total = start_time.elapsed();
    println!(
        "[LanTransfer] 📡 发送 finish 请求: {} (耗时: {:.2}s)",
        finish_url,
        elapsed_total.as_secs_f64()
    );

    let finish_response = client
        .post(&finish_url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            println!("[LanTransfer] ❌ finish 请求失败: {}", e);
            TransferError::TransferFailed(format!("finish 请求失败: {}", e))
        })?;

    println!(
        "[LanTransfer] 📡 finish 响应状态: {}",
        finish_response.status()
    );

    let finish_resp: FinishUploadResponse = finish_response.json().await.map_err(|e| {
        println!("[LanTransfer] ❌ finish 响应解析失败: {}", e);
        TransferError::TransferFailed(format!("finish 响应解析失败: {}", e))
    })?;

    if !finish_resp.success {
        let error = finish_resp
            .error
            .unwrap_or_else(|| "传输完成验证失败".to_string());
        println!("[LanTransfer] ❌ finish 验证失败: {}", error);
        return Err(TransferError::TransferFailed(error));
    }

    // 从活跃传输中移除
    {
        let mut transfers = state.active_transfers.write();
        transfers.remove(&file_meta.file_id);
    }

    // 发送完成事件
    let event = LanTransferEvent::TransferCompleted {
        task_id: file_meta.file_id.clone(),
        saved_path: file_path.to_string(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] 文件传输完成 [{}/{}]: {} -> {}",
        file_index + 1,
        total_files,
        file_meta.file_name,
        target_device.device_name
    );

    Ok(file_meta.file_size)
}

// ============================================================================
// 旧版单文件传输（保留兼容）
// ============================================================================

/// 发送单个文件（旧版接口）
pub async fn send_file(
    device_id: &str,
    file_path: &str,
    _app_handle: tauri::AppHandle,
) -> Result<String, TransferError> {
    // 使用新的传输请求机制
    let request_id = send_transfer_request(device_id, vec![file_path.to_string()]).await?;
    Ok(request_id)
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 计算文件哈希 (CRC32)，不带进度回调
///
/// 使用 crc32fast 库进行高性能哈希计算
/// - 速度: ~7.3 GB/s (比 SHA-256 快约 14 倍)
/// - 流式处理: 无需将整个文件读入内存
/// - 跨平台: 支持 Android AOSP, Windows, macOS, Linux, iOS
#[allow(dead_code)]
fn calculate_file_hash(path: &Path) -> Result<String, TransferError> {
    calculate_file_hash_with_progress(path, Option::<fn(u64, u64)>::None)
}

/// 计算文件哈希 (CRC32)，带进度回调
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
    let mut file =
        std::fs::File::open(path).map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    // 获取文件大小
    let file_size = file
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    let mut hasher = Crc32Hasher::new();
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

    // CRC32 输出为 32 位无符号整数，转换为 8 字符十六进制字符串
    Ok(format!("{:08x}", hasher.finalize()))
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
pub async fn cancel_session(request_id: &str) -> Result<(), TransferError> {
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

    // 发送批量取消事件
    let event = LanTransferEvent::BatchTransferCompleted {
        session_id: request_id.to_string(),
        total_files: 0,
        save_directory: String::new(),
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

/// 获取传输会话
pub fn get_transfer_session(request_id: &str) -> Option<TransferSession> {
    let sessions = get_active_sessions();
    let sessions = sessions.read();
    sessions.get(request_id).cloned()
}

/// 获取所有活跃会话
pub fn get_all_sessions() -> Vec<TransferSession> {
    let sessions = get_active_sessions();
    let sessions = sessions.read();
    sessions.values().cloned().collect()
}