//! 媒体权限管理模块
//!
//! 提供跨平台的媒体权限（摄像头、麦克风、屏幕共享）修复指南和系统设置打开功能。
//!
//! ## 支持平台
//! - Windows 10/11：通过 `ms-settings:` URI 打开隐私设置
//! - macOS：通过 `x-apple.systempreferences:` URI 打开设置，支持 `tccutil` 重置权限
//! - Linux (Ubuntu)：提供命令行修复方案（用户组、PipeWire 等）
//!
//! ## 使用方式
//! ```typescript
//! // 前端调用
//! const guide = await invoke('get_media_permission_guide', { permissionType: 'camera' });
//! await invoke('open_media_permission_settings', { permissionType: 'camera' });
//! ```

mod types;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod linux;

pub use types::{MediaPermissionType, PermissionGuide};

/// 打开系统媒体权限设置页面
///
/// 根据当前操作系统打开对应的权限设置页面：
/// - Windows: 通过 `ms-settings:` URI
/// - macOS: 通过 `x-apple.systempreferences:` URI
/// - Linux: 尝试打开 GNOME/KDE 设置
#[tauri::command]
pub fn open_media_permission_settings(permission_type: MediaPermissionType) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows::open_settings(permission_type)
    }

    #[cfg(target_os = "macos")]
    {
        macos::open_settings(permission_type)
    }

    #[cfg(target_os = "linux")]
    {
        linux::open_settings(permission_type)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = permission_type;
        Err("不支持的操作系统".into())
    }
}

/// 获取当前平台的权限修复指南
///
/// 返回包含修复步骤和可执行命令的指南结构
#[tauri::command]
pub fn get_media_permission_guide(permission_type: MediaPermissionType) -> PermissionGuide {
    #[cfg(target_os = "windows")]
    {
        windows::get_guide(permission_type)
    }

    #[cfg(target_os = "macos")]
    {
        macos::get_guide(permission_type)
    }

    #[cfg(target_os = "linux")]
    {
        linux::get_guide(permission_type)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = permission_type;
        PermissionGuide::default()
    }
}

/// 检测当前系统是否支持一键打开设置
#[tauri::command]
pub fn can_open_permission_settings() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux"
    ))
}
