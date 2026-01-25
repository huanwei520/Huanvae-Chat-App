/*!
 * HTTP 服务器模块
 *
 * 处理文件接收、传输请求等 HTTP 请求
 *
 * API 端点：
 * - GET /api/info: 获取设备信息
 *
 * 点对点连接（新版）：
 * - POST /api/peer-connection-request: 请求建立点对点连接
 * - POST /api/peer-connection-response: 响应连接请求
 * - POST /api/peer-disconnect: 断开连接
 *
 * 旧版兼容：
 * - POST /api/connect: 连接请求（旧版兼容）
 * - POST /api/transfer-request: 传输请求（需确认）
 * - POST /api/transfer-response: 传输请求响应
 *
 * 文件传输：
 * - POST /api/prepare-upload: 准备上传（支持断点续传）
 * - POST /api/upload: 上传文件块
 * - POST /api/finish: 完成上传
 * - POST /api/cancel: 取消传输
 *
 * 接收方进度显示：
 * - prepare-upload: 发送初始进度事件（0% 或续传偏移量）
 * - upload: 每 100ms 发送进度事件（包含接收速度、剩余时间）
 * - finish: 发送 BatchTransferCompleted 事件（清除前端进度）
 *
 * 连接管理：
 * - 服务端每次只处理一个 HTTP 请求（无 Keep-Alive 循环）
 * - 所有响应添加 `Connection: close` 头，防止客户端复用已关闭的连接
 *
 * 更新日志：
 * - 2026-01-21: 添加 Connection: close 头修复跨平台传输连接重用问题
 * - 2026-01-21: 添加接收方进度显示（初始进度、实时速度、完成事件）
 */

use super::config;
use super::discovery::get_event_sender;
use super::protocol::*;
use super::resume::get_resume_manager;
use super::{emit_lan_event, get_lan_transfer_state};
use chrono::Utc;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use crc32fast::Hasher as Crc32Hasher;
use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::oneshot;
use uuid::Uuid;

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum ServerError {
    #[error("服务器启动失败: {0}")]
    StartFailed(String),
    #[error("请求处理失败: {0}")]
    RequestFailed(String),
    #[error("文件写入失败: {0}")]
    FileWriteFailed(String),
    #[allow(dead_code)]
    #[error("校验失败")]
    ChecksumMismatch,
}

// ============================================================================
// 服务器状态
// ============================================================================

/// 服务器关闭信号
static SERVER_SHUTDOWN: OnceCell<Arc<Mutex<Option<oneshot::Sender<()>>>>> = OnceCell::new();

/// 活跃的上传会话
static UPLOAD_SESSIONS: OnceCell<Arc<Mutex<HashMap<String, UploadSession>>>> = OnceCell::new();

/// 待处理的传输请求
static PENDING_TRANSFER_REQUESTS: OnceCell<Arc<Mutex<HashMap<String, TransferRequest>>>> =
    OnceCell::new();

/// 活跃的点对点连接
static ACTIVE_PEER_CONNECTIONS: OnceCell<Arc<Mutex<HashMap<String, PeerConnection>>>> =
    OnceCell::new();

/// 待处理的连接请求
static PENDING_PEER_CONNECTION_REQUESTS: OnceCell<
    Arc<Mutex<HashMap<String, PeerConnectionRequest>>>,
> = OnceCell::new();

fn get_upload_sessions() -> Arc<Mutex<HashMap<String, UploadSession>>> {
    UPLOAD_SESSIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 获取待处理的传输请求
pub fn get_pending_transfer_requests_map() -> Arc<Mutex<HashMap<String, TransferRequest>>> {
    PENDING_TRANSFER_REQUESTS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 获取活跃的点对点连接
pub fn get_active_peer_connections_map() -> Arc<Mutex<HashMap<String, PeerConnection>>> {
    ACTIVE_PEER_CONNECTIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 获取待处理的连接请求
pub fn get_pending_peer_connection_requests_map(
) -> Arc<Mutex<HashMap<String, PeerConnectionRequest>>> {
    PENDING_PEER_CONNECTION_REQUESTS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 上传会话（支持断点续传）
struct UploadSession {
    /// 会话 ID（保留用于日志和调试）
    #[allow(dead_code)]
    session_id: String,
    /// 文件元信息
    files: HashMap<String, FileMetadata>,
    /// 文件写入器
    writers: HashMap<String, std::fs::File>,
    /// 文件哈希计算器 (CRC32)
    hashers: HashMap<String, Crc32Hasher>,
    /// 已接收的字节数
    received_bytes: HashMap<String, u64>,
    /// 上次进度更新时间（用于限制更新频率）
    last_progress_time: std::time::Instant,
    /// 传输开始时间（用于计算速度）
    start_time: std::time::Instant,
    /// 续传起始字节（用于速度计算）
    resume_offset: u64,
    /// 目标文件路径（Android 直接写入公共目录时使用）
    /// 如果有值，表示直接写入目标路径，完成时不需要移动文件
    target_paths: HashMap<String, String>,
}

// ============================================================================
// 服务器管理
// ============================================================================

/// 启动 HTTP 服务器
pub async fn start_server(device_info: DeviceInfo) -> Result<(), ServerError> {
    use tokio::net::TcpSocket;
    
    let addr = SocketAddr::from(([0, 0, 0, 0], SERVICE_PORT));

    // 使用 TcpSocket 来设置 SO_REUSEADDR，避免 TIME_WAIT 导致端口占用
    let socket = TcpSocket::new_v4()
        .map_err(|e| ServerError::StartFailed(format!("创建 socket 失败: {}", e)))?;
    
    // 设置端口复用，允许快速重启服务
    socket.set_reuseaddr(true)
        .map_err(|e| ServerError::StartFailed(format!("设置 SO_REUSEADDR 失败: {}", e)))?;
    
    socket.bind(addr)
        .map_err(|e| ServerError::StartFailed(format!("绑定端口 {} 失败: {}", SERVICE_PORT, e)))?;
    
    let listener = socket.listen(128)
        .map_err(|e| ServerError::StartFailed(format!("监听失败: {}", e)))?;

    println!("[LanTransfer] HTTP 服务器启动: {} (SO_REUSEADDR 已启用)", addr);

    // 创建关闭信号
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let shutdown_holder = SERVER_SHUTDOWN.get_or_init(|| Arc::new(Mutex::new(None)));
    {
        let mut holder = shutdown_holder.lock();
        *holder = Some(shutdown_tx);
    }

    // 服务器主循环
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, peer_addr)) => {
                        println!("[LanTransfer] 📥 收到 TCP 连接: 来自 {}", peer_addr);
                        let device_info = device_info.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(stream, peer_addr, device_info).await {
                                eprintln!("[LanTransfer] ❌ 处理连接失败 (来自 {}): {}", peer_addr, e);
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[LanTransfer] ❌ 接受连接失败: {}", e);
                    }
                }
            }
            _ = &mut shutdown_rx => {
                println!("[LanTransfer] HTTP 服务器关闭");
                break;
            }
        }
    }

    Ok(())
}

/// 停止 HTTP 服务器
pub async fn stop_server() {
    if let Some(shutdown_holder) = SERVER_SHUTDOWN.get() {
        let mut holder = shutdown_holder.lock();
        if let Some(tx) = holder.take() {
            let _ = tx.send(());
        }
    }
}

// ============================================================================
// 请求处理
// ============================================================================

/// 处理 TCP 连接
async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    device_info: DeviceInfo,
) -> Result<(), ServerError> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    let (reader, mut writer) = stream.split();
    let mut buf_reader = BufReader::new(reader);

    // 读取请求行
    let mut request_line = String::new();
    buf_reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // 解析请求方法和路径
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return send_error_response(&mut writer, 400, "Bad Request").await;
    }

    let method = parts[0];
    let path = parts[1];

    // 读取请求头
    let mut headers = HashMap::new();
    loop {
        let mut header_line = String::new();
        buf_reader
            .read_line(&mut header_line)
            .await
            .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

        let header_line = header_line.trim();
        if header_line.is_empty() {
            break;
        }

        if let Some((key, value)) = header_line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    // 读取请求体
    let content_length: usize = headers
        .get("content-length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        buf_reader
            .read_exact(&mut body)
            .await
            .map_err(|e| ServerError::RequestFailed(e.to_string()))?;
    }

    // 路由请求
    match (method, path) {
        ("GET", "/api/info") => {
            handle_info(&mut writer, &device_info).await
        }
        // ========== 点对点连接 API ==========
        ("POST", "/api/peer-connection-request") => {
            handle_peer_connection_request(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/peer-connection-response") => {
            handle_peer_connection_response(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/peer-disconnect") => {
            handle_peer_disconnect(&mut writer, &body).await
        }
        // ========== 旧版兼容 API ==========
        ("POST", "/api/connect") => {
            handle_connect(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/transfer-request") => {
            handle_transfer_request(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/transfer-response") => {
            handle_transfer_response(&mut writer, &body).await
        }
        // ========== 文件传输 API ==========
        ("POST", "/api/prepare-upload") => {
            handle_prepare_upload(&mut writer, &body).await
        }
        ("POST", path) if path.starts_with("/api/upload") => {
            handle_upload(&mut writer, &body, path, &headers).await
        }
        ("POST", path) if path.starts_with("/api/finish") => {
            handle_finish(&mut writer, path).await
        }
        ("POST", "/api/cancel") => {
            handle_cancel(&mut writer, &body).await
        }
        _ => {
            send_error_response(&mut writer, 404, "Not Found").await
        }
    }
}

/// 发送错误响应
///
/// 添加 `Connection: close` 头，因为服务端每次只处理一个请求。
async fn send_error_response(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    status: u16,
    message: &str,
) -> Result<(), ServerError> {
    use tokio::io::AsyncWriteExt;

    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{{\"error\":\"{}\"}}",
        status,
        message,
        message.len() + 12,
        message
    );

    writer
        .write_all(response.as_bytes())
        .await
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    Ok(())
}

/// 发送 JSON 响应
///
/// 添加 `Connection: close` 头，因为服务端每次只处理一个请求。
/// 这可以防止客户端尝试复用已关闭的连接。
async fn send_json_response<T: serde::Serialize>(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    data: &T,
) -> Result<(), ServerError> {
    use tokio::io::AsyncWriteExt;

    let body = serde_json::to_string(data)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );

    writer
        .write_all(response.as_bytes())
        .await
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    Ok(())
}

// ============================================================================
// API 处理函数
// ============================================================================

/// 处理设备信息请求
async fn handle_info(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    device_info: &DeviceInfo,
) -> Result<(), ServerError> {
    send_json_response(writer, device_info).await
}

// ============================================================================
// 点对点连接 API
// ============================================================================

/// 请求体：点对点连接请求
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerConnectionRequestBody {
    from_device: DiscoveredDevice,
}

/// 请求体：点对点连接响应
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerConnectionResponseBody {
    connection_id: String,
    accepted: bool,
    from_device: Option<DiscoveredDevice>,
}

/// 请求体：断开连接
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerDisconnectBody {
    connection_id: String,
}

/// 处理点对点连接请求（接收方收到）
///
/// 如果已与该设备建立连接，则返回现有连接 ID（防止重复连接）
async fn handle_peer_connection_request(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    println!("[LanTransfer] ========== 收到连接请求 ==========");
    println!("[LanTransfer] 来源 TCP 地址: {}", peer_addr);
    
    let req_body: PeerConnectionRequestBody =
        serde_json::from_slice(body).map_err(|e| {
            println!("[LanTransfer] ❌ 解析请求 JSON 失败: {}", e);
            ServerError::RequestFailed(e.to_string())
        })?;

    let from_device_id = req_body.from_device.device_id.clone();
    
    println!("[LanTransfer] 请求来自:");
    println!("[LanTransfer]   设备 ID: {}", from_device_id);
    println!("[LanTransfer]   设备名: {}", req_body.from_device.device_name);
    println!("[LanTransfer]   声称 IP: {}:{}", req_body.from_device.ip_address, req_body.from_device.port);
    println!("[LanTransfer]   实际 TCP 来源: {}", peer_addr);

    // ========== 检查是否已存在与该设备的连接（去重）==========
    // 注意：先提取数据，释放锁，再调用 async 函数
    let existing_connection_id: Option<String> = {
        let connections = get_active_peer_connections_map();
        let connections = connections.lock();
        connections
            .iter()
            .find(|(_, conn)| {
                conn.peer_device.device_id == from_device_id
                    && conn.status == PeerConnectionStatus::Connected
            })
            .map(|(conn_id, _)| conn_id.clone())
    };

    if let Some(conn_id) = existing_connection_id {
        println!(
            "[LanTransfer] 已存在与 {} 的连接: {}，返回现有连接",
            from_device_id, conn_id
        );

        // 重新发送连接建立事件，确保前端知道这个连接
        let connection: Option<PeerConnection> = {
            let connections = get_active_peer_connections_map();
            let connections = connections.lock();
            connections.get(&conn_id).cloned()
        };

        if let Some(conn) = connection {
            let event = LanTransferEvent::PeerConnectionEstablished { connection: conn };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);
        }

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Response {
            connection_id: String,
            status: String,
        }

        return send_json_response(
            writer,
            &Response {
                connection_id: conn_id,
                status: "connected".to_string(),
            },
        )
        .await;
    }

    // ========== 检查是否已有待处理的连接请求（防止重复请求）==========
    let existing_request: Option<PeerConnectionRequest> = {
        let requests = get_pending_peer_connection_requests_map();
        let requests = requests.lock();
        requests
            .iter()
            .find(|(_, req)| req.from_device.device_id == from_device_id)
            .map(|(_, req)| req.clone())
    };

    if let Some(request) = existing_request {
        println!(
            "[LanTransfer] 已存在来自 {} 的待处理请求: {}，重新发送事件",
            from_device_id, request.connection_id
        );

        // 重新发送事件到前端，确保前端知道这个请求
        let event = LanTransferEvent::PeerConnectionRequest {
            request: request.clone(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Response {
            connection_id: String,
            status: String,
        }

        return send_json_response(
            writer,
            &Response {
                connection_id: request.connection_id,
                status: "pending".to_string(),
            },
        )
        .await;
    }

    let connection_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // 创建连接请求
    let request = PeerConnectionRequest {
        connection_id: connection_id.clone(),
        from_device: DiscoveredDevice {
            ip_address: peer_addr.ip().to_string(),
            ..req_body.from_device
        },
        requested_at: now,
    };

    println!("[LanTransfer] ✓ 创建新连接请求: {}", connection_id);
    println!("[LanTransfer]   修正后的 IP: {} (使用 TCP 来源地址)", peer_addr.ip());

    // 保存到待处理请求
    {
        let requests = get_pending_peer_connection_requests_map();
        let mut requests = requests.lock();
        requests.insert(connection_id.clone(), request.clone());
        println!("[LanTransfer] ✓ 已保存到待处理请求列表 (共 {} 个)", requests.len());
    }

    // 发送事件通知前端
    let event = LanTransferEvent::PeerConnectionRequest { request };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!("[LanTransfer] ✓ 已发送 PeerConnectionRequest 事件到前端");
    println!("[LanTransfer] ========== 等待用户响应 ==========");

    // 返回连接 ID
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Response {
        connection_id: String,
        status: String,
    }

    send_json_response(
        writer,
        &Response {
            connection_id,
            status: "pending".to_string(),
        },
    )
    .await
}

/// 处理点对点连接响应（发起方收到接收方的响应）
async fn handle_peer_connection_response(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    println!("[LanTransfer] ========== 收到连接响应 ==========");
    println!("[LanTransfer] 来源 TCP 地址: {}", peer_addr);
    
    let req_body: PeerConnectionResponseBody =
        serde_json::from_slice(body).map_err(|e| {
            println!("[LanTransfer] ❌ 解析响应 JSON 失败: {}", e);
            ServerError::RequestFailed(e.to_string())
        })?;

    let connection_id = req_body.connection_id.clone();
    let now = Utc::now().to_rfc3339();
    
    println!("[LanTransfer] 连接 ID: {}", connection_id);
    println!("[LanTransfer] 接受连接: {}", req_body.accepted);
    if let Some(ref from_device) = req_body.from_device {
        println!("[LanTransfer] 响应设备: {} @ {}:{}", 
            from_device.device_name, from_device.ip_address, from_device.port);
    }

    if req_body.accepted {
        // 接收方接受了连接，创建连接对象
        if let Some(from_device) = req_body.from_device {
            let connection = PeerConnection {
                connection_id: connection_id.clone(),
                peer_device: DiscoveredDevice {
                    ip_address: peer_addr.ip().to_string(),
                    ..from_device
                },
                established_at: now,
                status: PeerConnectionStatus::Connected,
                is_initiator: true, // 发起方收到此响应
            };

            // 保存连接
            {
                let connections = get_active_peer_connections_map();
                let mut connections = connections.lock();
                connections.insert(connection_id.clone(), connection.clone());
            }

            // 发送事件通知前端
            let event = LanTransferEvent::PeerConnectionEstablished { connection };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);

            println!("[LanTransfer] 连接已建立: {}", connection_id);
        }
    } else {
        // 连接被拒绝，从发起方的活跃连接中移除
        {
            let connections = get_active_peer_connections_map();
            let mut connections = connections.lock();
            connections.remove(&connection_id);
        }

        // 发送连接关闭事件通知前端
        let event = LanTransferEvent::PeerConnectionClosed {
            connection_id: connection_id.clone(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        println!("[LanTransfer] 连接请求被拒绝: {}，已清理连接记录", connection_id);
    }

    // 返回确认
    #[derive(serde::Serialize)]
    struct AckResponse {
        success: bool,
    }

    send_json_response(writer, &AckResponse { success: true }).await
}

/// 处理断开连接请求
async fn handle_peer_disconnect(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    let req_body: PeerDisconnectBody =
        serde_json::from_slice(body).map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let connection_id = req_body.connection_id.clone();

    // 从活跃连接中移除
    {
        let connections = get_active_peer_connections_map();
        let mut connections = connections.lock();
        connections.remove(&connection_id);
    }

    // 发送事件通知前端
    let event = LanTransferEvent::PeerConnectionClosed {
        connection_id: connection_id.clone(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!("[LanTransfer] 连接已断开: {}", connection_id);

    // 返回确认
    #[derive(serde::Serialize)]
    struct AckResponse {
        success: bool,
    }

    send_json_response(writer, &AckResponse { success: true }).await
}

// ============================================================================
// 旧版兼容 API
// ============================================================================

/// 处理连接请求（旧版兼容）
async fn handle_connect(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    // 解析请求体
    let from_device: DiscoveredDevice = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let request_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let request = ConnectionRequest {
        request_id: request_id.clone(),
        from_device: DiscoveredDevice {
            ip_address: peer_addr.ip().to_string(),
            ..from_device
        },
        requested_at: now,
        status: ConnectionStatus::Pending,
    };

    // 保存到待处理请求
    let state = get_lan_transfer_state();
    {
        let mut pending = state.pending_requests.write();
        pending.insert(request_id.clone(), request.clone());
    }

    // 发送事件通知前端
    let _ = get_event_sender().send(LanTransferEvent::ConnectionRequest {
        request: request.clone(),
    });

    // 返回请求 ID
    #[derive(serde::Serialize)]
    struct ConnectResponse {
        request_id: String,
    }

    send_json_response(writer, &ConnectResponse { request_id }).await
}

/// 传输请求的请求体
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferRequestBody {
    from_device: DiscoveredDevice,
    files: Vec<FileMetadata>,
    total_size: u64,
    /// 关联的连接 ID（已建立连接时自动接受）
    #[serde(default)]
    connection_id: Option<String>,
    /// 是否自动接受（发送方指定）
    #[serde(default)]
    auto_accept: bool,
}

/// 处理传输请求（新版，需确认后才能传输）
async fn handle_transfer_request(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    // 解析请求体
    let req_body: TransferRequestBody = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let request_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let request = TransferRequest {
        request_id: request_id.clone(),
        from_device: DiscoveredDevice {
            ip_address: peer_addr.ip().to_string(),
            ..req_body.from_device
        },
        files: req_body.files,
        total_size: req_body.total_size,
        requested_at: now,
        status: TransferRequestStatus::Pending,
    };

    // 检查是否应该自动接受
    // 1. 请求中包含 auto_accept 标志（发送方指定）
    // 2. 有有效的 connection_id（已建立连接）
    // 3. 是信任设备
    let should_auto_accept = req_body.auto_accept
        || req_body.connection_id.as_ref().is_some_and(|cid| {
            let connections = get_active_peer_connections_map();
            let connections = connections.lock();
            connections.contains_key(cid)
        })
        || config::is_device_trusted(&request.from_device.device_id);

    if should_auto_accept {
        // 自动接受
        let save_dir = config::get_save_directory();
        let response = TransferRequestResponse {
            request_id: request_id.clone(),
            accepted: true,
            reject_reason: None,
            save_directory: Some(save_dir.to_string_lossy().to_string()),
        };

        // 通知前端（自动接受）
        let event = LanTransferEvent::TransferRequestResponse {
            request_id: request_id.clone(),
            accepted: true,
            reject_reason: None,
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        send_json_response(writer, &response).await
    } else {
        // 保存到待处理请求
        {
            let requests = get_pending_transfer_requests_map();
            let mut requests = requests.lock();
            requests.insert(request_id.clone(), request.clone());
        }

        // 发送事件通知前端
        let event = LanTransferEvent::TransferRequestReceived {
            request: request.clone(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        // 返回请求 ID（等待用户确认）
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PendingResponse {
            request_id: String,
            status: String,
        }

        send_json_response(
            writer,
            &PendingResponse {
                request_id,
                status: "pending".to_string(),
            },
        )
        .await
    }
}

/// 传输响应请求体
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferResponseBody {
    request_id: String,
    accepted: bool,
    reject_reason: Option<String>,
}

/// 处理传输请求响应（发送方收到接收方的确认）
async fn handle_transfer_response(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    use super::transfer;

    let req_body: TransferResponseBody = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let request_id = req_body.request_id.clone();
    let accepted = req_body.accepted;

    // 发送事件通知前端
    let event = LanTransferEvent::TransferRequestResponse {
        request_id: request_id.clone(),
        accepted,
        reject_reason: req_body.reject_reason.clone(),
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    // 如果被接受，启动传输
    if accepted {
        // 从发送方的会话存储中获取会话信息和文件路径
        if let Some(session) = transfer::get_transfer_session(&request_id) {
            let file_paths = session.file_paths.clone();

            if !file_paths.is_empty() {
                println!(
                    "[LanTransfer] 传输请求已被接受，开始传输: {} ({} 个文件)",
                    request_id,
                    file_paths.len()
                );

                // 在后台启动批量传输
                let request_id_clone = request_id.clone();
                tokio::spawn(async move {
                    if let Err(e) = transfer::start_batch_transfer(&request_id_clone, file_paths).await {
                        eprintln!("[LanTransfer] 批量传输失败: {}", e);
                    }
                });
            } else {
                println!("[LanTransfer] 传输请求已被接受，但没有文件路径: {}", request_id);
            }
        } else {
            println!("[LanTransfer] 传输请求已被接受，但找不到会话: {}", request_id);
        }
    } else {
        println!(
            "[LanTransfer] 传输请求被拒绝: {} ({})",
            request_id,
            req_body.reject_reason.as_deref().unwrap_or("无原因")
        );
    }

    // 返回确认响应
    #[derive(serde::Serialize)]
    struct AckResponse {
        success: bool,
    }

    send_json_response(writer, &AckResponse { success: true }).await
}

/// 处理准备上传请求（支持断点续传）
async fn handle_prepare_upload(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    // 解析请求
    let request: PrepareUploadRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // 确保配置目录存在
    config::ensure_directories()
        .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

    // 获取保存目录
    let save_directory = config::get_save_directory();
    std::fs::create_dir_all(&save_directory)
        .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

    let file = &request.file;
    let file_id = &file.file_id;

    // 检查是否可以断点续传
    let resume_manager = get_resume_manager();
    let resume_offset = if request.resume {
        match resume_manager.can_resume(file_id, &file.sha256) {
            Ok(Some(offset)) => offset,
            Ok(None) => 0,
            Err(e) => {
                println!("[LanTransfer] 检查续传状态失败: {}", e);
                0
            }
        }
    } else {
        // 不使用续传，清理旧的续传信息
        let _ = resume_manager.clear_resume_info(file_id);
        0
    };

    // 创建或打开文件
    // direct_target_path: Android 直接写入模式时的目标路径
    let (writer_file, hasher, direct_target_path): (std::fs::File, Crc32Hasher, Option<String>) = if resume_offset > 0 {
        // 断点续传：打开已有文件（不支持直接写入模式）
        let mut f = resume_manager
            .open_temp_file(file_id, resume_offset)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        // 需要重新计算哈希（从头读取）
        let temp_path = resume_manager.get_temp_file_path(file_id);
        let mut hasher = Crc32Hasher::new();

        // 读取已有内容计算哈希
        let mut temp_reader = std::fs::File::open(&temp_path)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut remaining = resume_offset;
        while remaining > 0 {
            use std::io::Read;
            let to_read = std::cmp::min(remaining as usize, buffer.len());
            let bytes_read = temp_reader
                .read(&mut buffer[..to_read])
                .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
            remaining -= bytes_read as u64;
        }

        // 定位到续传位置
        f.seek(SeekFrom::Start(resume_offset))
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        println!(
            "[LanTransfer] 断点续传: {} 从 {} 字节继续",
            file.file_name, resume_offset
        );

        (f, hasher, None)
    } else {
        // 新传输
        // Android 平台：直接写入公共 Download 目录，避免临时文件和跨文件系统复制
        #[cfg(target_os = "android")]
        {
            // 获取最终保存路径
            let final_path = config::get_file_save_path(&file.file_name);

            // 确保目标目录存在
            if let Some(parent) = final_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| ServerError::FileWriteFailed(format!("创建目标目录失败: {}", e)))?;
            }

            let f = std::fs::File::create(&final_path)
                .map_err(|e| ServerError::FileWriteFailed(format!("创建目标文件失败: {}", e)))?;
            let hasher = Crc32Hasher::new();

            println!(
                "[LanTransfer] 新传输 (Android 直接写入): {} -> {:?} (大小: {} 字节)",
                file.file_name, final_path, file.file_size
            );

            (f, hasher, Some(final_path.to_string_lossy().to_string()))
        }

        // 非 Android 平台：使用临时文件
        #[cfg(not(target_os = "android"))]
        {
            let f = resume_manager
                .create_temp_file(file_id)
                .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;
            let hasher = Crc32Hasher::new();

            println!("[LanTransfer] 新传输 (临时文件): {} (大小: {} 字节)", file.file_name, file.file_size);

            (f, hasher, None)
        }
    };

    // 创建上传会话
    let mut files = HashMap::new();
    let mut writers = HashMap::new();
    let mut hashers = HashMap::new();
    let mut received_bytes = HashMap::new();
    let mut target_paths = HashMap::new();

    files.insert(file_id.clone(), file.clone());
    writers.insert(file_id.clone(), writer_file);
    hashers.insert(file_id.clone(), hasher);
    received_bytes.insert(file_id.clone(), resume_offset);

    // 保存目标路径（Android 直接写入模式）
    if let Some(ref target_path) = direct_target_path {
        target_paths.insert(file_id.clone(), target_path.clone());
    }

    let session = UploadSession {
        session_id: request.session_id.clone(),
        files,
        writers,
        hashers,
        received_bytes,
        last_progress_time: std::time::Instant::now(),
        start_time: std::time::Instant::now(),
        resume_offset,
        target_paths,
    };

    // 保存会话
    let sessions = get_upload_sessions();
    {
        let mut sessions = sessions.lock();
        sessions.insert(request.session_id.clone(), session);
    }

    // 发送初始进度事件（让用户知道传输已开始）
    let initial_progress = BatchTransferProgress {
        session_id: request.session_id.clone(),
        total_files: 1,
        completed_files: 0,
        total_bytes: file.file_size,
        transferred_bytes: resume_offset,
        speed: 0,
        current_file: Some(file.clone()),
        eta_seconds: None,
    };
    let initial_event = LanTransferEvent::BatchProgress {
        progress: initial_progress,
    };
    let _ = get_event_sender().send(initial_event.clone());
    emit_lan_event(&initial_event);

    // 返回响应
    let response = PrepareUploadResponse {
        session_id: request.session_id,
        accepted: true,
        resume_offset,
        reject_reason: None,
        save_directory: Some(save_directory.to_string_lossy().to_string()),
    };

    send_json_response(writer, &response).await
}

/// 处理文件块上传（支持断点续传）
async fn handle_upload(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    path: &str,
    _headers: &HashMap<String, String>,
) -> Result<(), ServerError> {
    // 解析查询参数
    let query = path.split('?').nth(1).unwrap_or("");
    let params: HashMap<&str, &str> = query
        .split('&')
        .filter_map(|s| s.split_once('='))
        .collect();

    let session_id = params.get("sessionId").unwrap_or(&"").to_string();
    let file_id = params.get("fileId").unwrap_or(&"").to_string();

    // 在锁的作用域内完成所有同步操作
    let (response, file_sha256, received, should_emit_progress, file_meta, speed, eta_seconds) = {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| ServerError::RequestFailed("会话不存在".to_string()))?;

        // 写入数据
        let file_writer = session
            .writers
            .get_mut(&file_id)
            .ok_or_else(|| ServerError::RequestFailed("文件不存在".to_string()))?;

        file_writer
            .write_all(body)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        // 刷新到磁盘（确保数据持久化）
        file_writer
            .flush()
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        // 更新哈希
        if let Some(hasher) = session.hashers.get_mut(&file_id) {
            hasher.update(body);
        }

        // 获取文件元信息
        let file_meta = session.files.get(&file_id).cloned();

        // 获取文件 SHA256（用于更新断点信息）
        let file_sha256 = file_meta
            .as_ref()
            .map(|f| f.sha256.clone())
            .unwrap_or_default();

        // 更新已接收字节数
        let received_ref = session.received_bytes.get_mut(&file_id).unwrap();
        *received_ref += body.len() as u64;
        let received = *received_ref;

        // 计算速度（从开始传输到现在实际传输的字节数 / 耗时）
        let elapsed = session.start_time.elapsed().as_secs_f64();
        let transferred_since_start = received.saturating_sub(session.resume_offset);
        let speed = if elapsed > 0.0 {
            (transferred_since_start as f64 / elapsed) as u64
        } else {
            0
        };

        // 计算剩余时间
        let total_bytes = file_meta.as_ref().map(|f| f.file_size).unwrap_or(0);
        let remaining_bytes = total_bytes.saturating_sub(received);
        let eta_seconds = if speed > 0 {
            Some(remaining_bytes / speed)
        } else {
            None
        };

        // 检查是否应该发送进度事件（每 100ms 一次）
        let should_emit = session.last_progress_time.elapsed().as_millis() >= 100;
        if should_emit {
            session.last_progress_time = std::time::Instant::now();
        }

        let response = ChunkResponse {
            success: true,
            next_offset: received,
            error: None,
        };

        (response, file_sha256, received, should_emit, file_meta, speed, eta_seconds)
    };

    // 更新断点续传信息（锁已释放）
    let resume_manager = get_resume_manager();
    let _ = resume_manager.update_progress(&file_id, &file_sha256, received, None);

    // 发送接收进度事件（限制频率）
    if should_emit_progress
        && let Some(file) = file_meta
    {
        let total_bytes = file.file_size;

        let progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files: 1,
            completed_files: 0,
            total_bytes,
            transferred_bytes: received,
            speed,
            current_file: Some(file),
            eta_seconds,
        };

        let event = LanTransferEvent::BatchProgress { progress };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
    }

    send_json_response(writer, &response).await
}

/// 处理上传完成
async fn handle_finish(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    path: &str,
) -> Result<(), ServerError> {
    // 解析查询参数
    let query = path.split('?').nth(1).unwrap_or("");
    let params: HashMap<&str, &str> = query
        .split('&')
        .filter_map(|s| s.split_once('='))
        .collect();

    let session_id = params.get("sessionId").unwrap_or(&"").to_string();
    let file_id = params.get("fileId").unwrap_or(&"").to_string();

    // 在锁的作用域内完成所有同步操作
    let (file_meta, computed_hash, hash_match, target_path) = {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| ServerError::RequestFailed("会话不存在".to_string()))?;

        // 获取文件元信息
        let file_meta = session
            .files
            .get(&file_id)
            .ok_or_else(|| ServerError::RequestFailed("文件不存在".to_string()))?
            .clone();

        // 计算最终哈希
        let hasher = session
            .hashers
            .remove(&file_id)
            .ok_or_else(|| ServerError::RequestFailed("哈希计算器不存在".to_string()))?;

        // CRC32 输出为 32 位无符号整数，转换为 8 字符十六进制字符串
        let computed_hash = format!("{:08x}", hasher.finalize());
        let hash_match = computed_hash == file_meta.sha256;

        // 获取目标路径（如果有）
        let target_path = session.target_paths.get(&file_id).cloned();

        // 关闭文件
        session.writers.remove(&file_id);

        (file_meta, computed_hash, hash_match, target_path)
    };

    let resume_manager = get_resume_manager();

    let (response, saved_path_str) = if hash_match {
        // 哈希匹配
        // 检查是否使用了直接写入模式（有 target_path）
        if let Some(ref direct_path) = target_path {
            // 直接写入模式：文件已在目标位置，无需移动
            println!(
                "[LanTransfer] ✅ 接收完成 (直接写入): {} -> {}",
                file_meta.file_name, direct_path
            );

            // 清理续传信息（如果有）
            let _ = resume_manager.clear_resume_info(&file_id);

            let response = FinishUploadResponse {
                success: true,
                sha256_match: true,
                saved_path: Some(direct_path.clone()),
                error: None,
            };
            (response, direct_path.clone())
        } else {
            // 临时文件模式：移动文件到最终位置
            match resume_manager.finalize_transfer(&file_id, &file_meta.file_name) {
                Ok(final_path) => {
                    let saved_path_str = final_path.to_string_lossy().to_string();
                    let response = FinishUploadResponse {
                        success: true,
                        sha256_match: true,
                        saved_path: Some(saved_path_str.clone()),
                        error: None,
                    };
                    (response, saved_path_str)
                }
                Err(e) => {
                    let response = FinishUploadResponse {
                        success: false,
                        sha256_match: true,
                        saved_path: None,
                        error: Some(format!("文件保存失败: {}", e)),
                    };
                    (response, String::new())
                }
            }
        }
    } else {
        // 哈希不匹配
        println!(
            "[LanTransfer] 文件校验失败: {} (期望: {}, 实际: {})",
            file_meta.file_name, file_meta.sha256, computed_hash
        );

        // 清理临时文件和续传信息
        let _ = resume_manager.clear_resume_info(&file_id);

        let response = FinishUploadResponse {
            success: false,
            sha256_match: false,
            saved_path: None,
            error: Some("文件校验失败".to_string()),
        };
        (response, String::new())
    };

    // 发送事件（锁已释放）
    if response.success {
        // 发送单文件完成事件
        let event = LanTransferEvent::TransferCompleted {
            task_id: file_id.clone(),
            saved_path: saved_path_str.clone(),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        // 发送批量传输完成事件（清除前端进度显示）
        let batch_event = LanTransferEvent::BatchTransferCompleted {
            session_id: session_id.clone(),
            total_files: 1,
            save_directory: saved_path_str,
        };
        let _ = get_event_sender().send(batch_event.clone());
        emit_lan_event(&batch_event);

        println!(
            "[LanTransfer] ✅ 接收完成: {} (会话: {})",
            file_meta.file_name, session_id
        );
    } else {
        let event = LanTransferEvent::TransferFailed {
            task_id: file_id.clone(),
            error: response.error.clone().unwrap_or_else(|| "未知错误".to_string()),
        };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
    }

    send_json_response(writer, &response).await
}

/// 取消传输请求体
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    session_id: String,
    file_id: Option<String>,
    keep_partial: bool, // 是否保留已传输部分（用于后续续传）
}

/// 处理取消传输
async fn handle_cancel(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    let request: CancelRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // 在单独的作用域内处理锁，确保在 await 之前释放
    {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        if let Some(session) = sessions.get_mut(&request.session_id) {
            let resume_manager = get_resume_manager();

            if let Some(file_id) = &request.file_id {
                // 取消特定文件
                session.writers.remove(file_id);
                session.hashers.remove(file_id);

                if !request.keep_partial {
                    let _ = resume_manager.clear_resume_info(file_id);
                }

                println!("[LanTransfer] 取消文件传输: {}", file_id);
            } else {
                // 取消整个会话
                let file_ids: Vec<String> = session.files.keys().cloned().collect();
                for file_id in &file_ids {
                    if !request.keep_partial {
                        let _ = resume_manager.clear_resume_info(file_id);
                    }
                }
                sessions.remove(&request.session_id);

                println!("[LanTransfer] 取消传输会话: {}", request.session_id);
            }
        }
    } // 锁在这里释放

    #[derive(serde::Serialize)]
    struct CancelResponse {
        success: bool,
    }

    send_json_response(writer, &CancelResponse { success: true }).await
}
