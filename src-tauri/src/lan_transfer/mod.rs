/*!
 * 局域网文件互传模块
 *
 * 实现局域网内设备发现和文件传输功能
 *
 * 功能：
 * - mDNS 服务广播与发现：自动发现局域网内运行该软件的设备
 * - 设备信息展示：显示设备名称和登录用户
 * - 连接确认：双向确认机制确保安全
 * - 文件传输：支持大文件分块传输、校验、断点续传
 *
 * 模块结构：
 * - discovery: mDNS 设备发现
 * - protocol: 协议定义（消息类型、数据结构）
 * - server: HTTP 服务器（接收文件）
 * - transfer: 文件传输逻辑
 *
 * @see https://github.com/localsend/protocol 参考 LocalSend 协议
 */

pub mod config;
pub mod diagnostics;
pub mod discovery;
pub mod protocol;
pub mod resume;
pub mod server;
pub mod transfer;

use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;

pub use protocol::{
    ConnectionRequest, DiscoveredDevice, DeviceInfo,
    PeerConnection, PeerConnectionRequest,
    TransferRequest, TransferSession, TransferTask,
};

// ============================================================================
// 全局 AppHandle 管理
// ============================================================================

/// 全局 AppHandle 用于发送事件到前端
static APP_HANDLE: OnceCell<tauri::AppHandle> = OnceCell::new();

/// 设置全局 AppHandle
pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// 获取全局 AppHandle
pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

/// 向前端发送局域网传输事件
pub fn emit_lan_event(event: &protocol::LanTransferEvent) {
    if let Some(handle) = get_app_handle()
        && let Err(e) = handle.emit("lan-transfer-event", event)
    {
        eprintln!("[LanTransfer] 发送事件失败: {}", e);
    }
}

// ============================================================================
// 全局状态管理
// ============================================================================

/// 局域网传输服务状态
pub struct LanTransferState {
    /// 发现的设备列表
    pub devices: RwLock<HashMap<String, DiscoveredDevice>>,
    /// 待处理的连接请求
    pub pending_requests: RwLock<HashMap<String, ConnectionRequest>>,
    /// 当前传输任务
    pub active_transfers: RwLock<HashMap<String, TransferTask>>,
    /// 本机设备信息
    pub local_device: RwLock<Option<DeviceInfo>>,
    /// 服务是否正在运行
    pub is_running: RwLock<bool>,
}

impl LanTransferState {
    pub fn new() -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
            pending_requests: RwLock::new(HashMap::new()),
            active_transfers: RwLock::new(HashMap::new()),
            local_device: RwLock::new(None),
            is_running: RwLock::new(false),
        }
    }
}

impl Default for LanTransferState {
    fn default() -> Self {
        Self::new()
    }
}

/// 全局状态单例
static LAN_TRANSFER_STATE: OnceCell<Arc<LanTransferState>> = OnceCell::new();

/// 获取全局状态
pub fn get_lan_transfer_state() -> Arc<LanTransferState> {
    LAN_TRANSFER_STATE
        .get_or_init(|| Arc::new(LanTransferState::new()))
        .clone()
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 启动局域网传输服务
#[tauri::command]
pub async fn start_lan_transfer_service(
    user_id: String,
    user_nickname: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    set_app_handle(app_handle);

    discovery::start_service(user_id, user_nickname)
        .await
        .map_err(|e| e.to_string())
}

/// 停止局域网传输服务
#[tauri::command]
pub async fn stop_lan_transfer_service() -> Result<(), String> {
    discovery::stop_service().await.map_err(|e| e.to_string())
}

/// 获取发现的设备列表
#[tauri::command]
pub fn get_discovered_devices() -> Vec<DiscoveredDevice> {
    let state = get_lan_transfer_state();
    let devices = state.devices.read();
    devices.values().cloned().collect()
}

/// 发送连接请求
#[tauri::command]
pub async fn send_connection_request(device_id: String) -> Result<String, String> {
    transfer::send_connection_request(&device_id)
        .await
        .map_err(|e| e.to_string())
}

/// 响应连接请求
#[tauri::command]
pub async fn respond_to_connection_request(
    request_id: String,
    accept: bool,
) -> Result<(), String> {
    transfer::respond_to_request(&request_id, accept)
        .await
        .map_err(|e| e.to_string())
}

/// 发送文件
#[tauri::command]
pub async fn send_file_to_device(
    device_id: String,
    file_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    transfer::send_file(&device_id, &file_path, app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// 获取待处理的连接请求
#[tauri::command]
pub fn get_pending_connection_requests() -> Vec<ConnectionRequest> {
    let state = get_lan_transfer_state();
    let requests = state.pending_requests.read();
    requests.values().cloned().collect()
}

/// 获取当前传输任务列表
#[tauri::command]
pub fn get_active_transfers() -> Vec<TransferTask> {
    let state = get_lan_transfer_state();
    let transfers = state.active_transfers.read();
    transfers.values().cloned().collect()
}

/// 取消传输任务
#[tauri::command]
pub async fn cancel_transfer(transfer_id: String) -> Result<(), String> {
    transfer::cancel_transfer(&transfer_id)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// 点对点连接命令（新版）
// ============================================================================

/// 请求建立点对点连接
#[tauri::command]
pub async fn request_peer_connection(device_id: String) -> Result<String, String> {
    transfer::request_peer_connection(&device_id)
        .await
        .map_err(|e| e.to_string())
}

/// 响应点对点连接请求
#[tauri::command]
pub async fn respond_peer_connection(
    connection_id: String,
    accept: bool,
) -> Result<(), String> {
    transfer::respond_peer_connection(&connection_id, accept)
        .await
        .map_err(|e| e.to_string())
}

/// 断开点对点连接
#[tauri::command]
pub async fn disconnect_peer(connection_id: String) -> Result<(), String> {
    transfer::disconnect_peer(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取活跃的点对点连接
#[tauri::command]
pub fn get_active_peer_connections() -> Vec<PeerConnection> {
    transfer::get_active_peer_connections()
}

/// 获取待处理的连接请求
#[tauri::command]
pub fn get_pending_peer_connection_requests() -> Vec<PeerConnectionRequest> {
    transfer::get_pending_peer_connection_requests()
}

/// 向已连接的设备发送文件（无需再次确认）
#[tauri::command]
pub async fn send_files_to_peer(
    connection_id: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    transfer::send_files_to_peer(&connection_id, file_paths)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// 传输命令（旧版兼容）
// ============================================================================

/// 发送传输请求（需要对方确认）
#[tauri::command]
pub async fn send_transfer_request(
    device_id: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    transfer::send_transfer_request(&device_id, file_paths)
        .await
        .map_err(|e| e.to_string())
}

/// 响应传输请求
#[tauri::command]
pub async fn respond_to_transfer_request(
    request_id: String,
    accept: bool,
) -> Result<(), String> {
    transfer::respond_to_transfer_request(&request_id, accept)
        .await
        .map_err(|e| e.to_string())
}

/// 获取待处理的传输请求
#[tauri::command]
pub fn get_pending_transfer_requests() -> Vec<TransferRequest> {
    let requests = server::get_pending_transfer_requests_map();
    let requests = requests.lock();
    requests.values().cloned().collect()
}

/// 获取传输会话
#[tauri::command]
pub fn get_transfer_session(request_id: String) -> Option<TransferSession> {
    transfer::get_transfer_session(&request_id)
}

/// 获取所有活跃会话
#[tauri::command]
pub fn get_all_transfer_sessions() -> Vec<TransferSession> {
    transfer::get_all_sessions()
}

/// 取消传输会话
#[tauri::command]
pub async fn cancel_transfer_session(request_id: String) -> Result<(), String> {
    transfer::cancel_session(&request_id)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// 配置管理命令
// ============================================================================

/// 获取保存目录
#[tauri::command]
pub fn get_lan_transfer_save_directory() -> String {
    config::get_save_directory().to_string_lossy().to_string()
}

/// 设置保存目录
#[tauri::command]
pub async fn set_lan_transfer_save_directory(path: String) -> Result<(), String> {
    config::set_save_directory(std::path::PathBuf::from(path)).map_err(|e| e.to_string())
}

/// 打开保存目录（在文件管理器中）
#[tauri::command]
pub async fn open_lan_transfer_directory() -> Result<(), String> {
    let save_dir = config::get_save_directory();

    // 确保目录存在
    std::fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;

    // 使用系统默认方式打开目录
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&save_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&save_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&save_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 获取完整配置
#[tauri::command]
pub fn get_lan_transfer_config() -> config::LanTransferConfig {
    config::get_full_config()
}

/// 添加信任设备
#[tauri::command]
pub fn add_trusted_device(device_id: String, device_name: String) -> Result<(), String> {
    config::add_trusted_device(device_id, device_name).map_err(|e| e.to_string())
}

/// 移除信任设备
#[tauri::command]
pub fn remove_trusted_device(device_id: String) -> Result<(), String> {
    config::remove_trusted_device(&device_id).map_err(|e| e.to_string())
}

/// 获取信任设备列表
#[tauri::command]
pub fn get_trusted_devices() -> Vec<config::TrustedDevice> {
    config::get_trusted_devices()
}

/// 设置自动接受信任设备
#[tauri::command]
pub fn set_auto_accept_trusted(enabled: bool) -> Result<(), String> {
    config::set_auto_accept_trusted(enabled).map_err(|e| e.to_string())
}

/// 设置按日期分组
#[tauri::command]
pub fn set_group_by_date(enabled: bool) -> Result<(), String> {
    config::set_group_by_date(enabled).map_err(|e| e.to_string())
}

// ============================================================================
// 调试命令
// ============================================================================

/// 获取局域网调试信息
#[tauri::command]
pub fn get_lan_debug_info() -> Result<serde_json::Value, String> {
    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|e| format!("Error: {}", e));

    let interfaces: Vec<(String, String)> = local_ip_address::list_afinet_netifas()
        .map(|list| {
            list.into_iter()
                .map(|(name, ip)| (name, ip.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let device_id = mac_address::get_mac_address()
        .map(|opt| {
            opt.map(|mac| mac.to_string().replace(':', ""))
                .unwrap_or_else(|| "Unknown".to_string())
        })
        .unwrap_or_else(|e| format!("Error: {}", e));

    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    let os = std::env::consts::OS.to_string();

    Ok(serde_json::json!({
        "local_ip": local_ip,
        "interfaces": interfaces,
        "device_id": device_id,
        "hostname": hostname,
        "os": os
    }))
}
