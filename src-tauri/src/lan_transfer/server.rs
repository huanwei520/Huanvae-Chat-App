/*!
 * HTTP 服务器模块
 *
 * 处理文件接收和点对点连接请求
 *
 * API 端点：
 * - GET /api/info: 获取设备信息
 *
 * 点对点连接：
 * - POST /api/peer-connection-request: 请求建立点对点连接
 * - POST /api/peer-connection-response: 响应连接请求
 * - POST /api/peer-disconnect: 断开连接
 *
 * 旧版连接（保留兼容）：
 * - POST /api/connect: 连接请求
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
 * - 2026-02-04: 新增 cancel_receiver_file 公共函数，支持接收方取消正在接收的文件
 * - 2026-02-04: UploadSession 添加 cancelled_files 字段持久化取消状态，修复多文件取消显示问题
 * - 2026-02-04: handle_cancel 收到取消请求后发送 BatchProgress 事件更新接收方 UI
 * - 2026-02-04: 移除旧版传输请求机制 (transfer-request/transfer-response)
 * - 2026-01-21: 添加 Connection: close 头修复跨平台传输连接重用问题
 * - 2026-01-21: 添加接收方进度显示（初始进度、实时速度、完成事件）
 */

use super::config;
use super::discovery::get_event_sender;
use super::protocol::*;
use super::resume::get_resume_manager;
use super::speed::SpeedTracker;
use super::{emit_lan_event, get_lan_transfer_state};
use chrono::{DateTime, Utc};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
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

// ============================================================================
// 接收侧纯逻辑（offset 校验 / 续传节流 / 会话收尾判定）
// ============================================================================

/// 单个上传块的校验结论（D-03，纯函数便于单测）
#[derive(Debug, PartialEq)]
pub(crate) enum ChunkVerdict {
    /// 偏移对齐且不超限，允许写入
    Accept,
    /// 偏移与已收字节不一致：拒绝写入，回传当前权威偏移
    Mismatch { next_offset: u64 },
    /// 块超出文件边界：拒绝写入，回传当前权威偏移
    ExceedsFileSize { next_offset: u64 },
}

/// 校验上传块的逻辑偏移（纯函数，D-03）。
///
/// - 旧版发送端不带 `offset` 参数：视为 `offset == received`，维持原追加语义（向后兼容）；
/// - `offset != received`：拒绝且不写入，回传 `next_offset = received`；
/// - `received + body_len > file_size`：拒纯超限写入。
pub(crate) fn validate_chunk(
    offset: Option<u64>,
    received: u64,
    body_len: usize,
    file_size: u64,
) -> ChunkVerdict {
    let offset = offset.unwrap_or(received);
    if offset != received {
        return ChunkVerdict::Mismatch { next_offset: received };
    }
    if received.saturating_add(body_len as u64) > file_size {
        return ChunkVerdict::ExceedsFileSize { next_offset: received };
    }
    ChunkVerdict::Accept
}

/// 断点续传信息落盘节流决策（纯函数，D-07d）。
///
/// 原先每收 1MB 块就 `serde_json + fs::write` 落盘一次（10GB 文件 ≈ 1 万次小 JSON 写），
/// 现改为：每 64MB 或每 2 秒才落盘一次；文件收尾（已收满）时强制落盘。
///
/// # 参数
/// - `last_save`: (距上次落盘的秒数, 上次落盘时的已收字节)；`None` 表示从未落盘
/// - `received`: 当前已收字节
/// - `file_size`: 文件总大小
pub(crate) fn should_flush_resume(
    last_save: Option<(f64, u64)>,
    received: u64,
    file_size: u64,
) -> bool {
    // 文件已收满：必须落盘，保证后续 finish 失败/中断后续传偏移准确
    if received >= file_size && file_size > 0 {
        return true;
    }
    match last_save {
        None => true,
        Some((elapsed_secs, saved_at_bytes)) => {
            const RESUME_FLUSH_INTERVAL_BYTES: u64 = 64 * 1024 * 1024; // 64MB
            const RESUME_FLUSH_INTERVAL_SECS: f64 = 2.0;
            received.saturating_sub(saved_at_bytes) >= RESUME_FLUSH_INTERVAL_BYTES
                || elapsed_secs >= RESUME_FLUSH_INTERVAL_SECS
        }
    }
}

/// 会话是否可以收尾（纯函数，D-05）。
///
/// finish 失败/成功后：只有「无活跃 writer 且无等待中的文件」时才
/// 发 batch_transfer_completed 并清理会话，否则会话仍有在途文件，不能收。
pub(crate) fn session_should_finalize(active_writers: usize, pending_or_transferring: usize) -> bool {
    active_writers == 0 && pending_or_transferring == 0
}

/// 单个 HTTP 请求体允许的最大字节数。
///
/// 必须**大于** [`CHUNK_SIZE`]（1 MiB）—— `/api/upload` 的请求体就是一个文件块，
/// 卡得比它小会把正常传输拦死。这里取 8 MiB，给块大小留 8 倍余量，
/// 同时把「对端自报一个天文数字」挡在分配之前（见 `handle_connection`）。
const MAX_REQUEST_BODY_BYTES: usize = 8 * 1024 * 1024;

/// 编译期不变量：请求体上限必须大于单个文件块。
///
/// 写成 `const _: () = assert!(..)` 而不是一条单测 —— 违反时**编译不过**，
/// 比"跑测试才发现"早一步，而且不可能被 `--skip-*` 之类的开关绕过去。
const _: () = assert!(
    MAX_REQUEST_BODY_BYTES > CHUNK_SIZE,
    "MAX_REQUEST_BODY_BYTES 必须大于 CHUNK_SIZE，否则正常的分块上传会被自己拦死"
);

/// 单个 HTTP 头部行（请求行 / header 行）允许的最大字节数（D-11c）。
///
/// 原先用 `read_line` 无上限读行：异常对端发送一条**没有换行符**的超长行时，
/// `read_line` 会一直扩容 String 直到内存膨胀。16KB 远大于正常请求头
/// （正常请求头总量 ≤ 8KB），正常请求行为不受任何影响。
const MAX_HEADER_LINE_BYTES: usize = 16 * 1024;

/// 单行是否超过头部行长度上限（纯函数，D-11c）。
///
/// 读取端用 `take(MAX + 1)` 配 `read_until(b'\n')`：读到 `MAX + 1` 字节
/// 即证明该行真实长度超过上限（恰好 `MAX` 字节的合法行只会读出 `MAX` 字节）。
pub(crate) fn header_line_over_limit(len: usize) -> bool {
    len > MAX_HEADER_LINE_BYTES
}

/// 待处理连接请求的存活时间（TTL，秒）（D-11a）。
///
/// 对齐前端连接请求弹窗的确认生命周期：用户只在弹窗展示的短时间内可以响应，
/// 超时后请求已无意义。若不清理，条目会永久残留 —— 对端重连时命中
/// `handle_peer_connection_request` 的 `existing_request` 分支，把陈旧请求
/// 当 pending「复活」并重发事件弹 UI。取 120s。
pub(crate) const PENDING_PEER_REQUEST_TTL_SECS: i64 = 120;

/// 判断一条待处理连接请求是否已过期（纯函数，D-11a）。
///
/// `requested_at` 为 RFC3339 字符串；**解析失败按已过期处理**（fail-closed）：
/// 宁可丢弃时间戳损坏的请求，也不能让它永久残留、被对端重连时复活弹 UI。
pub(crate) fn is_peer_request_expired(
    now: DateTime<Utc>,
    requested_at: &str,
    ttl_secs: i64,
) -> bool {
    match DateTime::parse_from_rfc3339(requested_at) {
        Ok(requested) => now.signed_duration_since(requested).num_seconds() >= ttl_secs,
        // 时间戳损坏：按过期处理，防止损坏条目永久残留
        Err(_) => true,
    }
}

/// 惰性清扫过期的待处理连接请求（D-11a）。
///
/// 必须在**锁内**调用：本函数纯同步、无 await，符合 parking_lot 锁内禁止
/// await 的约束。返回被移除的条数（供调用方打日志）。注意以 `requested_at`
/// 为过期基准 —— 自动接受失败降级重插入等路径保留原始请求时间，不会续命。
pub(crate) fn sweep_expired_peer_requests_locked(
    requests: &mut HashMap<String, PeerConnectionRequest>,
    now: DateTime<Utc>,
) -> usize {
    let expired_ids: Vec<String> = requests
        .iter()
        .filter(|(_, req)| {
            is_peer_request_expired(now, &req.requested_at, PENDING_PEER_REQUEST_TTL_SECS)
        })
        .map(|(id, _)| id.clone())
        .collect();
    let removed = expired_ids.len();
    for id in &expired_ids {
        requests.remove(id);
    }
    removed
}

/// 该路径是否属于「文件传输」端点（必须先有点对点连接）。
///
/// 连接类端点（peer-connection-request / -response / disconnect / 旧版 connect）
/// **不在此列** —— 它们正是用来建立连接的，挡了就永远连不上。
/// `GET /api/info` 是 mDNS 发现后的设备探活，也不在此列。
fn is_transfer_endpoint(path: &str) -> bool {
    path == "/api/batch-prepare"
        || path == "/api/prepare-upload"
        || path == "/api/cancel"
        || path.starts_with("/api/upload")
        || path.starts_with("/api/finish")
}

/// 该 TCP 源地址上是否存在一条状态为 Connected 的点对点连接。
fn is_peer_connected(peer_addr: SocketAddr) -> bool {
    let connections = get_active_peer_connections_map();
    let connections = connections.lock();
    peer_ip_is_connected(&connections, &peer_addr.ip().to_string())
}

/// [`is_peer_connected`] 的纯函数内核（把全局表拆出去，好单测）。
///
/// 比的是 `peer_device.ip_address`，而接收侧登记连接时已经把它换成了**实际 TCP 源地址**
///（见 `handle_peer_connection_request`：`ip_address: peer_addr.ip().to_string()`），
/// 所以这不是在信对端自报的字段。
fn peer_ip_is_connected(connections: &HashMap<String, PeerConnection>, ip: &str) -> bool {
    connections.values().any(|conn| {
        conn.status == PeerConnectionStatus::Connected && conn.peer_device.ip_address == ip
    })
}

/// 获取活跃的点对点连接
pub fn get_active_peer_connections_map() -> Arc<Mutex<HashMap<String, PeerConnection>>> {
    ACTIVE_PEER_CONNECTIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 获取待处理的连接请求
///
/// D-11a：读取时惰性清扫过期请求（锁内同步完成，无 await），保证前端列表命令
/// （`get_pending_peer_connection_requests`）与响应路径（`respond_peer_connection`）
/// 都不会看到/命中已过期的陈旧请求。
pub fn get_pending_peer_connection_requests_map(
) -> Arc<Mutex<HashMap<String, PeerConnectionRequest>>> {
    let requests = PENDING_PEER_CONNECTION_REQUESTS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone();
    {
        let mut pending = requests.lock();
        let removed = sweep_expired_peer_requests_locked(&mut pending, Utc::now());
        if removed > 0 {
            println!("[LanTransfer] 🧹 已清扫 {} 条过期连接请求", removed);
        }
    }
    requests
}

/// 上传会话（支持断点续传）
struct UploadSession {
    /// 会话 ID（保留用于日志和调试）
    #[allow(dead_code)]
    session_id: String,
    /// 文件元信息
    files: HashMap<String, FileMetadata>,
    /// 文件写入器（D-07b：Arc 分文件锁，写盘移出全局 sessions.lock()）
    writers: HashMap<String, Arc<Mutex<std::fs::File>>>,
    /// 文件哈希计算器（D-04：真实 SHA-256，流式增量）
    hashers: HashMap<String, Sha256>,
    /// 已接收的字节数
    received_bytes: HashMap<String, u64>,
    /// 已取消的文件 ID 集合（用于持久化取消状态）
    cancelled_files: std::collections::HashSet<String>,
    /// 已判定失败的文件（file_id -> 错误信息，D-05/D-15）
    failed_files: HashMap<String, String>,
    /// 上次进度更新时间（用于限制更新频率）
    last_progress_time: std::time::Instant,
    /// 续传起始字节（用于速度计算）
    resume_offset: u64,
    /// 接收速度滑窗采样器（D-21，与发送端同一口径）
    speed_tracker: SpeedTracker,
    /// 发起方设备信息（TCP 源 IP 已修正；用于批量进度 peer 字段与镜像会话，D-01）
    from_device: Option<DiscoveredDevice>,
    /// 断点续传落盘节流跟踪（file_id -> (上次落盘时刻, 上次落盘时的已收字节)，D-07d）
    resume_flush_tracking: HashMap<String, (std::time::Instant, u64)>,
    /// 目标文件路径（Android 直接写入公共目录时使用）
    /// 如果有值，表示直接写入目标路径，完成时不需要移动文件
    target_paths: HashMap<String, String>,
}

// ============================================================================
// 接收方取消
// ============================================================================

/// 推导接收会话中单个文件的展示状态（按 failed_files > cancelled > writer > 字节判定）
fn derive_file_status(
    session: &UploadSession,
    file_id: &str,
    transferred: u64,
    _meta: &FileMetadata,
) -> TransferStatus {
    if session.failed_files.contains_key(file_id) {
        TransferStatus::Failed
    } else if session.cancelled_files.contains(file_id) {
        TransferStatus::Cancelled
    } else if session.writers.contains_key(file_id) {
        TransferStatus::Transferring
    } else if transferred > 0 {
        // 无 writer 且非取消/失败：要么已 finish 成功（Completed），
        // 要么字节还在（仅 finish 成功时 writer 才移除且哈希校验通过）
        TransferStatus::Completed
    } else {
        TransferStatus::Pending
    }
}

/// 取消接收方正在接收的文件
///
/// 返回: Option<(session_id, 对端设备, files_progress, 会话是否已收尾)>
/// 用于发送 BatchProgress / BatchTransferCompleted 事件。
/// 会话收尾（无剩余活跃文件）时此处同步移除 UPLOAD_SESSIONS 条目。
pub fn cancel_receiver_file(file_id: &str) -> Option<(String, Option<DiscoveredDevice>, Vec<FileProgressInfo>, bool)> {
    let sessions = get_upload_sessions();
    let mut sessions = sessions.lock();

    // 先定位包含该文件的会话（两段式：锁内取数据/判定，避免迭代借用与 remove 冲突）
    let target_session_id = sessions
        .iter()
        .find(|(_, session)| session.files.contains_key(file_id))
        .map(|(sid, _)| sid.clone())?;
    let (files_info, finished, from_device) = {
        let session = sessions.get_mut(&target_session_id)?;
        // 将文件添加到取消列表
        session.cancelled_files.insert(file_id.to_string());
        // 移除写入器和哈希器
        session.writers.remove(file_id);
        session.hashers.remove(file_id);

        println!("[LanTransfer] 📛 接收方取消文件传输: {}", file_id);

        // 构建文件进度信息
        let files_info: Vec<FileProgressInfo> = session.files.iter()
            .map(|(fid, file_meta)| {
                let transferred = session.received_bytes.get(fid).copied().unwrap_or(0);
                let status = derive_file_status(session, fid, transferred, file_meta);
                FileProgressInfo {
                    file_id: file_meta.file_id.clone(),
                    file_name: file_meta.file_name.clone(),
                    file_size: file_meta.file_size,
                    transferred_bytes: if status == TransferStatus::Completed { file_meta.file_size } else { transferred },
                    status,
                }
            })
            .collect();

        // 会话收尾判定（D-05 同源口径）：无活跃 writer 且无等待中的文件
        let pending_or_transferring = files_info.iter()
            .filter(|f| f.status == TransferStatus::Pending || f.status == TransferStatus::Transferring)
            .count();
        let finished = session_should_finalize(session.writers.len(), pending_or_transferring);
        let from_device = session.from_device.clone();
        (files_info, finished, from_device)
    };

    // 镜像会话同步（D-01：文件状态实时同步）
    super::transfer::update_receive_session_file(&target_session_id, file_id, files_info.iter()
        .find(|f| f.file_id == file_id)
        .map(|f| f.transferred_bytes)
        .unwrap_or(0), TransferStatus::Cancelled);

    if finished {
        sessions.remove(&target_session_id);
        super::transfer::set_session_status(&target_session_id, SessionStatus::Cancelled);
        println!("[LanTransfer] 📦 会话 {} 所有文件已收尾，移除上传会话", target_session_id);
    }

    Some((target_session_id, from_device, files_info, finished))
}

/// 取消接收侧整个会话（本地 cancel_session 与 HTTP /api/cancel 整会话分支共用，D-02）
///
/// - 关闭并移除全部 writer/hashers（丢弃即关闭文件句柄）
/// - 按 keep_partial 决定是否清理临时文件与续传信息
/// - 构造保留已收字节的终态进度（D-13：不归零）
/// - 同步镜像会话状态（Cancelled）
///
/// 返回: Option<(session_id, 对端设备, files_progress)>；会话不存在时 None
pub fn cancel_receiver_session(
    session_id: &str,
    keep_partial: bool,
) -> Option<(String, Option<DiscoveredDevice>, Vec<FileProgressInfo>)> {
    let resume_manager = get_resume_manager();
    let sessions = get_upload_sessions();
    let mut sessions = sessions.lock();
    let session = sessions.get_mut(session_id)?;

    let file_ids: Vec<String> = session.files.keys().cloned().collect();

    // D-13：保留已收字节构造终态进度
    let files_progress: Vec<FileProgressInfo> = session.files.values()
        .map(|meta| {
            let transferred = session.received_bytes.get(&meta.file_id).copied().unwrap_or(0);
            let status = if session.failed_files.contains_key(&meta.file_id) {
                TransferStatus::Failed
            } else if !session.writers.contains_key(&meta.file_id)
                && meta.file_size > 0
                && transferred >= meta.file_size
            {
                TransferStatus::Completed
            } else {
                TransferStatus::Cancelled
            };
            FileProgressInfo {
                file_id: meta.file_id.clone(),
                file_name: meta.file_name.clone(),
                file_size: meta.file_size,
                transferred_bytes: transferred,
                status,
            }
        })
        .collect();

    for file_id in &file_ids {
        if !keep_partial {
            let _ = resume_manager.clear_resume_info(file_id);
        }
    }
    // 丢弃即关闭全部文件句柄
    session.writers.clear();
    session.hashers.clear();
    let from_device = session.from_device.clone();
    sessions.remove(session_id);

    // 镜像会话同步
    for f in &files_progress {
        super::transfer::update_receive_session_file(session_id, &f.file_id, f.transferred_bytes, f.status.clone());
    }
    super::transfer::set_session_status(session_id, SessionStatus::Cancelled);

    println!("[LanTransfer] 取消传输会话: {} (共 {} 个文件)", session_id, file_ids.len());
    Some((session_id.to_string(), from_device, files_progress))
}

/// 清空全部上传会话（D-09：停服时调用，避免「半死」状态）
///
/// - 丢弃全部 writer（关闭文件句柄）并清空 UPLOAD_SESSIONS
/// - 每个会话广播终态进度（保留已收字节）+ batch_transfer_completed(cancelled)
/// - 临时文件保留（供下次启动断点续传）
pub fn clear_all_upload_sessions() {
    let session_ids: Vec<String> = {
        let sessions = get_upload_sessions();
        let sessions = sessions.lock();
        sessions.keys().cloned().collect()
    };

    for session_id in &session_ids {
        if let Some((sid, from_device, files_progress)) = cancel_receiver_session(session_id, true) {
            let total_files = files_progress.len() as u32;
            let statuses: Vec<TransferStatus> = files_progress.iter().map(|f| f.status.clone()).collect();
            let batch_progress = BatchTransferProgress {
                session_id: sid.clone(),
                total_files,
                completed_files: files_progress.iter()
                    .filter(|f| f.status == TransferStatus::Completed)
                    .count() as u32,
                total_bytes: files_progress.iter().map(|f| f.file_size).sum(),
                transferred_bytes: files_progress.iter().map(|f| f.transferred_bytes).sum(),
                speed: 0,
                current_file: None,
                eta_seconds: None,
                files: files_progress,
                direction: Some(TransferDirection::Receive),
                peer_device_id: from_device.as_ref().map(|d| d.device_id.clone()),
                peer_device_name: from_device.as_ref().map(|d| d.device_name.clone()),
            };
            let progress_event = LanTransferEvent::BatchProgress { progress: batch_progress };
            let _ = get_event_sender().send(progress_event.clone());
            emit_lan_event(&progress_event);

            let completed_event = LanTransferEvent::BatchTransferCompleted {
                session_id: sid,
                total_files,
                save_directory: String::new(),
                outcome: Some(compute_batch_outcome(&statuses).to_string()),
                failed_files: Some(Vec::new()),
            };
            let _ = get_event_sender().send(completed_event.clone());
            emit_lan_event(&completed_event);
        }
    }

    if !session_ids.is_empty() {
        println!("[LanTransfer] 🛑 已清空全部上传会话（{} 个）", session_ids.len());
    }
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

/// 读取一行 HTTP 头部（请求行 / header 行），单行长度上限 [`MAX_HEADER_LINE_BYTES`]（D-11c）。
///
/// 返回:
/// - `Ok(Some(line))`: 读到一行（空串 = 对端关闭且无数据，沿用原有 400 路径）
/// - `Ok(None)`: 单行超限 —— 调用方应立即回 431 并断开连接，不再继续解析
async fn read_header_line_limited<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<String>, ServerError> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt};

    let mut raw = Vec::new();
    // 多放行 1 字节：读到 MAX+1 即证明该行超过上限（见 header_line_over_limit），
    // 恰好 MAX 字节的合法行不受影响
    let mut limited = reader.take((MAX_HEADER_LINE_BYTES + 1) as u64);
    let n = limited
        .read_until(b'\n', &mut raw)
        .await
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    if header_line_over_limit(n) {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&raw).into_owned()))
}

/// 处理 TCP 连接
async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    device_info: DeviceInfo,
) -> Result<(), ServerError> {
    use tokio::io::{AsyncReadExt, BufReader};

    let (reader, mut writer) = stream.split();
    let mut buf_reader = BufReader::new(reader);

    // 读取请求行（D-11c：单行上限 16KB，超限立即回 431 并断开，不继续解析）
    let request_line = match read_header_line_limited(&mut buf_reader).await? {
        Some(line) => line,
        None => {
            println!(
                "[LanTransfer] ⛔ 请求行超长 (上限 {} 字节)，拒绝并断开: {}",
                MAX_HEADER_LINE_BYTES, peer_addr
            );
            return send_error_response(&mut writer, 431, "Request Header Fields Too Large")
                .await;
        }
    };

    // 解析请求方法和路径
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return send_error_response(&mut writer, 400, "Bad Request").await;
    }

    let method = parts[0];
    let path = parts[1];

    // 读取请求头（D-11c：每行同样卡 16KB 上限，异常对端无法用超长无换行行打爆内存）
    let mut headers = HashMap::new();
    loop {
        let header_line = match read_header_line_limited(&mut buf_reader).await? {
            Some(line) => line,
            None => {
                println!(
                    "[LanTransfer] ⛔ 请求头行超长 (上限 {} 字节)，拒绝并断开: {}",
                    MAX_HEADER_LINE_BYTES, peer_addr
                );
                return send_error_response(&mut writer, 431, "Request Header Fields Too Large")
                    .await;
            }
        };

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

    // 🔴 先卡上界，再分配。
    // `content_length` 是**未认证**的局域网对端在头里自报的数字，`vec![0u8; n]` 走
    // `alloc_zeroed`：n 巨大时分配失败触发 `handle_alloc_error` → **abort 整个进程**
    //（Rust 的 OOM 不可捕获，不是返回 Err）；即使分配成功（比如 8 GB）也会先零填充再等
    // `read_exact`，同样把内存打满。一条
    // `POST /api/cancel` + `Content-Length: 99999999999999` 就能让局域网内任何人随时
    // 杀掉用户的聊天客户端 —— 而这发生在路由匹配**之前**，所以任何端点都能触发。
    if content_length > MAX_REQUEST_BODY_BYTES {
        println!(
            "[LanTransfer] ⛔ 拒绝超大请求体: {} 字节 (上限 {})，来自 {}",
            content_length, MAX_REQUEST_BODY_BYTES, peer_addr
        );
        return send_error_response(&mut writer, 413, "Payload Too Large").await;
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        buf_reader
            .read_exact(&mut body)
            .await
            .map_err(|e| ServerError::RequestFailed(e.to_string()))?;
    }

    // 🔴 文件传输端点必须来自一条**已建立**的点对点连接。
    // 模块头声称「需先建立连接后才能传输文件」，但 `handle_prepare_upload` /
    // `handle_batch_prepare` 的签名里根本没有 `peer_addr`，函数体也从不查
    // `ACTIVE_PEER_CONNECTIONS` —— 于是任何能连到本机 53317 的主机都可以跳过握手，
    // 直接 batch-prepare + prepare-upload + upload + finish 把文件写进接收目录，
    // 用户端不弹任何确认框。这道闸把「双向确认」从注释变成代码。
    //
    // 判据是**实际 TCP 源 IP**（不是对端自报的 ip_address 字段），
    // 对应地，接收侧登记连接时也改成登记实际源 IP（见 handle_peer_connection_request）。
    if method == "POST" && is_transfer_endpoint(path) && !is_peer_connected(peer_addr) {
        println!(
            "[LanTransfer] ⛔ 拒绝未建立连接的传输请求: {} {} 来自 {}",
            method, path, peer_addr
        );
        return send_error_response(&mut writer, 403, "No active peer connection").await;
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
        // ========== 文件传输 API ==========
        ("POST", "/api/batch-prepare") => {
            handle_batch_prepare(&mut writer, &body, peer_addr).await
        }
        ("POST", "/api/prepare-upload") => {
            handle_prepare_upload(&mut writer, &body, peer_addr).await
        }
        ("POST", path) if path.starts_with("/api/upload") => {
            handle_upload(&mut writer, &body, path, &headers).await
        }
        ("POST", path) if path.starts_with("/api/finish") => {
            handle_finish(&mut writer, path, &body).await
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
    // D-11a：查表前先惰性清扫过期请求（锁内同步完成，无 await）。
    // 动机：用户不响应（关窗/设备消失）时条目会永久残留，对端重连会在这里命中
    // existing_request 分支，把陈旧请求当 pending「复活」并重发事件弹 UI；
    // 清扫后陈旧条目不再命中，走下方新建请求的正常流程。
    let existing_request: Option<PeerConnectionRequest> = {
        let requests = get_pending_peer_connection_requests_map();
        let mut requests = requests.lock();
        sweep_expired_peer_requests_locked(&mut requests, Utc::now());
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

    // ========== D-11a：auto-accept 判定前惰性清扫过期请求 ==========
    // 刚插入的请求 elapsed ≈ 0 不会被误删；清的是其他设备残留的陈旧条目，
    // 防止其挤占待处理表、被后续路径误命中。（锁内同步完成，无 await）
    {
        let requests = get_pending_peer_connection_requests_map();
        let mut requests = requests.lock();
        sweep_expired_peer_requests_locked(&mut requests, Utc::now());
    }

    // ========== 检查是否可以自动接受（信任设备 + 开关已启用）==========
    let should_auto_accept = {
        let config_manager = config::get_config_manager();
        let config = config_manager.read();
        let cfg = config.get_config();
        cfg.auto_accept_trusted && config.is_device_trusted(&from_device_id)
    };

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Response {
        connection_id: String,
        status: String,
    }

    if should_auto_accept {
        println!("[LanTransfer] ✓ 设备 {} 已信任且自动接受已启用，自动建立连接", from_device_id);

        // 从待处理队列移除
        {
            let requests = get_pending_peer_connection_requests_map();
            let mut requests = requests.lock();
            requests.remove(&connection_id);
        }

        // 获取本机设备信息（提前释放 RwLockReadGuard，避免跨 await）
        let state = get_lan_transfer_state();
        let local_device_opt = {
            let local = state.local_device.read();
            local.clone()
        };
        let local_device = match local_device_opt {
            Some(d) => d,
            None => {
                println!("[LanTransfer] ❌ 本地服务未启动，降级为手动确认");
                // 降级：重新加入 pending 队列，走手动流程
                {
                    let requests = get_pending_peer_connection_requests_map();
                    let mut requests = requests.lock();
                    requests.insert(connection_id.clone(), request.clone());
                }
                let event = LanTransferEvent::PeerConnectionRequest { request };
                let _ = get_event_sender().send(event.clone());
                emit_lan_event(&event);
                return send_json_response(writer, &Response {
                    connection_id,
                    status: "pending".to_string(),
                }).await;
            }
        };

        // 向发起方发送接受响应
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct AcceptResponseBody {
            connection_id: String,
            accepted: bool,
            from_device: Option<DiscoveredDevice>,
        }

        let url = format!(
            "http://{}:{}/api/peer-connection-response",
            request.from_device.ip_address, request.from_device.port
        );

        let from_device_info = DiscoveredDevice {
            device_id: local_device.device_id.clone(),
            device_name: local_device.device_name.clone(),
            user_id: local_device.user_id.clone(),
            user_nickname: local_device.user_nickname.clone(),
            ip_address: local_device.ip_address.clone(),
            port: local_device.port,
            discovered_at: Utc::now().to_rfc3339(),
            last_seen: Utc::now().to_rfc3339(),
        };

        let client = reqwest::Client::new();
        let send_result = client
            .post(&url)
            .json(&AcceptResponseBody {
                connection_id: connection_id.clone(),
                accepted: true,
                from_device: Some(from_device_info),
            })
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        if let Err(e) = send_result {
            println!("[LanTransfer] ❌ 自动接受响应发送失败: {}，降级为手动确认", e);
            // 降级：重新加入 pending 队列，走手动流程
            {
                let requests = get_pending_peer_connection_requests_map();
                let mut requests = requests.lock();
                requests.insert(connection_id.clone(), request.clone());
            }
            let event = LanTransferEvent::PeerConnectionRequest { request };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);
            return send_json_response(writer, &Response {
                connection_id,
                status: "pending".to_string(),
            }).await;
        }

        // 创建连接对象
        let connection = PeerConnection {
            connection_id: connection_id.clone(),
            peer_device: request.from_device,
            established_at: Utc::now().to_rfc3339(),
            status: PeerConnectionStatus::Connected,
            is_initiator: false,
        };

        {
            let connections = get_active_peer_connections_map();
            let mut connections = connections.lock();
            connections.insert(connection_id.clone(), connection.clone());
            println!("[LanTransfer] ✓ 自动接受连接已保存 (共 {} 个活跃连接)", connections.len());
        }

        // 通知前端连接已建立
        let event = LanTransferEvent::PeerConnectionEstablished { connection };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
        println!("[LanTransfer] ✓ 已发送 PeerConnectionEstablished 事件（自动接受）");

        send_json_response(
            writer,
            &Response {
                connection_id,
                status: "connected".to_string(),
            },
        )
        .await
    } else {
        // 正常流程：发送事件通知前端，等待用户手动确认
        let event = LanTransferEvent::PeerConnectionRequest { request };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);

        println!("[LanTransfer] ✓ 已发送 PeerConnectionRequest 事件到前端");
        println!("[LanTransfer] ========== 等待用户响应 ==========");

        send_json_response(
            writer,
            &Response {
                connection_id,
                status: "pending".to_string(),
            },
        )
        .await
    }
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

/// 处理连接请求（旧版兼容，已废弃）
#[allow(deprecated)]
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

// ============================================================================
// 批量传输准备
// ============================================================================

/// 处理批量传输准备请求
///
/// 在传输多个文件前，发送方先调用此 API 通知接收方即将传输的所有文件列表
/// 接收方预创建会话，后续的 prepare-upload 请求会添加到此会话
async fn handle_batch_prepare(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    use super::protocol::{BatchPrepareRequest, BatchPrepareResponse, FileProgressInfo, TransferStatus};

    // 解析请求
    let request: BatchPrepareRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(format!("解析 batch-prepare 请求失败: {}", e)))?;

    println!(
        "[LanTransfer] 📦 收到批量传输准备请求: session={}, 文件数={}, 总大小={}",
        request.session_id,
        request.files.len(),
        super::transfer::format_bytes(request.total_size)
    );

    // 🔴 文件名来自对端、全程零校验会变成任意路径写（详见
    // config::sanitize_incoming_file_name）。在**建会话之前**整批拒掉：
    // 拒一整批而不是挑掉坏的那个 —— 一次传输里混进穿越名字，正常语义下不存在，
    // 只可能是攻击或对端有 bug，此时继续接收剩下的文件没有意义。
    if let Some(bad) = request
        .files
        .iter()
        .find(|f| config::sanitize_incoming_file_name(&f.file_name).is_none())
    {
        println!(
            "[LanTransfer] ⛔ 拒绝批量传输: 文件名不合法 {:?} (session={})",
            bad.file_name, request.session_id
        );
        let response = BatchPrepareResponse {
            session_id: request.session_id,
            accepted: false,
            file_count: 0,
            reject_reason: Some("文件名不合法（含路径分隔符或保留名），已拒绝接收".to_string()),
        };
        return send_json_response(writer, &response).await;
    }

    // 🔴 同族第二个入口：`file_id` 也对端可控，且它拼出来的临时/续传路径
    // 既被写、也被 `fs::remove_file` 删（resume::clear_resume_info）。
    // 与文件名同一口径：**整批拒**，判据见 config::sanitize_incoming_file_id。
    if let Some(bad) = request
        .files
        .iter()
        .find(|f| config::sanitize_incoming_file_id(&f.file_id).is_none())
    {
        println!(
            "[LanTransfer] ⛔ 拒绝批量传输: file_id 不合法 {:?} (session={})",
            bad.file_id, request.session_id
        );
        let response = BatchPrepareResponse {
            session_id: request.session_id,
            accepted: false,
            file_count: 0,
            reject_reason: Some("file_id 不合法（含路径分隔符或非法字符），已拒绝接收".to_string()),
        };
        return send_json_response(writer, &response).await;
    }

    // 确保配置目录存在
    config::ensure_directories()
        .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

    // 预创建会话（只包含文件元信息，不创建文件写入器）
    // 后续的 prepare-upload 请求会添加实际的文件写入器
    // D-01：发起方 IP 以实际 TCP 源地址为准（与连接表同口径）
    let corrected_from_device = DiscoveredDevice {
        ip_address: peer_addr.ip().to_string(),
        ..request.from_device.clone()
    };
    let session = UploadSession {
        session_id: request.session_id.clone(),
        files: request.files.iter().map(|f| (f.file_id.clone(), f.clone())).collect(),
        writers: HashMap::new(),  // prepare-upload 时填充
        hashers: HashMap::new(),  // prepare-upload 时填充
        received_bytes: HashMap::new(),  // prepare-upload 时填充
        cancelled_files: std::collections::HashSet::new(),
        failed_files: HashMap::new(),
        last_progress_time: std::time::Instant::now(),
        resume_offset: 0,
        speed_tracker: SpeedTracker::new(),
        from_device: Some(corrected_from_device.clone()),
        resume_flush_tracking: HashMap::new(),
        target_paths: HashMap::new(),  // prepare-upload 时填充
    };

    let file_count = request.files.len() as u32;

    // 保存会话
    {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();
        println!(
            "[LanTransfer] 创建批量会话: {} (文件数: {}, 当前会话数: {})",
            request.session_id,
            file_count,
            sessions.len() + 1
        );
        sessions.insert(request.session_id.clone(), session);
    }

    // D-01：接收会话镜像进统一会话表（direction=Receive，targetDevice=发起方），
    // 前端会话桥/设备归属即可见本方向传输
    super::transfer::upsert_receive_session(TransferSession {
        session_id: request.session_id.clone(),
        connection_id: String::new(),
        request_id: String::new(),
        files: request.files.iter().map(|f| FileTransferState {
            file: f.clone(),
            status: TransferStatus::Pending,
            transferred_bytes: 0,
            resume_info: None,
        }).collect(),
        file_paths: Vec::new(),
        status: SessionStatus::Transferring,
        created_at: Utc::now().to_rfc3339(),
        target_device: corrected_from_device.clone(),
        direction: TransferDirection::Receive,
    });

    // 发送初始进度事件（所有文件状态为 Pending）
    let initial_progress = BatchTransferProgress {
        session_id: request.session_id.clone(),
        total_files: file_count,
        completed_files: 0,
        total_bytes: request.total_size,
        transferred_bytes: 0,
        speed: 0,
        current_file: None,
        eta_seconds: None,
        files: request.files.iter().map(|f| FileProgressInfo {
            file_id: f.file_id.clone(),
            file_name: f.file_name.clone(),
            file_size: f.file_size,
            transferred_bytes: 0,
            status: TransferStatus::Pending,
        }).collect(),
        direction: Some(TransferDirection::Receive),
        peer_device_id: Some(corrected_from_device.device_id.clone()),
        peer_device_name: Some(corrected_from_device.device_name.clone()),
    };

    let event = LanTransferEvent::BatchProgress {
        progress: initial_progress,
    };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    // 返回响应
    let response = BatchPrepareResponse {
        session_id: request.session_id,
        accepted: true,
        file_count,
        reject_reason: None,
    };

    send_json_response(writer, &response).await
}

/// 处理准备上传请求（支持断点续传）
async fn handle_prepare_upload(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    peer_addr: SocketAddr,
) -> Result<(), ServerError> {
    // 解析请求
    let request: PrepareUploadRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // 🔴 与 batch-prepare 同一道闸：文件名过不了校验就不建会话、不开文件写入器。
    // 这里拒是为了让发送端拿到 `accepted:false` + 原因，
    // config::get_save_path 那一层的拒绝是纵深防御的兜底。
    if config::sanitize_incoming_file_name(&request.file.file_name).is_none() {
        println!(
            "[LanTransfer] ⛔ 拒绝上传准备: 文件名不合法 {:?} (session={})",
            request.file.file_name, request.session_id
        );
        let response = PrepareUploadResponse {
            session_id: request.session_id,
            accepted: false,
            resume_offset: 0,
            reject_reason: Some("文件名不合法（含路径分隔符或保留名），已拒绝接收".to_string()),
            save_directory: None,
        };
        return send_json_response(writer, &response).await;
    }

    // 🔴 `file_id` 同为对端可控且直接参与拼临时/续传路径，同一道闸在这里也要有：
    // config 层那道（get_temp_file_path / get_resume_info_path 返回 Option）是纵深防御兜底，
    // 这里拒是为了让发送端拿到 accepted:false + 原因，而不是一路走到 IO 层才失败。
    if config::sanitize_incoming_file_id(&request.file.file_id).is_none() {
        println!(
            "[LanTransfer] ⛔ 拒绝上传准备: file_id 不合法 {:?} (session={})",
            request.file.file_id, request.session_id
        );
        let response = PrepareUploadResponse {
            session_id: request.session_id,
            accepted: false,
            resume_offset: 0,
            reject_reason: Some("file_id 不合法（含路径分隔符或非法字符），已拒绝接收".to_string()),
            save_directory: None,
        };
        return send_json_response(writer, &response).await;
    }

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
    let (writer_file, hasher, direct_target_path): (Arc<Mutex<std::fs::File>>, Sha256, Option<String>) = if resume_offset > 0 {
        // 断点续传：打开已有文件（不支持直接写入模式）
        let mut f = resume_manager
            .open_temp_file(file_id, resume_offset)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        // 需要重新计算哈希（从头读取，D-04：SHA-256）
        let temp_path = resume_manager
            .get_temp_file_path(file_id)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;
        let mut hasher = Sha256::new();

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

        (Arc::new(Mutex::new(f)), hasher, None)
    } else {
        // 新传输
        // Android 平台：直接写入公共 Download 目录，避免临时文件和跨文件系统复制
        #[cfg(target_os = "android")]
        {
            // 获取最终保存路径
            let final_path = config::get_file_save_path(&file.file_name).ok_or_else(|| {
                ServerError::FileWriteFailed("对端文件名不合法，拒绝落盘".to_string())
            })?;

            // 确保目标目录存在
            if let Some(parent) = final_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| ServerError::FileWriteFailed(format!("创建目标目录失败: {}", e)))?;
            }

            let f = std::fs::File::create(&final_path)
                .map_err(|e| ServerError::FileWriteFailed(format!("创建目标文件失败: {}", e)))?;
            let hasher = Sha256::new();

            println!(
                "[LanTransfer] 新传输 (Android 直接写入): {} -> {:?} (大小: {} 字节)",
                file.file_name, final_path, file.file_size
            );

            (Arc::new(Mutex::new(f)), hasher, Some(final_path.to_string_lossy().to_string()))
        }

        // 非 Android 平台：使用临时文件
        #[cfg(not(target_os = "android"))]
        {
            let f = resume_manager
                .create_temp_file(file_id)
                .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;
            let hasher = Sha256::new();

            println!("[LanTransfer] 新传输 (临时文件): {} (大小: {} 字节)", file.file_name, file.file_size);

            (Arc::new(Mutex::new(f)), hasher, None)
        }
    };

    // 添加文件到会话（支持批量传输）
    // 检查是否已存在会话（由 batch-prepare 创建）
    // is_new_session: 是否为新建会话（用于决定是否发送初始进度事件）
    // peer_device: 发起方信息（用于初始进度的 peer 字段，D-01/D-22）
    let (total_files, total_bytes, is_new_session, peer_device) = {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        if let Some(existing_session) = sessions.get_mut(&request.session_id) {
            // 会话已存在（由 batch-prepare 创建），添加文件资源到现有会话
            println!(
                "[LanTransfer] 添加文件到现有会话: {} (文件: {}, 当前文件数: {})",
                request.session_id,
                file.file_name,
                existing_session.files.len()
            );

            // 添加文件资源（文件元信息可能已在 batch-prepare 时添加）
            existing_session.files.insert(file_id.clone(), file.clone());
            existing_session.writers.insert(file_id.clone(), writer_file);
            existing_session.hashers.insert(file_id.clone(), hasher);
            existing_session.received_bytes.insert(file_id.clone(), resume_offset);

            if let Some(ref target_path) = direct_target_path {
                existing_session.target_paths.insert(file_id.clone(), target_path.clone());
            }

            // 镜像会话同步（D-01：该文件进入传输中，字节 = 续传偏移）
            super::transfer::update_receive_session_file(
                &request.session_id,
                file_id,
                resume_offset,
                TransferStatus::Transferring,
            );

            // 返回会话的文件总数和总大小
            let total_files = existing_session.files.len() as u32;
            let total_bytes: u64 = existing_session.files.values().map(|f| f.file_size).sum();
            // 已存在会话，不发送初始进度（batch-prepare 已发送）
            (total_files, total_bytes, false, existing_session.from_device.clone())
        } else {
            // 新会话（单文件传输或向后兼容）
            // D-01：发起方信息优先从设备表按 TCP 源 IP 反查（与连接表同口径）
            let peer_ip = peer_addr.ip().to_string();
            let resolved_from_device = {
                let state = get_lan_transfer_state();
                let devices = state.devices.read();
                devices.values().find(|d| d.ip_address == peer_ip).cloned()
            }.unwrap_or_else(|| DiscoveredDevice {
                device_id: format!("unknown-{}", peer_ip),
                device_name: "未知设备".to_string(),
                user_id: String::new(),
                user_nickname: String::new(),
                ip_address: peer_ip.clone(),
                port: peer_addr.port(),
                discovered_at: Utc::now().to_rfc3339(),
                last_seen: Utc::now().to_rfc3339(),
            });

            let mut files = HashMap::new();
            let mut writers = HashMap::new();
            let mut hashers_map = HashMap::new();
            let mut received_bytes_map = HashMap::new();
            let mut target_paths = HashMap::new();

            files.insert(file_id.clone(), file.clone());
            writers.insert(file_id.clone(), writer_file);
            hashers_map.insert(file_id.clone(), hasher);
            received_bytes_map.insert(file_id.clone(), resume_offset);

            if let Some(ref target_path) = direct_target_path {
                target_paths.insert(file_id.clone(), target_path.clone());
            }

            let session = UploadSession {
                session_id: request.session_id.clone(),
                files,
                writers,
                hashers: hashers_map,
                received_bytes: received_bytes_map,
                cancelled_files: std::collections::HashSet::new(),
                failed_files: HashMap::new(),
                last_progress_time: std::time::Instant::now(),
                resume_offset,
                speed_tracker: SpeedTracker::new(),
                from_device: Some(resolved_from_device.clone()),
                resume_flush_tracking: HashMap::new(),
                target_paths,
            };

            println!(
                "[LanTransfer] 创建新会话: {} (文件: {}, 当前会话数: {})",
                request.session_id,
                file.file_name,
                sessions.len() + 1
            );
            sessions.insert(request.session_id.clone(), session);

            // D-01：新建会话同步镜像进统一会话表
            super::transfer::upsert_receive_session(TransferSession {
                session_id: request.session_id.clone(),
                connection_id: String::new(),
                request_id: String::new(),
                files: vec![FileTransferState {
                    file: file.clone(),
                    status: TransferStatus::Transferring,
                    transferred_bytes: resume_offset,
                    resume_info: None,
                }],
                file_paths: Vec::new(),
                status: SessionStatus::Transferring,
                created_at: Utc::now().to_rfc3339(),
                target_device: resolved_from_device.clone(),
                direction: TransferDirection::Receive,
            });

            // 新建会话，需要发送初始进度
            (1, file.file_size, true, Some(resolved_from_device))
        }
    };

    // 只有新建会话时才发送初始进度事件
    // 如果会话已存在（由 batch-prepare 创建），则不重复发送，避免 UI 重复显示
    if is_new_session {
        let files_progress = vec![FileProgressInfo {
            file_id: file.file_id.clone(),
            file_name: file.file_name.clone(),
            file_size: file.file_size,
            transferred_bytes: resume_offset,
            status: TransferStatus::Transferring,
        }];

        let initial_progress = BatchTransferProgress {
            session_id: request.session_id.clone(),
            total_files,
            completed_files: 0,
            total_bytes,
            transferred_bytes: resume_offset,
            speed: 0,
            current_file: Some(file.clone()),
            eta_seconds: None,
            files: files_progress,
            direction: Some(TransferDirection::Receive),
            peer_device_id: peer_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: peer_device.as_ref().map(|d| d.device_name.clone()),
        };
        let initial_event = LanTransferEvent::BatchProgress {
            progress: initial_progress,
        };
        let _ = get_event_sender().send(initial_event.clone());
        emit_lan_event(&initial_event);
    }

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

/// 上传块处理结果（锁外写盘后回填）
struct UploadCommit {
    response: ChunkResponse,
    file_sha256: String,
    received: u64,
    should_emit: bool,
    file_meta: Option<FileMetadata>,
    speed: u64,
    eta_seconds: Option<u64>,
    flush_resume: bool,
    /// D-07b：写盘在全局锁外进行（Arc 分文件锁）
    writer: Option<Arc<Mutex<std::fs::File>>>,
}

/// 处理文件块上传（支持断点续传）
///
/// D-03：请求带 `offset` 查询参数，校验 offset == 当前已收字节；
/// 不匹配/超限时返回 success:false + next_offset（不写入），发送端据此重对齐重发。
/// D-07b：写盘在全局 sessions.lock() 之外进行（分文件锁），消除跨会话串行化。
async fn handle_upload(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
    path: &str,
    _headers: &HashMap<String, String>,
) -> Result<(), ServerError> {
    // 解析查询参数（D-03：新增 offset）
    let query = path.split('?').nth(1).unwrap_or("");
    let params: HashMap<&str, &str> = query
        .split('&')
        .filter_map(|s| s.split_once('='))
        .collect();

    let session_id = params.get("sessionId").unwrap_or(&"").to_string();
    let file_id = params.get("fileId").unwrap_or(&"").to_string();
    let offset_param: Option<u64> = params.get("offset").and_then(|s| s.parse().ok());

    // 检查文件是否已被取消（在主处理块之前）
    let cancelled_offset = {
        let sessions = get_upload_sessions();
        let sessions = sessions.lock();
        sessions.get(&session_id).and_then(|session| {
            if session.cancelled_files.contains(&file_id) {
                Some(session.received_bytes.get(&file_id).copied().unwrap_or(0))
            } else {
                None
            }
        })
    };
    if let Some(next_offset) = cancelled_offset {
        let response = ChunkResponse {
            success: false,
            next_offset,
            error: Some("file_cancelled".to_string()),
        };
        return send_json_response(writer, &response).await;
    }

    // 锁内：定位会话、校验偏移（D-03 纯函数）、取出 writer 的 Arc
    // 返回 None 表示文件已取消（需在块外发送取消响应）
    let block_result = (|| -> Result<Option<UploadCommit>, ServerError> {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        let session = match sessions.get_mut(&session_id) {
            Some(s) => s,
            None => {
                let existing_sessions: Vec<&String> = sessions.keys().collect();
                println!(
                    "[LanTransfer] ⚠️ upload 会话不存在: {} (现有会话: {:?})",
                    session_id, existing_sessions
                );
                return Err(ServerError::RequestFailed("会话不存在".to_string()));
            }
        };

        // 二次检查取消状态（消除前置检查与此处的 TOCTOU 竞态窗口）
        if session.cancelled_files.contains(&file_id) {
            return Ok(None);
        }

        // 获取文件元信息与当前已收字节
        let file_meta = session.files.get(&file_id).cloned();
        let file_size = file_meta.as_ref().map(|f| f.file_size).unwrap_or(0);
        let received_now = session.received_bytes.get(&file_id).copied().unwrap_or(0);

        // D-03：偏移校验 —— 错位/超限一律拒绝且不写入，回传权威偏移
        match validate_chunk(offset_param, received_now, body.len(), file_size) {
            ChunkVerdict::Mismatch { next_offset } => {
                println!(
                    "[LanTransfer] ⚠️ 拒绝错位块: session={} file={} 期望偏移 {} 请求偏移 {:?}，回传 next_offset={}",
                    session_id, file_id, received_now, offset_param, next_offset
                );
                return Ok(Some(UploadCommit {
                    response: ChunkResponse {
                        success: false,
                        next_offset,
                        error: Some("offset_mismatch".to_string()),
                    },
                    file_sha256: String::new(),
                    received: received_now,
                    should_emit: false,
                    file_meta: None,
                    speed: 0,
                    eta_seconds: None,
                    flush_resume: false,
                    writer: None,
                }));
            }
            ChunkVerdict::ExceedsFileSize { next_offset } => {
                println!(
                    "[LanTransfer] ⛔ 拒绝超限块: session={} file={} 已收 {} + 块 {} > 文件大小 {}",
                    session_id, file_id, received_now, body.len(), file_size
                );
                return Ok(Some(UploadCommit {
                    response: ChunkResponse {
                        success: false,
                        next_offset,
                        error: Some("chunk_exceeds_file_size".to_string()),
                    },
                    file_sha256: String::new(),
                    received: received_now,
                    should_emit: false,
                    file_meta: None,
                    speed: 0,
                    eta_seconds: None,
                    flush_resume: false,
                    writer: None,
                }));
            }
            ChunkVerdict::Accept => {}
        }

        // D-07b：取出 writer 的 Arc 并立即释放全局锁，写盘在锁外进行
        let writer_arc = session
            .writers
            .get(&file_id)
            .cloned()
            .ok_or_else(|| ServerError::RequestFailed("文件不存在".to_string()))?;

        let file_sha256 = file_meta
            .as_ref()
            .map(|f| f.sha256.clone())
            .unwrap_or_default();

        Ok(Some(UploadCommit {
            response: ChunkResponse {
                success: true,
                next_offset: 0,
                error: None,
            },
            file_sha256,
            received: 0,
            should_emit: false,
            file_meta,
            speed: 0,
            eta_seconds: None,
            flush_resume: false,
            writer: Some(writer_arc),
        }))
    })();

    // 处理块结果：错误传播、取消响应、正常继续
    let mut commit = match block_result {
        Err(e) => return Err(e),
        Ok(None) => {
            // 文件已取消 — 在锁外发送 JSON 取消响应
            let next_offset = {
                let sessions = get_upload_sessions();
                let sessions = sessions.lock();
                sessions.get(&session_id)
                    .and_then(|s| s.received_bytes.get(&file_id).copied())
                    .unwrap_or(0)
            };
            let cancel_response = ChunkResponse {
                success: false,
                next_offset,
                error: Some("file_cancelled".to_string()),
            };
            return send_json_response(writer, &cancel_response).await;
        }
        Ok(Some(tuple)) => tuple,
    };

    // D-07b：写盘（全局锁外，分文件锁）。数据先落盘，成功后才在锁内提交字节计数。
    if commit.response.success && let Some(writer_arc) = commit.writer.take() {
        let mut file_writer = writer_arc.lock();
        file_writer
            .write_all(body)
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;

        // 刷新到磁盘（确保数据持久化）
        file_writer
            .flush()
            .map_err(|e| ServerError::FileWriteFailed(e.to_string()))?;
        drop(file_writer);

        // 锁内提交：哈希/字节计数/速度/节流决策
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();
        if let Some(session) = sessions.get_mut(&session_id) {
            // 更新哈希（D-04：SHA-256）
            if let Some(hasher) = session.hashers.get_mut(&file_id) {
                hasher.update(body);
            }

            // 更新已接收字节数
            let received_ref = session.received_bytes.entry(file_id.clone()).or_insert(0);
            *received_ref += body.len() as u64;
            let received = *received_ref;
            commit.received = received;
            commit.response.next_offset = received;

            // D-21：滑窗速度（本次运行累计 = received - resume_offset）
            let run_bytes = received.saturating_sub(session.resume_offset);
            let speed = session.speed_tracker.record(run_bytes);
            commit.speed = speed;

            let total_bytes = commit.file_meta.as_ref().map(|f| f.file_size).unwrap_or(0);
            let remaining_bytes = total_bytes.saturating_sub(received);
            commit.eta_seconds = remaining_bytes.checked_div(speed);

            // D-07d：续传落盘节流（每 64MB 或 2s；收尾强制）
            commit.flush_resume = should_flush_resume(
                session.resume_flush_tracking.get(&file_id)
                    .map(|(t, b)| (t.elapsed().as_secs_f64(), *b)),
                received,
                total_bytes,
            );
            if commit.flush_resume {
                session.resume_flush_tracking.insert(file_id.clone(), (std::time::Instant::now(), received));
            }

            // 检查是否应该发送进度事件（每 100ms 一次）
            commit.should_emit = session.last_progress_time.elapsed().as_millis() >= 100;
            if commit.should_emit {
                session.last_progress_time = std::time::Instant::now();
            }

            // D-01：镜像会话文件状态/字节实时同步
            super::transfer::update_receive_session_file(
                &session_id,
                &file_id,
                received,
                TransferStatus::Transferring,
            );
        } else {
            // 会话在写盘期间被移除（如整批取消）——按取消处理
            commit.response.success = false;
            commit.response.error = Some("file_cancelled".to_string());
        }
    }

    // 更新断点续传信息（锁外，D-07d 节流后）
    if commit.flush_resume && commit.response.success {
        let resume_manager = get_resume_manager();
        let _ = resume_manager.update_progress(&file_id, &commit.file_sha256, commit.received, None);
    }

    // 发送接收进度事件（限制频率）
    if commit.should_emit
        && commit.response.success
        && let Some(file) = commit.file_meta.clone()
    {
        // 从会话中获取所有文件的进度信息
        let (total_files, session_total_bytes, files_progress, peer_device) = {
            let sessions = get_upload_sessions();
            let sessions = sessions.lock();
            if let Some(session) = sessions.get(&session_id) {
                let total_files = session.files.len() as u32;
                let session_total_bytes: u64 = session.files.values().map(|f| f.file_size).sum();

                // D-14：Completed 只在 finish 校验成功后出现（writer 已移除且非取消/失败）；
                // 字节收满但 writer 尚在时仍显示 Transferring，避免 finish 校验失败后 UI 闪过「✓」
                let files_progress: Vec<FileProgressInfo> = session.files.values().map(|f| {
                    let transferred = session.received_bytes.get(&f.file_id).copied().unwrap_or(0);
                    let status = derive_file_status(session, &f.file_id, transferred, f);
                    FileProgressInfo {
                        file_id: f.file_id.clone(),
                        file_name: f.file_name.clone(),
                        file_size: f.file_size,
                        transferred_bytes: if status == TransferStatus::Completed { f.file_size } else { transferred },
                        status,
                    }
                }).collect();

                (total_files, session_total_bytes, files_progress, session.from_device.clone())
            } else {
                // 会话不存在，使用当前文件信息
                (1, file.file_size, vec![FileProgressInfo {
                    file_id: file.file_id.clone(),
                    file_name: file.file_name.clone(),
                    file_size: file.file_size,
                    transferred_bytes: commit.received,
                    status: TransferStatus::Transferring,
                }], None)
            }
        };

        // 计算已完成文件数（D-14：只有真正完成的文件才计入）
        let completed_files = files_progress.iter()
            .filter(|f| f.status == TransferStatus::Completed)
            .count() as u32;

        // 实际已收字节合计（不虚报总大小）
        let session_transferred_bytes: u64 = files_progress.iter().map(|f| f.transferred_bytes).sum();

        // 重新计算整体 ETA
        let remaining_bytes = session_total_bytes.saturating_sub(session_transferred_bytes);
        let overall_eta = remaining_bytes.checked_div(commit.speed);

        let progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files,
            completed_files,
            total_bytes: session_total_bytes,
            transferred_bytes: session_transferred_bytes,
            speed: commit.speed,
            current_file: Some(file.clone()),
            eta_seconds: overall_eta,
            files: files_progress,
            direction: Some(TransferDirection::Receive),
            peer_device_id: peer_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: peer_device.as_ref().map(|d| d.device_name.clone()),
        };

        let event = LanTransferEvent::BatchProgress { progress };
        let _ = get_event_sender().send(event.clone());
        emit_lan_event(&event);
    }

    send_json_response(writer, &commit.response).await
}

/// Finish 请求体（用于从 JSON body 解析）
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FinishRequest {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    file_id: String,
}

/// 发送接收侧批量进度事件；会话已无活跃 writer 且无等待文件时收尾（D-05）。
///
/// 收尾动作：发 batch_transfer_completed（outcome + failed_files）→ 移除 UPLOAD_SESSIONS
/// → 镜像会话置终态。进度事件的 transferred_bytes 为实际已收字节合计（D-20：不虚报总大小）。
/// 返回是否已收尾。
fn emit_receive_progress_and_maybe_finalize(session_id: &str, save_directory: &str) -> bool {
    // 快照（锁内只取数据，事件在锁外发）
    let snapshot = {
        let sessions = get_upload_sessions();
        let sessions = sessions.lock();
        let Some(session) = sessions.get(session_id) else {
            return false;
        };

        let total_files = session.files.len() as u32;
        let session_total_bytes: u64 = session.files.values().map(|f| f.file_size).sum();
        let files_progress: Vec<FileProgressInfo> = session.files.values().map(|f| {
            let transferred = session.received_bytes.get(&f.file_id).copied().unwrap_or(0);
            let status = derive_file_status(session, &f.file_id, transferred, f);
            FileProgressInfo {
                file_id: f.file_id.clone(),
                file_name: f.file_name.clone(),
                file_size: f.file_size,
                transferred_bytes: if status == TransferStatus::Completed { f.file_size } else { transferred },
                status,
            }
        }).collect();
        let failed_list: Vec<FailedFileInfo> = session.failed_files.iter().map(|(fid, err)| {
            let name = session.files.get(fid).map(|m| m.file_name.clone()).unwrap_or_default();
            FailedFileInfo {
                file_id: fid.clone(),
                file_name: name,
                error: err.clone(),
            }
        }).collect();

        Some((
            total_files,
            session_total_bytes,
            files_progress,
            failed_list,
            session.writers.len(),
            session.from_device.clone(),
        ))
    };

    let Some((total_files, session_total_bytes, files_progress, failed_list, active_writers, from_device)) = snapshot
    else {
        return false;
    };

    // D-20：实际已收字节合计（完成文件按满额计），不再无条件下 total_bytes
    let transferred_bytes: u64 = files_progress.iter().map(|f| f.transferred_bytes).sum();
    let completed_files = files_progress.iter()
        .filter(|f| f.status == TransferStatus::Completed)
        .count() as u32;
    let statuses: Vec<TransferStatus> = files_progress.iter().map(|f| f.status.clone()).collect();
    let pending_or_transferring = files_progress.iter()
        .filter(|f| f.status == TransferStatus::Pending || f.status == TransferStatus::Transferring)
        .count();

    // 发送进度更新事件（包含最终文件状态，D-15）
    let progress_event = LanTransferEvent::BatchProgress {
        progress: BatchTransferProgress {
            session_id: session_id.to_string(),
            total_files,
            completed_files,
            total_bytes: session_total_bytes,
            transferred_bytes,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_progress,
            direction: Some(TransferDirection::Receive),
            peer_device_id: from_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: from_device.as_ref().map(|d| d.device_name.clone()),
        },
    };
    let _ = get_event_sender().send(progress_event.clone());
    emit_lan_event(&progress_event);

    // D-05：只有当无活跃 writer 且无等待中的文件时才收尾
    if !session_should_finalize(active_writers, pending_or_transferring) {
        return false;
    }

    let outcome = compute_batch_outcome(&statuses);
    let batch_event = LanTransferEvent::BatchTransferCompleted {
        session_id: session_id.to_string(),
        total_files,
        save_directory: save_directory.to_string(),
        outcome: Some(outcome.to_string()),
        failed_files: Some(failed_list),
    };
    let _ = get_event_sender().send(batch_event.clone());
    emit_lan_event(&batch_event);

    // 镜像会话置终态 + 清理上传会话
    super::transfer::set_session_status(
        session_id,
        if outcome == "failed" { SessionStatus::Failed } else { SessionStatus::Completed },
    );
    {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();
        sessions.remove(session_id);
    }
    println!("[LanTransfer] 📦 批量传输完成 (outcome={})，清理会话: {}", outcome, session_id);
    true
}

/// 处理上传完成
async fn handle_finish(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    path: &str,
    body: &[u8],
) -> Result<(), ServerError> {
    // 解析查询参数
    let query = path.split('?').nth(1).unwrap_or("");
    let params: HashMap<&str, &str> = query
        .split('&')
        .filter_map(|s| s.split_once('='))
        .collect();

    // 优先从 URL 参数获取，如果为空则尝试从请求体解析
    let mut session_id = params.get("sessionId").unwrap_or(&"").to_string();
    let mut file_id = params.get("fileId").unwrap_or(&"").to_string();

    // 如果 URL 参数为空，尝试从请求体解析
    if session_id.is_empty() || file_id.is_empty() {
        if let Ok(body_request) = serde_json::from_slice::<FinishRequest>(body) {
            if session_id.is_empty() && !body_request.session_id.is_empty() {
                session_id = body_request.session_id;
            }
            if file_id.is_empty() && !body_request.file_id.is_empty() {
                file_id = body_request.file_id;
            }
            println!(
                "[LanTransfer] finish 请求 (从请求体解析): session={}, file={}",
                session_id, file_id
            );
        }
    } else {
        println!(
            "[LanTransfer] finish 请求 (从URL解析): session={}, file={}",
            session_id, file_id
        );
    }

    // 在锁的作用域内完成所有同步操作
    let (file_meta, computed_hash, hash_match, target_path, received) = {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        let session = match sessions.get_mut(&session_id) {
            Some(s) => s,
            None => {
                let existing_sessions: Vec<&String> = sessions.keys().collect();
                println!(
                    "[LanTransfer] ⚠️ finish 会话不存在: {} (现有会话: {:?})",
                    session_id, existing_sessions
                );
                return Err(ServerError::RequestFailed("会话不存在".to_string()));
            }
        };

        // 获取文件元信息
        let file_meta = session
            .files
            .get(&file_id)
            .ok_or_else(|| ServerError::RequestFailed("文件不存在".to_string()))?
            .clone();

        // 计算最终哈希（D-04：SHA-256，与发送端预哈希同算法同口径）
        let hasher = session
            .hashers
            .remove(&file_id)
            .ok_or_else(|| ServerError::RequestFailed("哈希计算器不存在".to_string()))?;

        let computed_hash = hex::encode(hasher.finalize());
        let hash_match = computed_hash == file_meta.sha256;

        // 获取目标路径（如果有）
        let target_path = session.target_paths.get(&file_id).cloned();

        // 关闭文件
        session.writers.remove(&file_id);

        // 已收字节（供失败路径镜像同步与续传保底）
        let received = session.received_bytes.get(&file_id).copied().unwrap_or(0);

        (file_meta, computed_hash, hash_match, target_path, received)
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

        // 清理临时文件和续传信息（数据已损坏，续传无意义）
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

        println!(
            "[LanTransfer] ✅ 接收完成: {} (会话: {})",
            file_meta.file_name, session_id
        );

        // D-01：镜像会话同步完成状态（Completed 只在 finish 校验成功后标记，D-14）
        super::transfer::update_receive_session_file(
            &session_id,
            &file_id,
            file_meta.file_size,
            TransferStatus::Completed,
        );

        // 发送进度更新 + 会话收尾判定（无剩余活跃文件时发 completed 并清理会话）
        let _finalized = emit_receive_progress_and_maybe_finalize(&session_id, &saved_path_str);
    } else {
        // ── D-05：finish 失败收尾 —— 文件标 Failed → 发带最终 files 的 batch_progress
        // → 无活跃 writer/等待文件时发 completed 并清会话，不得永久卡「传输中」──

        // 1. 记录失败文件与错误信息
        {
            let sessions = get_upload_sessions();
            let mut sessions = sessions.lock();
            if let Some(session) = sessions.get_mut(&session_id) {
                session.failed_files.insert(
                    file_id.clone(),
                    response.error.clone().unwrap_or_else(|| "传输失败".to_string()),
                );
            }
        }

        // 2. 镜像会话同步 Failed 状态（保留已收字节）
        super::transfer::update_receive_session_file(
            &session_id,
            &file_id,
            received,
            TransferStatus::Failed,
        );

        // 3. 若是保存失败（非校验失败），临时文件仍完好：把续传信息保底落到实际偏移，
        //    让下次重试可以续传（校验失败路径已清临时文件，无需保底）
        if response.sha256_match {
            let _ = resume_manager.update_progress(&file_id, &file_meta.sha256, received, None);
        }

        // 4. 发带最终 files 的 batch_progress；会话无剩余活跃文件时发 completed 并清理
        let _finalized = emit_receive_progress_and_maybe_finalize(&session_id, "");

        // 5. TransferFailed 事件（兼容旧前端逻辑）
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
/// 
/// 接收到发送方的取消请求后：
/// 1. 清理文件写入器和哈希器
/// 2. 发送 BatchProgress 事件更新前端 UI（标记文件为 Cancelled，保留已收字节 D-13）
/// 3. 发送 TransferFailed 事件（兼容）
/// 4. 会话无剩余活跃文件时发 batch_transfer_completed 并移除会话（D-05 同源口径）
async fn handle_cancel(
    writer: &mut tokio::net::tcp::WriteHalf<'_>,
    body: &[u8],
) -> Result<(), ServerError> {
    let request: CancelRequest = serde_json::from_slice(body)
        .map_err(|e| ServerError::RequestFailed(e.to_string()))?;

    // ── 整会话取消：复用共享函数（D-02：本地 cancel_session 与此同一路径）──
    let Some(file_id) = request.file_id.clone() else {
        let cancelled = cancel_receiver_session(&request.session_id, request.keep_partial);
        if let Some((sid, from_device, files_progress)) = cancelled {
            let total_files = files_progress.len() as u32;
            let statuses: Vec<TransferStatus> = files_progress.iter().map(|f| f.status.clone()).collect();

            // 进度事件（D-13：保留已收字节，不归零）
            let batch_progress = BatchTransferProgress {
                session_id: sid.clone(),
                total_files,
                completed_files: files_progress.iter()
                    .filter(|f| f.status == TransferStatus::Completed)
                    .count() as u32,
                total_bytes: files_progress.iter().map(|f| f.file_size).sum(),
                transferred_bytes: files_progress.iter().map(|f| f.transferred_bytes).sum(),
                speed: 0,
                current_file: None,
                eta_seconds: None,
                files: files_progress,
                direction: Some(TransferDirection::Receive),
                peer_device_id: from_device.as_ref().map(|d| d.device_id.clone()),
                peer_device_name: from_device.as_ref().map(|d| d.device_name.clone()),
            };
            let progress_event = LanTransferEvent::BatchProgress { progress: batch_progress };
            let _ = get_event_sender().send(progress_event.clone());
            emit_lan_event(&progress_event);

            // 终态事件
            let completed_event = LanTransferEvent::BatchTransferCompleted {
                session_id: sid,
                total_files,
                save_directory: String::new(),
                outcome: Some(compute_batch_outcome(&statuses).to_string()),
                failed_files: Some(Vec::new()),
            };
            let _ = get_event_sender().send(completed_event.clone());
            emit_lan_event(&completed_event);
        } else {
            println!("[LanTransfer] ⚠️ /api/cancel: 会话不存在: {}", request.session_id);
        }

        #[derive(serde::Serialize)]
        struct CancelResponse {
            success: bool,
        }
        return send_json_response(writer, &CancelResponse { success: true }).await;
    };

    // ── 单文件取消 ──
    // 收集需要发送事件的信息 + 会话收尾判定
    let event_info: Option<(String, Vec<FileProgressInfo>, Option<DiscoveredDevice>, bool)>;

    // 在单独的作用域内处理锁，确保在 await 之前释放
    {
        let sessions = get_upload_sessions();
        let mut sessions = sessions.lock();

        if !sessions.contains_key(&request.session_id) {
            event_info = None;
        } else {
            let (files_progress, finished, transferred) = {
                let session = sessions.get_mut(&request.session_id).unwrap();
                let resume_manager = get_resume_manager();

                // 取消特定文件
                session.writers.remove(&file_id);
                session.hashers.remove(&file_id);
                // 将文件 ID 添加到取消列表（持久化取消状态）
                session.cancelled_files.insert(file_id.clone());

                if !request.keep_partial {
                    let _ = resume_manager.clear_resume_info(&file_id);
                }

                let transferred = session.received_bytes.get(&file_id).copied().unwrap_or(0);

                // 构建文件进度信息（保留已收字节 D-13）
                let files_progress: Vec<FileProgressInfo> = session.files.iter()
                    .map(|(fid, file_meta)| {
                        let transferred = session.received_bytes.get(fid).copied().unwrap_or(0);
                        let status = derive_file_status(session, fid, transferred, file_meta);
                        FileProgressInfo {
                            file_id: file_meta.file_id.clone(),
                            file_name: file_meta.file_name.clone(),
                            file_size: file_meta.file_size,
                            transferred_bytes: if status == TransferStatus::Completed { file_meta.file_size } else { transferred },
                            status,
                        }
                    })
                    .collect();

                // 会话收尾判定：无活跃 writer 且无等待中的文件 → 本会话到此结束
                let pending_or_transferring = files_progress.iter()
                    .filter(|f| f.status == TransferStatus::Pending || f.status == TransferStatus::Transferring)
                    .count();
                let finished = session_should_finalize(session.writers.len(), pending_or_transferring);

                (files_progress, finished, transferred)
            };

            let from_device = sessions.get(&request.session_id).and_then(|s| s.from_device.clone());

            // 镜像会话同步（D-01）
            super::transfer::update_receive_session_file(
                &request.session_id,
                &file_id,
                transferred,
                TransferStatus::Cancelled,
            );

            if finished {
                // 移除上传会话 + 镜像会话置 Cancelled
                sessions.remove(&request.session_id);
                super::transfer::set_session_status(&request.session_id, SessionStatus::Cancelled);
                println!("[LanTransfer] 取消文件后无剩余活跃文件，会话 {} 收尾", request.session_id);
            }

            event_info = Some((request.session_id.clone(), files_progress, from_device, finished));
            println!("[LanTransfer] 取消文件传输: {}", file_id);
        }
    } // 锁在这里释放

    // 发送事件更新前端 UI
    if let Some((session_id, files_progress, from_device, finished)) = event_info {
        let total_files = files_progress.len() as u32;
        let completed_files = files_progress.iter()
            .filter(|f| f.status == TransferStatus::Completed)
            .count() as u32;
        let total_bytes: u64 = files_progress.iter().map(|f| f.file_size).sum();
        let transferred_bytes: u64 = files_progress.iter().map(|f| f.transferred_bytes).sum();
        let statuses: Vec<TransferStatus> = files_progress.iter().map(|f| f.status.clone()).collect();

        // 发送 BatchProgress 事件（D-13：保留已收字节）
        let batch_progress = BatchTransferProgress {
            session_id: session_id.clone(),
            total_files,
            completed_files,
            total_bytes,
            transferred_bytes,
            speed: 0,
            current_file: None,
            eta_seconds: None,
            files: files_progress,
            direction: Some(TransferDirection::Receive),
            peer_device_id: from_device.as_ref().map(|d| d.device_id.clone()),
            peer_device_name: from_device.as_ref().map(|d| d.device_name.clone()),
        };

        let progress_event = LanTransferEvent::BatchProgress {
            progress: batch_progress,
        };
        let _ = get_event_sender().send(progress_event.clone());
        emit_lan_event(&progress_event);

        // 发送 TransferFailed 事件（兼容）
        let failed_event = LanTransferEvent::TransferFailed {
            task_id: file_id.clone(),
            error: "发送方取消".to_string(),
        };
        let _ = get_event_sender().send(failed_event.clone());
        emit_lan_event(&failed_event);

        // 会话收尾：发 completed（outcome 按最终文件状态推导）
        if finished {
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

    #[derive(serde::Serialize)]
    struct CancelResponse {
        success: bool,
    }

    send_json_response(writer, &CancelResponse { success: true }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(ip: &str) -> DiscoveredDevice {
        DiscoveredDevice {
            device_id: format!("dev-{ip}"),
            device_name: "peer".to_string(),
            user_id: "u".to_string(),
            user_nickname: "n".to_string(),
            ip_address: ip.to_string(),
            port: SERVICE_PORT,
            discovered_at: "2026-08-21T00:00:00Z".to_string(),
            last_seen: "2026-08-21T00:00:00Z".to_string(),
        }
    }

    fn conn(ip: &str, status: PeerConnectionStatus) -> PeerConnection {
        PeerConnection {
            connection_id: format!("c-{ip}"),
            peer_device: device(ip),
            established_at: "2026-08-21T00:00:00Z".to_string(),
            status,
            is_initiator: false,
        }
    }

    /// 传输端点必须被认成传输端点；**连接类端点绝不能**被认成传输端点
    /// —— 认错了就永远建不上连接（这道闸会把握手本身挡死）。
    #[test]
    fn transfer_endpoints_are_exactly_the_file_write_paths() {
        for gated in [
            "/api/batch-prepare",
            "/api/prepare-upload",
            "/api/cancel",
            "/api/upload",
            "/api/upload/abc123",
            "/api/finish",
            "/api/finish/abc123",
        ] {
            assert!(is_transfer_endpoint(gated), "应受闸: {gated}");
        }
        for open_path in [
            "/api/info",
            "/api/peer-connection-request",
            "/api/peer-connection-response",
            "/api/peer-disconnect",
            "/api/connect",
        ] {
            assert!(!is_transfer_endpoint(open_path), "不应受闸: {open_path}");
        }
    }

    /// 没有任何连接 ⇒ 拒；有一条来自该 IP 的 Connected ⇒ 放行。
    /// 两侧结果不同，才证明这条判据有判别力（不是恒真也不是恒假）。
    #[test]
    fn peer_gate_rejects_unknown_ip_and_accepts_connected_ip() {
        let mut connections: HashMap<String, PeerConnection> = HashMap::new();
        assert!(
            !peer_ip_is_connected(&connections, "192.168.1.50"),
            "空表时任何 IP 都不该放行"
        );

        connections.insert(
            "c1".to_string(),
            conn("192.168.1.50", PeerConnectionStatus::Connected),
        );
        assert!(peer_ip_is_connected(&connections, "192.168.1.50"));
        assert!(
            !peer_ip_is_connected(&connections, "192.168.1.51"),
            "别的 IP 不能蹭同一条连接"
        );
    }

    /// 只有 Connected 算数：已断开（Disconnected）的连接不能放行传输。
    #[test]
    fn peer_gate_ignores_non_connected_states() {
        let mut connections: HashMap<String, PeerConnection> = HashMap::new();
        connections.insert(
            "c1".to_string(),
            conn("10.0.0.7", PeerConnectionStatus::Disconnected),
        );
        assert!(!peer_ip_is_connected(&connections, "10.0.0.7"));
    }
}

// ============================================================================
// 接收侧纯逻辑单测（D-03 / D-07d / D-05）
// ============================================================================

#[cfg(test)]
mod validation_tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    /// D-03：offset 校验纯逻辑 —— 错位块被拒且回传权威偏移，不写入
    #[test]
    fn offset_mismatch_is_rejected_with_authoritative_offset() {
        // 已收 1MB，请求偏移 0（重发第一块）→ 拒绝，next_offset = 1MB
        assert_eq!(
            validate_chunk(Some(0), MB, MB as usize, 10 * MB),
            ChunkVerdict::Mismatch { next_offset: MB }
        );
        // 已收 1MB，请求偏移 2MB（跳块）→ 拒绝
        assert_eq!(
            validate_chunk(Some(2 * MB), MB, MB as usize, 10 * MB),
            ChunkVerdict::Mismatch { next_offset: MB }
        );
        // 偏移对齐 → 接受
        assert_eq!(validate_chunk(Some(MB), MB, MB as usize, 10 * MB), ChunkVerdict::Accept);
    }

    /// D-03：不带 offset 的旧版客户端维持追加语义（向后兼容）
    #[test]
    fn missing_offset_falls_back_to_append_semantics() {
        assert_eq!(validate_chunk(None, MB, MB as usize, 10 * MB), ChunkVerdict::Accept);
        assert_eq!(validate_chunk(None, 0, MB as usize, 10 * MB), ChunkVerdict::Accept);
    }

    /// D-03：超出文件边界的块被拒（offset + len > file_size）
    #[test]
    fn oversize_chunk_is_rejected() {
        // 文件 2MB：已收 1MB，再来 2MB → 超限拒绝
        assert_eq!(
            validate_chunk(Some(MB), MB, 2 * MB as usize, 2 * MB),
            ChunkVerdict::ExceedsFileSize { next_offset: MB }
        );
        // 恰好填满 → 接受
        assert_eq!(
            validate_chunk(Some(MB), MB, MB as usize, 2 * MB),
            ChunkVerdict::Accept
        );
        // 0 字节文件只能接受 0 字节块（空文件 finish 路径）
        assert_eq!(
            validate_chunk(Some(0), 0, 1, 0),
            ChunkVerdict::ExceedsFileSize { next_offset: 0 }
        );
    }

    /// D-07d：续传落盘节流 —— 每 64MB 或 2s 才落盘；收尾强制落盘
    #[test]
    fn resume_flush_throttles_but_always_flushes_at_end() {
        const INTERVAL: u64 = 64 * 1024 * 1024;
        // 从未落盘 → 立即落盘
        assert!(should_flush_resume(None, 0, 10 * INTERVAL));
        // 刚落过盘（0.1s 前，字节增量小）→ 不落盘
        assert!(!should_flush_resume(Some((0.1, MB)), 2 * MB, 100 * MB));
        // 累计增量 ≥ 64MB → 落盘
        assert!(should_flush_resume(Some((0.1, MB)), INTERVAL + MB, 100 * MB));
        // 距上次落盘 ≥ 2s → 落盘（即使字节增量小）
        assert!(should_flush_resume(Some((2.0, MB)), MB + 1, 100 * MB));
        // 已收满（文件收尾）→ 强制落盘
        assert!(should_flush_resume(Some((0.01, MB)), 100 * MB, 100 * MB));
        // 0 字节文件靠「从未落盘」分支落盘
        assert!(should_flush_resume(None, 0, 0));
    }

    /// D-05：finish 后会话收尾判定 —— 有活跃 writer 或等待中文件时不得收尾
    #[test]
    fn session_finalization_requires_no_active_writers_and_no_pending() {
        // 全部 writer 已关、无等待文件 → 收尾
        assert!(session_should_finalize(0, 0));
        // 还有活跃 writer（其他文件在传）→ 不收尾
        assert!(!session_should_finalize(2, 0));
        // 还有等待中的文件（发送端稍后会上传）→ 不收尾
        assert!(!session_should_finalize(0, 1));
        assert!(!session_should_finalize(1, 3));
    }

    /// D-05 配套：失败会话的 outcome 推导（单文件会话校验失败 → failed）
    #[test]
    fn failed_finish_outcome_is_failed_for_single_file_session() {
        assert_eq!(compute_batch_outcome(&[TransferStatus::Failed]), "failed");
        // 多文件：一个失败一个完成 → partial（列失败文件）
        assert_eq!(
            compute_batch_outcome(&[TransferStatus::Failed, TransferStatus::Completed]),
            "partial"
        );
    }
}

// ============================================================================
// D-11 加固单测（a：待处理请求 TTL 过期；c：请求头行长度上限）
// ============================================================================

#[cfg(test)]
mod d11_hardening_tests {
    use super::*;
    use tokio::io::BufReader;

    fn utc_at(unix_secs: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(unix_secs, 0).unwrap()
    }

    fn peer_request(connection_id: &str, requested_at: String) -> PeerConnectionRequest {
        PeerConnectionRequest {
            connection_id: connection_id.to_string(),
            from_device: DiscoveredDevice {
                device_id: format!("dev-{connection_id}"),
                device_name: "peer".to_string(),
                user_id: "u".to_string(),
                user_nickname: "n".to_string(),
                ip_address: "192.168.1.10".to_string(),
                port: SERVICE_PORT,
                discovered_at: "2026-08-21T00:00:00Z".to_string(),
                last_seen: "2026-08-21T00:00:00Z".to_string(),
            },
            requested_at,
        }
    }

    /// D-11a：过期判定边界 —— 刚插入不过期；TTL 前 1 秒不过期；
    /// 恰好到 TTL、超过 TTL 均过期
    #[test]
    fn peer_request_expiry_boundaries() {
        let now = utc_at(1_800_000_000);
        let ttl = PENDING_PEER_REQUEST_TTL_SECS;

        // 刚插入（elapsed = 0）：不过期
        assert!(!is_peer_request_expired(
            now,
            &now.to_rfc3339(),
            ttl
        ));
        // elapsed = TTL - 1：不过期
        assert!(!is_peer_request_expired(
            now,
            &(now - chrono::Duration::seconds(ttl - 1)).to_rfc3339(),
            ttl
        ));
        // elapsed = TTL（恰好到达）：过期
        assert!(is_peer_request_expired(
            now,
            &(now - chrono::Duration::seconds(ttl)).to_rfc3339(),
            ttl
        ));
        // elapsed = TTL + 1：过期
        assert!(is_peer_request_expired(
            now,
            &(now - chrono::Duration::seconds(ttl + 1)).to_rfc3339(),
            ttl
        ));
    }

    /// D-11a：requested_at 解析失败按**已过期**处理（fail-closed），
    /// 防止时间戳损坏的条目永久残留、被对端重连时复活弹 UI
    #[test]
    fn peer_request_with_unparsable_timestamp_is_treated_expired() {
        let now = utc_at(1_800_000_000);
        for garbage in ["", "not-a-timestamp", "2026-13-99T99:99:99Z"] {
            assert!(
                is_peer_request_expired(now, garbage, PENDING_PEER_REQUEST_TTL_SECS),
                "解析失败的 requested_at 应按过期处理: {garbage:?}"
            );
        }
    }

    /// D-11a：惰性清扫 —— 只移除过期项（含时间戳损坏项），新鲜项保留
    #[test]
    fn sweep_removes_only_expired_peer_requests() {
        let now = utc_at(1_800_000_000);
        let ttl = PENDING_PEER_REQUEST_TTL_SECS;

        let mut map = HashMap::new();
        map.insert(
            "fresh".to_string(),
            peer_request("fresh", (now - chrono::Duration::seconds(1)).to_rfc3339()),
        );
        map.insert(
            "stale".to_string(),
            peer_request("stale", (now - chrono::Duration::seconds(ttl + 1)).to_rfc3339()),
        );
        map.insert(
            "garbage".to_string(),
            peer_request("garbage", "not-a-timestamp".to_string()),
        );

        let removed = sweep_expired_peer_requests_locked(&mut map, now);
        assert_eq!(removed, 2, "stale 与 garbage 应被清扫");
        assert!(map.contains_key("fresh"), "新鲜请求必须保留");
        assert!(!map.contains_key("stale"));
        assert!(!map.contains_key("garbage"));
    }

    /// D-11c：单行上限判定 —— 正常请求行 / 头行 / 恰好到上限放行，超过 1 字节即拒
    #[test]
    fn header_line_over_limit_boundaries() {
        // 正常请求行、常见头行（远小于 16KB）：不受影响
        assert!(!header_line_over_limit(0));
        assert!(!header_line_over_limit(b"GET /api/info HTTP/1.1\r\n".len()));
        assert!(!header_line_over_limit(b"Content-Type: application/json\r\n".len()));
        // 恰好到上限：放行
        assert!(!header_line_over_limit(MAX_HEADER_LINE_BYTES));
        // 超过上限 1 字节（take(MAX+1) 读满即此情形）：拒绝
        assert!(header_line_over_limit(MAX_HEADER_LINE_BYTES + 1));
        assert!(header_line_over_limit(1 << 20));
    }

    /// D-11c：正常请求逐行读取行为不变（请求行、头行、头部结束空行）
    #[tokio::test]
    async fn limited_line_reader_passes_normal_request_headers() {
        let raw: &[u8] =
            b"POST /api/peer-connection-request HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\n";
        let mut reader = BufReader::new(raw);
        assert_eq!(
            read_header_line_limited(&mut reader).await.unwrap().unwrap(),
            "POST /api/peer-connection-request HTTP/1.1\r\n"
        );
        assert_eq!(
            read_header_line_limited(&mut reader).await.unwrap().unwrap(),
            "Content-Type: application/json\r\n"
        );
        assert_eq!(
            read_header_line_limited(&mut reader).await.unwrap().unwrap(),
            "Content-Length: 5\r\n"
        );
        // 头部结束的空行
        assert_eq!(
            read_header_line_limited(&mut reader).await.unwrap().unwrap(),
            "\r\n"
        );
    }

    /// D-11c：恰好 16KB（含换行符）的行放行，不被误杀
    #[tokio::test]
    async fn limited_line_reader_accepts_line_exactly_at_limit() {
        let mut line = vec![b'a'; MAX_HEADER_LINE_BYTES - 1];
        line.push(b'\n');
        let mut reader = BufReader::new(line.as_slice());
        let got = read_header_line_limited(&mut reader).await.unwrap().unwrap();
        assert_eq!(got.len(), MAX_HEADER_LINE_BYTES);
    }

    /// D-11c：超限行（有换行 / 无换行直到 EOF）都判超限，调用方不再继续解析
    #[tokio::test]
    async fn limited_line_reader_rejects_oversize_lines() {
        // 超限 + 换行：读满 MAX+1 即判超限
        let mut raw = vec![b'a'; MAX_HEADER_LINE_BYTES + 42];
        raw.push(b'\n');
        let mut reader = BufReader::new(raw.as_slice());
        assert!(read_header_line_limited(&mut reader).await.unwrap().is_none());

        // 超限且无换行直到 EOF：同样判超限（内存不再随行长膨胀）
        let raw = vec![b'b'; MAX_HEADER_LINE_BYTES + 7];
        let mut reader = BufReader::new(raw.as_slice());
        assert!(read_header_line_limited(&mut reader).await.unwrap().is_none());
    }

    /// D-11c：对端关闭且无数据 → 空串（沿用原有 400 路径），不是超限
    #[tokio::test]
    async fn limited_line_reader_returns_empty_line_on_eof() {
        let mut reader = BufReader::new(&b""[..]);
        let got = read_header_line_limited(&mut reader).await.unwrap().unwrap();
        assert_eq!(got, "");
    }
}
