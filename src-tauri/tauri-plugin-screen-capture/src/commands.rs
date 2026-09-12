//! 命令面（3 条，固定契约；供前端对接）。
//!
//! 通道：JS `invoke('plugin:screen-capture|<cmd>', args)` → 本文件 `#[tauri::command]`
//! → `ScreenCapture::call`（run_mobile_plugin，JNI）→ Kotlin `@Command`。
//!
//! 帧下行：JS 在 capture_start 参数里传 `Channel`（tauri ipc channel），
//! 序列化为 `__CHANNEL__:<id>` 字符串后透传给 Kotlin；Kotlin `parseArgs` 里经
//! ChannelDeserializer 还原为 `app.tauri.plugin.Channel`，采集服务逐帧 `send`。
//! 本 crate 只做参数透传，不接触帧数据。

use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime, State};

use crate::ScreenCapture;

/// 泛型命令的 State 获取助手：generate_handler 宏对 `State<'_, ScreenCapture<R>>`
/// 作为唯一参数时无法推断 R（E0283），故命令签名统一取 `AppHandle<R>`
/// （宏可推断），内部再 state() 取插件状态（hg-guard 同模式）。

/// capture_start：发起屏幕共享采集。
///
/// 参数：`{ channel, width?, height?, fps?, quality? }`
/// - `channel`：帧下行通道（JS `new Channel()`），帧消息
///   `{ type:'frame', width, height, data:<base64 JPEG> }` / `{ type:'stopped' }`
///   / `{ type:'error', message }`；
/// - `width/height`：虚拟显示目标尺寸（缺省 720p 等比）；`fps`：帧率上限（缺省 10）；
///   `quality`：JPEG 质量 1-100（缺省 60）。
///
/// 行为链：① 系统授权弹窗（createScreenCaptureIntent，用户可拒绝）→
/// ② 授权成功起 mediaProjection 前台服务 → ③ 逐帧经 channel 下行。
/// 本命令在授权弹窗出现前即返回 `{ ok:true, authorized:false }`（异步授权语义），
/// 授权结果经 channel 消息 `{ type:'consent', authorized }` 通知。
#[tauri::command]
pub async fn capture_start<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel,
    width: Option<i32>,
    height: Option<i32>,
    fps: Option<i32>,
    quality: Option<i32>,
) -> Result<Value, String> {
    let state: State<'_, ScreenCapture<R>> = app.state();
    state.call(
        "captureStart",
        json!({
            "channel": channel,
            "width": width,
            "height": height,
            "fps": fps,
            "quality": quality,
        }),
    )
}

/// capture_stop：停止屏幕共享采集（幂等）。
///
/// 释放 VirtualDisplay / ImageReader / MediaProjection，撤前台服务与通知。
/// 返回 `{ ok: true }`。
#[tauri::command]
pub async fn capture_stop<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, ScreenCapture<R>> = app.state();
    state.call("captureStop", json!({}))
}

/// capture_status：采集状态投影。
///
/// 返回 `{ active: bool }`——前台服务存活且投影未释放。
#[tauri::command]
pub async fn capture_status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, ScreenCapture<R>> = app.state();
    state.call("captureStatus", json!({}))
}
