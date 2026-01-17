//! macOS 平台媒体权限处理
//!
//! 提供 macOS 的权限设置打开和修复指南
//!
//! ## URI Scheme
//! - `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera`
//! - `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
//! - `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
//!
//! ## tccutil 命令
//! - `tccutil reset Camera` - 重置摄像头权限
//! - `tccutil reset Microphone` - 重置麦克风权限
//! - `tccutil reset ScreenCapture` - 重置屏幕录制权限
//!
//! ## 官方文档
//! - https://developer.apple.com/documentation/bundleresources/information_property_list/nscamerausagedescription

use super::types::{MediaPermissionType, PermissionFixCommand, PermissionGuide};
use std::process::Command;

/// 打开 macOS 系统设置页面
pub fn open_settings(permission_type: MediaPermissionType) -> Result<(), String> {
    let pane = match permission_type {
        MediaPermissionType::Camera => "Privacy_Camera",
        MediaPermissionType::Microphone => "Privacy_Microphone",
        MediaPermissionType::ScreenCapture => "Privacy_ScreenCapture",
    };

    let uri = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        pane
    );

    Command::new("open")
        .arg(&uri)
        .spawn()
        .map_err(|e| format!("无法打开设置: {}", e))?;

    Ok(())
}

/// 获取 macOS 权限修复指南
pub fn get_guide(permission_type: MediaPermissionType) -> PermissionGuide {
    let (name, pane, tcc_type) = match permission_type {
        MediaPermissionType::Camera => ("摄像头", "Privacy_Camera", "Camera"),
        MediaPermissionType::Microphone => ("麦克风", "Privacy_Microphone", "Microphone"),
        MediaPermissionType::ScreenCapture => {
            ("屏幕录制", "Privacy_ScreenCapture", "ScreenCapture")
        }
    };

    let uri = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        pane
    );

    let commands = vec![
        PermissionFixCommand {
            description: format!("打开{}权限设置", name),
            command: format!("open \"{}\"", uri),
            requires_admin: false,
            requires_restart: false,
        },
        PermissionFixCommand {
            description: format!("重置{}权限（下次访问重新弹窗询问）", name),
            command: format!("tccutil reset {}", tcc_type),
            requires_admin: false,
            requires_restart: true,
        },
    ];

    PermissionGuide {
        os: "macOS".into(),
        permission_name: name.into(),
        steps: vec![
            "方法一：点击「打开设置」，在列表中找到本应用并勾选".into(),
            "方法二：复制下方 tccutil 命令在终端执行，重置权限后重启应用".into(),
            "重置后下次使用会重新弹出权限请求窗口".into(),
        ],
        fix_commands: commands,
        can_open_settings: true,
        settings_path: format!("系统设置 → 隐私与安全性 → {}", name),
        settings_uri: Some(uri),
    }
}
