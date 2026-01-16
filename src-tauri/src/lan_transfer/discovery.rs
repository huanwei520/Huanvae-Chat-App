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
 */

use super::protocol::{DeviceInfo, DiscoveredDevice, LanTransferEvent, PROTOCOL_VERSION, SERVICE_PORT, SERVICE_TYPE};
use super::{emit_lan_event, get_lan_transfer_state, server};
use chrono::Utc;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::collections::HashMap;
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
    #[error("获取 MAC 地址失败: {0}")]
    MacAddressError(String),
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

// ============================================================================
// 服务管理
// ============================================================================

/// 启动局域网传输服务
pub async fn start_service(user_id: String, user_nickname: String) -> Result<(), DiscoveryError> {
    let state = get_lan_transfer_state();

    println!("[LanTransfer] ========== 启动服务 ==========");
    println!("[LanTransfer] 用户: {} ({})", user_nickname, user_id);

    // 检查是否已在运行
    {
        let is_running = state.is_running.read();
        if *is_running {
            println!("[LanTransfer] ❌ 服务已在运行");
            return Err(DiscoveryError::AlreadyRunning);
        }
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

    // 获取设备 ID（基于 MAC 地址）
    println!("[LanTransfer] 正在获取 MAC 地址...");
    let device_id = get_device_id()?;
    println!("[LanTransfer] ✓ 设备 ID (MAC): {}", device_id);

    // 获取设备名称
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());
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
    println!("[LanTransfer]   等待发现其他设备...");
    println!("[LanTransfer] ========================================");

    Ok(())
}

/// 停止局域网传输服务
pub async fn stop_service() -> Result<(), DiscoveryError> {
    let state = get_lan_transfer_state();

    // 检查是否在运行
    {
        let is_running = state.is_running.read();
        if !*is_running {
            return Err(DiscoveryError::NotRunning);
        }
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

/// 获取设备唯一标识（基于 MAC 地址）
fn get_device_id() -> Result<String, DiscoveryError> {
    match mac_address::get_mac_address() {
        Ok(Some(mac)) => Ok(mac.to_string().replace(':', "")),
        Ok(None) => Err(DiscoveryError::MacAddressError("未找到 MAC 地址".to_string())),
        Err(e) => Err(DiscoveryError::MacAddressError(e.to_string())),
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

                        // 添加到设备列表
                        {
                            let mut devices = state.devices.write();
                            let is_new = !devices.contains_key(&device_id);
                            devices.insert(device_id.clone(), device.clone());

                            if is_new {
                                println!("[LanTransfer] ✅ 发现新设备!");
                                println!("[LanTransfer]   名称: {}", device_name);
                                println!("[LanTransfer]   用户: {} ({})", user_nickname, user_id);
                                println!("[LanTransfer]   IP: {}:{}", ip_address, info.get_port());
                                let event = LanTransferEvent::DeviceDiscovered {
                                    device: device.clone(),
                                };
                                let _ = event_sender.send(event.clone());
                                emit_lan_event(&event);
                            } else {
                                println!("[LanTransfer]   ℹ️ 设备已存在，更新信息");
                            }
                        }
                    }
                    ServiceEvent::ServiceRemoved(service_type, fullname) => {
                        println!("[LanTransfer] ────────────────────────────────");
                        println!("[LanTransfer] 📴 收到 ServiceRemoved 事件 #{}", event_count);
                        println!("[LanTransfer]   类型: {}", service_type);
                        println!("[LanTransfer]   全名: {}", fullname);

                        // 从设备列表中移除
                        let device_id = fullname.split('.').next().unwrap_or("").to_string();
                        println!("[LanTransfer]   设备 ID: {}", device_id);

                        if device_id == my_device_id {
                            println!("[LanTransfer]   ⏭️ 跳过：这是本机设备");
                            continue;
                        }

                        {
                            let mut devices = state.devices.write();
                            if devices.remove(&device_id).is_some() {
                                println!("[LanTransfer] ❌ 设备离线: {}", device_id);
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



