//! macOS 平台诊断模块
//!
//! 检查项：
//! - M1: 网络接口状态
//! - M2: 应用防火墙状态
//! - M3: 阻止所有传入连接选项
//! - M4: Bonjour 服务状态
//!
//! # 参考文档
//!
//! - [macOS 防火墙设置](https://support.apple.com/zh-cn/guide/mac-help/mh34041/mac)
//! - [Bonjour 开发者文档](https://developer.apple.com/bonjour/)

use super::types::*;
use std::process::Command;

/// macOS 诊断器
pub struct MacOSDiagnostician;

impl MacOSDiagnostician {
    /// 创建新的 macOS 诊断器实例
    pub fn new() -> Self {
        Self
    }

    /// M1: 检查网络接口
    async fn check_network_interface(&self) -> DiagItem {
        match local_ip_address::local_ip() {
            Ok(ip) => DiagItem {
                id: "M1".into(),
                name: "网络接口".into(),
                category: DiagCategory::Network,
                description: "检测本机局域网 IP 地址".into(),
                status: DiagStatus::Ok,
                details: format!("本机 IP: {}", ip),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
            Err(e) => DiagItem {
                id: "M1".into(),
                name: "网络接口".into(),
                category: DiagCategory::Network,
                description: "检测本机局域网 IP 地址".into(),
                status: DiagStatus::Error,
                details: format!("无法获取本机 IP: {}", e),
                fix_suggestion: Some("请检查网络连接".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "检查 WiFi 或有线网络连接".into(),
                    "打开「系统设置 → 网络」查看连接状态".into(),
                ]),
                doc_url: None,
            },
        }
    }

    /// M2: 检查应用防火墙状态
    async fn check_firewall_state(&self) -> DiagItem {
        let output = Command::new("/usr/libexec/ApplicationFirewall/socketfilterfw")
            .arg("--getglobalstate")
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);

                if stdout.contains("disabled") || stdout.contains("off") {
                    DiagItem {
                        id: "M2".into(),
                        name: "应用防火墙".into(),
                        category: DiagCategory::Firewall,
                        description: "macOS 应用防火墙状态".into(),
                        status: DiagStatus::Ok,
                        details: "应用防火墙已禁用".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    DiagItem {
                        id: "M2".into(),
                        name: "应用防火墙".into(),
                        category: DiagCategory::Firewall,
                        description: "macOS 应用防火墙状态".into(),
                        status: DiagStatus::Warning,
                        details: "应用防火墙已启用，请确保本应用被允许接收入站连接".into(),
                        fix_suggestion: Some("在防火墙设置中将本应用添加到允许列表".into()),
                        fix_command: None,
                        fix_steps: Some(vec![
                            "打开「系统设置 → 网络 → 防火墙」".into(),
                            "点击「选项...」".into(),
                            "点击「+」添加本应用".into(),
                            "确保「允许传入连接」已勾选".into(),
                        ]),
                        doc_url: Some(
                            "https://support.apple.com/zh-cn/guide/mac-help/mh34041/mac".into(),
                        ),
                    }
                }
            }
            Err(_) => DiagItem {
                id: "M2".into(),
                name: "应用防火墙".into(),
                category: DiagCategory::Firewall,
                description: "macOS 应用防火墙状态".into(),
                status: DiagStatus::Unknown,
                details: "无法检测防火墙状态".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// M3: 检查「阻止所有传入连接」选项
    ///
    /// 此选项会阻止所有非系统服务的入站连接，包括局域网传输
    async fn check_block_all(&self) -> DiagItem {
        let output = Command::new("/usr/libexec/ApplicationFirewall/socketfilterfw")
            .arg("--getblockall")
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);

                if stdout.contains("DISABLED") || stdout.contains("off") || stdout.contains("0") {
                    DiagItem {
                        id: "M3".into(),
                        name: "阻止所有传入连接".into(),
                        category: DiagCategory::Firewall,
                        description: "此选项会阻止所有非系统服务的入站连接".into(),
                        status: DiagStatus::Ok,
                        details: "「阻止所有传入连接」未启用".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    DiagItem {
                        id: "M3".into(),
                        name: "阻止所有传入连接".into(),
                        category: DiagCategory::Firewall,
                        description: "此选项会阻止所有非系统服务的入站连接".into(),
                        status: DiagStatus::Error,
                        details: "「阻止所有传入连接」已启用，这会阻止局域网传输功能".into(),
                        fix_suggestion: Some("关闭「阻止所有传入连接」选项".into()),
                        fix_command: Some(
                            "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setblockall off".into(),
                        ),
                        fix_steps: Some(vec![
                            "打开「系统设置 → 网络 → 防火墙 → 选项...」".into(),
                            "取消勾选「阻止所有传入连接」".into(),
                        ]),
                        doc_url: Some(
                            "https://support.apple.com/zh-cn/guide/mac-help/mh34041/mac".into(),
                        ),
                    }
                }
            }
            Err(_) => DiagItem {
                id: "M3".into(),
                name: "阻止所有传入连接".into(),
                category: DiagCategory::Firewall,
                description: "此选项会阻止所有非系统服务的入站连接".into(),
                status: DiagStatus::Unknown,
                details: "无法检测设置状态".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// M4: 检查 mDNSResponder 服务（Bonjour）
    ///
    /// macOS 内置的 mDNS 服务，通常默认运行
    async fn check_bonjour_service(&self) -> DiagItem {
        let output = Command::new("launchctl")
            .args(["list", "com.apple.mDNSResponder"])
            .output();

        match output {
            Ok(result) if result.status.success() => DiagItem {
                id: "M4".into(),
                name: "Bonjour 服务".into(),
                category: DiagCategory::Service,
                description: "macOS 内置 mDNS 服务 (mDNSResponder)".into(),
                status: DiagStatus::Ok,
                details: "mDNSResponder 服务正在运行".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: Some("https://developer.apple.com/bonjour/".into()),
            },
            _ => DiagItem {
                id: "M4".into(),
                name: "Bonjour 服务".into(),
                category: DiagCategory::Service,
                description: "macOS 内置 mDNS 服务 (mDNSResponder)".into(),
                status: DiagStatus::Warning,
                details: "mDNSResponder 服务状态异常".into(),
                fix_suggestion: Some("重启 mDNSResponder 服务".into()),
                fix_command: Some(
                    "sudo launchctl kickstart -k system/com.apple.mDNSResponder".into(),
                ),
                fix_steps: Some(vec![
                    "打开终端".into(),
                    "运行: sudo launchctl kickstart -k system/com.apple.mDNSResponder".into(),
                ]),
                doc_url: Some("https://developer.apple.com/bonjour/".into()),
            },
        }
    }

    /// 获取 macOS 版本
    fn get_os_version() -> String {
        Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|_| "macOS".into())
    }
}

impl Default for MacOSDiagnostician {
    fn default() -> Self {
        Self::new()
    }
}

impl Diagnostician for MacOSDiagnostician {
    async fn diagnose(&self) -> DiagReport {
        let mut items = Vec::new();

        items.push(self.check_network_interface().await);
        items.push(self.check_firewall_state().await);
        items.push(self.check_block_all().await);
        items.push(self.check_bonjour_service().await);

        DiagReport::from_items("macOS".into(), Self::get_os_version(), items)
    }
}
