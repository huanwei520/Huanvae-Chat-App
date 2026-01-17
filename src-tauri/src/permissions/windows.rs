//! Windows 平台媒体权限处理
//!
//! 提供 Windows 10/11 的权限设置打开和修复指南
//!
//! ## URI Scheme
//! - `ms-settings:privacy-webcam` - 摄像头隐私设置
//! - `ms-settings:privacy-microphone` - 麦克风隐私设置
//! - `ms-settings:privacy-graphicscapture` - 屏幕捕获设置 (Win11)
//!
//! ## 官方文档
//! - https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings

use super::types::{MediaPermissionType, PermissionFixCommand, PermissionGuide};
use std::process::Command;

/// 打开 Windows 系统设置页面
pub fn open_settings(permission_type: MediaPermissionType) -> Result<(), String> {
    let uri = match permission_type {
        MediaPermissionType::Camera => "ms-settings:privacy-webcam",
        MediaPermissionType::Microphone => "ms-settings:privacy-microphone",
        MediaPermissionType::ScreenCapture => "ms-settings:privacy-graphicscapture",
    };

    Command::new("cmd")
        .args(["/C", "start", uri])
        .spawn()
        .map_err(|e| format!("无法打开设置: {}", e))?;

    Ok(())
}

/// 获取 Windows 权限修复指南
pub fn get_guide(permission_type: MediaPermissionType) -> PermissionGuide {
    let (name, uri, commands) = match permission_type {
        MediaPermissionType::Camera => (
            "摄像头",
            "ms-settings:privacy-webcam",
            vec![PermissionFixCommand {
                description: "打开摄像头隐私设置".into(),
                command: "start ms-settings:privacy-webcam".into(),
                requires_admin: false,
                requires_restart: false,
            }],
        ),
        MediaPermissionType::Microphone => (
            "麦克风",
            "ms-settings:privacy-microphone",
            vec![PermissionFixCommand {
                description: "打开麦克风隐私设置".into(),
                command: "start ms-settings:privacy-microphone".into(),
                requires_admin: false,
                requires_restart: false,
            }],
        ),
        MediaPermissionType::ScreenCapture => (
            "屏幕共享",
            "ms-settings:privacy-graphicscapture",
            vec![PermissionFixCommand {
                description: "打开屏幕捕获隐私设置".into(),
                command: "start ms-settings:privacy-graphicscapture".into(),
                requires_admin: false,
                requires_restart: false,
            }],
        ),
    };

    PermissionGuide {
        os: "Windows".into(),
        permission_name: name.into(),
        steps: vec![
            "点击下方命令复制并在终端执行，或点击「打开设置」按钮".into(),
            format!("在「{}」页面，确保「允许应用访问」已开启", name),
            "向下滚动，找到本应用并开启权限".into(),
            "返回应用，重新操作".into(),
        ],
        fix_commands: commands,
        can_open_settings: true,
        settings_path: format!("设置 → 隐私与安全 → {}", name),
        settings_uri: Some(uri.into()),
    }
}
