//! 自建分片并发下载器（替换 tauri-plugin-updater 的默认单连接顺序下载）
//!
//! # 为什么要自己写
//!
//! 插件默认下载是**单连接、顺序流式、无 Range、无重试**（`tauri-plugin-updater-2.10.1`
//! `src/updater.rs:652 download()`）。受控链路损伤实测（本机 loopback + dummynet，
//! 20Mbit/s 限速下）：
//!
//! | 丢包/RTT   | 单连接  | 8 段分片 | 提速  |
//! |-----------|--------|---------|------|
//! | 0% / 0ms  | 5.50s  | 5.52s   | 1.00x |
//! | 1% / 150ms| 9.14s  | 6.23s   | 1.47x |
//! | 5% / 250ms| 35.58s | 8.10s   | 4.39x |
//!
//! 即：链路越差，分片并发赢得越多（单连接的拥塞窗口被丢包反复砍半，N 条连接拿到 N 倍聚合窗口）。
//!
//! # 🔴 签名校验绝不能丢
//!
//! 插件的验签在 `download()` **内部**（`updater.rs:712 verify_signature(...)`），而
//! `install(bytes)`（`:718`，pub）**不验签**。所以「自己下载 → 直接 install」会把验签整个跳过。
//! 本模块因此原样复刻插件的验签逻辑（`updater.rs:1453`）：
//!   base64 解码 pubkey / signature → `minisign-verify` 的 `PublicKey::decode` /
//!   `Signature::decode` → `verify(data, sig, true)`。
//! 校验**失败即中止**，绝不安装。
//!
//! # 🔴 Range 分片是唯一下载路径（产品决定：不做任何兜底 / 降级）
//!
//! 本模块**只有一条**下载出口：Range 分片并发。除它之外不存在第二种下载实现，
//! 因此任何前置条件不满足都只有一个结果 —— **报错中止**：
//!
//! - HEAD 探测不到 `accept-ranges: bytes` → 中止（文案见 [`ERR_RANGE_UNSUPPORTED`]）；
//! - HEAD 拿不到有效内容长度（缺失或为 0）→ 中止（文案见 [`ERR_TOTAL_UNKNOWN`]）；
//! - 分片重试用尽 → 中止；
//! - 验签失败 → 中止。
//!
//! 失败就把明确文案交给用户，不静默降级。
//!
//! 合法性前提（2026-08-12 实测，两条更新源 × 全部五个产物）：纯 HEAD 一律返回
//! `accept-ranges: bytes` + 非零 `content-length`，Range GET 一律 206；最小产物
//! 9,284,371 B。即"服务端不支持 Range"在当前所有真实产物上都不成立，
//! 曾经为它准备的那条非分片路径没有任何真实场景会命中。
//!
//! # 🔴 请求整形必须与插件一致
//!
//! 插件 `download()` 在建 client / 发请求时做了一整套整形（`updater.rs:657-687`）：
//! 自定义 UA、`Accept: application/octet-stream`、用户 headers、timeout、proxy/no_proxy、
//! 两个 dangerous TLS 开关。自建下载器一旦漏掉，用户在 `check()` 里配的东西就**静默失效**。
//! 本模块用 [`RequestShaping`] + [`build_client`] 逐项复刻，见那里的对照注释。
//!
//! ⚠️ 一个容易误判的点：**漏掉 `proxy` 字段 ≠ 不走系统代理**。reqwest 的
//! `auto_sys_proxy` 默认就是 `true`（`reqwest-0.12.28/src/async_impl/client.rs:309`，
//! 建 client 时 `:419` push `ProxyMatcher::system()`），即**默认就读环境变量 / 系统代理**；
//! 反倒是调用 `.proxy()` 或 `.no_proxy()` 会把 `auto_sys_proxy` 置 `false`（`:1416` / `:1429`）。
//! 所以 `Update.proxy` 只在调用方**显式**传了代理时才有意义。
//!
//! # 断点续传：落盘 + sidecar 清单（不是"重试时接着下"那种）
//!
//! 历史上这里的"断点续传"只覆盖**一个分片的一次请求失败后重试**那一层；
//! 分片字节只活在内存（`Vec::with_capacity`），所以整次失败 / 用户点重试 / 进程退出
//! 一律**从头下**。现在改成：
//!
//! - 分片直接 `seek + write` 进 `<app_cache>/huanvae-update.part`（不再整包驻留内存，
//!   峰值内存从 ≈2× 包大小降到 1×——验签那一下仍需把整包读进来）；
//! - 每片的进度写进 sidecar 清单 `<app_cache>/huanvae-update.part.json`（1s 节流），
//!   **失败路径上也会落一次最终清单**，那正是下次接着下的依据；
//! - 续传前必须证明**远端还是同一份字节**：URL + 总长 + **强校验标识**（ETag，
//!   弱 ETag 不收；退而用 Last-Modified）三者全等才续，拿不到校验标识就一律重下。
//!   协议层还有第二道保险：续传请求带 `If-Range`，资源若已变服务端回 200 而不是 206，
//!   而本模块把"非 206"直接判失败 ⇒ 新旧字节不可能被拼在一起。
//! - 完整性由**验签**收口（minisign，见 [`verify_signature`]）：验不过就把
//!   `.part` 连同清单一起删掉重来 —— 否则会永远从同一堆坏字节接着下，每次都在同一处失败。
//!
//! # ⚠️ `Response::content_length()` 在 HEAD 上恒失真（踩过）
//!
//! 它读的**不是** `content-length` 头，而是 hyper 的 body size hint
//! （`reqwest-0.12.28/src/async_impl/response.rs:90-94`：`Body::size_hint(self.res.body()).exact()`）。
//! HEAD 响应按定义没有 body ⇒ 它给 0，与头里的真实长度无关。
//! 所以 [`probe`] 必须**自己读 `content-length` 头**。
//!
//! # 🔴 Windows：安装器落地前必须先停掉 HuanvaeGuard 服务（本模块 [`guard_stop`]）
//!
//! ## 根因（owner 实机定案，2026-09-16）
//!
//! Windows 上 App 内更新时 HuanvaeGuard 服务若仍在运行，`huanvaeguard-svc.exe` /
//! `wintun.dll` 就被服务进程独占上锁。安装器（NSIS）覆盖这两个文件时写入被拒绝 ⇒
//! 更新半截失败留下残缺安装 ⇒ 服务起不来（用户见 1053 /「已安装未运行」）。
//! 对照实证：owner 从 GitHub 全新安装 1.1.49 后 VPN 正常 —— 包内二进制无缺陷，缺陷只在更新路径。
//!
//! ## 修法（「停服务 → 等 STOPPED → 落地 → 按前态恢复」四段式）
//!
//! 1. **停**：`sc.exe stop HuanvaeGuard`（服务 SDDL 已授予 Authenticated Users 启停权限，
//!    见 `hooks.nsi` POSTINSTALL 的 `sc sdset`）；
//! 2. **等**：轮询 `sc.exe query` 直到 `STATE` 行为 `STOPPED`，500ms × 60 = 30s 上限 ——
//!    **只等 `sc stop` 的返回码不算数**（rc=0 只代表 SCM 收下了请求，服务进程真正退出、
//!    文件句柄真正释放要以 SCM 最终态为准，与 [`crate::desktop::huanvaeguard::repair`]
//!    末尾「不信自述、独立复核」是同一条纪律）；
//! 3. **落地**：只有等到了 `STOPPED` 才调用 [`Update::install`]；
//! 4. **恢复**：更新后 App 会被安装器重启（NSIS `/R`），启动时的
//!    `desktop::huanvaeguard::spawn_start_on_boot` 照常拉起服务 —— 恢复逻辑复用
//!    既有启动链，本模块不自己再 start（避免双拉）；NSIS 侧的同位修复见
//!    `src-tauri/windows/hooks.nsi` 的 `HUANVAE_GUARD_STOP_FOR_INSTALL`
//!    （覆盖安装/手动安装路径，与本模块互为冗余防线）。
//!
//! ## 失败分支（停不掉 ⇒ 中止更新，绝不硬覆盖）
//!
//! 停不掉（`sc stop` 被拒，或 30s 内仍未 `STOPPED`）⇒ 返回 `Err`，更新在**安装器启动之前**
//! 中止：此时一个文件都没被动过，不存在半截安装；`.part` 与断点清单原样保留（已过验签，
//! 重试 = 零重下）。文案必须让用户知道「为什么中止 + 下一步做什么」。
//!
//! 为什么这段逻辑放在本模块而不是 `desktop::huanvaeguard.rs`：那是服务生命周期的
//! 常驻管理（启停绑定 App 生命周期），而这里是**更新落地专属**的时序动作 —— 它必须
//! 卡在「验签之后、`install()` 之前」这个精确位置，挪走就失去时序保证。服务名常量
//! 与 `hooks.nsi` / `desktop::huanvaeguard.rs` 的一致性由
//! `tests/winService.nsisContract.test.ts` 的跨文件断言机器守着。

use std::fs::{self, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use tauri::{ipc::Channel, Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::Update;

// 断点清单与「远端未变」判定与安卓侧共用同一份实现，见该模块头注释
use crate::resume_meta::{
    can_resume, discard_part, fresh_layout, if_range_value, load_meta, remote_validator, save_meta,
    snapshot_meta, ShardProgress,
};

/// 分片数。8 段在实测里比 4 段稳定更优（5%丢包 8.10s vs 10.13s）。
const SHARD_COUNT: u64 = 8;
/// 每个分片的失败重试次数（不含首次）。
const MAX_RETRY: u32 = 3;
/// 单个分片请求的整体超时。插件默认**没有超时**，挂死就是它的真实行为，这里必须给上界。
const SHARD_TIMEOUT: Duration = Duration::from_secs(120);
/// 建连超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 断点续传的落盘文件名（应用缓存目录内）。
const PART_FILE_NAME: &str = "huanvae-update.part";
/// 断点清单（sidecar）文件名。清单在 ⇒ `.part` 是**半截的**；清单不在 ⇒ 没有可续的东西。
const PART_META_FILE_NAME: &str = "huanvae-update.part.json";
/// 清单持久化节流间隔。每个 chunk 都写盘毫无必要（崩溃最多多下 1 秒的量）。
const META_FLUSH_INTERVAL: Duration = Duration::from_millis(1000);

/// 更新源未声明 `accept-ranges: bytes` 时给用户看的文案。
///
/// 这条走到用户面前就意味着这次更新到此为止 —— 分片是唯一路径，没有别的下载实现可退，
/// 所以文案必须自带下一步动作，而不是只说"失败了"。
const ERR_RANGE_UNSUPPORTED: &str =
    "更新源不支持分段下载（未声明 accept-ranges: bytes），已中止更新。请稍后重试，或从 GitHub Release 页手动下载安装包。";

/// HEAD 拿不到有效内容长度（缺失或为 0）时给用户看的文案。
///
/// 长度未知就切不出分片区间；同样直接中止，不退化成整包顺序拉流。
const ERR_TOTAL_UNKNOWN: &str =
    "更新源未返回有效的内容长度，无法分段下载，已中止更新。请稍后重试，或从 GitHub Release 页手动下载安装包。";

/// 插件下载请求用的 User-Agent（`updater.rs:44`）。
///
/// 插件那边是 `const UPDATER_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/",
/// env!("CARGO_PKG_VERSION"))` —— **私有 const**，外部 crate 取不到，`env!` 又只会展开成
/// *本* crate 的名字/版本，所以只能按值复刻。值会随插件升版漂移，故有
/// `user_agent_matches_plugin_version_in_lockfile` 从 Cargo.lock 读真值来钉死它。
const UPDATER_USER_AGENT: &str = "tauri-plugin-updater/2.10.1";

/// 复刻插件 `download()` 对 client / 请求做的整形（`updater.rs:657-687`）。
///
/// 字段来源分两类：
/// - `headers` / `timeout` / `proxy` / `no_proxy` —— `Update` 上的 **pub** 字段，直接读；
/// - `accept_invalid_certs` / `accept_invalid_hostnames` —— 插件读的是 `Update.config`
///   （**私有**字段，取不到），但它就是 `tauri.conf.json` 的 `plugins.updater` 反序列化结果，
///   所以改从运行时配置读同一份真值（与 [`pubkey_from_config`] 同样的做法）。
#[derive(Clone, Default)]
struct RequestShaping {
    /// 调用方经 `check()` 传入的自定义请求头（`updater.rs:658`）
    headers: HeaderMap,
    /// 整体请求超时（`updater.rs:670`）
    timeout: Option<Duration>,
    /// 显式代理；`no_proxy` 为真时插件不看这个字段（`updater.rs:675`）
    proxy: Option<String>,
    /// 禁用系统代理（`updater.rs:673`）
    no_proxy: bool,
    /// `plugins.updater.dangerousAcceptInvalidCerts`（`updater.rs:664`）
    accept_invalid_certs: bool,
    /// `plugins.updater.dangerousAcceptInvalidHostnames`（`updater.rs:667`）
    accept_invalid_hostnames: bool,
}

/// 复刻 `updater.rs:658-661`：在用户 headers 基础上补 `Accept`，
/// **但用户已显式给了 `Accept` 就不覆盖**。
fn shaping_headers(user_headers: &HeaderMap) -> HeaderMap {
    let mut headers = user_headers.clone();
    if !headers.contains_key(ACCEPT) {
        headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    }
    headers
}

/// 按 [`RequestShaping`] 建 client，逐项对应 `updater.rs:663-681`。
///
/// 整形挂在 **client** 上（而非逐个请求）是有意的：本模块有 HEAD 探测 / 分片 GET
/// 两条出口，共用这一个 client 才能保证两条都被整形。`default_headers`
/// 不会覆盖请求级 header（`reqwest-0.12.28/src/async_impl/client.rs:2590-2596`
/// 只填 `Entry::Vacant`），所以分片那条 `RANGE` 照常生效。
fn build_client(shaping: &RequestShaping) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(UPDATER_USER_AGENT)
        .default_headers(shaping_headers(&shaping.headers))
        // 本模块自有（插件没有）：给建连一个上界，其余下载参数一概不动
        .connect_timeout(CONNECT_TIMEOUT)
        // ── HTTP/2 流控窗口（本模块自有；插件与 reqwest 默认都不设）──
        //
        // reqwest 的三个 h2 窗口旋钮**默认全关**
        // （`reqwest-0.12.28/src/async_impl/client.rs:343/345/347`：
        // `http2_initial_stream_window_size: None` / `http2_initial_connection_window_size: None`
        // / `http2_adaptive_window: false`）⇒ 不发 SETTINGS 覆盖 ⇒ 落到协议默认
        // **65535 字节**（`h2-0.4.12/src/frame/settings.rs:44`
        // `pub const DEFAULT_INITIAL_WINDOW_SIZE: u32 = 65_535;`）。
        //
        // 单条 h2 流的吞吐上界 ≈ 窗口 / RTT。64 KiB 窗口在 30ms RTT 上就是 ~2 MB/s——
        // 与链路带宽无关，纯粹是流控在卡。**这正是现状 8 分片在替窗口还债**：8 条独立
        // TCP 各自拿一份 64 KiB 窗口，聚合起来才把速度堆上去；一旦看单流就会发现它慢。
        // 明确放大窗口后，速度不再依赖"多开连接"这个副作用。
        //
        // 实测（2026-08-11，同机 / 同 URL = v1.1.28 的 macOS 包 13,748,110 B / 交错 A-B
        // 14 轮取中位数；改前改后逐轮交替次序以抵消网络漂移）：
        //
        // | 变体                                   | 单流       | 本模块 8 分片 |
        // |----------------------------------------|-----------|-------------|
        // | 改前：reqwest 默认（= 65535 窗口）        | 6.31 MB/s | 12.54 MB/s  |
        // | 改后：本行两个窗口                        |10.95 MB/s | 17.46 MB/s  |
        // | 对照：Chromium（浏览器，单连接）           |10.50 MB/s |      —      |
        //
        // 单流 1.73x、分片路径 1.39x；同轮配对里改后更快的轮次 12/14（单流）、11/14（分片）。
        // 注意改后**单流**已经追平乃至略超浏览器 —— 说明此前"分片才追得上浏览器"确实是
        // 拿并发在补窗口的亏。
        //
        // 🔴 **绝对不要改成 `http2_adaptive_window(true)`**，两条独立理由：
        //   1. 实测更差——同一批次里自适应单流只有 **4.07 MB/s**，不但远低于改后的
        //      10.95，连改前的默认 6.31 都不如（同轮配对中它只在 3/14 轮里更快，
        //      中位比值 0.63x）；它的窗口探测爬升期反而拖垮了这种"几秒就结束"的短下载；
        //   2. 它会**覆盖**下面这两个显式上限（reqwest 自己的文档就这么写：
        //      `client.rs:1598-1599` "Enabling this will override the limits set in
        //      `http2_initial_stream_window_size` and `http2_initial_connection_window_size`"）
        //      ⇒ 打开它等于把这两行静默作废。
        .http2_initial_stream_window_size(4 * 1024 * 1024)
        .http2_initial_connection_window_size(8 * 1024 * 1024);

    if shaping.accept_invalid_certs {
        builder = builder.danger_accept_invalid_certs(true);
    }
    if shaping.accept_invalid_hostnames {
        builder = builder.danger_accept_invalid_hostnames(true);
    }
    if let Some(timeout) = shaping.timeout {
        builder = builder.timeout(timeout);
    }
    // 与插件同样的 if / else if 次序：no_proxy 优先，两者都没有则保持 reqwest
    // 默认的 auto_sys_proxy（即照常走系统 / 环境变量代理）
    if shaping.no_proxy {
        builder = builder.no_proxy();
    } else if let Some(proxy) = &shaping.proxy {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy.as_str()).map_err(|e| format!("代理配置无效: {e}"))?,
        );
    }

    builder.build().map_err(err)
}

/// 读 `tauri.conf.json` → `plugins.updater` 下的 bool 开关。
///
/// 同时认 camelCase 与 kebab-case，与插件 `config.rs` 的 `#[serde(alias = "...")]` 对齐。
fn updater_config_flag<R: Runtime>(webview: &Webview<R>, camel: &str, kebab: &str) -> bool {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get(camel).or_else(|| v.get(kebab)))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 下载进度事件（变体名与字段名都必须与前端 `src/update/service.ts` 的解析逐字对齐）
///
/// 🔴 这里**只能**写 `rename_all_fields`，不能写 `rename_all` —— 它俩在 enum 上作用于
/// 完全不同的东西，写错的那一版在编译期毫无征兆，只在运行时把线格式整个换掉：
///
/// | 属性 | 作用对象（serde 语义） | 本 enum 的实际线格式 |
/// |---|---|---|
/// | `rename_all = "camelCase"` | **变体名**（字段不动） | `{"event":"started","data":{"content_length":…}}` |
/// | `rename_all_fields = "camelCase"` | **变体内的字段名**（变体名不动） | `{"event":"Started","data":{"contentLength":…}}` |
///
/// 前端 `service.ts` 的 `switch (msg.event)` 只认 `'Started' / 'Progress' / 'Finished'`，
/// 所以写成 `rename_all` 时**一条进度都进不了前端**（switch 无分支命中 ⇒ `onProgress`
/// 一次都不调），进度条全程停在 `startDownload()` 的初值 —— 表现为「0 B 不定态直到完成」。
/// 这正是 v1.1.23（`1f42b3e` 引入自建分片下载器时）～v1.1.32 十个版本一直在犯的错：
/// 它不报错、不告警，唯一症状就是进度条不动，因此没人把它跟"格式"联系起来。
/// 上面那张表的两行都是 serde 1.0.228 实跑出来的，不是推断。
///
/// 守卫：`tests/update/updateWireContract.test.ts` 从本文件**解析出真实线格式**再喂给
/// 前端真实 handler；改动本行或任一变体名/字段名而不同步前端，那条测试立刻翻红。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all_fields = "camelCase", tag = "event", content = "data")]
pub enum ShardedEvent {
    /// 总长度。
    ///
    /// BACKLOG（等更新事件契约随前端一并收窄时删掉这个 `Option`）：自「分片是唯一路径」
    /// 落地起，本模块**恒发 `Some`** —— 长度未知在 [`require_shardable`] 就已报错中止，
    /// 走不到这里。`Option` 之所以还留着，只因收窄它要同步改前端
    /// `src/update/service.ts` 的 `contentLength: number | null` 与 `indeterminate`
    /// 分支（跨语言契约，属另一次改动的范围），不是给本模块留降级余地。
    ///
    /// `downloaded` = **本次开跑时已经在盘上的字节数**（断点续传的起点，非续传时为 0）。
    /// 🔴 它必须由 `Started` 自己带出去，不能"先报 0 再补一条 Progress" ——
    /// 那样前端速率估算会看到「0 → 8MB」这一跳，把它当成 200ms 内真下了 8MB，
    /// 瞬时速率直接飙到几十 MB/s（EMA 要好几秒才落回真值）。
    Started {
        content_length: Option<u64>,
        downloaded: u64,
    },
    Progress { downloaded: u64, content_length: Option<u64> },
    Finished,
}

fn err<T: std::fmt::Display>(e: T) -> String {
    e.to_string()
}

/// 复刻 `tauri-plugin-updater` 的验签（updater.rs:1453），一步都不能少。
fn verify_signature(data: &[u8], release_signature: &str, pub_key: &str) -> Result<(), String> {
    let pub_key_decoded = base64::engine::general_purpose::STANDARD
        .decode(pub_key)
        .map_err(|e| format!("pubkey base64 解码失败: {e}"))?;
    let pub_key_str =
        std::str::from_utf8(&pub_key_decoded).map_err(|e| format!("pubkey 不是合法 UTF-8: {e}"))?;
    let public_key =
        PublicKey::decode(pub_key_str).map_err(|e| format!("pubkey 解析失败: {e}"))?;

    let sig_decoded = base64::engine::general_purpose::STANDARD
        .decode(release_signature)
        .map_err(|e| format!("signature base64 解码失败: {e}"))?;
    let sig_str =
        std::str::from_utf8(&sig_decoded).map_err(|e| format!("signature 不是合法 UTF-8: {e}"))?;
    let signature = Signature::decode(sig_str).map_err(|e| format!("signature 解析失败: {e}"))?;

    // 第三个参数 true 与插件一致（allow legacy）
    public_key
        .verify(data, &signature, true)
        .map_err(|e| format!("签名校验未通过，已中止安装: {e}"))
}

/// 从应用配置里取 updater pubkey。
///
/// 不硬编码：`Update` 的 `config` 字段是私有的，取不到；而 `tauri.conf.json` 是唯一真值源，
/// 从运行时配置读可避免与配置漂移。
fn pubkey_from_config<R: Runtime>(webview: &Webview<R>) -> Result<String, String> {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "tauri.conf.json 缺少 plugins.updater.pubkey".to_string())
}

// ============================================================
// 探测与分片抓取
// ============================================================

/// HEAD 探测结果。
struct Probe {
    total: Option<u64>,
    accepts_range: bool,
    /// 强校验标识（可能为 None ⇒ 不允许续传）
    validator: Option<String>,
}

/// HEAD 探测：拿总长度 + 是否支持 Range + 强校验标识
async fn probe(client: &reqwest::Client, url: &str) -> Result<Probe, String> {
    let resp = client
        .head(url)
        .timeout(SHARD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("HEAD 探测失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HEAD 探测返回 {}", resp.status()));
    }
    let headers = resp.headers();
    // 🔴 必须读**头**，不能用 `resp.content_length()`：后者是 hyper 的 body size hint
    //    （`reqwest-0.12.28/src/async_impl/response.rs:90-94`），而 HEAD 响应没有 body
    //    ⇒ 它恒给 0，与真实长度无关。用它会让每一次更新都以「更新源未返回有效的内容长度」
    //    中止（实测：同一 URL 头里是 13766023，`content_length()` 给 Some(0)）。
    let len = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let accepts_range = headers
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        // `bytes` 可能出现在复合值里（如 `bytes, foo`），用 contains 而不是全等
        .map(|v| v.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false);
    let validator = remote_validator(
        headers
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok()),
        headers
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok()),
    );
    Ok(Probe { total: len, accepts_range, validator })
}

/// 取一段 Range 直接写进 `.part` 的对应偏移，返回本次写入的字节数。
///
/// 与旧实现（收进内存 `Vec`）的关键差别：**写盘成功就算数**，所以失败时不需要
/// 「回滚已计字节」那套 —— 已落盘的字节是真的可以接着下的。
#[allow(clippy::too_many_arguments)]
async fn fetch_range_into(
    client: &reqwest::Client,
    url: &str,
    from: u64,
    end: u64,
    if_range: Option<&str>,
    file: &mut File,
    done_counter: &AtomicU64,
    progress: &AtomicU64,
) -> Result<u64, String> {
    file.seek(SeekFrom::Start(from))
        .map_err(|e| format!("定位 .part 失败: {e}"))?;

    let mut req = client
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes={from}-{end}"))
        .timeout(SHARD_TIMEOUT);
    if let Some(v) = if_range {
        // 🔴 协议层的第二道保险：资源若已变，服务端按 RFC 9110 §13.1.5 回 200（整包）
        //    而不是 206；下面那句 206 断言随即把这次续传拦下来 —— 新旧字节不可能被拼在一起。
        req = req.header(reqwest::header::IF_RANGE, v);
    }

    let resp = req.send().await.map_err(|e| format!("分片请求失败: {e}"))?;
    // 必须是 206；200 说明服务端忽略了 Range 或资源已变（会把整个文件塞回来）
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("分片响应状态非 206（实际 {}）", resp.status()));
    }

    // 🔴 必须**流式**读，不能 `resp.bytes()` 一次性等整片：那样 `progress` 在整片完成前
    // 一直不动，用户看到的就是「一直 0%，然后突然完成」。
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let allowed = end - from + 1;
    let mut written = 0u64;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("分片读取失败: {e}"))?;
        let n = chunk.len() as u64;
        // 服务端多给字节就会写进**下一片**的区间、把它已下好的内容覆盖掉 ⇒ 坏包。
        // 宁可判失败重来，也不能越界写。
        if written + n > allowed {
            return Err(format!(
                "服务端返回超出请求区间的字节（请求 {allowed}，已收 {}）",
                written + n
            ));
        }
        file.write_all(&chunk)
            .map_err(|e| format!("分片写入失败: {e}"))?;
        written += n;
        // 边收边计：写盘成功才计数，这也是「实时进度」的唯一来源
        done_counter.fetch_add(n, Ordering::Relaxed);
        progress.fetch_add(n, Ordering::Relaxed);
    }
    file.flush().map_err(|e| format!("分片刷新失败: {e}"))?;
    Ok(written)
}

/// 下载单个分片到 `.part`（带重试 + 断点续传：每次只请求这片还差的那段）。
async fn fetch_shard(
    client: reqwest::Client,
    url: String,
    part_path: PathBuf,
    shard: ShardProgress,
    if_range: Option<String>,
    done_counter: Arc<AtomicU64>,
    progress: Arc<AtomicU64>,
) -> Result<(), String> {
    let ShardProgress { start, end, .. } = shard;
    let want = end - start + 1;
    let mut attempt = 0u32;

    let mut file = OpenOptions::new()
        .write(true)
        .open(&part_path)
        .map_err(|e| format!("分片打开 .part 失败: {e}"))?;

    loop {
        let done = done_counter.load(Ordering::Relaxed);
        if done >= want {
            break;
        }
        let res = fetch_range_into(
            &client,
            &url,
            start + done,
            end,
            if_range.as_deref(),
            &mut file,
            &done_counter,
            &progress,
        )
        .await;

        match res {
            // 短读：继续循环补齐，不计入重试
            Ok(n) if n > 0 => {}
            // 一个字节都没给却报成功 ⇒ 再循环就是死循环，按失败计
            Ok(_) => {
                attempt += 1;
                if attempt > MAX_RETRY {
                    return Err(format!(
                        "分片 [{start}-{end}] 重试 {MAX_RETRY} 次仍失败: 服务端返回 206 但无数据"
                    ));
                }
                tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
            }
            Err(e) => {
                attempt += 1;
                if attempt > MAX_RETRY {
                    return Err(format!("分片 [{start}-{end}] 重试 {MAX_RETRY} 次仍失败: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
            }
        }
    }

    let done = done_counter.load(Ordering::Relaxed);
    if done != want {
        return Err(format!(
            "分片 [{start}-{end}] 字节数不符：期望 {want}，实到 {done}"
        ));
    }
    Ok(())
}

/// 把 HEAD 探测结果收敛成「分片下载唯一需要的那个参数」：总字节数。
///
/// 分片是唯一下载路径，所以这里是**产品语义的收口点**：任何一项不满足都直接变成
/// 面向用户的 `Err`，绝不返回某种"降级模式"的标记。抽成纯函数是为了让这条语义
/// 能被单测钉死（`updater_sharded_install` 需要真 `Webview`，测不了）。
fn require_shardable(total: Option<u64>, accepts_range: bool) -> Result<u64, String> {
    if !accepts_range {
        return Err(ERR_RANGE_UNSUPPORTED.to_string());
    }
    match total {
        Some(len) if len > 0 => Ok(len),
        // 长度缺失与长度为 0 归同一出口：两者都切不出任何有效 Range 区间
        _ => Err(ERR_TOTAL_UNKNOWN.to_string()),
    }
}

// ============================================================
// 🔴 Windows：更新落地前停服（guard_stop）
// ============================================================
//
// 模块头「Windows：安装器落地前必须先停掉 HuanvaeGuard 服务」一节是这段代码的完整设计
// 说明；这里只记实现分工：
//
// - **纯函数**（[`parse_guard_state`] / [`classify_stop_rc`] / [`stop_poll_decision`]）
//   不碰进程/SCM，任何平台都能跑单测 —— 「等待完全停止」「超时/失败中止」这两条
//   分支的判定逻辑全部收敛在这里，测试不需要 Windows；
// - **exec 薄壳**（[`#[cfg(windows)]` 的 `sc_query` / `stop_guard_service_for_update`）
//   只负责起 `sc.exe`、喂参数、把判定函数的结论翻成 Ok/Err，判定逻辑零重复。
//
// 🔴 本段是**更新落地专属**，不是通用的服务启停 API —— 日常启停在
// `desktop::huanvaeguard.rs`。这里**只停不启**：恢复交给安装器重启后的
// `spawn_start_on_boot`（见模块头第 4 步）。

/// HuanvaeGuard 服务的名字。与 `src-tauri/windows/hooks.nsi`、
/// `src-tauri/src/desktop/huanvaeguard.rs` 的同名常量必须逐字一致 ——
/// 由 `tests/winService.nsisContract.test.ts` 跨文件断言守着。
pub const GUARD_SERVICE_NAME: &str = "HuanvaeGuard";

/// `sc.exe stop` 后等待服务真正 `STOPPED` 的上限。
///
/// 健康服务通常 < 2s；给到 30s 是为了覆盖「隧道在跑、sing-box + wintun 适配器拆除慢」
/// 的场景——这正是 owner 实机上更新写失败的那类现场。宁可多等，不可硬覆盖。
#[allow(dead_code)]
const GUARD_STOP_TIMEOUT: Duration = Duration::from_secs(30);
/// `STATE` 轮询间隔。30s / 500ms = 60 次。
#[allow(dead_code)]
const GUARD_STOP_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// `sc.exe query` 对**不存在**的服务返回的退出码（`ERROR_SERVICE_DOES_NOT_EXIST`）。
#[allow(dead_code)]
const SC_QUERY_NO_SERVICE: i32 = 1060;
/// `sc.exe stop` 对**本来就没在跑**的服务返回的退出码（`ERROR_SERVICE_NOT_ACTIVE`）。
/// 这不是失败：目标态就是 STOPPED，它已经达成了。
const SC_STOP_NOT_ACTIVE: i32 = 1062;

/// HuanvaeGuard 服务在 SCM 里的观测状态（更新停服路径只关心这几个）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum GuardState {
    /// SCM 里没有这个服务（fresh 环境或已被卸载）⇒ 没有文件锁，无需停。
    NotRegistered,
    /// `STATE : 1  STOPPED` ⇒ 无需停。
    Stopped,
    /// `STATE : 4  RUNNING` ⇒ 必须停。
    Running,
    /// `START_PENDING` / `STOP_PENDING`：瞬态。等它翻到终态再决定。
    Pending,
    /// `sc query` 成功（rc=0）但输出里没有可识别的 `STATE` 行 —— 罕见（本地化输出/
    /// 未来格式漂移）。按「停 + 轮询兜底」处理：停不下会显式报错，不会静默放行。
    Unknown,
    /// `sc.exe` 没能给出可信结论（非 1060 的非零退出码，或进程都没起来）。
    /// 与 [`GuardState::NotRegistered`] 必须分开 —— 「没查到」≠「没装」，
    /// 据此去装/停一个可能存在的服务正是本仓修过的同形病。
    QueryFailed(Option<i32>),
}

/// `sc stop` 退出码的三分类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum StopRc {
    /// SCM 收下了停止请求（rc=0）⇒ 进入轮询等待。
    Accepted,
    /// 服务本来就没在跑（rc=1062）⇒ 目标态已达成，直接当成功。
    NotActive,
    /// 其余一切（5=拒绝访问、1061=死锁收不下控制消息、`None`=sc.exe 没起来……）。
    /// 🔴 这里**不**直接判死——`sc stop` 被拒后仍按超时口径轮询到点：万一 SCM 只是
    /// 瞬时抖动，服务照样能翻到 STOPPED；翻不到再中止。拒绝访问的场景多等 30s 的
    /// 代价远小于误杀一次本可完成的更新。
    Failed,
}

/// 轮询等待的一步结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum PollDecision {
    /// 还没到点、服务还没停 ⇒ 继续。
    Continue,
    /// 服务已 `STOPPED` ⇒ 可以落地。
    ReachedStopped,
    /// 超时仍未 `STOPPED` ⇒ 中止更新。
    GiveUp,
}

/// 解析 `sc.exe query <svc>` 的 stdout 里的 `STATE` 行。
///
/// 只认行内的**状态关键字**（`RUNNING` / `STOPPED` / `*_PENDING`），不解析数字码也不认
/// 逗号格式 —— 本仓其它 sc 解析（`desktop::huanvaeguard::query_state`）同款口径。
/// 输出样例：`"        STATE              : 4  RUNNING"`。
#[allow(dead_code)]
fn parse_guard_state(sc_query_stdout: &str) -> GuardState {
    let has = |needle: &str| {
        sc_query_stdout
            .lines()
            .any(|l| l.trim_start().starts_with("STATE") && l.contains(needle))
    };
    // 🔴 顺序不可换：`STOP_PENDING`/`START_PENDING` 都包含 "PENDING"，而 `STOPPED` 不被
    // 任何其它关键字包含；先判 PENDING 再判 STOPPED/RUNNING，避免瞬态被误读成终态。
    if has("START_PENDING") || has("STOP_PENDING") {
        GuardState::Pending
    } else if has("STOPPED") {
        GuardState::Stopped
    } else if has("RUNNING") {
        GuardState::Running
    } else {
        GuardState::Unknown
    }
}

/// `sc stop` 的退出码 → [`StopRc`]。`None` = sc.exe 连进程都没起来。
#[allow(dead_code)]
fn classify_stop_rc(rc: Option<i32>) -> StopRc {
    match rc {
        Some(0) => StopRc::Accepted,
        Some(SC_STOP_NOT_ACTIVE) => StopRc::NotActive,
        _ => StopRc::Failed,
    }
}

/// 轮询等待的单步判定：观测到什么状态、已经等了多久 ⇒ 下一步。
///
/// 🔴 `Stopped` 的判定**优先于**超时：哪怕已经到点，只要这一次观测到了 STOPPED
/// （SCM 在超时瞬间恰好翻转完成）也算成功 —— 目标态达成比死守 deadline 重要。
#[allow(dead_code)]
fn stop_poll_decision(state: GuardState, elapsed: Duration, timeout: Duration) -> PollDecision {
    if state == GuardState::Stopped {
        return PollDecision::ReachedStopped;
    }
    if elapsed >= timeout {
        return PollDecision::GiveUp;
    }
    PollDecision::Continue
}

/// 「停不掉 ⇒ 中止更新」的面向用户文案。
///
/// 必须交代：发生了什么（服务停不下来）、为什么不硬来（硬覆盖=残缺安装）、下一步做什么。
/// 只带退出码数字，不带 sc.exe 的 stdout/stderr（那里可能带路径，见
/// `desktop::huanvaeguard::query_failure_reason` 同一条纪律）。
#[allow(dead_code)]
fn guard_stop_failure_message(reason: &str) -> String {
    format!(
        "无法停止 HuanvaeGuard 服务（{reason}）。为避免文件被占用导致残缺安装，本次更新已中止，未改动任何文件。请重启电脑后重试更新；若仍失败，请在管理员命令行执行 sc stop {GUARD_SERVICE_NAME} 后重试。"
    )
}

/// 「没有可信的服务状态」的文案（与 [`GuardState::NotRegistered`] 是两回事）。
#[allow(dead_code)]
fn guard_query_failure_message(rc: Option<i32>) -> String {
    match rc {
        Some(rc) => format!("查询 HuanvaeGuard 服务状态失败（sc query 返回 {rc}）"),
        None => "查询 HuanvaeGuard 服务状态失败（系统的服务查询程序 sc.exe 没能运行）".to_string(),
    }
}

/// 在 Windows 上执行命令并取 `(退出码, stdout)`；进程起不来返回 `None`。
/// 一律隐藏控制台窗口（与 `desktop::huanvaeguard::sc_command` 同款 CREATE_NO_WINDOW）。
#[cfg(target_os = "windows")]
fn run_captured(program: &str, args: &[&str]) -> Option<(i32, String)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some((out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned()))
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
fn run_captured(_program: &str, _args: &[&str]) -> Option<(i32, String)> {
    // 非 Windows 不会真的调用（调用点整段 cfg 掉），这里只是让本模块在所有平台可编译。
    None
}

/// Windows：查询 HuanvaeGuard 服务的 SCM 状态。
#[cfg(target_os = "windows")]
fn guard_query_state() -> GuardState {
    let Some((rc, stdout)) = run_captured("sc.exe", &["query", GUARD_SERVICE_NAME]) else {
        return GuardState::QueryFailed(None);
    };
    if rc == SC_QUERY_NO_SERVICE {
        return GuardState::NotRegistered;
    }
    if rc != 0 {
        return GuardState::QueryFailed(Some(rc));
    }
    parse_guard_state(&stdout)
}

/// Windows：更新落地前停服。返回 `Ok(running_before)`：更新前服务是否在运行
/// （仅用于日志/可观测；恢复不在这里做，见模块头第 4 步）。
///
/// - 服务不存在 / 已停止 ⇒ `Ok(false)`，零副作用；
/// - 在跑 ⇒ `sc stop` + 轮询等到 `STOPPED` ⇒ `Ok(true)`；
/// - 停不掉（`sc stop` 被拒且到点仍未停 / `sc query` 本身失败）⇒ `Err(面向用户的
///   中止文案)` —— 调用方（[`updater_sharded_install`]）据此在**安装器启动之前**中止，
///   绝不硬覆盖。
#[cfg(target_os = "windows")]
pub fn stop_guard_service_for_update() -> Result<bool, String> {
    let state = guard_query_state();
    match state {
        GuardState::NotRegistered | GuardState::Stopped => return Ok(false),
        GuardState::QueryFailed(rc) => {
            return Err(guard_query_failure_message(rc));
        }
        _ => {}
    }

    // 先记下「更新前在跑」—— 无论后面停成停不成，它都描述更新前的真实状态。
    let running_before = state == GuardState::Running;
    println!(
        "[Updater] 更新落地前停止 {GUARD_SERVICE_NAME} 服务（释放 huanvaeguard-svc.exe / wintun.dll 文件锁）..."
    );
    let stop_rc = run_captured("sc.exe", &["stop", GUARD_SERVICE_NAME]).map(|(rc, _)| rc);
    // 🔴 `sc stop` 的 rc（包括被拒的）在这里**不**作为结论 —— 结论只认下面的轮询终态。
    //    被拒只是让人多等满 30s，而不是立刻判死（理由见 [`StopRc::Failed`] 注释）；
    //    打一行日志把分类留在案，方便实机排查。
    match classify_stop_rc(stop_rc) {
        StopRc::Accepted => println!("[Updater] sc stop 已被 SCM 受理，等待服务完全停止..."),
        StopRc::NotActive => println!("[Updater] sc stop 返回 1062（服务本就未在运行），按已停止处理"),
        StopRc::Failed => println!("[Updater] sc stop 未被受理（rc={stop_rc:?}），仍按超时口径轮询终态"),
    }

    let start = std::time::Instant::now();
    loop {
        let now_state = guard_query_state();
        if let GuardState::QueryFailed(rc) = now_state {
            // 轮询途中查询坏了（SCM 忙/权限突变）⇒ 没有可信结论就不许落地。
            return Err(guard_query_failure_message(rc));
        }
        match stop_poll_decision(now_state, start.elapsed(), GUARD_STOP_TIMEOUT) {
            PollDecision::ReachedStopped => {
                println!("[Updater] {GUARD_SERVICE_NAME} 服务已完全停止，继续安装");
                return Ok(running_before);
            }
            PollDecision::GiveUp => {
                return Err(guard_stop_failure_message(&format!(
                    "等待 {}s 后仍未进入 STOPPED 状态",
                    GUARD_STOP_TIMEOUT.as_secs()
                )));
            }
            PollDecision::Continue => {
                std::thread::sleep(GUARD_STOP_POLL_INTERVAL);
            }
        }
    }
}

/// 切分片区间：返回 `[(start, end_inclusive)]`，闭区间、首尾相接、恰好覆盖 `[0, len)`。
///
/// 阈值分支删掉之后**所有**包都走分片，所以它必须对小 `len` 同样正确：
/// - `len < SHARD_COUNT` 时 `div_ceil` 得 `shard == 1`，只产出 `len` 个单字节区间，
///   多余的 `i` 因 `start >= len` 被 `take_while` 截掉 ⇒ 不产生**零长**或越界 Range；
/// - `len == 0` 由 [`require_shardable`] 在更早处挡掉，走不到这里（真收到 0 也只会
///   返回空 Vec，不会除零、不会下溢）。
fn shard_ranges(len: u64) -> Vec<(u64, u64)> {
    let shard = len.div_ceil(SHARD_COUNT);
    (0..SHARD_COUNT)
        .map(|i| i * shard)
        .take_while(|start| *start < len)
        .map(|start| (start, std::cmp::min(start + shard - 1, len - 1)))
        .collect()
}

/// 分片并发下载 + 验签 + 安装。
///
/// 前端传入 `rid` = `@tauri-apps/plugin-updater` 的 `Update.rid`（`Update extends Resource`）。
///
/// `#[tauri::command]` 挂在 lib.rs 的包装函数上（与 `desktop::get_windows_installer_type()`
/// 同样的委托写法），这样移动端能给同名存根，`generate_handler!` 列表在所有平台都能编过。
pub async fn updater_sharded_install<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    on_event: Channel<ShardedEvent>,
) -> Result<(), String> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| format!("取不到 Update 资源（rid={rid}）: {e}"))?;

    let url = update.download_url.to_string();
    let signature = update.signature.clone();
    let pubkey = pubkey_from_config(&webview)?;

    // 🔴 请求整形必须与插件 download() 一致，否则调用方在 check() 里配的
    // headers / timeout / proxy 会被静默丢弃。这一个 client 同时服务于
    // probe(HEAD) / fetch_shard(GET Range)，两条出口一起覆盖。
    let shaping = RequestShaping {
        headers: update.headers.clone(),
        timeout: update.timeout,
        proxy: update.proxy.as_ref().map(|p| p.to_string()),
        no_proxy: update.no_proxy,
        accept_invalid_certs: updater_config_flag(
            &webview,
            "dangerousAcceptInvalidCerts",
            "dangerous-accept-invalid-certs",
        ),
        accept_invalid_hostnames: updater_config_flag(
            &webview,
            "dangerousAcceptInvalidHostnames",
            "dangerous-accept-invalid-hostnames",
        ),
    };
    let client = build_client(&shaping)?;

    // 断点落点：应用**缓存**目录，`.part` 与清单同目录、成对存在。
    //
    // 这里刻意**不**用本仓 portable 模式那个 `user_data::get_app_root()`（`<exe_dir>/data`）：
    // 半截安装包是纯粹的可重建中间产物，属于缓存语义 —— 让系统能回收它是对的，
    // 也不该跟着 portable 数据目录被用户拷来拷去。安卓侧同理（用 `cache_dir()`）。
    let cache_dir = webview
        .path()
        .app_cache_dir()
        .map_err(|e| format!("取应用缓存目录失败: {e}"))?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let part_path = cache_dir.join(PART_FILE_NAME);
    let meta_path = cache_dir.join(PART_META_FILE_NAME);

    let Probe { total, accepts_range, validator } = probe(&client, &url).await?;

    // 🔴 先判前提再报 Started：不满足就是这次更新的终点，不该先给用户一个"开始下载"
    // 的假象。这里没有"另一种下载方式"可选 —— 判不过就是 Err，文案直达用户。
    let len = require_shardable(total, accepts_range)?;

    // ── 决定「接着下」还是「重下」──
    //
    // 三个条件缺一不可：清单存在且自洽、[`can_resume`] 判定远端未变、`.part` 的实际长度
    // 就是 total（它是预分配出来的；长度对不上说明这文件不是我们这轮的产物）。
    let layout: Vec<ShardProgress> = match load_meta(&meta_path) {
        Some(meta)
            if can_resume(&meta, &url, len, validator.as_deref())
                && fs::metadata(&part_path).map(|m| m.len() == len).unwrap_or(false) =>
        {
            let already: u64 = meta.shards.iter().map(|s| s.done).sum();
            println!(
                "[Updater] 断点续传：{already}/{len} 字节已在盘上，只补剩下的"
            );
            meta.shards
        }
        other => {
            if other.is_some() {
                println!("[Updater] 断点清单与当前远端对不上（或 .part 已损坏），丢弃重下");
            }
            discard_part(&part_path, &meta_path);
            fresh_layout(shard_ranges(len))
        }
    };

    // 预分配：各片按偏移写入，文件必须先有足够长度（续传时这一步是幂等的）
    {
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&part_path)
            .map_err(|e| format!("创建 .part 失败: {e}"))?;
        f.set_len(len).map_err(|e| format!("预分配 .part 失败: {e}"))?;
    }

    let resumed: u64 = layout.iter().map(|s| s.done).sum();
    let progress = Arc::new(AtomicU64::new(resumed));
    let counters: Vec<Arc<AtomicU64>> = layout
        .iter()
        .map(|s| Arc::new(AtomicU64::new(s.done)))
        .collect();

    // 起点直接写进 Started：进度条一上来就停在断点处（不是先 0 再跳），
    // 且前端速率估算把它当基线而不是"200ms 内下了这么多"。
    let _ = on_event.send(ShardedEvent::Started {
        content_length: Some(len),
        downloaded: resumed,
    });

    // 清单先落一份：没有 validator 就不可能续（[`can_resume`] 会拒），此时**不写清单**，
    // 免得留一个注定被丢弃的脏文件（那种情况下的 `.part` 由下一轮的 discard 分支收走）。
    if let Some(v) = &validator {
        save_meta(&meta_path, &snapshot_meta(&url, len, v, &layout, &counters));
    }

    let mut tasks = Vec::new();
    for (shard, counter) in layout.iter().cloned().zip(counters.iter().cloned()) {
        tasks.push(tokio::spawn(fetch_shard(
            client.clone(),
            url.clone(),
            part_path.clone(),
            shard,
            validator.as_deref().map(|v| if_range_value(v).to_string()),
            counter,
            progress.clone(),
        )));
    }

    // 进度上报：分片是并发的，用累计已下字节数算真实百分比
    //
    // 🔴 顺序是「先发一条再睡」，不是「先睡再发」。所有分片跑完后本任务会被
    // `reporter.abort()` 立刻掐掉（见下方），所以「睡够一个 tick」是**上报能不能发生**的
    // 前提，不只是延迟：整次下载短于一个 tick 时，旧写法一条 `Progress` 都发不出去。
    // 本机 13.8 MB 包实测 0.73s（够 3 个 tick）没暴露，但 Windows 安装包只有 9.3 MB，
    // 更快的链路就会掉进这个窗口。
    // ⚠️ 把 200ms 调小**不是**修法：那只是把窗口挪窄，窗口本身还在。
    //
    // 首帧那条的 `downloaded` 就是断点起点（非续传时为 0），与 `Started` 同值 ——
    // 两条之间 Δt≈0，前端速率估算的 `MIN_SAMPLE_INTERVAL_MS`（50ms）会整条丢弃它，
    // 不会因为除以一个极小的 dt 而算出假的瞬时速率（见 `src/update/downloadSpeed.ts`）。
    let reporter = {
        let progress = progress.clone();
        let ch = on_event.clone();
        tokio::spawn(async move {
            loop {
                let done = progress.load(Ordering::Relaxed);
                let _ = ch.send(ShardedEvent::Progress {
                    downloaded: done,
                    content_length: Some(len),
                });
                if done >= len {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
    };

    // 清单持久化：节流 1s。它跑在**独立任务**里，这样长时间下载中途被杀也留得下断点。
    let persister = validator.clone().map(|v| {
        let meta_path = meta_path.clone();
        let url = url.clone();
        let layout = layout.clone();
        let counters = counters.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(META_FLUSH_INTERVAL).await;
                save_meta(&meta_path, &snapshot_meta(&url, len, &v, &layout, &counters));
            }
        })
    });

    // 🔴 必须**等所有分片都结束**再返回错误（旧实现是 `?` 直接早退）：早退会把还在跑的
    //    分片连同它们刚写下的字节一起扔掉，而那些字节本可以计进断点。
    let mut first_err: Option<String> = None;
    for t in tasks {
        let outcome = match t.await {
            Ok(inner) => inner,
            Err(e) => Err(format!("分片任务 panic: {e}")),
        };
        if let Err(e) = outcome {
            first_err.get_or_insert(e);
        }
    }
    reporter.abort();
    if let Some(p) = persister {
        p.abort();
    }

    // 🔴 无论成败都落一次**最终**清单：失败时这正是「下次接着下」的唯一依据。
    //    少了这一步，最后一秒内下的字节就白下了（更糟的是失败往往就发生在那一秒）。
    if let Some(v) = &validator {
        save_meta(&meta_path, &snapshot_meta(&url, len, v, &layout, &counters));
    }
    if let Some(e) = first_err {
        return Err(e);
    }

    let bytes = fs::read(&part_path).map_err(|e| format!("读取 .part 失败: {e}"))?;
    if bytes.len() as u64 != len {
        discard_part(&part_path, &meta_path);
        return Err(format!(
            ".part 大小不符：期望 {len}，实到 {}",
            bytes.len()
        ));
    }

    // 🔴 验签：插件的 install() 不验签，这一步丢了就等于装了未经验证的包。
    //    它同时是断点续传的**完整性收口** —— 拼错一个字节都过不了。
    if let Err(e) = verify_signature(&bytes, &signature, &pubkey) {
        // 验不过 = 这堆字节不可信。必须连 .part 一起删，否则下次续传会永远从这堆坏字节
        // 接着下、每次都在同一处失败，用户永远更新不了。
        discard_part(&part_path, &meta_path);
        return Err(e);
    }

    let _ = on_event.send(ShardedEvent::Finished);

    // 🔴 Windows：安装器将覆盖 $INSTDIR 下的 huanvaeguard-svc.exe / wintun.dll，
    //    必须先停掉 HuanvaeGuard 服务并**等到 STOPPED**（释放文件锁）才允许落地。
    //    位置在验签之后：万一验签失败，服务不该被白停一次；在 Finished 事件之后：
    //    停服失败 ⇒ Err 直接中止，前端拿到明确文案，不会出现「下载完成却装不上」的半截态。
    //    停不掉 ⇒ 这里的 Err 在安装器启动**之前**返回 —— 一个文件都没动，无残缺安装。
    #[cfg(target_os = "windows")]
    let _guard_was_running = stop_guard_service_for_update()?;

    update
        .install(&bytes)
        .map_err(|e| format!("安装失败: {e}"))?;

    // 安装成功才清理。安装失败时 `.part` 留着 —— 它已经验签通过，下次「重试」是
    // 「零重下 + 直接验签安装」。
    discard_part(&part_path, &meta_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用真实产物的 pubkey/signature 反例：篡改过的数据必须验签失败。
    /// 这条守住「自己下载后验签不能被跳过」——如果 verify_signature 被改成恒真，本测试立刻红。
    #[test]
    fn tampered_data_fails_signature_check() {
        // tauri.conf.json 里的真实 pubkey
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNGOTFDMzBGQTkxQTc1NUEKUldSYWRScXBEOE9SUDVCWUJjZnYvaHBSdzNkbk5PTWRmUzNkVjdlamtDK2xTOXI4UmVZYUhDbGMK";
        // 随便一段不匹配的签名（格式合法但对不上数据）
        let bogus_sig = base64::engine::general_purpose::STANDARD.encode(
            "untrusted comment: signature from tauri secret key\nRUR\ntrusted comment: x\nAAAA\n",
        );
        let r = verify_signature(b"whatever", &bogus_sig, pubkey);
        assert!(r.is_err(), "篡改/不匹配的数据必须验签失败");
    }

    /// 🔴 正对照：上面两条只断言 `is_err()`，如果 verify_signature 坏成「什么都拒」，
    /// 它们照样全绿，而线上表现是**永远装不上更新**。所以必须证明「合法输入能走通解析」，
    /// 否则那两条断言等于没有区分力。
    #[test]
    fn real_pubkey_parses_ok() {
        let pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNGOTFDMzBGQTkxQTc1NUEKUldSYWRScXBEOE9SUDVCWUJjZnYvaHBSdzNkbk5PTWRmUzNkVjdlamtDK2xTOXI4UmVZYUhDbGMK";
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(pubkey)
            .expect("真实 pubkey 必须能 base64 解码");
        let s = std::str::from_utf8(&decoded).expect("解码后必须是 UTF-8");
        PublicKey::decode(s).expect("真实 pubkey 必须能被 minisign-verify 解析——解析不了说明校验链本身坏了");
    }

    #[test]
    fn bad_pubkey_is_rejected() {
        let r = verify_signature(b"data", "aGVsbG8=", "bm90LWEta2V5");
        assert!(r.is_err(), "非法 pubkey 必须报错而不是放行");
    }

    // ---------- 分片是唯一路径：前提判定 + 小文件切分 ----------

    /// 服务端不声明 `accept-ranges: bytes` ⇒ 必须报错中止，且给的是**用户能照做**的文案。
    /// 这条是「不静默降级」的机器化守卫：一旦有人把它改回"探测不到就换种下载方式"，
    /// 返回值就不再是 Err，本测试立刻翻红。
    #[test]
    fn require_shardable_rejects_source_without_range_support() {
        let e = require_shardable(Some(9_284_371), false)
            .expect_err("不支持 Range 必须报错中止，绝不降级");
        assert_eq!(e, ERR_RANGE_UNSUPPORTED);
        assert!(
            e.contains("已中止更新") && e.contains("手动下载"),
            "文案必须说明已中止并给出下一步动作，实际: {e}"
        );
    }

    /// 长度缺失 / 长度为 0 都切不出有效 Range ⇒ 同样报错中止。
    /// 长度为 0 这条尤其重要：阈值分支删掉后它不再有别的出口，
    /// 若放行会得到「零个分片 → 合并出空字节 → 拿空数据去验签」。
    #[test]
    fn require_shardable_rejects_unknown_or_zero_length() {
        for total in [None, Some(0u64)] {
            let e = require_shardable(total, true)
                .expect_err(&format!("total={total:?} 必须报错中止，不得放行"));
            assert_eq!(e, ERR_TOTAL_UNKNOWN, "total={total:?}");
            assert!(
                e.contains("已中止更新") && e.contains("手动下载"),
                "文案必须说明已中止并给出下一步动作，实际: {e}"
            );
        }
    }

    /// 正对照：前提都满足时必须放行并原样给出总长 —— 否则上面两条"恒 Err"也能全绿，
    /// 而线上表现是**永远更新不了**。
    #[test]
    fn require_shardable_accepts_valid_probe() {
        assert_eq!(require_shardable(Some(1), true), Ok(1));
        assert_eq!(require_shardable(Some(9_284_371), true), Ok(9_284_371));
    }

    /// 分片边界不能重叠、不能漏字节、不能零长 —— 直接测生产函数 [`shard_ranges`]，
    /// 不在测试里另抄一份切分逻辑（抄一份就只能证明"两份抄写一致"）。
    ///
    /// 覆盖面刻意压到 `len < SHARD_COUNT`：阈值分支删除后所有包都走分片，
    /// 小文件是新暴露出来的输入域。
    #[test]
    fn shard_boundaries_cover_exactly() {
        for len in [
            1u64, 2, 3, 7, 8, 9, 15, 1023, 1024, 1024 * 1024, 9_284_371, 13_646_531, 13_646_532,
        ] {
            let ranges = shard_ranges(len);
            assert!(!ranges.is_empty(), "任何非零长度都必须切出至少一片 (len={len})");
            assert!(
                ranges.len() as u64 <= SHARD_COUNT,
                "分片数不得超过 SHARD_COUNT (len={len})"
            );

            let mut covered = 0u64;
            let mut prev_end: Option<u64> = None;
            for (start, end) in &ranges {
                assert!(end >= start, "区间是闭区间，不得出现零长/倒置 (len={len})");
                assert!(*end < len, "区间不得越过末字节 (len={len})");
                if let Some(pe) = prev_end {
                    assert_eq!(*start, pe + 1, "分片之间必须连续无缝 (len={len})");
                }
                covered += end - start + 1;
                prev_end = Some(*end);
            }
            assert_eq!(covered, len, "分片必须恰好覆盖全部字节 (len={len})");
            assert_eq!(prev_end, Some(len - 1), "最后一片必须到达末字节 (len={len})");
        }
    }

    /// `len < SHARD_COUNT` 时不该硬凑满 8 片（凑满就必然出现零长 Range）。
    #[test]
    fn shard_ranges_of_tiny_file_are_single_bytes() {
        assert_eq!(shard_ranges(1), vec![(0, 0)]);
        assert_eq!(shard_ranges(3), vec![(0, 0), (1, 1), (2, 2)]);
    }

    // ---------- 请求整形（复刻 updater.rs:657-687）----------

    /// 插件无条件补 `Accept: application/octet-stream`（`updater.rs:659-661`）。
    #[test]
    fn shaping_headers_adds_accept_when_absent() {
        let out = shaping_headers(&HeaderMap::new());
        assert_eq!(
            out.get(ACCEPT).map(|v| v.to_str().unwrap()),
            Some("application/octet-stream"),
            "缺省时必须补上 Accept，否则部分更新源会按 text/html 回内容"
        );
    }

    /// 插件是 `if !headers.contains_key(ACCEPT)` —— 用户显式给了就**不能**覆盖。
    #[test]
    fn shaping_headers_does_not_override_user_accept() {
        let mut user = HeaderMap::new();
        user.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let out = shaping_headers(&user);
        assert_eq!(
            out.get(ACCEPT).map(|v| v.to_str().unwrap()),
            Some("application/json"),
            "用户显式设置的 Accept 必须原样保留"
        );
    }

    /// 用户经 `check()` 传的其它自定义头（鉴权 / 灰度标记等）必须一并带上。
    #[test]
    fn shaping_headers_preserves_user_headers() {
        let mut user = HeaderMap::new();
        user.insert("x-update-channel", HeaderValue::from_static("beta"));
        let out = shaping_headers(&user);
        assert_eq!(
            out.get("x-update-channel").map(|v| v.to_str().unwrap()),
            Some("beta"),
            "用户自定义头不能被丢掉"
        );
        // 补 Accept 与保留用户头两件事必须同时成立
        assert!(out.contains_key(ACCEPT), "补 Accept 不能以丢掉用户头为代价");
    }

    /// 从 Cargo.lock 取插件真实版本 —— 独立于本文件的真值源。
    fn plugin_version_from_lockfile() -> String {
        const LOCK: &str = include_str!("../Cargo.lock");
        const NAME: &str = "name = \"tauri-plugin-updater\"";
        const VER: &str = "version = \"";
        let after = &LOCK[LOCK.find(NAME).expect("Cargo.lock 里应有 tauri-plugin-updater")..];
        let start = after.find(VER).expect("包条目后应有 version 字段") + VER.len();
        let end = start + after[start..].find('"').expect("version 字符串应闭合");
        after[start..end].to_string()
    }

    /// UA 是按值复刻的（插件那个 const 私有，见 [`UPDATER_USER_AGENT`] 注释），
    /// 所以必须有东西盯着它别跟插件版本漂移 —— 升级插件后本测试会立刻翻红。
    #[test]
    fn user_agent_matches_plugin_version_in_lockfile() {
        let expected = format!("tauri-plugin-updater/{}", plugin_version_from_lockfile());
        assert_eq!(
            UPDATER_USER_AGENT, expected,
            "UA 与 Cargo.lock 里的插件版本不一致：插件升版后请同步 UPDATER_USER_AGENT"
        );
    }

    // 下面几条断言的观测面是 `reqwest::Client` 的 `Debug` —— 它会把 `default_headers` /
    // `proxies` / `timeout` 原样打出来（`reqwest-0.12.28/src/async_impl/client.rs`
    // `fn fmt_fields`）。用它才能证明整形**真的被交给了 reqwest**，而不是只在我们自己的
    // 结构体里躺着：任何一项接线被删，对应断言立刻翻红。

    fn debug_of(shaping: &RequestShaping) -> String {
        format!("{:?}", build_client(shaping).expect("client 必须能建出来"))
    }

    /// UA（`updater.rs:663`）+ Accept（`:659-661`）必须真的落到 client 上。
    #[test]
    fn build_client_carries_plugin_user_agent_and_accept() {
        let debug = debug_of(&RequestShaping::default());
        assert!(
            debug.contains(&format!("\"user-agent\": \"{UPDATER_USER_AGENT}\"")),
            "client 必须带插件同款 UA，实际: {debug}"
        );
        assert!(
            debug.contains("\"accept\": \"application/octet-stream\""),
            "client 必须带 Accept: application/octet-stream，实际: {debug}"
        );
    }

    /// 用户自定义头要带上；用户若自带 UA，**用户的赢**（插件那边是请求级 headers
    /// 盖过 client 级 UA，本模块靠 `.user_agent()` 在前、`.default_headers()` 在后
    /// 的次序等价实现 —— 这条把该次序钉死）。
    #[test]
    fn build_client_carries_user_headers_and_lets_user_ua_win() {
        let mut headers = HeaderMap::new();
        headers.insert("x-update-channel", HeaderValue::from_static("beta"));
        headers.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_static("my-own-agent/9"),
        );
        let debug = debug_of(&RequestShaping {
            headers,
            ..Default::default()
        });
        assert!(
            debug.contains("\"x-update-channel\": \"beta\""),
            "用户自定义头必须落到 client 上，实际: {debug}"
        );
        assert!(
            debug.contains("\"user-agent\": \"my-own-agent/9\""),
            "用户显式给的 UA 必须覆盖插件默认 UA，实际: {debug}"
        );
    }

    /// 显式代理必须真的进到 client 的 proxies 里（`updater.rs:675-677`）。
    #[test]
    fn build_client_applies_explicit_proxy() {
        let debug = debug_of(&RequestShaping {
            proxy: Some("http://127.0.0.1:8080".to_string()),
            ..Default::default()
        });
        assert!(
            debug.contains("http://127.0.0.1:8080"),
            "显式代理必须出现在 client 的 proxies 里，实际: {debug}"
        );
    }

    /// `no_proxy`（`updater.rs:673`）必须清空代理；同时这条也钉住了插件的
    /// `if no_proxy { .. } else if let Some(proxy) { .. }` 次序 —— 两者同时给时以
    /// `no_proxy` 为准，代理不得出现。
    #[test]
    fn build_client_no_proxy_clears_proxies_and_wins_over_proxy() {
        let debug = debug_of(&RequestShaping {
            proxy: Some("http://127.0.0.1:8080".to_string()),
            no_proxy: true,
            ..Default::default()
        });
        assert!(
            !debug.contains("proxies"),
            "no_proxy 必须把代理清空（含系统代理），实际: {debug}"
        );
        assert!(
            !debug.contains("127.0.0.1:8080"),
            "no_proxy 为真时不得再应用 proxy 字段，实际: {debug}"
        );
    }

    /// 反向对照：**不** 设 no_proxy 时 reqwest 默认就会带上系统代理匹配器
    /// （`auto_sys_proxy` 默认 true）。这条是模块头注释那个「漏掉 proxy 字段 ≠
    /// 不走系统代理」结论的机器化证据，防止后人再据此误判。
    #[test]
    fn default_shaping_keeps_system_proxy_detection() {
        let debug = debug_of(&RequestShaping::default());
        assert!(
            debug.contains("proxies"),
            "默认应保留 reqwest 的系统代理探测，实际: {debug}"
        );
    }

    // ---------- 断点续传：清单与分片布局必须互相认账 ----------

    /// [`shard_ranges`] 生成的布局，必须被清单校验 [`shards_tile_exactly`] 接受。
    ///
    /// 这两个函数一个在生产模块、一个在共用模块，是**两份独立的不变量表述**（生成 vs 验收）。
    /// 它们一旦对不上，表现是「刚写下的清单下一次被自己判为损坏」⇒ 断点续传静默失效、
    /// 每次都从头下，而且**不会有任何报错**。所以必须有东西把两边钉在一起。
    #[test]
    fn fresh_layout_from_shard_ranges_passes_manifest_validation() {
        use crate::resume_meta::shards_tile_exactly;
        for len in [1u64, 2, 7, 8, 9, 1023, 1024, 9_284_371, 13_766_023] {
            let layout = fresh_layout(shard_ranges(len));
            assert!(
                shards_tile_exactly(&layout, len),
                "shard_ranges 生成的布局必须能通过清单校验 (len={len})"
            );
        }
    }

    // ---------- 与测速台的一致性 ----------

    /// 测速台是**另一份代码**，天然会漂移。这条把两个 h2 窗口值钉在一起：
    /// 谁改了生产的窗口却没同步测速台，测出来的数字就与线上无关 —— 立刻翻红。
    #[test]
    fn bench_harness_mirrors_production_http2_windows() {
        const BENCH: &str = include_str!("../../scripts/bench/download-bench/src/main.rs");
        assert!(
            BENCH.contains("const PROD_H2_STREAM_WINDOW: u32 = 4 * 1024 * 1024;"),
            "测速台的 stream 窗口与生产不一致（生产 = 4 MiB）"
        );
        assert!(
            BENCH.contains("const PROD_H2_CONNECTION_WINDOW: u32 = 8 * 1024 * 1024;"),
            "测速台的 connection 窗口与生产不一致（生产 = 8 MiB）"
        );
        // 正对照：上面两条靠 contains，若把常量整块删了它们会红；这条证明文件本身读得到，
        // 不是 include_str! 读进了空内容让断言"看着在查其实什么都没查"。
        assert!(
            BENCH.len() > 1000,
            "测速台源码没读进来（include_str! 路径错了？），上面的断言等于没查"
        );
    }

    /// 只取**生产代码**那一段（`#[cfg(test)]` 之前）来做静态扫描。
    ///
    /// 不切掉测试模块的话，断言里写的那个"禁止出现的字面量"会**命中自己** ⇒ 恒 FAIL。
    /// （本文件这两条守卫第一次写就这么翻的车。）没有 `#[cfg(test)]` 的文件原样返回。
    fn production_source(src: &str) -> &str {
        src.split_once("#[cfg(test)]").map(|(p, _)| p).unwrap_or(src)
    }

    /// 一行代码（不含 `//` 之后的注释）里是否出现了某个 token。
    ///
    /// 必须剥注释：两个下载器和测速台的注释里都**特意**写着
    /// 「绝对不要改成 `http2_adaptive_window(true)`」—— 那些警告正是要保留的东西，
    /// 不剥注释就会把它们当成违规。
    fn code_mentions(src: &str, token: &str) -> bool {
        production_source(src)
            .lines()
            .any(|line| line.split("//").next().unwrap_or("").contains(token))
    }

    /// 🔴 反面守卫：`http2_adaptive_window(true)` 会**覆盖**上面两个显式窗口
    /// （reqwest 官方文档原话），且实测更差（单流 4.07 MB/s，连改前 6.31 都不如）。
    /// 谁"顺手打开自适应"就等于把已生效的优化静默作废 —— 这条把它钉死。
    #[test]
    fn http2_adaptive_window_is_never_enabled() {
        const PROD: &str = include_str!("updater_download.rs");
        const ANDROID: &str = include_str!("android_update.rs");
        const BENCH: &str = include_str!("../../scripts/bench/download-bench/src/main.rs");
        for (name, src) in [
            ("updater_download.rs", PROD),
            ("android_update.rs", ANDROID),
            ("download-bench", BENCH),
        ] {
            assert!(src.len() > 1000, "{name} 源码没读进来，本断言等于没查");
            assert!(
                !code_mentions(src, "http2_adaptive_window"),
                "{name} 的**代码**里出现了 http2_adaptive_window —— 它会覆盖两个显式窗口且实测更差"
            );
        }
        // 正对照：确认剥注释这套判据不是"永远查不到东西"——
        // 三份文件的代码里都必须查得到那两个显式窗口设置。
        for (name, src) in [
            ("updater_download.rs", PROD),
            ("android_update.rs", ANDROID),
            ("download-bench", BENCH),
        ] {
            assert!(
                code_mentions(src, "http2_initial_stream_window_size"),
                "{name} 的代码里应当查得到显式窗口设置；查不到说明判据本身失效了"
            );
        }
    }

    /// timeout（`updater.rs:670-672`）与两个 dangerous TLS 开关（`:664-669`）必须接线。
    #[test]
    fn build_client_applies_timeout_and_danger_flags() {
        let debug = debug_of(&RequestShaping {
            timeout: Some(Duration::from_secs(37)),
            accept_invalid_certs: true,
            accept_invalid_hostnames: true,
            ..Default::default()
        });
        // reqwest 0.12.28 把整体超时打成 `reqwest::config::TotalTimeout: 37s`
        assert!(
            debug.contains("TotalTimeout: 37s"),
            "用户配置的 timeout 必须落到 client 上，实际: {debug}"
        );
    }

    // ---------- 🔴 Windows 更新落地前停服：判定逻辑（跨平台可测的部分） ----------

    /// `sc query` 输出 → 状态。真实 sc.exe（Win10/11 英文区）的 STATE 行形态就是
    /// `"        STATE              : 4  RUNNING"`，这里按真实形态造样本。
    /// 🔴 负对照思想同上文验签那两条：如果 parse 坏成「什么都给同一个答案」，
    /// 停服循环要么永远等不到 STOPPED、要么把 RUNNING 读成 STOPPED 直接硬覆盖 ——
    /// 两个方向都是事故，所以四态必须互不混洧。
    #[test]
    fn guard_state_parsing_distinguishes_all_states() {
        let line = |state: &str| {
            format!(
                "SERVICE_NAME: HuanvaeGuard\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : {state}\r\n"
            )
        };
        assert_eq!(parse_guard_state(&line("4  RUNNING")), GuardState::Running);
        assert_eq!(parse_guard_state(&line("1  STOPPED")), GuardState::Stopped);
        assert_eq!(
            parse_guard_state(&line("2  START_PENDING")),
            GuardState::Pending
        );
        assert_eq!(
            parse_guard_state(&line("3  STOP_PENDING")),
            GuardState::Pending
        );
        // 无 STATE 行 / 空输出 / 错误文本 ⇒ Unknown（rc 判定在 guard_query_state，进不了这里）
        assert_eq!(parse_guard_state(""), GuardState::Unknown);
        assert_eq!(parse_guard_state("[SC] QueryServiceStatus FAILED 1058:"), GuardState::Unknown);
        // 🔴 负对照：四态的形状必须互不相同 —— 否则上面的断言没有区分力
        let all = [
            parse_guard_state(&line("4  RUNNING")),
            parse_guard_state(&line("1  STOPPED")),
            parse_guard_state(&line("2  START_PENDING")),
            GuardState::Unknown,
        ];
        for (i, a) in all.iter().enumerate() {
            for (j, b) in all.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "第 {i} 态与第 {j} 态撞了：{a:?} == {b:?}");
                }
            }
        }
    }

    /// STATE 行解析只认 STATE 行：其它行里的关键字不得干扰判定。
    /// （sc query 输出里 SERVICE_NAME 就含服务名，若将来有人把 “RUNNING” 写进别名/描述
    /// 也不得影响。）
    #[test]
    fn guard_state_parsing_only_trusts_the_state_line() {
        // SERVICE_NAME 行含 "RUNNING" 但没有 STATE 行 ⇒ 不得读成 Running
        assert_eq!(
            parse_guard_state("SERVICE_NAME: HuanvaeGuard-RUNNING-SUFFIX"),
            GuardState::Unknown
        );
        // STATE 行在后面的多行输出里也要能找到
        let multi = "DISPLAY_NAME: HuanvaeGuard VPN Service\r\n        STATE              : 1  STOPPED\r\n";
        assert_eq!(parse_guard_state(multi), GuardState::Stopped);
    }

    /// `sc stop` 退出码三分类。0=受理；1062=本就没在跑（目标态已达成，算成功）；
    /// 其余一切（含 None=sc.exe 没起来）都是 Failed。
    #[test]
    fn stop_rc_classification_covers_every_exit() {
        assert_eq!(classify_stop_rc(Some(0)), StopRc::Accepted);
        assert_eq!(classify_stop_rc(Some(1062)), StopRc::NotActive);
        assert_eq!(classify_stop_rc(Some(5)), StopRc::Failed, "拒绝访问不得读成成功");
        assert_eq!(classify_stop_rc(Some(1061)), StopRc::Failed, "死锁 1061 不得读成成功");
        assert_eq!(classify_stop_rc(None), StopRc::Failed, "sc.exe 没起来不得读成成功");
    }

    /// 「等待完全停止」的核心判定：STOPPED 优先于超时；未停且到点 ⇒ 放弃；
    /// 未停未到点 ⇒ 继续。🔴 超时边界（elapsed == timeout）必须判放弃，
    /// 否则轮询循环在钟点之后仍可能永远 Continue。
    #[test]
    fn stop_poll_decision_waits_then_gives_up() {
        let t = Duration::from_secs(30);
        // 已停：无论等多久都算到达（超时瞬间 SCM 刚翻转完成也算成功）
        assert_eq!(
            stop_poll_decision(GuardState::Stopped, Duration::ZERO, t),
            PollDecision::ReachedStopped
        );
        assert_eq!(
            stop_poll_decision(GuardState::Stopped, t, t),
            PollDecision::ReachedStopped
        );
        // 没停、没到点 ⇒ 继续（Running / Pending / Unknown 一视同仁地等）
        for s in [GuardState::Running, GuardState::Pending, GuardState::Unknown] {
            assert_eq!(
                stop_poll_decision(s, Duration::ZERO, t),
                PollDecision::Continue,
                "state={s:?} 在到点前必须继续等"
            );
        }
        // 没停、恰好到点（边界）与过点 ⇒ 放弃
        for s in [GuardState::Running, GuardState::Pending, GuardState::Unknown] {
            assert_eq!(
                stop_poll_decision(s, t, t),
                PollDecision::GiveUp,
                "state={s:?} 到点未停必须放弃，绝不硬覆盖"
            );
            assert_eq!(
                stop_poll_decision(s, t + Duration::from_millis(1), t),
                PollDecision::GiveUp
            );
        }
    }

    /// 中止文案必须交代「发生了什么/为什么不硬来/下一步做什么」，且不带路径。
    /// （sc 的 stdout 可能含安装路径；本仓是 PUBLIC 仓 —— 同
    /// `desktop::huanvaeguard::query_failure_reason` 的纪律。）
    #[test]
    fn guard_failure_message_is_actionable_and_leaks_no_path() {
        let m = guard_stop_failure_message("等待 30s 后仍未进入 STOPPED 状态");
        assert!(m.contains("已中止"), "必须说明已中止更新：{m}");
        assert!(m.contains("未改动任何文件"), "必须说明无残缺安装：{m}");
        assert!(m.contains("重启电脑"), "必须给出下一步动作：{m}");
        assert!(m.contains("sc stop HuanvaeGuard"), "必须给出兜底命令：{m}");
        assert!(!m.contains("C:\\"), "不得出现路径：{m}");

        let q1 = guard_query_failure_message(Some(5));
        let q2 = guard_query_failure_message(None);
        assert!(q1.contains('5') && !q2.contains('5'), "退出码必须出现在原因里");
        assert_ne!(q1, q2, "两种失败形态的文案不许撞");
        for s in [&q1, &q2] {
            assert!(!s.contains("C:\\"), "不得出现路径：{s}");
        }
    }

    /// 🔴 Windows 之外的平台上，本段唯一的 Windows 出口
    /// [`stop_guard_service_for_update`] 不得参与编译（调用点已用 `#[cfg]` 钉在
    /// Windows）；这条在非 Windows 平台上只验证纯函数面存在且可调用 —— 防止有人把
    /// 调用点的 `#[cfg]` 拆掉后，Linux 上才在编译期报错（CI 首轮就红不了）。
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn guard_stop_pure_surface_compiles_everywhere() {
        // 纯函数在非 Windows 平台必须可用（这正是它们被抽成纯函数的原因）
        let _ = parse_guard_state("STATE : 1  STOPPED");
        let _ = classify_stop_rc(Some(0));
        let _ = stop_poll_decision(GuardState::Stopped, Duration::ZERO, GUARD_STOP_TIMEOUT);
        let _ = guard_stop_failure_message("x");
        let _ = guard_query_failure_message(None);
    }

    // ---------- 真机集成测试（#[ignore]，只在 Windows 实机上手动跑）----------
    //
    // 这两条在真实 SCM 上验证「停服等待」与「停不掉即中止」两个分支。它们对机器状态
    // 有真实副作用（停服务 / 改服务 SDDL），所以不进常规 CI —— 由 VM 验收
    // （winserver-hg，blockId 1789554821716-b12sxey0-1）显式跑：
    //     cargo test --lib updater_download::tests::win_machine -- --ignored --nocapture

    /// 停服分支：调 stop_guard_service_for_update 后，SCM 终态必须是 STOPPED；
    /// 若服务此前在跑，测完恢复运行（测试不留状态）。
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "真机集成：需要 Windows + HuanvaeGuard 服务（会真的停/启服务）"]
    fn win_machine_guard_stop_reaches_stopped() {
        let running_before = stop_guard_service_for_update().expect("停服必须成功");
        // 独立复核（不信被测函数自己的结论）：SCM 此刻必须报 STOPPED
        assert_eq!(
            guard_query_state(),
            GuardState::Stopped,
            "停服返回 Ok 但 SCM 未到 STOPPED"
        );
        println!("[win-machine] running_before={running_before}, SCM 终态=STOPPED");
        // 恢复：更新前在跑的场景下把它拉回来（守模拟真实更新后的恢复路径）
        if running_before {
            let out = run_captured("sc.exe", &["start", GUARD_SERVICE_NAME]);
            println!("[win-machine] 恢复启动 rc={out:?}");
        }
    }

    /// 中止分支：人为让服务「停不掉」（回收 AU 的 SERVICE_STOP 权限）⇒
    /// stop_guard_service_for_update 必须在超时后返回 Err（含「已中止」文案），
    /// 而不是带着文件锁继续落地。测完恢复 SDDL 并拉回服务。
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "真机集成：需要 Windows + 管理员 + HuanvaeGuard 服务（会改服务 SDDL）"]
    fn win_machine_undeniable_stop_aborts_update() {
        // 前提：服务存在且【完全进入 RUNNING】——前一个测试可能刚 sc start，
        // START_PENDING 中去 deny/stop 会遇到 SCM 竞态（START_PENDING 里的服务
        // 可能被直接停掉，恰好绕过 deny），所以先等启动完成。
        let mut saw_running = false;
        for _ in 0..60 {
            if guard_query_state() == GuardState::Running {
                saw_running = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        assert!(
            saw_running,
            "本测试要求 HuanvaeGuard 服务已安装且完全进入 RUNNING"
        );

        // 保存现 SDDL（sc sdset 输出形如 "D:(A;;…;;;SY)…"）
        let orig = run_captured("sc.exe", &["sdshow", GUARD_SERVICE_NAME])
            .filter(|(rc, _)| *rc == 0)
            .map(|(_, out)| out)
            .filter(|s| s.contains("D:"))
            .expect("读取服务 SDDL 失败");
        let orig_sddl: String = orig.lines().map(|l| l.trim()).collect();
        // 拿掉 AU 的授外，再给 BA 塞一条 STOP 拒绝 —— 只回收 AU 对提升后的管理员
        // 调用者无效（BA 的 allow 仍在），必须显式 deny：(D;;0x20;;;BA) 才能让
        // sc stop 返回 5（VM 实测；助记符 ST 在 sc sdset 的 SDDL 解析器里会被拒 1336，
        // 必须写十六进制 0x20 = SERVICE_STOP）。
        let revoked = orig_sddl
            .replace("(A;;CCLCSWRPWPLOCRRC;;;AU)", "")
            .replace("(A;;CCLCSWRPWPLOCRRC;;;IU)", "")
            .replace("D:(", "D:(D;;0x20;;;BA)(");
        assert_ne!(revoked, orig_sddl, "SDDL 里没找到 AU/IU 授权段，样本形态变了");
        let set = run_captured("sc.exe", &["sdset", GUARD_SERVICE_NAME, revoked.as_str()]);
        assert_eq!(set.map(|(rc, _)| rc), Some(0), "回收 AU 停服权限失败");

        // 🔴 被测分支：sc stop 会被拒（5），轮询到点仍未 STOPPED ⇒ 必须 Err(已中止)
        let result = stop_guard_service_for_update();

        // 无论结果如何先恢复 SDDL + 服务（测试不留状态）
        let _ = run_captured("sc.exe", &["sdset", GUARD_SERVICE_NAME, orig_sddl.as_str()]);
        let _ = run_captured("sc.exe", &["start", GUARD_SERVICE_NAME]);

        let err = result.expect_err("停不掉时必须 Err（中止更新），不得放行去硬覆盖");
        assert!(err.contains("已中止"), "中止文案必须出现：{err}");
        assert!(err.contains(GUARD_SERVICE_NAME), "文案必须点名服务：{err}");
        assert!(!err.contains("C:\\"), "文案不得带路径：{err}");
        println!("[win-machine] 中止分支文案：{err}");
    }
}
