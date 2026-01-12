/*!
 * HTTP 服务器模块
 *
 * 处理文件接收、连接请求等 HTTP 请求
 *
 * API 端点：
 * - POST /api/connect: 连接请求
 * - POST /api/prepare-upload: 准备上传
 * - POST /api/upload: 上传文件块
 * - POST /api/finish: 完成上传
 * - GET /api/info: 获取设备信息
 */

use super::discovery::get_event_sender;
use super::protocol::*;
use super::get_lan_transfer_state;
use chrono::Utc;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
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

fn get_upload_sessions() -> Arc<Mutex<HashMap<String, UploadSession>>> {
    UPLOAD_SESSIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 上传会话
struct UploadSession {
    /// 会话 ID
    #[allow(dead_code)]
    session_id: String,
    /// 文件元信息
    files: HashMap<String, FileMetadata>,
    /// 文件写入器
    writers: HashMap<String, std::fs::File>,
    /// 文件哈希计算器
    hashers: HashMap<String, Sha256>,
    /// 已接收的字节数
    received_bytes: HashMap<String, u64>,
    /// 保存目录
    save_directory: PathBuf,
}

// ============================================================================
// 服务器管理
// ============================================================================

/// 启动 HTTP 服务器
pub async fn start_server(device_info: DeviceInfo) -> Result<(), ServerError> {
    let addr = SocketAddr::from(([0, 0, 0, 0], SERVICE_PORT));

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| ServerError::StartFailed(e.to_string()))?;

    println!("[LanTransfer] HTTP 服务器启动: {}", addr);

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
                        let device_info = device_info.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(stream, peer_addr, device_info).await {
                                eprintln!("[LanTransfer] 处理连接失败: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[LanTransfer] 接受连接失败: {}", e);
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
        ("POST", "/api/connect") => {
            handle_connect(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/prepare-upload") => {
            handle_prepare_upload(&mut writer, &body).await
        }
        ("POST", path) if path.starts_with("/api/upload") => {
            handle_upload(&mut writer, &body, path, &headers).await
        }
        ("POST", path) if path.starts_with("/api/finish") => {
            handle_finish(&mut writer, path).await
        }
        _ => {
            send_error_response(&mut writer, 404, "Not Found").await
        }
    }
}

/// 发送错误响应
async fn send_error_response(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    status: u16,
    message: &str,
) -> Result<(), ServerError> {
    use tokio::io::AsyncWriteExt;

    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{{\"error\":\"{}\"}}",
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
async fn send_json_response<T: serde::Serialize>(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    data: &T,
) -> Result<(), ServerError> {
    use tokio::io::AsyncWriteExt;

    let body = serde_json::to_string(data)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
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

/// 处理连接请求
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

/// 处理准备上传请求
async fn handle_prepare_upload(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    // 解析请求
    let request: PrepareUploadRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // 获取保存目录（使用下载目录）
    let save_directory = dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("HuanvaeTransfer");

    // 确保目录存在
    std::fs::create_dir_all(&save_directory)
        .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

    // 创建上传会话
    let mut files = HashMap::new();
    let mut writers = HashMap::new();
    let mut hashers = HashMap::new();
    let mut received_bytes = HashMap::new();

    for file in &request.files {
        files.insert(file.file_id.clone(), file.clone());

        // 创建文件
        let file_path = save_directory.join(&file.file_name);
        let writer_file = std::fs::File::create(&file_path)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        writers.insert(file.file_id.clone(), writer_file);
        hashers.insert(file.file_id.clone(), Sha256::new());
        received_bytes.insert(file.file_id.clone(), 0u64);
    }

    let session = UploadSession {
        session_id: request.session_id.clone(),
        files,
        writers,
        hashers,
        received_bytes,
        save_directory: save_directory.clone(),
    };

    // 保存会话
    let sessions = get_upload_sessions();
    {
        let mut sessions = sessions.lock();
        sessions.insert(request.session_id.clone(), session);
    }

    // 返回响应
    let response = PrepareUploadResponse {
        session_id: request.session_id,
        accepted: true,
        reject_reason: None,
        save_directory: Some(save_directory.to_string_lossy().to_string()),
    };

    send_json_response(writer, &response).await
}

/// 处理文件块上传
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
    let response = {
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

        // 更新哈希
        if let Some(hasher) = session.hashers.get_mut(&file_id) {
            hasher.update(body);
        }

        // 更新已接收字节数
        let received = session.received_bytes.get_mut(&file_id).unwrap();
        *received += body.len() as u64;

        ChunkResponse {
            success: true,
            next_offset: *received,
            error: None,
        }
    };

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
    let (response, saved_path_str, sha256_match) = {
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

        let computed_hash = hex::encode(hasher.finalize());
        let sha256_match = computed_hash == file_meta.sha256;

        // 关闭文件
        session.writers.remove(&file_id);

        let saved_path = session.save_directory.join(&file_meta.file_name);
        let saved_path_str = saved_path.to_string_lossy().to_string();

        let response = FinishUploadResponse {
            success: sha256_match,
            sha256_match,
            saved_path: Some(saved_path_str.clone()),
            error: if sha256_match {
                None
            } else {
                Some("文件校验失败".to_string())
            },
        };

        (response, saved_path_str, sha256_match)
    };

    // 发送事件（锁已释放）
    if sha256_match {
        let _ = get_event_sender().send(LanTransferEvent::TransferCompleted {
            task_id: file_id.clone(),
            saved_path: saved_path_str,
        });
    } else {
        let _ = get_event_sender().send(LanTransferEvent::TransferFailed {
            task_id: file_id.clone(),
            error: "文件校验失败".to_string(),
        });
    }

    send_json_response(writer, &response).await
}

