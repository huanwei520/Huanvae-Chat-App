//! Android 平台诊断模块
//!
//! 检查项：
//! - A1: 网络权限
//! - A2: 组播权限
//! - A3: 附近设备权限（Android 13+）
//! - A4: MulticastLock 状态
//! - A5: WiFi 连接状态
//!
//! # 注意
//!
//! Android 的大部分检测需要通过前端 JavaScript 或 Tauri 移动端插件完成。
//! 此模块主要提供检查项结构定义和文档说明。
//!
//! # 参考文档
//!
//! - [Android NSD 文档](https://developer.android.com/develop/connectivity/wifi/use-nsd)
//! - [Android WifiManager](https://developer.android.com/reference/android/net/wifi/WifiManager)

use super::types::*;

/// Android 诊断器
///
/// 由于 Android 平台的限制，大部分检测需要在前端完成。
/// 此诊断器主要返回检查项的静态说明。
pub struct AndroidDiagnostician;

impl AndroidDiagnostician {
    /// 创建新的 Android 诊断器实例
    pub fn new() -> Self {
        Self
    }

    /// 获取所有 Android 平台检查项说明
    fn get_check_items() -> Vec<DiagItem> {
        vec![
            DiagItem {
                id: "A1".into(),
                name: "网络权限".into(),
                category: DiagCategory::Permission,
                description: "INTERNET 和网络状态权限".into(),
                status: DiagStatus::Unknown,
                details: "需要通过前端检测".into(),
                fix_suggestion: Some("在 AndroidManifest.xml 中声明权限".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "确保 AndroidManifest.xml 包含:".into(),
                    "<uses-permission android:name=\"android.permission.INTERNET\" />".into(),
                    "<uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\" />"
                        .into(),
                    "<uses-permission android:name=\"android.permission.ACCESS_WIFI_STATE\" />"
                        .into(),
                ]),
                doc_url: Some(
                    "https://developer.android.com/training/basics/network-ops/connecting".into(),
                ),
            },
            DiagItem {
                id: "A2".into(),
                name: "组播权限".into(),
                category: DiagCategory::Permission,
                description: "CHANGE_WIFI_MULTICAST_STATE 权限（mDNS 必需）".into(),
                status: DiagStatus::Unknown,
                details: "需要通过前端检测".into(),
                fix_suggestion: Some("添加组播状态权限".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "在 AndroidManifest.xml 添加:".into(),
                    "<uses-permission android:name=\"android.permission.CHANGE_WIFI_MULTICAST_STATE\" />".into(),
                ]),
                doc_url: Some(
                    "https://developer.android.com/reference/android/net/wifi/WifiManager#createMulticastLock(java.lang.String)".into(),
                ),
            },
            DiagItem {
                id: "A3".into(),
                name: "附近设备权限".into(),
                category: DiagCategory::Permission,
                description: "Android 13+ 需要 NEARBY_WIFI_DEVICES 权限".into(),
                status: DiagStatus::Unknown,
                details: "需要通过前端检测".into(),
                fix_suggestion: Some("添加附近设备权限（Android 13+）".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "在 AndroidManifest.xml 添加:".into(),
                    "<uses-permission android:name=\"android.permission.NEARBY_WIFI_DEVICES\" />"
                        .into(),
                    "运行时请求此权限".into(),
                ]),
                doc_url: Some(
                    "https://developer.android.com/develop/connectivity/wifi/use-nsd".into(),
                ),
            },
            DiagItem {
                id: "A4".into(),
                name: "MulticastLock".into(),
                category: DiagCategory::Service,
                description: "WiFi 组播锁（接收 mDNS 广播必需）".into(),
                status: DiagStatus::Unknown,
                details: "需要在应用代码中获取".into(),
                fix_suggestion: Some("在代码中获取 MulticastLock".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "获取 WifiManager:".into(),
                    "WifiManager wifi = (WifiManager) getSystemService(WIFI_SERVICE);".into(),
                    "创建锁: MulticastLock lock = wifi.createMulticastLock(\"mdns\");".into(),
                    "获取锁: lock.acquire();".into(),
                    "使用完毕释放: lock.release();".into(),
                ]),
                doc_url: Some(
                    "https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock".into(),
                ),
            },
            DiagItem {
                id: "A5".into(),
                name: "WiFi 连接".into(),
                category: DiagCategory::Network,
                description: "设备需要连接到 WiFi 网络".into(),
                status: DiagStatus::Unknown,
                details: "需要通过前端检测".into(),
                fix_suggestion: Some("确保设备已连接到 WiFi".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "打开设置 → WiFi".into(),
                    "连接到与其他设备相同的 WiFi 网络".into(),
                    "确保路由器未开启 AP 隔离".into(),
                ]),
                doc_url: None,
            },
        ]
    }
}

impl Default for AndroidDiagnostician {
    fn default() -> Self {
        Self::new()
    }
}

impl Diagnostician for AndroidDiagnostician {
    async fn diagnose(&self) -> DiagReport {
        // Android 的实际检测需要在前端完成
        // 这里返回静态的检查项说明
        let items = Self::get_check_items();

        DiagReport::from_items("Android".into(), "需前端检测".into(), items)
    }
}
