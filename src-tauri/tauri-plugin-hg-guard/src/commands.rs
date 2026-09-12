//! 命令面（6 条，阶段 2a 固定契约；供阶段 2b 前端对接）。
//!
//! 通道：JS `invoke('plugin:hg-guard|<cmd>', args)` → 本文件 `#[tauri::command]`
//! → `HgGuard::call`（run_mobile_plugin，JNI）→ Kotlin `@Command hgXxx`。
//!
//! 阻塞说明：`run_mobile_plugin` 是同步 JNI 往返（Kotlin 侧在 tauri 的 JNI
//! 线程同步执行，完成后经 pending-callback 唤醒本线程）。hg_connect 内部的
//! 拉配置 HTTP 发生在 Rust 核心的自有线程（reqwest），仅占用本通道线程，
//! 与 android-fs 插件的既有 async 命令先例一致。

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::HgGuard;

/// 泛型命令的 State 获取助手：generate_handler 宏对 `State<'_, HgGuard<R>>`
/// 作为唯一参数时无法推断 R（E0283），故命令签名统一取 `AppHandle<R>`
/// （宏可推断），内部再 state() 取插件状态（tauri-plugin-store/android-fs
/// 同模式）。

/// hg_status：桥自检 + 状态投影（statusJson 等价物）。
///
/// 返回：`{ available, bridgeVersion?, statusCode?, statusJson?, error? }`
/// - `available=false`：libhg_android.so 加载失败或 BRIDGE_VERSION≠3；
/// - `statusJson`：`HgNative.statusJson()` 原文（redact 安全；未就绪为 null），
///   字段契约见 HuanvaeGuard client/android/src/vpn.rs（status_code/
///   active/interface_name/address/listen_port/peers[]/control_plane/last_error）。
#[tauri::command]
pub async fn hg_status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgStatus", json!({}))
}

/// hg_connect：StartConfig 获取链 + 隧道启动。
///
/// 参数：`{ masterUrl: string, session: string }`
/// - `masterUrl`：master 源 URL（唯一明文入站字段，非凭据）；
/// - `session`：会话 JSON **字符串**（含 device_id/access_token[/refresh_token]），
///   插件内合并 master_url 后经管道 fd 送 `controlFetchConfig`，仅进程内传递。
///
/// 行为链（镜像 Guard LoginActivity.kt:163-231）：
///   ① controlFetchConfig(sessionFd) → StartConfig（Rust 核心已归一化 /32、
///      listen_port=0 红线）→ ② VpnService.prepare 授权闸（未授权则
///      拒绝 "hg_guard_vpn_not_prepared"，由前端先调 hg_prepare_vpn）→
///   ③ startForegroundService(ACTION_CONNECT, EXTRA_CONFIG) → HgVpnService
///      establish() → startTunnel(tunFd, cfgFd)。
///
/// 返回：`{ ok: true, statusCode }`；错误信封（reject 字符串前缀）：
/// `hg_guard_bridge_unavailable` / `hg_guard_fetch_config_failed:<redact>`
/// / `hg_guard_vpn_not_prepared` / `hg_guard_start_service_failed`。
#[tauri::command]
pub async fn hg_connect<R: Runtime>(
    app: AppHandle<R>,
    master_url: String,
    session: String,
) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgConnect", json!({ "masterUrl": master_url, "session": session }))
}

/// hg_disconnect：幂等断开（控制面 + 隧道 + 服务收尾）。
///
/// 行为：controlStop()（控制面 daemon 归零）+ 服务 ACTION_DISCONNECT
/// （HgVpnService.disconnect → stopTunnel；App 退后台 startService 被拒时由
/// 服务 watchdog 2s 自愈兜底）。
///
/// 返回：`{ ok: true, statusCode }`（statusCode 恒为 STATUS_STOPPED=0 或
/// 尚在收尾中的中间态，以 hg_status 轮询为准）。
#[tauri::command]
pub async fn hg_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgDisconnect", json!({}))
}

/// hg_prepare_vpn：发起 VpnService.prepare 系统授权。
///
/// 返回：`{ authorized: bool }`——已授权（或本次用户同意）true；
/// 用户拒绝 false。已授权态下 prepare 返回 null，直接 resolve true，
/// 不弹系统对话框（Guard MainActivity.kt:154 同语义）。
///
/// 实现：走 tauri 插件框架自带 `startActivityForResult` +
/// `@ActivityCallback`（PluginManager 内部 registerForActivityResult，
/// TauriActivity onCreate 时注册）——不依赖宿主 MainActivity 覆写
/// onActivityResult（勘察 §6.2 未实测项的规避路径，选型理由见交付）。
#[tauri::command]
pub async fn hg_prepare_vpn<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgPrepareVpn", json!({}))
}

/// hg_control_start：启动控制面 daemon（WS 拓扑推送 + 兜底轮询 + 401 刷新）。
///
/// 参数：`{ masterUrl: string, session: string }`（语义同 hg_connect）。
/// 会话经 HgSession.controlCredentialsJson 抽取 ControlCredentials
/// （master_url/device_id/access_token/refresh_token）后走管道 fd 送
/// `controlStart`；会话缺 device_id（未注册设备）则拒绝。
///
/// 返回：`{ ok: true }`；拒绝前缀 `hg_guard_control_failed:<码,redact 文案>`。
#[tauri::command]
pub async fn hg_control_start<R: Runtime>(
    app: AppHandle<R>,
    master_url: String,
    session: String,
) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgControlStart", json!({ "masterUrl": master_url, "session": session }))
}

/// hg_control_stop：幂等停控制面（尽力 release 5s 超时后归零）。
///
/// 返回：`{ ok: true }`。
#[tauri::command]
pub async fn hg_control_stop<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let state: State<'_, HgGuard<R>> = app.state();
    state.call("hgControlStop", json!({}))
}
