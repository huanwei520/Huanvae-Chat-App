//! 桌面平台专属模块
//!
//! 仅在 Windows、macOS、Linux 等桌面平台编译
//!
//! ## 包含功能
//! - 系统托盘：关闭窗口时最小化到托盘
//! - 会话锁：同设备同账户单开控制
//! - 安装类型检测：检测 Windows 上是 MSI 还是 NSIS 安装（用于更新器）
//! - HuanvaeGuard 服务生命周期：Windows Service 的启停绑定到 Tauri 进程（仅 Windows）
//!
//! ## 条件编译
//! 此模块使用 `#[cfg(desktop)]` 或 `#[cfg(not(any(target_os = "android", target_os = "ios")))]`
//! 内部 `huanvaeguard` 子模块进一步限定为 `#[cfg(target_os = "windows")]`，
//! 因为 HG 依赖 Windows SCM (sc.exe / taskkill)，mac/Linux 无对应实现。

#[cfg(target_os = "windows")]
pub mod huanvaeguard;
pub mod installer_type;
pub mod session_lock;
pub mod tray;

// 重新导出常用项
pub use installer_type::get_windows_installer_type;
pub use session_lock::{
    activate_existing_instance, check_session_lock, cleanup_stale_locks, create_session_lock,
    remove_session_lock,
};
pub use tray::setup_tray;
