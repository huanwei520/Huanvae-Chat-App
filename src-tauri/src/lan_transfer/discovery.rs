/*!
 * mDNS 设备发现模块
 *
 * 使用 mDNS/DNS-SD 协议在局域网内广播和发现设备
 *
 * 功能：
 * - 广播本机服务信息（设备名、用户信息、端口）
 * - 监听局域网内其他设备的广播
 * - 维护发现的设备列表
 * - 设备上下线通知
 * - 定期验证设备在线状态（解决强制杀掉应用无法检测的问题）
 * - 设备信息自动更新（包括 IP 地址变化）
 *
 * 设备下线检测机制：
 * - mDNS ServiceRemoved 事件：当设备正常关闭时触发
 * - 主动验证任务：定期对已发现设备调用 mDNS verify()
 * - 验证失败计数：连续失败 MAX_VERIFY_FAILURES 次后主动移除设备
 *
 * 设备信息更新机制：
 * - 当设备重新上线时（如重启服务），会收到新的 ServiceResolved 事件
 * - 无论是新设备还是已存在设备，都会发送 DeviceDiscovered 事件通知前端
 * - 这确保前端始终拥有最新的设备信息（特别是可能变化的 IP 地址）
 *
 * 关键映射关系：
 * - fullname -> device_id：mDNS fullname 使用截断后的 instance_name（最多15字符），
 *   而设备列表使用完整的 device_id（32字符 UUID），需要映射表进行转换
 *
 * 更新日志：
 * - 2026-01-25: 修复设备 IP 地址不更新问题，设备重新上线时也发送事件通知前端
 */

use super::protocol::{DeviceInfo, DiscoveredDevice, LanTransferEvent, PROTOCOL_VERSION, SERVICE_PORT, SERVICE_TYPE};
use super::{emit_lan_event, get_lan_transfer_state, server};
use chrono::Utc;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::broadcast;

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum DiscoveryError {
    #[error("mDNS 服务启动失败: {0}")]
    ServiceStartFailed(String),
    #[error("获取本地 IP 失败: {0}")]
    LocalIpError(String),
    #[allow(dead_code)]
    #[error("获取 MAC 地址失败: {0}")]
    MacAddressError(String),
    #[allow(dead_code)]
    #[error("服务已在运行")]
    AlreadyRunning,
    #[error("服务未运行")]
    NotRunning,
}

// ============================================================================
// 全局单例
// ============================================================================

/// mDNS 服务守护进程
static MDNS_DAEMON: OnceCell<Arc<Mutex<Option<ServiceDaemon>>>> = OnceCell::new();

/// 验证任务运行标志
static VERIFY_TASK_RUNNING: OnceCell<Arc<std::sync::atomic::AtomicBool>> = OnceCell::new();

/// 设备验证间隔（秒）
const DEVICE_VERIFY_INTERVAL_SECS: u64 = 5;

/// 设备验证超时（秒）
const DEVICE_VERIFY_TIMEOUT_SECS: u64 = 3;

/// 最大验证失败次数，超过后主动移除设备
const MAX_VERIFY_FAILURES: u32 = 3;

/// mDNS fullname 到完整 device_id 的映射
/// 由于 mDNS instance_name 限制为 15 字符，而 device_id 为 32 字符 UUID，
/// 需要此映射表来正确处理 ServiceRemoved 事件
static FULLNAME_TO_DEVICE_ID: OnceCell<Arc<Mutex<HashMap<String, String>>>> = OnceCell::new();

/// 设备验证失败计数器
/// key: device_id, value: 连续失败次数
static VERIFY_FAILURE_COUNT: OnceCell<Arc<Mutex<HashMap<String, u32>>>> = OnceCell::new();

/// 获取 fullname 到 device_id 的映射表
fn get_fullname_to_device_id_map() -> Arc<Mutex<HashMap<String, String>>> {
    FULLNAME_TO_DEVICE_ID
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 获取验证失败计数器
fn get_verify_failure_count_map() -> Arc<Mutex<HashMap<String, u32>>> {
    VERIFY_FAILURE_COUNT
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// 事件广播通道
static EVENT_SENDER: OnceCell<broadcast::Sender<LanTransferEvent>> = OnceCell::new();

/// 获取事件发送器
pub fn get_event_sender() -> broadcast::Sender<LanTransferEvent> {
    EVENT_SENDER
        .get_or_init(|| {
            let (tx, _) = broadcast::channel(100);
            tx
        })
        .clone()
}

/// 订阅事件
#[allow(dead_code)]
pub fn subscribe_events() -> broadcast::Receiver<LanTransferEvent> {
    get_event_sender().subscribe()
}

/// 获取验证任务运行标志
fn get_verify_task_flag() -> Arc<std::sync::atomic::AtomicBool> {
    VERIFY_TASK_RUNNING
        .get_or_init(|| Arc::new(std::sync::atomic::AtomicBool::new(false)))
        .clone()
}

// ============================================================================
// 服务管理
// ============================================================================

/// 启动局域网传输服务
pub async fn start_service(
    user_id: String,
    user_nickname: String,
    custom_device_name: Option<String>,
) -> Result<(), DiscoveryError> {
    let state = get_lan_transfer_state();

    println!("[LanTransfer] ========== 启动服务 ==========");
    println!("[LanTransfer] 用户: {} ({})", user_nickname, user_id);

    // 检查是否已在运行，如果是则先停止
    let was_running = {
        let is_running = state.is_running.read();
        *is_running
    };

    if was_running {
        println!("[LanTransfer] ⚠ 服务已在运行，正在重启...");
        let _ = stop_service().await; // 先停止服务
        println!("[LanTransfer] ✓ 旧服务已停止");
    }

    // 获取本地 IP 地址
    println!("[LanTransfer] 正在获取本地 IP 地址...");
    let local_ip = local_ip_address::local_ip()
        .map_err(|e| {
            println!("[LanTransfer] ❌ 获取本地 IP 失败: {}", e);
            DiscoveryError::LocalIpError(e.to_string())
        })?;
    println!("[LanTransfer] ✓ 本地 IP: {}", local_ip);

    // 列出所有网络接口
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        println!("[LanTransfer] 所有网络接口:");
        for (name, ip) in interfaces {
            println!("[LanTransfer]   - {}: {}", name, ip);
        }
    }

    // 获取设备 ID（UUID）
    println!("[LanTransfer] 正在获取设备 ID...");
    let device_id = get_device_id()?;
    println!("[LanTransfer] ✓ 设备 ID: {}", device_id);

    // 获取设备名称（优先使用前端传入的，否则使用 hostname）
    let device_name = custom_device_name
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "Unknown".to_string())
        });
    println!("[LanTransfer] ✓ 设备名称: {}", device_name);

    // 获取操作系统信息
    let os = std::env::consts::OS.to_string();
    println!("[LanTransfer] ✓ 操作系统: {}", os);

    // 构建本机设备信息
    let device_info = DeviceInfo {
        device_id: device_id.clone(),
        device_name: device_name.clone(),
        user_id: user_id.clone(),
        user_nickname: user_nickname.clone(),
        ip_address: local_ip.to_string(),
        port: SERVICE_PORT,
        version: PROTOCOL_VERSION.to_string(),
        os,
    };

    // 保存本机信息
    {
        let mut local_device = state.local_device.write();
        *local_device = Some(device_info.clone());
    }

    // 创建 mDNS 服务守护进程
    println!("[LanTransfer] 正在创建 mDNS 服务...");
    let mdns = ServiceDaemon::new()
        .map_err(|e| {
            println!("[LanTransfer] ❌ mDNS 服务创建失败: {}", e);
            DiscoveryError::ServiceStartFailed(e.to_string())
        })?;
    println!("[LanTransfer] ✓ mDNS 服务已创建");

    // 创建服务信息
    let mut properties = HashMap::new();
    properties.insert("device_id".to_string(), device_id.clone());
    properties.insert("device_name".to_string(), device_name.clone());
    properties.insert("user_id".to_string(), user_id.clone());
    properties.insert("user_nickname".to_string(), user_nickname);
    properties.insert("version".to_string(), PROTOCOL_VERSION.to_string());

    // mDNS 要求主机名必须以 .local. 结尾
    // 将主机名中的非法字符替换为连字符，并添加 .local. 后缀
    // 同时确保名称不超过 15 字节（NetBIOS 兼容性要求）
    let safe_hostname: String = device_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .take(15)  // 截断到 15 字符
        .collect();
    let host_name = format!("{}.local.", safe_hostname);

    // 服务实例名称也需要限制在 15 字节以内
    let instance_name: String = device_id.chars().take(15).collect();

    println!("[LanTransfer] mDNS 配置:");
    println!("[LanTransfer]   服务类型: {}", SERVICE_TYPE);
    println!("[LanTransfer]   实例名称: {} (原: {})", instance_name, device_id);
    println!("[LanTransfer]   主机名: {} (原: {})", host_name, device_name);
    println!("[LanTransfer]   端口: {}", SERVICE_PORT);
    println!("[LanTransfer]   IP 地址: {}", local_ip);

    // 直接使用检测到的本地 IP 地址注册服务
    let service_info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,  // 使用截断后的实例名称
        &host_name,
        local_ip,
        SERVICE_PORT,
        properties,
    )
    .map_err(|e| {
        println!("[LanTransfer] ❌ 创建 ServiceInfo 失败: {}", e);
        DiscoveryError::ServiceStartFailed(e.to_string())
    })?;

    println!("[LanTransfer] ✓ ServiceInfo 已创建");

    // 监控服务注册状态
    let monitor_receiver = mdns.monitor()
        .map_err(|e| {
            println!("[LanTransfer] ❌ 启动监控失败: {}", e);
            DiscoveryError::ServiceStartFailed(e.to_string())
        })?;

    // 注册服务
    println!("[LanTransfer] 正在注册 mDNS 服务...");
    let fullname = service_info.get_fullname().to_string();
    mdns.register(service_info.clone())
        .map_err(|e| {
            println!("[LanTransfer] ❌ 注册服务失败: {}", e);
            DiscoveryError::ServiceStartFailed(e.to_string())
        })?;
    println!("[LanTransfer] ✓ mDNS 服务注册请求已提交 (fullname: {})", fullname);

    // 等待服务注册完成（最多 5 秒）
    println!("[LanTransfer] 等待服务注册确认...");
    let start = std::time::Instant::now();
    let mut registered = false;
    while start.elapsed() < std::time::Duration::from_secs(5) {
        match monitor_receiver.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(event) => {
                println!("[LanTransfer] 📬 Monitor 事件: {:?}", event);
                // DaemonEvent::Announce 表示服务公告已发送
                if format!("{:?}", event).contains("Announce") {
                    println!("[LanTransfer] ✅ 检测到服务公告事件");
                    registered = true;
                    break;
                }
            }
            Err(e) => {
                if format!("{:?}", e).contains("Disconnected") {
                    break;
                }
                // Timeout: continue waiting
                continue;
            }
        }
    }
    
    if registered {
        println!("[LanTransfer] ✓ mDNS 服务公告已发送");
    } else {
        println!("[LanTransfer] ⚠️ 服务公告确认超时（5秒），继续运行...");
    }

    // 开始浏览服务
    println!("[LanTransfer] 正在启动服务浏览...");
    let browse_receiver = mdns
        .browse(SERVICE_TYPE)
        .map_err(|e| {
            println!("[LanTransfer] ❌ 启动浏览失败: {}", e);
            DiscoveryError::ServiceStartFailed(e.to_string())
        })?;
    println!("[LanTransfer] ✓ 服务浏览已启动");

    // 保存 mDNS 守护进程
    let daemon_holder = MDNS_DAEMON.get_or_init(|| Arc::new(Mutex::new(None)));
    {
        let mut daemon = daemon_holder.lock();
        *daemon = Some(mdns);
    }

    // 启动 HTTP 服务器
    println!("[LanTransfer] 正在启动 HTTP 服务器 (端口 {})...", SERVICE_PORT);
    let server_device_info = device_info.clone();
    tokio::spawn(async move {
        if let Err(e) = server::start_server(server_device_info).await {
            eprintln!("[LanTransfer] ❌ HTTP 服务器启动失败: {}", e);
        }
    });

    // 启动事件监听任务
    let my_device_id = device_id.clone();
    tokio::spawn(async move {
        handle_mdns_events(browse_receiver, my_device_id).await;
    });

    // 启动设备验证任务（定期检测设备是否在线）
    let verify_flag = get_verify_task_flag();
    verify_flag.store(true, std::sync::atomic::Ordering::SeqCst);
    let verify_device_id = device_id.clone();
    tokio::spawn(async move {
        run_device_verify_task(verify_device_id).await;
    });

    // 标记服务已启动
    {
        let mut is_running = state.is_running.write();
        *is_running = true;
    }

    // 发送服务状态变化事件
    let event = LanTransferEvent::ServiceStateChanged { is_running: true };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!("[LanTransfer] ========================================");
    println!("[LanTransfer] ✅ 服务启动成功!");
    println!("[LanTransfer]   设备: {} ({})", device_info.device_name, device_info.ip_address);
    println!("[LanTransfer]   端口: {}", SERVICE_PORT);
    println!("[LanTransfer]   设备验证间隔: {}秒", DEVICE_VERIFY_INTERVAL_SECS);
    println!("[LanTransfer]   等待发现其他设备...");
    println!("[LanTransfer] ========================================");

    Ok(())
}

/// 停止局域网传输服务
///
/// 执行以下清理操作：
/// 1. 停止设备验证任务
/// 2. 断开所有活跃的点对点连接
/// 3. 停止 mDNS 服务
/// 4. 停止 HTTP 服务器
/// 5. 清空设备列表和连接状态
pub async fn stop_service() -> Result<(), DiscoveryError> {
    let state = get_lan_transfer_state();

    // 检查是否在运行
    {
        let is_running = state.is_running.read();
        if !*is_running {
            return Err(DiscoveryError::NotRunning);
        }
    }

    // 停止设备验证任务
    {
        let verify_flag = get_verify_task_flag();
        verify_flag.store(false, std::sync::atomic::Ordering::SeqCst);
        println!("[LanTransfer] 设备验证任务已停止");
    }

    // 断开所有活跃的点对点连接
    {
        let connections = server::get_active_peer_connections_map();
        let connection_ids: Vec<String> = {
            let conns = connections.lock();
            conns.keys().cloned().collect()
        };

        for conn_id in connection_ids {
            println!("[LanTransfer] 断开连接: {}", conn_id);
            // 发送连接关闭事件
            let event = LanTransferEvent::PeerConnectionClosed {
                connection_id: conn_id.clone(),
            };
            let _ = get_event_sender().send(event.clone());
            emit_lan_event(&event);
        }

        // 清空连接列表
        let mut conns = connections.lock();
        conns.clear();
    }

    // 清空待处理的连接请求
    {
        let requests = server::get_pending_peer_connection_requests_map();
        let mut reqs = requests.lock();
        reqs.clear();
    }

    // 停止 mDNS 服务
    if let Some(daemon_holder) = MDNS_DAEMON.get() {
        let mut daemon = daemon_holder.lock();
        if let Some(mdns) = daemon.take() {
            let _ = mdns.shutdown();
        }
    }

    // 停止 HTTP 服务器
    server::stop_server().await;

    // 清空设备列表
    {
        let mut devices = state.devices.write();
        devices.clear();
    }

    // 清空 fullname 到 device_id 的映射
    {
        let map = get_fullname_to_device_id_map();
        let mut map = map.lock();
        map.clear();
    }

    // 清空验证失败计数器
    {
        let map = get_verify_failure_count_map();
        let mut map = map.lock();
        map.clear();
    }

    // 清空本机信息
    {
        let mut local_device = state.local_device.write();
        *local_device = None;
    }

    // 标记服务已停止
    {
        let mut is_running = state.is_running.write();
        *is_running = false;
    }

    // 发送服务状态变化事件
    let event = LanTransferEvent::ServiceStateChanged { is_running: false };
    let _ = get_event_sender().send(event.clone());
    emit_lan_event(&event);

    println!("[LanTransfer] 服务已停止");

    Ok(())
}

// ============================================================================
// 内部函数
// ============================================================================

/// 获取设备唯一标识（UUID）
///
/// 使用持久化的 UUID 作为设备标识，确保重启应用后 ID 保持一致
fn get_device_id() -> Result<String, DiscoveryError> {
    get_or_create_device_uuid()
}

/// 获取或创建设备 UUID（Android 备用方案）
///
/// 使用文件持久化，确保重启应用后 ID 保持一致
fn get_or_create_device_uuid() -> Result<String, DiscoveryError> {
    use std::fs;

    // 获取存储路径
    let uuid_file = get_uuid_storage_path();

    // 尝试读取已存储的 UUID
    if uuid_file.exists()
        && let Ok(stored) = fs::read_to_string(&uuid_file)
    {
        let uuid = stored.trim().to_string();
        if !uuid.is_empty() {
            println!("[LanTransfer] 使用已存储的设备 UUID: {}", &uuid[..8.min(uuid.len())]);
            return Ok(uuid);
        }
    }

    // 生成新的 UUID
    let new_uuid = uuid::Uuid::new_v4().to_string().replace('-', "");
    println!("[LanTransfer] 生成新的设备 UUID: {}", &new_uuid[..8]);

    // 确保父目录存在
    if let Some(parent) = uuid_file.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 保存 UUID
    if let Err(e) = fs::write(&uuid_file, &new_uuid) {
        println!("[LanTransfer] 警告: 保存设备 UUID 失败: {}", e);
        // 即使保存失败，仍然返回生成的 UUID（本次运行有效）
    }

    Ok(new_uuid)
}

/// 获取 UUID 存储路径
fn get_uuid_storage_path() -> PathBuf {
    // Android：使用应用数据目录
    #[cfg(target_os = "android")]
    {
        crate::user_data::get_app_root().join(".lan_device_uuid")
    }

    // 桌面端：使用用户数据目录
    #[cfg(not(target_os = "android"))]
    {
        if let Some(data_dir) = dirs::data_local_dir() {
            data_dir.join("huanvae-chat").join(".lan_device_uuid")
        } else {
            PathBuf::from(".lan_device_uuid")
        }
    }
}

/// 处理 mDNS 事件
async fn handle_mdns_events(
    receiver: mdns_sd::Receiver<ServiceEvent>,
    my_device_id: String,
) {
    let state = get_lan_transfer_state();
    let event_sender = get_event_sender();

    println!("[LanTransfer] mDNS 事件监听已启动，等待设备广播...");
    println!("[LanTransfer] 本机设备 ID: {}", my_device_id);

    let mut event_count = 0u64;

    loop {
        match receiver.recv() {
            Ok(event) => {
                event_count += 1;
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        println!("[LanTransfer] ────────────────────────────────");
                        println!("[LanTransfer] 📡 收到 ServiceResolved 事件 #{}", event_count);
                        println!("[LanTransfer]   全名: {}", info.get_fullname());
                        println!("[LanTransfer]   主机: {}", info.get_hostname());
                        println!("[LanTransfer]   端口: {}", info.get_port());

                        // 打印所有地址
                        let addresses: Vec<_> = info.get_addresses().iter().collect();
                        println!("[LanTransfer]   地址数量: {}", addresses.len());
                        for (i, addr) in addresses.iter().enumerate() {
                            println!("[LanTransfer]   地址[{}]: {}", i, addr);
                        }

                        // 打印所有属性
                        let properties = info.get_properties();
                        println!("[LanTransfer]   属性:");
                        for prop in properties.iter() {
                            println!("[LanTransfer]     {}: {:?}", prop.key(), prop.val_str());
                        }

                        let device_id = properties
                            .get_property_val_str("device_id")
                            .unwrap_or_default()
                            .to_string();

                        // 忽略自己
                        if device_id == my_device_id {
                            println!("[LanTransfer]   ⏭️ 跳过：这是本机设备");
                            continue;
                        }

                        if device_id.is_empty() {
                            println!("[LanTransfer]   ⚠️ 警告：device_id 为空，可能是其他 mDNS 服务");
                            continue;
                        }

                        let device_name = properties
                            .get_property_val_str("device_name")
                            .unwrap_or_default()
                            .to_string();

                        let user_id = properties
                            .get_property_val_str("user_id")
                            .unwrap_or_default()
                            .to_string();

                        let user_nickname = properties
                            .get_property_val_str("user_nickname")
                            .unwrap_or_default()
                            .to_string();

                        // 获取 IP 地址（优先选择 IPv4）
                        let ip_address = info
                            .get_addresses()
                            .iter()
                            .find(|addr| addr.is_ipv4())
                            .or_else(|| info.get_addresses().iter().next())
                            .map(|addr| addr.to_string())
                            .unwrap_or_default();

                        let now = Utc::now().to_rfc3339();

                        let device = DiscoveredDevice {
                            device_id: device_id.clone(),
                            device_name: device_name.clone(),
                            user_id: user_id.clone(),
                            user_nickname: user_nickname.clone(),
                            ip_address: ip_address.clone(),
                            port: info.get_port(),
                            discovered_at: now.clone(),
                            last_seen: now,
                        };

                        // 保存 fullname 到 device_id 的映射
                        // 这对于正确处理 ServiceRemoved 事件至关重要
                        let fullname = info.get_fullname().to_string();
                        {
                            let map = get_fullname_to_device_id_map();
                            let mut map = map.lock();
                            map.insert(fullname.clone(), device_id.clone());
                            println!("[LanTransfer]   📝 保存映射: {} -> {}", fullname, device_id);
                        }

                        // 添加到设备列表
                        {
                            let mut devices = state.devices.write();
                            let is_new = !devices.contains_key(&device_id);
                            devices.insert(device_id.clone(), device.clone());

                            // 重置验证失败计数
                            {
                                let count_map = get_verify_failure_count_map();
                                let mut count_map = count_map.lock();
                                count_map.remove(&device_id);
                            }

                            if is_new {
                                println!("[LanTransfer] ✅ 发现新设备!");
                                println!("[LanTransfer]   名称: {}", device_name);
                                println!("[LanTransfer]   用户: {} ({})", user_nickname, user_id);
                                println!("[LanTransfer]   IP: {}:{}", ip_address, info.get_port());
                            } else {
                                // 设备重新响应，更新设备信息（包括可能变化的 IP 地址）
                                println!("[LanTransfer]   🔄 设备已存在，更新信息");
                                println!("[LanTransfer]   IP: {}:{}", ip_address, info.get_port());
                            }

                            // 无论新设备还是已存在设备，都发送事件通知前端
                            // 这样前端可以获取最新的设备信息（特别是 IP 地址可能变化）
                            let event = LanTransferEvent::DeviceDiscovered {
                                device: device.clone(),
                            };
                            let _ = event_sender.send(event.clone());
                            emit_lan_event(&event);
                        }
                    }
                    ServiceEvent::ServiceRemoved(service_type, fullname) => {
                        println!("[LanTransfer] ────────────────────────────────");
                        println!("[LanTransfer] 📴 收到 ServiceRemoved 事件 #{}", event_count);
                        println!("[LanTransfer]   类型: {}", service_type);
                        println!("[LanTransfer]   全名: {}", fullname);

                        // 使用映射表查找完整的 device_id
                        // 注意：mDNS fullname 使用截断后的 instance_name（最多15字符），
                        // 而设备列表使用完整的 device_id（32字符 UUID）
                        let device_id = {
                            let map = get_fullname_to_device_id_map();
                            let map = map.lock();
                            map.get(&fullname).cloned()
                        };

                        let device_id = match device_id {
                            Some(id) => {
                                println!("[LanTransfer]   📝 通过映射找到设备 ID: {}", id);
                                id
                            }
                            None => {
                                // 回退：尝试从 fullname 提取（可能是旧版本的设备）
                                let fallback_id = fullname.split('.').next().unwrap_or("").to_string();
                                println!("[LanTransfer]   ⚠️ 映射未找到，使用回退 ID: {}", fallback_id);
                                fallback_id
                            }
                        };

                        if device_id.is_empty() {
                            println!("[LanTransfer]   ⚠️ 无法确定设备 ID，跳过");
                            continue;
                        }

                        if device_id == my_device_id {
                            println!("[LanTransfer]   ⏭️ 跳过：这是本机设备");
                            continue;
                        }

                        // 从设备列表中移除
                        {
                            let mut devices = state.devices.write();
                            if devices.remove(&device_id).is_some() {
                                println!("[LanTransfer] ❌ 设备离线: {}", device_id);
                                
                                // 清理映射表
                                {
                                    let map = get_fullname_to_device_id_map();
                                    let mut map = map.lock();
                                    map.remove(&fullname);
                                }
                                
                                // 清理验证失败计数
                                {
                                    let count_map = get_verify_failure_count_map();
                                    let mut count_map = count_map.lock();
                                    count_map.remove(&device_id);
                                }

                                let event = LanTransferEvent::DeviceLeft {
                                    device_id: device_id.clone(),
                                };
                                let _ = event_sender.send(event.clone());
                                emit_lan_event(&event);
                            } else {
                                println!("[LanTransfer]   ℹ️ 设备不在列表中");
                            }
                        }
                    }
                    ServiceEvent::ServiceFound(service_type, fullname) => {
                        println!("[LanTransfer] 🔍 ServiceFound: {} - {}", service_type, fullname);
                    }
                    ServiceEvent::SearchStarted(service_type) => {
                        println!("[LanTransfer] 🚀 SearchStarted: {}", service_type);
                    }
                    ServiceEvent::SearchStopped(service_type) => {
                        println!("[LanTransfer] 🛑 SearchStopped: {}", service_type);
                    }
                    _ => {
                        // 其他事件类型（未来版本可能添加）
                    }
                }
            }
            Err(e) => {
                // 通道关闭，退出循环
                println!("[LanTransfer] ❌ mDNS 事件通道关闭: {}", e);
                break;
            }
        }
    }
    println!("[LanTransfer] mDNS 事件监听已结束，共处理 {} 个事件", event_count);
}

/// 设备验证任务
///
/// 定期验证已发现的设备是否仍然在线。
/// 这可以解决设备被强制杀掉（如手机杀后台）时无法检测的问题。
///
/// 工作原理：
/// 1. 每隔 DEVICE_VERIFY_INTERVAL_SECS 秒执行一次
/// 2. 对每个已发现的设备调用 mDNS verify() 方法
/// 3. 如果设备在 DEVICE_VERIFY_TIMEOUT_SECS 秒内没有响应，mDNS 会自动发送 ServiceRemoved 事件
/// 4. 如果连续验证失败 MAX_VERIFY_FAILURES 次，主动移除设备
///
/// 关键修复：
/// - 使用 fullname 到 device_id 的映射表获取正确的 fullname
/// - mDNS instance_name 限制为 15 字符，而 device_id 为 32 字符 UUID
/// - 验证失败计数器用于处理 mDNS verify 无法触发 ServiceRemoved 的情况
async fn run_device_verify_task(my_device_id: String) {
    use std::time::Duration;

    println!("[LanTransfer] 🔍 设备验证任务已启动");
    println!("[LanTransfer] 🔍 验证间隔: {}s, 超时: {}s, 最大失败次数: {}",
        DEVICE_VERIFY_INTERVAL_SECS, DEVICE_VERIFY_TIMEOUT_SECS, MAX_VERIFY_FAILURES);

    let verify_flag = get_verify_task_flag();
    let event_sender = get_event_sender();

    loop {
        // 检查是否应该停止
        if !verify_flag.load(std::sync::atomic::Ordering::SeqCst) {
            println!("[LanTransfer] 🔍 设备验证任务收到停止信号");
            break;
        }

        // 等待间隔
        tokio::time::sleep(Duration::from_secs(DEVICE_VERIFY_INTERVAL_SECS)).await;

        // 再次检查是否应该停止（避免在 sleep 期间服务已停止）
        if !verify_flag.load(std::sync::atomic::Ordering::SeqCst) {
            println!("[LanTransfer] 🔍 设备验证任务收到停止信号");
            break;
        }

        // 获取所有已发现的设备
        let state = get_lan_transfer_state();
        let device_ids: Vec<String> = {
            let devices = state.devices.read();
            devices.keys().cloned().collect()
        };

        if device_ids.is_empty() {
            continue;
        }

        // 获取 mDNS daemon
        let mdns_opt = {
            let daemon_guard = MDNS_DAEMON
                .get_or_init(|| Arc::new(Mutex::new(None)))
                .lock();
            daemon_guard.clone()
        };

        let mdns = match mdns_opt {
            Some(m) => m,
            None => {
                // mDNS 服务未运行，退出验证任务
                println!("[LanTransfer] 🔍 mDNS 服务未运行，验证任务退出");
                break;
            }
        };

        // 从映射表中获取所有 device_id 到 fullname 的反向映射
        let device_to_fullname: HashMap<String, String> = {
            let map = get_fullname_to_device_id_map();
            let map = map.lock();
            // 反转映射：device_id -> fullname
            map.iter()
                .map(|(fullname, device_id)| (device_id.clone(), fullname.clone()))
                .collect()
        };

        // 验证每个设备
        for device_id in device_ids {
            // 跳过自己
            if device_id == my_device_id {
                continue;
            }

            // 从映射表获取正确的 fullname
            let fullname = match device_to_fullname.get(&device_id) {
                Some(name) => name.clone(),
                None => {
                    // 没有找到映射，可能是旧版本设备或映射丢失
                    // 尝试使用截断后的 device_id 构建 fullname
                    let instance_name: String = device_id.chars().take(15).collect();
                    format!("{}.{}", instance_name, SERVICE_TYPE)
                }
            };

            // 调用 verify 方法，如果设备不响应会触发 ServiceRemoved 事件
            let verify_result = mdns.verify(
                fullname.clone(),
                Duration::from_secs(DEVICE_VERIFY_TIMEOUT_SECS),
            );

            match verify_result {
                Ok(_) => {
                    // 验证成功，重置失败计数
                    let count_map = get_verify_failure_count_map();
                    let mut count_map = count_map.lock();
                    if count_map.remove(&device_id).is_some() {
                        println!("[LanTransfer] 🔍 设备 {} 验证成功，重置失败计数", device_id);
                    }
                }
                Err(e) => {
                    // 验证失败，增加失败计数
                    let failure_count = {
                        let count_map = get_verify_failure_count_map();
                        let mut count_map = count_map.lock();
                        let count = count_map.entry(device_id.clone()).or_insert(0);
                        *count += 1;
                        *count
                    };

                    println!(
                        "[LanTransfer] 🔍 验证设备 {} 失败 ({}/{}): {}",
                        device_id, failure_count, MAX_VERIFY_FAILURES, e
                    );

                    // 如果连续失败次数超过阈值，主动移除设备
                    if failure_count >= MAX_VERIFY_FAILURES {
                        println!(
                            "[LanTransfer] 🔍 设备 {} 连续验证失败 {} 次，主动移除",
                            device_id, failure_count
                        );

                        // 从设备列表中移除
                        let removed = {
                            let mut devices = state.devices.write();
                            devices.remove(&device_id).is_some()
                        };

                        if removed {
                            // 清理映射表
                            {
                                let map = get_fullname_to_device_id_map();
                                let mut map = map.lock();
                                map.remove(&fullname);
                            }

                            // 清理验证失败计数
                            {
                                let count_map = get_verify_failure_count_map();
                                let mut count_map = count_map.lock();
                                count_map.remove(&device_id);
                            }

                            // 发送设备离线事件
                            let event = LanTransferEvent::DeviceLeft {
                                device_id: device_id.clone(),
                            };
                            let _ = event_sender.send(event.clone());
                            emit_lan_event(&event);

                            println!("[LanTransfer] ❌ 设备已主动移除: {}", device_id);
                        }
                    }
                }
            }
        }
    }

    println!("[LanTransfer] 🔍 设备验证任务已结束");
}