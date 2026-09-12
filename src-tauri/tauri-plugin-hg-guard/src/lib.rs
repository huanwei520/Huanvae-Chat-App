//! tauri-plugin-hg-guard — HuanvaeGuard VPN 能力接入 chat App（阶段 2a 原生侧）。
//!
//! 架构（勘察交付 §5 路径 C）：
//! ```text
//! JS invoke('plugin:hg-guard|hg_xxx')
//!   → 本 crate #[tauri::command] hg_xxx（Rust 命令面，契约锚点）
//!   → PluginHandle::run_mobile_plugin("hgXxx", payload)（JNI）
//!   → android/…/tauri/HgGuardPlugin.kt @Command hgXxx
//!   → dev.huanvae.guard.HgNative（JNI 管道 fd 语义，桥 libhg_android.so）
//! ```
//!
//! 契约红线：
//! - 命令面固定 6 条：hg_status / hg_connect / hg_disconnect / hg_prepare_vpn /
//!   hg_control_start / hg_control_stop（build.rs COMMANDS 同步）。
//! - 会话凭据仅在 Rust↔Rust-core 的 JNI 边界走管道 fd（Kotlin 侧
//!   ParcelFileDescriptor.createPipe → detachFd → HgNative），不以 jstring
//!   入站到 Rust 核心；本 crate 到 Kotlin 的载荷是进程内 IPC JSON，
//!   不落盘不打日志。
//! - Guard 仓（HuanvaeGuard）零改动：Kotlin 桥 6 文件为搬运件，
//!   包名 `dev.huanvae.guard` 保持原样以维持
//!   `Java_dev_huanvae_guard_HgNative_*` JNI 符号契约（BRIDGE_VERSION=3）。

use serde_json::Value;
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

mod commands;

pub use commands::*;

/// Rust↔Kotlin 插件句柄状态。android 上由 setup 注入真实 PluginHandle；
/// 其他平台注册本插件时命令面统一返回 unsupported。
pub struct HgGuard<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
}

impl<R: Runtime> HgGuard<R> {
    #[cfg(target_os = "android")]
    fn call(&self, command: &str, payload: Value) -> Result<Value, String> {
        self.handle
            .run_mobile_plugin(command, payload)
            .map_err(|e| format!("hg_guard: mobile invoke {command} failed: {e}"))
    }

    #[cfg(not(target_os = "android"))]
    fn call(&self, _command: &str, _payload: Value) -> Result<Value, String> {
        Err("hg_guard: not supported on this platform".into())
    }
}

/// Kotlin 侧插件类全限定名的包部分（android/…/tauri/HgGuardPlugin.kt）。
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "dev.huanvae.guard.tauri";

/// 注册插件。仅安卓链路调用（App lib.rs 的 `#[cfg(target_os = "android")]` 段）。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("hg-guard")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "HgGuardPlugin")?;
                app.manage(HgGuard { handle });
            }
            #[cfg(not(target_os = "android"))]
            {
                app.manage(HgGuard::<R> {});
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::hg_status,
            commands::hg_connect,
            commands::hg_disconnect,
            commands::hg_prepare_vpn,
            commands::hg_control_start,
            commands::hg_control_stop,
        ])
        .build()
}
