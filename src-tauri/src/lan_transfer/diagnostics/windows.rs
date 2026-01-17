//! Windows 平台诊断模块
//!
//! 检查项：
//! - W1: 网络接口状态
//! - W2: 网络类型（公用/专用）
//! - W3: mDNS 防火墙规则 (UDP 5353)
//! - W4: 传输端口防火墙规则 (TCP 53317)
//! - W5: DNS Client 服务状态
//!
//! # 参考文档
//!
//! - [Windows 防火墙配置](https://learn.microsoft.com/zh-cn/windows/security/threat-protection/windows-firewall/)
//! - [Windows mDNS 支持](https://techcommunity.microsoft.com/blog/networkingblog/mdns-in-the-enterprise/3275777)

use super::types::*;
use crate::lan_transfer::protocol::SERVICE_PORT;
use std::process::Command;

/// Windows 诊断器
pub struct WindowsDiagnostician;

impl WindowsDiagnostician {
    /// 创建新的 Windows 诊断器实例
    pub fn new() -> Self {
        Self
    }

    /// W1: 检查网络接口
    ///
    /// 验证本机是否有有效的局域网 IP 地址
    async fn check_network_interface(&self) -> DiagItem {
        match local_ip_address::local_ip() {
            Ok(ip) => {
                let ip_str = ip.to_string();
                let is_private = ip_str.starts_with("192.168.")
                    || ip_str.starts_with("10.")
                    || (ip_str.starts_with("172.")
                        && ip_str
                            .split('.')
                            .nth(1)
                            .and_then(|s| s.parse::<u8>().ok())
                            .map(|n| (16..=31).contains(&n))
                            .unwrap_or(false));

                DiagItem {
                    id: "W1".into(),
                    name: "网络接口".into(),
                    category: DiagCategory::Network,
                    description: "检测本机是否有有效的局域网 IP 地址".into(),
                    status: if is_private {
                        DiagStatus::Ok
                    } else {
                        DiagStatus::Warning
                    },
                    details: format!("本机 IP: {}", ip_str),
                    fix_suggestion: if !is_private {
                        Some("检测到的 IP 可能不是局域网地址，请确认已连接到局域网".into())
                    } else {
                        None
                    },
                    fix_command: None,
                    fix_steps: None,
                    doc_url: None,
                }
            }
            Err(e) => DiagItem {
                id: "W1".into(),
                name: "网络接口".into(),
                category: DiagCategory::Network,
                description: "检测本机是否有有效的局域网 IP 地址".into(),
                status: DiagStatus::Error,
                details: format!("无法获取本机 IP: {}", e),
                fix_suggestion: Some("请检查网络连接，确保已连接到局域网（WiFi 或有线）".into()),
                fix_command: None,
                fix_steps: Some(vec![
                    "检查网线是否连接或 WiFi 是否已连接".into(),
                    "打开「设置 → 网络和 Internet」查看连接状态".into(),
                ]),
                doc_url: None,
            },
        }
    }

    /// W2: 检查网络类型（公用/专用）
    ///
    /// 公用网络默认策略更严格，可能阻止局域网功能
    async fn check_network_profile(&self) -> DiagItem {
        let output = Command::new("powershell")
            .args([
                "-Command",
                "Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory",
            ])
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();

                if stdout.contains("Private") || stdout.contains("DomainAuthenticated") {
                    DiagItem {
                        id: "W2".into(),
                        name: "网络类型".into(),
                        category: DiagCategory::Network,
                        description: "检测网络是否设置为专用网络".into(),
                        status: DiagStatus::Ok,
                        details: format!("当前网络类型: {}", stdout),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    DiagItem {
                        id: "W2".into(),
                        name: "网络类型".into(),
                        category: DiagCategory::Network,
                        description: "检测网络是否设置为专用网络".into(),
                        status: DiagStatus::Warning,
                        details: format!("当前网络类型: {} (公用网络限制更严格)", stdout),
                        fix_suggestion: Some("将网络类型改为「专用」以启用局域网功能".into()),
                        fix_command: Some(
                            "Set-NetConnectionProfile -NetworkCategory Private".into(),
                        ),
                        fix_steps: Some(vec![
                            "打开「设置 → 网络和 Internet → 以太网/WiFi」".into(),
                            "点击当前连接的网络".into(),
                            "将「网络配置文件类型」改为「专用」".into(),
                        ]),
                        doc_url: Some(
                            "https://support.microsoft.com/zh-cn/windows/make-a-wi-fi-network-public-or-private-in-windows-0460117d-8d3e-a7ac-f003-7a0da607448d".into(),
                        ),
                    }
                }
            }
            Err(_) => DiagItem {
                id: "W2".into(),
                name: "网络类型".into(),
                category: DiagCategory::Network,
                description: "检测网络是否设置为专用网络".into(),
                status: DiagStatus::Unknown,
                details: "无法检测网络类型".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// W3: 检查 mDNS 防火墙规则
    async fn check_mdns_firewall(&self) -> DiagItem {
        self.check_firewall_rule(
            "W3",
            "mDNS 防火墙规则",
            "mDNS",
            "UDP",
            5353,
            "设备发现功能使用的 UDP 5353 端口",
        )
        .await
    }

    /// W4: 检查传输端口防火墙规则
    async fn check_transfer_firewall(&self) -> DiagItem {
        self.check_firewall_rule(
            "W4",
            "传输端口防火墙规则",
            "LAN Transfer",
            "TCP",
            SERVICE_PORT,
            &format!("文件传输服务使用的 TCP {} 端口", SERVICE_PORT),
        )
        .await
    }

    /// 通用防火墙规则检查方法
    async fn check_firewall_rule(
        &self,
        id: &str,
        name: &str,
        rule_name: &str,
        protocol: &str,
        port: u16,
        description: &str,
    ) -> DiagItem {
        let output = Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "show",
                "rule",
                &format!("name={}", rule_name),
            ])
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);
                let has_rule = stdout.contains("Rule Name") || stdout.contains("规则名称");
                let is_enabled = (stdout.contains("Enabled:") && stdout.contains("Yes"))
                    || (stdout.contains("已启用:") && stdout.contains("是"));

                if has_rule && is_enabled {
                    DiagItem {
                        id: id.into(),
                        name: name.into(),
                        category: DiagCategory::Firewall,
                        description: description.into(),
                        status: DiagStatus::Ok,
                        details: format!("防火墙规则「{}」已启用", rule_name),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    let cmd = format!(
                        "netsh advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol={} localport={}",
                        rule_name, protocol, port
                    );
                    DiagItem {
                        id: id.into(),
                        name: name.into(),
                        category: DiagCategory::Firewall,
                        description: description.into(),
                        status: DiagStatus::Warning,
                        details: if has_rule {
                            format!("防火墙规则「{}」存在但未启用", rule_name)
                        } else {
                            format!("未找到防火墙规则「{}」", rule_name)
                        },
                        fix_suggestion: Some("需要添加或启用防火墙入站规则".into()),
                        fix_command: Some(cmd),
                        fix_steps: Some(vec![
                            "以管理员身份打开 PowerShell".into(),
                            "执行上方命令添加防火墙规则".into(),
                            "或：打开「Windows 安全中心 → 防火墙和网络保护 → 高级设置」".into(),
                            format!(
                                "在「入站规则」中添加允许 {} {} 端口的规则",
                                protocol, port
                            ),
                        ]),
                        doc_url: Some(
                            "https://learn.microsoft.com/zh-cn/windows/security/threat-protection/windows-firewall/".into(),
                        ),
                    }
                }
            }
            Err(e) => DiagItem {
                id: id.into(),
                name: name.into(),
                category: DiagCategory::Firewall,
                description: description.into(),
                status: DiagStatus::Unknown,
                details: format!("无法检查防火墙规则: {}", e),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// W5: 检查 DNS Client 服务
    ///
    /// Windows 10 1803+ 的 mDNS 支持依赖此服务
    async fn check_dns_client_service(&self) -> DiagItem {
        let output = Command::new("sc").args(["query", "Dnscache"]).output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);

                if stdout.contains("RUNNING") || stdout.contains("正在运行") {
                    DiagItem {
                        id: "W5".into(),
                        name: "DNS Client 服务".into(),
                        category: DiagCategory::Service,
                        description: "Windows mDNS 支持依赖 DNS Client 服务".into(),
                        status: DiagStatus::Ok,
                        details: "DNS Client 服务正在运行".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    DiagItem {
                        id: "W5".into(),
                        name: "DNS Client 服务".into(),
                        category: DiagCategory::Service,
                        description: "Windows mDNS 支持依赖 DNS Client 服务".into(),
                        status: DiagStatus::Error,
                        details: "DNS Client 服务未运行".into(),
                        fix_suggestion: Some("启动 DNS Client 服务以支持 mDNS".into()),
                        fix_command: Some("net start Dnscache".into()),
                        fix_steps: Some(vec![
                            "以管理员身份打开命令提示符".into(),
                            "运行：net start Dnscache".into(),
                        ]),
                        doc_url: Some(
                            "https://techcommunity.microsoft.com/blog/networkingblog/mdns-in-the-enterprise/3275777".into(),
                        ),
                    }
                }
            }
            Err(_) => DiagItem {
                id: "W5".into(),
                name: "DNS Client 服务".into(),
                category: DiagCategory::Service,
                description: "Windows mDNS 支持依赖 DNS Client 服务".into(),
                status: DiagStatus::Unknown,
                details: "无法检查服务状态".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }
}

impl Default for WindowsDiagnostician {
    fn default() -> Self {
        Self::new()
    }
}

impl Diagnostician for WindowsDiagnostician {
    async fn diagnose(&self) -> DiagReport {
        let mut items = Vec::new();

        items.push(self.check_network_interface().await);
        items.push(self.check_network_profile().await);
        items.push(self.check_mdns_firewall().await);
        items.push(self.check_transfer_firewall().await);
        items.push(self.check_dns_client_service().await);

        // 获取 Windows 版本
        let os_version = Command::new("cmd")
            .args(["/c", "ver"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();

        DiagReport::from_items("Windows".into(), os_version, items)
    }
}
