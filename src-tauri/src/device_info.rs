//! 设备信息模块
//!
//! 提供获取设备 MAC 地址等信息的功能，用于登录时标识设备

use mac_address::get_mac_address;

/// 获取本机 MAC 地址
///
/// 返回格式：`XX:XX:XX:XX:XX:XX`
/// 如果获取失败，返回 `None`
///
/// # 示例
///
/// ```text
/// 前端调用: await invoke<string | null>('get_mac_address')
/// 返回: "00:1A:2B:3C:4D:5E" 或 null
/// ```
#[tauri::command]
pub fn get_mac_address_cmd() -> Option<String> {
    match get_mac_address() {
        Ok(Some(addr)) => {
            let mac = addr
                .bytes()
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(":");
            println!("[DeviceInfo] MAC 地址: {}", mac);
            Some(mac)
        }
        Ok(None) => {
            println!("[DeviceInfo] 未找到网络接口");
            None
        }
        Err(e) => {
            println!("[DeviceInfo] 获取 MAC 地址失败: {}", e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_mac_address() {
        // MAC 地址可能获取成功或失败，但不应该 panic
        let result = get_mac_address_cmd();
        if let Some(mac) = result {
            // 验证格式：XX:XX:XX:XX:XX:XX
            assert_eq!(mac.len(), 17);
            assert_eq!(mac.matches(':').count(), 5);
        }
    }
}

