//! Linux (Ubuntu) 平台媒体权限处理
//!
//! 提供 Ubuntu 的权限修复指南和命令
//!
//! ## 常用命令
//! - `sudo usermod -aG video $USER` - 添加用户到 video 组
//! - `sudo usermod -aG audio $USER` - 添加用户到 audio 组
//! - `gnome-control-center privacy` - 打开 GNOME 隐私设置
//!
//! ## 注意事项
//! - Linux 没有统一的权限 URI scheme
//! - 权限管理因桌面环境而异 (GNOME/KDE)
//! - Flatpak/Snap 应用有额外的沙盒权限限制

use super::types::{MediaPermissionType, PermissionFixCommand, PermissionGuide};
use std::process::Command;

/// 尝试打开 Linux 系统设置
pub fn open_settings(permission_type: MediaPermissionType) -> Result<(), String> {
    // 尝试 GNOME 设置
    let panel = match permission_type {
        MediaPermissionType::Camera | MediaPermissionType::Microphone => "privacy",
        MediaPermissionType::ScreenCapture => "privacy",
    };

    // 尝试多种桌面环境的设置程序
    let attempts = [
        ("gnome-control-center", vec![panel]),
        ("systemsettings5", vec![]), // KDE
    ];

    for (app, args) in attempts {
        if Command::new(app).args(&args).spawn().is_ok() {
            return Ok(());
        }
    }

    Err("无法打开系统设置，请手动打开".into())
}

/// 获取 Linux (Ubuntu) 权限修复指南
pub fn get_guide(permission_type: MediaPermissionType) -> PermissionGuide {
    let (name, commands) = match permission_type {
        MediaPermissionType::Camera => (
            "摄像头",
            vec![
                PermissionFixCommand {
                    description: "添加用户到 video 组（获取摄像头访问权限）".into(),
                    command: "sudo usermod -aG video $USER".into(),
                    requires_admin: true,
                    requires_restart: true,
                },
                PermissionFixCommand {
                    description: "检查摄像头设备是否存在".into(),
                    command: "ls -la /dev/video*".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "加载摄像头驱动（UVC）".into(),
                    command: "sudo modprobe uvcvideo".into(),
                    requires_admin: true,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "打开 GNOME 隐私设置".into(),
                    command: "gnome-control-center privacy".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
            ],
        ),
        MediaPermissionType::Microphone => (
            "麦克风",
            vec![
                PermissionFixCommand {
                    description: "添加用户到 audio 组".into(),
                    command: "sudo usermod -aG audio $USER".into(),
                    requires_admin: true,
                    requires_restart: true,
                },
                PermissionFixCommand {
                    description: "检查 PipeWire 服务状态".into(),
                    command: "systemctl --user status pipewire".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "重启 PipeWire 音频服务".into(),
                    command: "systemctl --user restart pipewire pipewire-pulse".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "打开 GNOME 隐私设置".into(),
                    command: "gnome-control-center privacy".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
            ],
        ),
        MediaPermissionType::ScreenCapture => (
            "屏幕共享",
            vec![
                PermissionFixCommand {
                    description: "检查 PipeWire 服务状态（Wayland 屏幕共享依赖）".into(),
                    command: "systemctl --user status pipewire".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "重启 PipeWire 服务".into(),
                    command: "systemctl --user restart pipewire pipewire-pulse wireplumber".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
                PermissionFixCommand {
                    description: "安装 xdg-desktop-portal（如未安装）".into(),
                    command: "sudo apt install xdg-desktop-portal xdg-desktop-portal-gtk".into(),
                    requires_admin: true,
                    requires_restart: true,
                },
                PermissionFixCommand {
                    description: "打开 GNOME 隐私设置".into(),
                    command: "gnome-control-center privacy".into(),
                    requires_admin: false,
                    requires_restart: false,
                },
            ],
        ),
    };

    PermissionGuide {
        os: "Linux (Ubuntu)".into(),
        permission_name: name.into(),
        steps: vec![
            "Ubuntu 权限管理因桌面环境而异".into(),
            "请根据您的系统选择合适的命令执行".into(),
            "执行需要 sudo 的命令后，需要注销并重新登录".into(),
        ],
        fix_commands: commands,
        can_open_settings: true,
        settings_path: "系统设置 → 隐私".into(),
        settings_uri: None,
    }
}
