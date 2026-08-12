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

/// 分片数。8 段在实测里比 4 段稳定更优（5%丢包 8.10s vs 10.13s）。
const SHARD_COUNT: u64 = 8;
/// 每个分片的失败重试次数（不含首次）。
const MAX_RETRY: u32 = 3;
/// 单个分片请求的整体超时。插件默认**没有超时**，挂死就是它的真实行为，这里必须给上界。
const SHARD_TIMEOUT: Duration = Duration::from_secs(120);
/// 建连超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

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

/// 下载进度事件（字段名与前端 `src/update/service.ts` 的解析保持一致）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ShardedEvent {
    /// 总长度。
    ///
    /// BACKLOG（等更新事件契约随前端一并收窄时删掉这个 `Option`）：自「分片是唯一路径」
    /// 落地起，本模块**恒发 `Some`** —— 长度未知在 [`require_shardable`] 就已报错中止，
    /// 走不到这里。`Option` 之所以还留着，只因收窄它要同步改前端
    /// `src/update/service.ts` 的 `contentLength: number | null` 与 `indeterminate`
    /// 分支（跨语言契约，属另一次改动的范围），不是给本模块留降级余地。
    Started { content_length: Option<u64> },
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

/// HEAD 探测：拿总长度 + 是否支持 Range
async fn probe(client: &reqwest::Client, url: &str) -> Result<(Option<u64>, bool), String> {
    let resp = client
        .head(url)
        .timeout(SHARD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("HEAD 探测失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HEAD 探测返回 {}", resp.status()));
    }
    let len = resp.content_length();
    let accepts_range = resp
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false);
    Ok((len, accepts_range))
}

/// 下载单个分片（带重试 + 断点续传：重试时只补没下完的那部分）
async fn fetch_shard(
    client: reqwest::Client,
    url: String,
    start: u64,
    end: u64,
    progress: Arc<AtomicU64>,
) -> Result<Vec<u8>, String> {
    let want = (end - start + 1) as usize;
    let mut buf: Vec<u8> = Vec::with_capacity(want);
    let mut attempt = 0u32;

    loop {
        // 断点续传：已经拿到 buf.len() 字节，本次只请求剩下的
        let from = start + buf.len() as u64;
        if from > end {
            break;
        }
        let range = format!("bytes={}-{}", from, end);

        let result = async {
            let resp = client
                .get(&url)
                .header(reqwest::header::RANGE, &range)
                .timeout(SHARD_TIMEOUT)
                .send()
                .await
                .map_err(|e| format!("分片请求失败: {e}"))?;
            // 必须是 206；200 说明服务端忽略了 Range（会把整个文件塞回来）
            if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("分片响应状态非 206（实际 {}）", resp.status()));
            }
            // 🔴 必须**流式**读，不能 `resp.bytes()` 一次性等整片。
            //
            // `resp.bytes()` 会等这一片**全部**下完才返回，于是 `progress` 在整片完成前
            // 一直是 0；而进度上报器每 200ms 只是读 `progress` ⇒ 用户看到的就是
            // 「一直 0%，然后突然完成」（八片几乎同时完成时尤其像"卡住后瞬间跳完"）。
            use futures_util::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut part: Vec<u8> = Vec::new();
            loop {
                match stream.next().await {
                    Some(Ok(chunk)) => {
                        // 边收边计：这才是「实时进度」的来源
                        progress.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                        part.extend_from_slice(&chunk);
                    }
                    Some(Err(e)) => {
                        // 本次尝试中断：`part` 会被丢弃并重下这一段，
                        // 故必须把本次已计入的字节**回滚**，否则重试会重复计数
                        // ⇒ progress 超过 content_length ⇒ 百分比冲过 100%。
                        progress.fetch_sub(part.len() as u64, Ordering::Relaxed);
                        return Err(format!("分片读取失败: {e}"));
                    }
                    None => break,
                }
            }
            Ok::<Vec<u8>, String>(part)
        }
        .await;

        match result {
            Ok(bytes) => {
                // 注意：progress 已在流式循环里逐 chunk 累加过，这里**不能**再加一次
                buf.extend_from_slice(&bytes);
                if buf.len() >= want {
                    break;
                }
                // 短读：继续循环补齐（不计入重试）
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

    buf.truncate(want);
    if buf.len() != want {
        return Err(format!(
            "分片 [{start}-{end}] 字节数不符：期望 {want}，实到 {}",
            buf.len()
        ));
    }
    Ok(buf)
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

    let (total, accepts_range) = probe(&client, &url).await?;

    // 🔴 先判前提再报 Started：不满足就是这次更新的终点，不该先给用户一个"开始下载"
    // 的假象。这里没有"另一种下载方式"可选 —— 判不过就是 Err，文案直达用户。
    let len = require_shardable(total, accepts_range)?;

    let _ = on_event.send(ShardedEvent::Started {
        content_length: Some(len),
    });

    let progress = Arc::new(AtomicU64::new(0));

    let bytes: Vec<u8> = {
        let mut tasks = Vec::new();
        for (start, end) in shard_ranges(len) {
            tasks.push(tokio::spawn(fetch_shard(
                client.clone(),
                url.clone(),
                start,
                end,
                progress.clone(),
            )));
        }

        // 进度上报：分片是并发的，用累计已下字节数算真实百分比
        let reporter = {
            let progress = progress.clone();
            let ch = on_event.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    let done = progress.load(Ordering::Relaxed);
                    let _ = ch.send(ShardedEvent::Progress {
                        downloaded: done,
                        content_length: Some(len),
                    });
                    if done >= len {
                        break;
                    }
                }
            })
        };

        let mut parts: Vec<Vec<u8>> = Vec::with_capacity(tasks.len());
        for t in tasks {
            // 任一分片失败 ⇒ 整体失败
            let part = t.await.map_err(|e| format!("分片任务 panic: {e}"))??;
            parts.push(part);
        }
        reporter.abort();

        let mut merged = Vec::with_capacity(len as usize);
        for p in parts {
            merged.extend_from_slice(&p);
        }
        if merged.len() as u64 != len {
            return Err(format!(
                "合并后大小不符：期望 {len}，实到 {}",
                merged.len()
            ));
        }
        merged
    };

    // 🔴 验签：插件的 install() 不验签，这一步丢了就等于装了未经验证的包
    verify_signature(&bytes, &signature, &pubkey)?;

    let _ = on_event.send(ShardedEvent::Finished);

    update
        .install(&bytes)
        .map_err(|e| format!("安装失败: {e}"))?;
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
}
