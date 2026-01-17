//! 局域网传输诊断模块
//!
//! 自动检测各平台的网络、防火墙、服务配置，
//! 发现问题并提供解决方案。
//!
//! # 支持的平台
//!
//! - Windows: 检查防火墙规则、网络类型、DNS Client 服务
//! - Linux: 检查 avahi-daemon、UFW/firewalld 防火墙
//! - macOS: 检查应用防火墙、Bonjour 服务
//! - Android: 提供权限检查项说明（需前端配合）
//!
//! # 使用示例
//!
//! ```rust,ignore
//! use crate::lan_transfer::diagnostics::diagnose_lan_transfer;
//!
//! #[tauri::command]
//! async fn check_network() -> Result<DiagReport, String> {
//!     diagnose_lan_transfer().await
//! }
//! ```

mod types;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(any(target_os = "android", target_os = "ios"))]
mod android;

pub use types::*;

#[cfg(target_os = "windows")]
pub use windows::WindowsDiagnostician;

#[cfg(target_os = "linux")]
pub use linux::LinuxDiagnostician;

#[cfg(target_os = "macos")]
pub use macos::MacOSDiagnostician;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub use android::AndroidDiagnostician;

/// Tauri 命令：执行局域网传输诊断
///
/// 根据当前平台自动选择对应的诊断器，执行所有检查项，
/// 返回完整的诊断报告。
///
/// # 返回值
///
/// - `Ok(DiagReport)`: 诊断报告，包含所有检查项结果和修复建议
/// - `Err(String)`: 诊断失败的错误信息
///
/// # 示例
///
/// 前端调用：
/// ```typescript
/// const report = await invoke<DiagReport>('diagnose_lan_transfer');
/// if (report.overallStatus !== 'ok') {
///     // 显示诊断结果和修复建议
/// }
/// ```
#[tauri::command]
pub async fn diagnose_lan_transfer() -> Result<DiagReport, String> {
    #[cfg(target_os = "windows")]
    {
        let diagnostician = WindowsDiagnostician::new();
        Ok(diagnostician.diagnose().await)
    }

    #[cfg(target_os = "linux")]
    {
        let diagnostician = LinuxDiagnostician::new();
        Ok(diagnostician.diagnose().await)
    }

    #[cfg(target_os = "macos")]
    {
        let diagnostician = MacOSDiagnostician::new();
        Ok(diagnostician.diagnose().await)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let diagnostician = AndroidDiagnostician::new();
        Ok(diagnostician.diagnose().await)
    }

    #[cfg(not(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    )))]
    {
        Err("不支持的操作系统".into())
    }
}
