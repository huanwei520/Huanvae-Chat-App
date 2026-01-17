//! Linux 平台诊断模块
//!
//! 检查项：
//! - L1: 网络接口状态
//! - L2: avahi-daemon 服务状态
//! - L3: UFW 防火墙规则
//! - L4: firewalld 规则
//!
//! # 参考文档
//!
//! - [Avahi 官方文档](https://avahi.org/)
//! - [UFW 文档](https://help.ubuntu.com/community/UFW)
//! - [firewalld 文档](https://firewalld.org/documentation/)

use super::types::*;
use crate::lan_transfer::protocol::SERVICE_PORT;
use std::process::Command;

/// Linux 诊断器
pub struct LinuxDiagnostician;

impl LinuxDiagnostician {
    /// 创建新的 Linux 诊断器实例
    pub fn new() -> Self {
        Self
    }

    /// L1: 检查网络接口
    async fn check_network_interface(&self) -> DiagItem {
        match local_ip_address::local_ip() {
            Ok(ip) => DiagItem {
                id: "L1".into(),
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
                id: "L1".into(),
                name: "网络接口".into(),
                category: DiagCategory::Network,
                description: "检测本机局域网 IP 地址".into(),
                status: DiagStatus::Error,
                details: format!("无法获取本机 IP: {}", e),
                fix_suggestion: Some("请检查网络连接".into()),
                fix_command: Some("ip addr show".into()),
                fix_steps: Some(vec![
                    "检查网络连接状态".into(),
                    "运行 ip addr show 查看网络接口".into(),
                ]),
                doc_url: None,
            },
        }
    }

    /// L2: 检查 avahi-daemon 服务
    ///
    /// mDNS/DNS-SD 服务发现依赖此服务
    async fn check_avahi_service(&self) -> DiagItem {
        let output = Command::new("systemctl")
            .args(["is-active", "avahi-daemon"])
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();

                if stdout == "active" {
                    DiagItem {
                        id: "L2".into(),
                        name: "Avahi 服务".into(),
                        category: DiagCategory::Service,
                        description: "mDNS/DNS-SD 服务发现守护进程".into(),
                        status: DiagStatus::Ok,
                        details: "avahi-daemon 服务正在运行".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: Some("https://avahi.org/".into()),
                    }
                } else {
                    DiagItem {
                        id: "L2".into(),
                        name: "Avahi 服务".into(),
                        category: DiagCategory::Service,
                        description: "mDNS/DNS-SD 服务发现守护进程".into(),
                        status: DiagStatus::Error,
                        details: format!("avahi-daemon 状态: {}", stdout),
                        fix_suggestion: Some("安装并启动 avahi-daemon 服务".into()),
                        fix_command: Some(
                            "sudo apt install avahi-daemon && sudo systemctl enable --now avahi-daemon".into(),
                        ),
                        fix_steps: Some(vec![
                            "安装: sudo apt install avahi-daemon (Debian/Ubuntu)".into(),
                            "或: sudo dnf install avahi (Fedora)".into(),
                            "启动: sudo systemctl start avahi-daemon".into(),
                            "开机启动: sudo systemctl enable avahi-daemon".into(),
                        ]),
                        doc_url: Some("https://avahi.org/".into()),
                    }
                }
            }
            Err(_) => {
                // 尝试检查是否安装
                let installed = Command::new("which").arg("avahi-daemon").output();
                let is_installed = installed.map(|o| o.status.success()).unwrap_or(false);

                DiagItem {
                    id: "L2".into(),
                    name: "Avahi 服务".into(),
                    category: DiagCategory::Service,
                    description: "mDNS/DNS-SD 服务发现守护进程".into(),
                    status: if is_installed {
                        DiagStatus::Warning
                    } else {
                        DiagStatus::Error
                    },
                    details: if is_installed {
                        "avahi-daemon 已安装但未通过 systemctl 管理".into()
                    } else {
                        "avahi-daemon 未安装".into()
                    },
                    fix_suggestion: Some("安装 avahi-daemon".into()),
                    fix_command: Some("sudo apt install avahi-daemon".into()),
                    fix_steps: None,
                    doc_url: Some("https://avahi.org/".into()),
                }
            }
        }
    }

    /// L3: 检查 UFW 防火墙
    async fn check_ufw_firewall(&self) -> DiagItem {
        let status_output = Command::new("ufw").arg("status").output();

        match status_output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);

                if stdout.contains("inactive") || stdout.contains("Status: inactive") {
                    DiagItem {
                        id: "L3".into(),
                        name: "UFW 防火墙".into(),
                        category: DiagCategory::Firewall,
                        description: "Ubuntu/Debian 默认防火墙".into(),
                        status: DiagStatus::Ok,
                        details: "UFW 防火墙未启用，不会阻止连接".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    // UFW 已启用，检查是否有相关规则
                    let has_5353 = stdout.contains("5353");
                    let has_transfer = stdout.contains(&SERVICE_PORT.to_string());

                    if has_5353 && has_transfer {
                        DiagItem {
                            id: "L3".into(),
                            name: "UFW 防火墙".into(),
                            category: DiagCategory::Firewall,
                            description: "Ubuntu/Debian 默认防火墙".into(),
                            status: DiagStatus::Ok,
                            details: format!(
                                "UFW 已允许 mDNS (5353) 和传输端口 ({})",
                                SERVICE_PORT
                            ),
                            fix_suggestion: None,
                            fix_command: None,
                            fix_steps: None,
                            doc_url: None,
                        }
                    } else {
                        let mut missing = Vec::new();
                        if !has_5353 {
                            missing.push("5353/udp (mDNS)".to_string());
                        }
                        if !has_transfer {
                            missing.push(format!("{}/tcp (传输)", SERVICE_PORT));
                        }

                        DiagItem {
                            id: "L3".into(),
                            name: "UFW 防火墙".into(),
                            category: DiagCategory::Firewall,
                            description: "Ubuntu/Debian 默认防火墙".into(),
                            status: DiagStatus::Warning,
                            details: format!("UFW 已启用，缺少规则: {}", missing.join(", ")),
                            fix_suggestion: Some("需要允许 mDNS 和传输端口".into()),
                            fix_command: Some(format!(
                                "sudo ufw allow 5353/udp && sudo ufw allow {}/tcp",
                                SERVICE_PORT
                            )),
                            fix_steps: Some(vec![
                                "运行: sudo ufw allow 5353/udp".into(),
                                format!("运行: sudo ufw allow {}/tcp", SERVICE_PORT),
                                "重载: sudo ufw reload".into(),
                            ]),
                            doc_url: Some("https://help.ubuntu.com/community/UFW".into()),
                        }
                    }
                }
            }
            Err(_) => DiagItem {
                id: "L3".into(),
                name: "UFW 防火墙".into(),
                category: DiagCategory::Firewall,
                description: "Ubuntu/Debian 默认防火墙".into(),
                status: DiagStatus::Skipped,
                details: "UFW 未安装或无权限检测".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// L4: 检查 firewalld（RHEL/Fedora 系）
    async fn check_firewalld(&self) -> DiagItem {
        let status_output = Command::new("firewall-cmd").arg("--state").output();

        match status_output {
            Ok(result) if result.status.success() => {
                // firewalld 正在运行，检查 mDNS 服务
                let services = Command::new("firewall-cmd")
                    .arg("--list-services")
                    .output();

                let has_mdns = services
                    .map(|o| String::from_utf8_lossy(&o.stdout).contains("mdns"))
                    .unwrap_or(false);

                if has_mdns {
                    DiagItem {
                        id: "L4".into(),
                        name: "Firewalld".into(),
                        category: DiagCategory::Firewall,
                        description: "RHEL/Fedora 防火墙".into(),
                        status: DiagStatus::Ok,
                        details: "firewalld 已允许 mDNS 服务".into(),
                        fix_suggestion: None,
                        fix_command: None,
                        fix_steps: None,
                        doc_url: None,
                    }
                } else {
                    DiagItem {
                        id: "L4".into(),
                        name: "Firewalld".into(),
                        category: DiagCategory::Firewall,
                        description: "RHEL/Fedora 防火墙".into(),
                        status: DiagStatus::Warning,
                        details: "firewalld 未启用 mDNS 服务".into(),
                        fix_suggestion: Some("添加 mDNS 服务到 firewalld".into()),
                        fix_command: Some(
                            "sudo firewall-cmd --permanent --add-service=mdns && sudo firewall-cmd --reload".into(),
                        ),
                        fix_steps: Some(vec![
                            "运行: sudo firewall-cmd --permanent --add-service=mdns".into(),
                            format!(
                                "运行: sudo firewall-cmd --permanent --add-port={}/tcp",
                                SERVICE_PORT
                            ),
                            "重载: sudo firewall-cmd --reload".into(),
                        ]),
                        doc_url: Some(
                            "https://firewalld.org/documentation/howto/open-a-port-or-service.html"
                                .into(),
                        ),
                    }
                }
            }
            _ => DiagItem {
                id: "L4".into(),
                name: "Firewalld".into(),
                category: DiagCategory::Firewall,
                description: "RHEL/Fedora 防火墙".into(),
                status: DiagStatus::Skipped,
                details: "firewalld 未安装或未运行".into(),
                fix_suggestion: None,
                fix_command: None,
                fix_steps: None,
                doc_url: None,
            },
        }
    }

    /// 获取 Linux 发行版信息
    fn get_os_version() -> String {
        std::fs::read_to_string("/etc/os-release")
            .unwrap_or_default()
            .lines()
            .find(|l| l.starts_with("PRETTY_NAME="))
            .map(|l| {
                l.trim_start_matches("PRETTY_NAME=")
                    .trim_matches('"')
                    .to_string()
            })
            .unwrap_or_else(|| "Linux".into())
    }
}

impl Default for LinuxDiagnostician {
    fn default() -> Self {
        Self::new()
    }
}

impl Diagnostician for LinuxDiagnostician {
    async fn diagnose(&self) -> DiagReport {
        let mut items = Vec::new();

        items.push(self.check_network_interface().await);
        items.push(self.check_avahi_service().await);
        items.push(self.check_ufw_firewall().await);
        items.push(self.check_firewalld().await);

        DiagReport::from_items("Linux".into(), Self::get_os_version(), items)
    }
}
