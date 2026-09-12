//! tauri-plugin-screen-capture — 安卓屏幕共享采集插件（MediaProjection）。
//!
//! 架构（对齐桌面端 getDisplayMedia 形态，Android WebView 不支持 getDisplayMedia）：
//! ```text
//! JS invoke('plugin:screen-capture|capture_start', { channel, width, height, fps, quality })
//!   → 本 crate #[tauri::command] capture_start（Rust 命令面）
//!   → PluginHandle::run_mobile_plugin("captureStart", payload)（JNI）
//!   → android/…/tauri/ScreenCapturePlugin.kt @Command captureStart
//!       → startActivityForResult(MediaProjectionManager.createScreenCaptureIntent())
//!       → 用户授权（系统授权弹窗）→ onActivityResult
//!       → startForegroundService(ScreenCaptureService, foregroundServiceType=mediaProjection)
//!       → MediaProjection → VirtualDisplay → ImageReader
//!       → RGBA → Bitmap → JPEG → Base64 → Channel（帧）→ JS
//!   → JS: canvas 绘帧 → canvas.captureStream() → MediaStreamTrack
//!   → 注入 useWebRTC 既有屏幕共享 transceiver 链路（与桌面同一条 WebRTC 通道）
//! ```
//!
//! 契约红线：
//! - 命令面固定 3 条：capture_start / capture_stop / capture_status（build.rs COMMANDS 同步）。
//! - 仅安卓注册（App lib.rs 的 `#[cfg(target_os = "android")]` 段）；
//!   其他平台本 crate 不接入，桌面端零改动。
//! - 帧数据只经内存通道（Channel）流动，不落盘、不打日志。

use serde_json::Value;
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

mod commands;

pub use commands::*;

/// Rust↔Kotlin 插件句柄状态。android 上由 setup 注入真实 PluginHandle；
/// 其他平台注册本插件时命令面统一返回 unsupported。
pub struct ScreenCapture<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
}

impl<R: Runtime> ScreenCapture<R> {
    #[cfg(target_os = "android")]
    fn call(&self, command: &str, payload: Value) -> Result<Value, String> {
        self.handle
            .run_mobile_plugin(command, payload)
            .map_err(|e| format!("screen_capture: mobile invoke {command} failed: {e}"))
    }

    #[cfg(not(target_os = "android"))]
    fn call(&self, _command: &str, _payload: Value) -> Result<Value, String> {
        Err("screen_capture: not supported on this platform".into())
    }
}

/// Kotlin 侧插件类全限定名的包部分（android/…/tauri/ScreenCapturePlugin.kt）。
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "dev.huanvae.screen.capture.tauri";

/// 注册插件。仅安卓链路调用（App lib.rs 的 `#[cfg(target_os = "android")]` 段）。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("screen-capture")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ScreenCapturePlugin")?;
                app.manage(ScreenCapture { handle });
            }
            #[cfg(not(target_os = "android"))]
            {
                app.manage(ScreenCapture::<R> {});
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_start,
            commands::capture_stop,
            commands::capture_status,
        ])
        .build()
}
