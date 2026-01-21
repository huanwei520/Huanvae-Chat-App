/*!
 * 文件传输模块
 *
 * 实现文件发送逻辑
 *
 * 功能：
 * - 点对点连接管理（请求、响应、断开）
 * - 向已连接设备发送文件（无需再次确认）
 * - 多文件批量传输
 * - 断点续传支持
 * - 传输进度跟踪
 * - 取消传输
 * - 详细传输调试日志
 *
 * 调试日志说明：
 * - 📤 开始传输: 文件名、大小、目标地址
 * - 📡 HTTP请求: prepare-upload、upload、finish 请求和响应状态
 * - 📦 分块上传: 块大小、块数量、传输进度
 * - 📊 进度日志: 每传输 5MB 打印一次进度（百分比、速度、剩余时间）
 * - 🔄 断点续传: 恢复偏移量
 * - ❌ 错误信息: 详细的错误位置和原因
 *
 * 更新日志：
 * - 2026-01-21: 添加详细传输调试日志，用于排查跨平台传输问题
 */

use super::discovery::get_event_sender;
use super::protocol::*;
use super::{emit_lan_event, get_lan_transfer_state};
use chrono::Utc;
use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use uuid::Uuid;

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
pub async fn request_peer_connection(device_id: &str) -> Result<String, TransferError> {
    use super::server::get_active_peer_connections_map;

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

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&RequestBody { from_device })
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
    #[serde(rename_all = "camelCase")]
    struct Response {
        connection_id: String,
    }

    let resp: Response = response
        .json()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    // 保存连接（等待对方确认后才真正建立）
    // 这里先记录为发起方等待状态
    let connection = PeerConnection {
        connection_id: resp.connection_id.clone(),
        peer_device: target_device.clone(),
        established_at: Utc::now().to_rfc3339(),
        status: PeerConnectionStatus::Connected, // 先设置为连接状态，等待对方确认
        is_initiator: true,
    };

    {
        let connections = get_active_peer_connections_map();
        let mut connections = connections.lock();
        connections.insert(resp.connection_id.clone(), connection);
    }

    println!(
        "[LanTransfer] 连接请求已发送到 {} ({})",
        target_device.device_name, target_device.ip_address
    );

    Ok(resp.connection_id)
}

/// 响应点对点连接请求（接收方调用）
pub async fn respond_peer_connection(
    connection_id: &str,
    accept: bool,
) -> Result<(), TransferError> {
    use super::server::{get_active_peer_connections_map, get_pending_peer_connection_requests_map};

    // 获取待处理的连接请求
    let request = {
        let requests = get_pending_peer_connection_requests_map();
        let mut requests = requests.lock();
        requests
            .remove(connection_id)
            .ok_or_else(|| TransferError::RequestNotFound(connection_id.to_string()))?
    };

    let state = get_lan_transfer_state();

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| TransferError::ConnectionFailed("本地服务未启动".to_string()))?
    };

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
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

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
        }

        // 发送事件通知前端
        let event = LanTransferEvent::PeerConnectionEstablished { connection };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
    }

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

        // 计算文件哈希
        let sha256 = calculate_file_hash(path)?;

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

    for file_path in &file_paths {
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

        // 计算文件哈希
        let file_hash = calculate_file_hash(path)?;

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

/// 开始批量传输
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
    let mut completed_files = 0u32;
    let mut total_transferred: u64 = 0;

    // 逐个传输文件
    for (index, (file_state, file_path)) in files.iter().zip(file_paths.iter()).enumerate() {
        let file_meta = &file_state.file;

        // 发送批量进度
        let progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files,
            completed_files,
            total_bytes,
            transferred_bytes: total_transferred,
            speed: 0,
            current_file: Some(file_meta.clone()),
            eta_seconds: None,
        };

        let event = LanTransferEvent::BatchProgress {
            progress: progress.clone(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        // 传输单个文件
        match do_file_transfer_with_resume(
            &target_device,
            &session_id,
            file_meta,
            file_path,
            index,
            total_files as usize,
            total_transferred,
            total_bytes,
        )
        .await
        {
            Ok(bytes) => {
                completed_files += 1;
                total_transferred += bytes;

                // 更新会话中的文件状态
                {
                    let sessions = get_active_sessions();
                    let mut sessions = sessions.write();
                    if let Some(s) = sessions.get_mut(request_id)
                        && let Some(fs) = s.files.get_mut(index)
                    {
                        fs.status = TransferStatus::Completed;
                        fs.transferred_bytes = file_meta.file_size;
                    }
                }
            }
            Err(e) => {
                eprintln!("[LanTransfer] 文件传输失败: {} - {}", file_meta.file_name, e);

                // 更新文件状态为失败
                {
                    let sessions = get_active_sessions();
                    let mut sessions = sessions.write();
                    if let Some(s) = sessions.get_mut(request_id) {
                        if let Some(fs) = s.files.get_mut(index) {
                            fs.status = TransferStatus::Failed;
                        }
                        s.status = SessionStatus::Failed;
                    }
                }

                // 发送失败事件
                let event = LanTransferEvent::TransferFailed {
                    task_id: file_meta.file_id.clone(),
                    error: e.to_string(),
                };
                let _ = get_event_sender().send(event.clone());
                emit_lan_event(&event);

                return Err(e);
            }
        }
    }

    // 更新会话状态为完成
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(s) = sessions.get_mut(request_id) {
            s.status = SessionStatus::Completed;
        }
    }

    // 发送批量完成事件
    let event = LanTransferEvent::BatchTransferCompleted {
        session_id: session_id.clone(),
        total_files,
        save_directory: String::new(), // 发送方不需要保存目录
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!(
        "[LanTransfer] 批量传输完成: {} 个文件 -> {}",
        total_files, target_device.device_name
    );

    Ok(())
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

        let response = client
            .post(&upload_url)
            .body(chunk_data.to_vec())
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| {
                println!(
                    "[LanTransfer] ❌ 块上传请求失败 (块 #{}, offset={}): {}",
                    chunk_count, offset, e
                );
                TransferError::TransferFailed(format!("块上传失败: {}", e))
            })?;

        let response_status = response.status();
        let chunk_resp: ChunkResponse = response.json().await.map_err(|e| {
            println!(
                "[LanTransfer] ❌ 块响应解析失败 (块 #{}, status={}): {}",
                chunk_count, response_status, e
            );
            TransferError::TransferFailed(format!("块响应解析失败: {}", e))
        })?;

        if !chunk_resp.success {
            let error = chunk_resp.error.unwrap_or_else(|| "块传输失败".to_string());
            println!(
                "[LanTransfer] ❌ 块传输失败 (块 #{}, offset={}): {}",
                chunk_count, offset, error
            );
            return Err(TransferError::TransferFailed(error));
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

/// 计算文件哈希
fn calculate_file_hash(path: &Path) -> Result<String, TransferError> {
    let mut file =
        std::fs::File::open(path).map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

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

/// 取消会话
pub async fn cancel_session(request_id: &str) -> Result<(), TransferError> {
    // 更新会话状态
    {
        let sessions = get_active_sessions();
        let mut sessions = sessions.write();
        if let Some(session) = sessions.get_mut(request_id) {
            session.status = SessionStatus::Cancelled;

            // 取消所有文件
            for file_state in &mut session.files {
                if file_state.status == TransferStatus::Pending
                    || file_state.status == TransferStatus::Transferring
                {
                    file_state.status = TransferStatus::Cancelled;
                }
            }
        }
    }

    println!("[LanTransfer] 会话已取消: {}", request_id);

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