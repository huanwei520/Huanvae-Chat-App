//! secure_proxy — 回环安全反代(webview 原生加载的统一出口)。
//!
//! webview 的浏览器原生加载(`<img>`/`<video>`/`<audio>`、上传 XHR)用**系统信任**校验 TLS,
//! 验不过私有 CA 签的自签 leaf(私有 CA 只内置 App,不进系统信任库)。故起一个 `127.0.0.1` HTTP 反代:
//! webview 经它(本地明文回环)请求 → 反代用 secure_net 的**钉 CA 客户端**(连源站 IP / 不发 SNI /
//! 内置 CA 验、不验主机名)转发到数据面源站。webview↔反代=回环明文(本机不出网),反代↔源站=自签 TLS。
//!
//! 前端用法:`ensure_secure_proxy()` 启动并取端口(幂等);`set_proxy_target(ip,port,host)` 在 discovery
//! 选定 active 后设置/更新目标源站;把头像/图片 URL 改写成 `http://127.0.0.1:<port>/<原路径>` 即走此反代。
//!
//! **Host=逻辑域名 + 强制 HTTP/1.1**:转发时显式设 `Host=逻辑域名`(兼容 presigned 按 Host 计算签名——
//! 历史上 webview 直传 `https://api.huanvae.cn/...` 即以域名签名)。但若用 secure_net 默认 client(HTTP/2),
//! 显式 `Host:域名` 与 `:authority:源站IP`(由 URL 取)不一致 → 服务端按 RFC7540 §8.1.2.3 判 malformed
//! 返 400(实测头像 GET 即 400)。故反代专用 `pinned_http1_client`:HTTP/1.1 无 :authority,显式 Host
//! 即权威 → "连源站 IP + 不发 SNI + Host=域名"三者并存,与原生浏览器请求语义一致。
//!
//! **CORS**:webview 源(`tauri://localhost` 等)≠ `127.0.0.1:<port>`,跨源 XHR/fetch(带 Authorization
//! /Content-Type)会先发 OPTIONS 预检。反代本地直接放行预检(不打源站)+ 所有响应加
//! `Access-Control-Allow-Origin: *`(回环明文、无 cookie 凭据,* 安全)。
//!
//! **展示资源本地优先 + 后台刷新**:头像/小程序图标等白名单路径(display_cache::is_cacheable_path)
//! 的 GET 请求,磁盘缓存命中即直接回本地(带 `x-display-cache: hit` 头;后端/MinIO 不可达时看过的
//! 头像仍能显示),同时每键每次运行后台回源刷新一次收敛内容;miss 则正常回源,200 落盘缓存。
//! 命中检查在 target 检查**之前**且不依赖 target:离线冷启动(discovery 失败、target 从未设置)
//! 也能回缓存,此时不登记、不后台刷新。
//! 换头像时后端变更 `?t=` 时间戳 → URL 变 → 天然新键;presigned 聊天文件路径不在白名单,绝不缓存。
//!
//! **流式转发(治"GB 视频首帧封面"④根因)**:回源响应**不再整段读进内存再回包**——历史上
//! `resp.bytes().await` 会把整个上游响应缓冲完才回给 webview,而 webview 常发开口 Range、
//! 上游对整个剩余文件回 206,GB 文件的第一个字节因此永远到不了 `<video>`。现改为逐 chunk
//! 透传(`Body::from_stream`),首字节到达与文件大小解耦;状态码与响应头(含 206/Content-Range/
//! Accept-Ranges)如实透传。唯一例外:可缓存小资产(白名单路径,头像/图标)回源 200 时做
//! **有界收集**(≤ `DISPLAY_COLLECT_CAP`)供落盘缓存;超上限则"已收前缀 + 剩余流"拼接透传、
//! 不缓存——交付不截断、内存有界。
//!
//! **超时拆分**:反代专用 client 只设**连接超时**与**读 idle 超时**(相邻 chunk 的最大间隔),
//! **不设含 body 读完的总时限**——GB 级 206 流的合法总时长随文件大小线性增长,任何总时长
//! 上限都是错误的门。不再复用 `secure_net::pinned_http1_client`(其 builder 把 timeout_secs
//! 塞进 reqwest `.timeout()` = 总时限;改它会把语义传染给 download.rs 等其它调用方)。

use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use once_cell::sync::Lazy;

/// 反代目标(数据面源站)。`host` = 转发时显式设的 Host 头(逻辑域名,兼容 presigned 签名;见模块注释)。
#[derive(Clone)]
struct ProxyTarget {
    ip: String,
    port: u16,
    host: String,
}

/// 优先固定端口:消息/账号会持久化"已解析的头像 URL"(即反代 URL),固定端口让其跨重启仍有效。
/// 被占用则回落系统分配(该次运行端口不同,旧持久化 URL 失效,重登刷新即可,属罕见)。
const PREFERRED_PORT: u16 = 47823;
/// 监听端口(0 = 未启动)
static PROXY_PORT: AtomicU16 = AtomicU16::new(0);
/// 当前转发目标
static TARGET: Lazy<Mutex<Option<ProxyTarget>>> = Lazy::new(|| Mutex::new(None));

/// 反代 client 连接超时(秒):回环反代 → 源站(VPN/内网 IP),TCP+TLS 握手 15s 足够;
/// 旧语义里它是 300s 总时限的一部分,拆出后独立取小值——连接半天建不起来就该早失败。
const PROXY_CONNECT_TIMEOUT_SECS: u64 = 15;
/// 读 idle 超时(秒):相邻两个 chunk 的最大间隔,**不是**总时长。正常分块间隔是毫秒级;
/// 60s 容忍源站/链路长抖动(MinIO 后端取数卡顿),又能让"上游真挂死"的连接最终被回收
/// (前端 `<video>` 会重新发 Range 请求,断流可恢复)。
const PROXY_READ_IDLE_TIMEOUT_SECS: u64 = 60;
/// 展示资产有界收集上限(字节):与 display_cache 单条目上限(8 MiB)对齐——超过它的条目
/// `display_cache::store*` 本来就不落盘,多收集字节无意义;白名单资产(头像/图标)实物体量 ≪ 8 MiB。
const DISPLAY_COLLECT_CAP: usize = 8 * 1024 * 1024;

fn target() -> std::sync::MutexGuard<'static, Option<ProxyTarget>> {
    TARGET.lock().unwrap_or_else(|p| p.into_inner())
}

/// 构建反代专用 reqwest client:与 secure_net 同套信任(内置 CA + mTLS + 不验主机名 + HTTP/1.1),
/// 但**超时语义不同**:只设 connect + 读 idle(reqwest `read_timeout` = per-read 间隔),不设
/// 含 body 读完的总时限。不复用 `secure_net::pinned_http1_client` 的原因见模块头「超时拆分」节。
fn build_proxy_client(connect_secs: u64, read_idle_secs: u64) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(Duration::from_secs(connect_secs))
        .read_timeout(Duration::from_secs(read_idle_secs))
        .pool_max_idle_per_host(5)
        // 禁用系统代理:本 client 只打源站内网 IP(钉 CA + mTLS + 显式 Host=逻辑域名),
        // 走系统代理只会让内网 IP 不可达/回环 mock 被劫持;且 macOS 上系统代理检测
        // (SCDynamicStoreCreateWithOptions → CFBundleGetMainBundle)在非 bundle 进程里
        // 会 readdir 可执行文件所在目录(target/debug/deps 数万条目 + 网络盘 = 分钟级卡顿)。
        .no_proxy()
        // 强制 HTTP/1.1:显式 Host=逻辑域名与 :authority 冲突问题见模块头注释
        .http1_only();
    b = b
        .tls_built_in_root_certs(false)
        .danger_accept_invalid_hostnames(true);
    for cert in reqwest::Certificate::from_pem_bundle(crate::secure_net::EMBEDDED_CA_PEM)
        .map_err(|e| format!("内置 CA 解析失败: {e}"))?
    {
        b = b.add_root_certificate(cert);
    }
    // mTLS:与 secure_net 同一张内置客户端证书(reqwest Identity 需 key+cert 在同一 PEM buf)
    let mut identity_pem = Vec::with_capacity(
        crate::secure_net::EMBEDDED_CLIENT_KEY_PEM.len()
            + crate::secure_net::EMBEDDED_CLIENT_CERT_PEM.len(),
    );
    identity_pem.extend_from_slice(crate::secure_net::EMBEDDED_CLIENT_KEY_PEM);
    identity_pem.extend_from_slice(crate::secure_net::EMBEDDED_CLIENT_CERT_PEM);
    let identity = reqwest::Identity::from_pem(&identity_pem)
        .map_err(|e| format!("客户端证书加载失败: {e}"))?;
    b.identity(identity)
        .build()
        .map_err(|e| format!("构建反代 HTTP client 失败: {e}"))
}

/// 反代专用 client(进程级单例;构建只会因内置 PEM 损坏而失败,那种情况每次请求都该报同一个错)。
static PROXY_CLIENT: Lazy<Result<reqwest::Client, String>> =
    Lazy::new(|| build_proxy_client(PROXY_CONNECT_TIMEOUT_SECS, PROXY_READ_IDLE_TIMEOUT_SECS));

fn proxy_client() -> Result<reqwest::Client, String> {
    match PROXY_CLIENT.as_ref() {
        Ok(c) => Ok(c.clone()),
        Err(e) => Err(e.clone()),
    }
}

/// 上游 body 流(装箱;reqwest `bytes_stream` 的具体类型不可命名)。
type UpstreamStream =
    std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

/// 回源响应体的接力结果。
enum RelayedBody {
    /// 已完整收集(≤ cap)——仅"可缓存小资产 + 上游 200"走这支,供落盘缓存。
    Collected(Vec<u8>),
    /// 收集途中超上限:已收前缀(含触发 chunk)+ 上游剩余流。拼接透传,**不缓存**
    /// ——交付不截断、内存有界(≤ cap + 一个 chunk)。
    Overflow(Vec<u8>, UpstreamStream),
    /// 纯流式透传(未预读任何字节)——默认路径(聊天文件/视频 presigned、上传响应等)。
    Streaming(UpstreamStream),
}

/// 把上游响应转成接力形态:collect_for_cache=false → 纯流式(不等 body 直接返回,首字节零延迟);
/// true → 有界收集(≤ cap),超限转 [`RelayedBody::Overflow`]。Err 仅在收集路径读取上游失败时产生
/// (流式路径的读错误以帧错误形式体现在下游 body 上,此时响应头已发出,无法再改状态码——
/// 这是流式反代的标准语义,下游看到的是截断/断流而非假 200 完整身)。
async fn relay_response_body(
    resp: reqwest::Response,
    collect_for_cache: bool,
) -> Result<RelayedBody, reqwest::Error> {
    relay_response_body_with_cap(resp, collect_for_cache, DISPLAY_COLLECT_CAP).await
}

async fn relay_response_body_with_cap(
    resp: reqwest::Response,
    collect_for_cache: bool,
    cap: usize,
) -> Result<RelayedBody, reqwest::Error> {
    let mut stream: UpstreamStream = Box::pin(resp.bytes_stream());
    if !collect_for_cache {
        return Ok(RelayedBody::Streaming(stream));
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if buf.len() + chunk.len() > cap {
            // 超上限:触发 chunk 已在内存,并入前缀;剩余流原样续传
            buf.extend_from_slice(&chunk);
            return Ok(RelayedBody::Overflow(buf, stream));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(RelayedBody::Collected(buf))
}

/// 接力形态 → 响应体:Collected=一次性 body;Streaming/Overflow=流式 body
/// (Overflow 先把已收前缀作为首帧,再逐 chunk 透传剩余流)。
fn body_from_relayed(relayed: RelayedBody) -> Body {
    match relayed {
        RelayedBody::Collected(bytes) => Body::from(bytes),
        RelayedBody::Streaming(stream) => Body::from_stream(stream),
        RelayedBody::Overflow(prefix, rest) => Body::from_stream(
            futures_util::stream::once(async move { Ok::<Bytes, reqwest::Error>(Bytes::from(prefix)) })
                .chain(rest),
        ),
    }
}

/// 启动回环反代(幂等:已启动直接返回端口)。返回 `127.0.0.1` 监听端口。
#[tauri::command]
pub async fn ensure_secure_proxy() -> Result<u16, String> {
    let existing = PROXY_PORT.load(Ordering::SeqCst);
    if existing != 0 {
        return Ok(existing);
    }
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("反代绑定失败: {e}"))?,
    };
    let port = listener
        .local_addr()
        .map_err(|e| format!("取反代端口失败: {e}"))?
        .port();
    // 并发竞态:若已被别的调用抢先占位,放弃本 listener,用已记录端口
    if PROXY_PORT
        .compare_exchange(0, port, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(PROXY_PORT.load(Ordering::SeqCst));
    }
    let app = Router::new().fallback(forward);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[secure_proxy] serve 退出: {e}");
        }
    });
    Ok(port)
}

/// 设置/更新反代目标源站(discovery 选定 active 后调用)。host=源站逻辑域名(转发时的 Host 头)。
#[tauri::command]
pub fn set_proxy_target(ip: String, port: u16, host: String) {
    *target() = Some(ProxyTarget { ip, port, host });
}

/// 给响应补 `Access-Control-Allow-Origin: *`(错误响应也要带,否则浏览器只报 CORS、看不到真实状态)。
fn with_cors(mut resp: Response) -> Response {
    resp.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    resp
}

/// CORS 预检响应:放行任意源/方法,允许的头回显请求方的 `Access-Control-Request-Headers`(缺省 `*`)。
/// 回环明文、无 cookie 凭据(上传只带 Authorization 头、非 withCredentials),`*` 安全。
fn preflight_response(req: &Request) -> Response {
    let allow_headers = req
        .headers()
        .get("access-control-request-headers")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "*".to_string());
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, PUT, DELETE, PATCH, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, allow_headers)
        .header(header::ACCESS_CONTROL_MAX_AGE, "600")
        .body(Body::empty())
        .unwrap_or_else(|_| (StatusCode::NO_CONTENT, "").into_response())
}

/// 反代转发:把 webview 来的请求经钉 CA 客户端打到源站 IP(不发 SNI、内置 CA 验)。
async fn forward(req: Request) -> Response {
    // 跨源 XHR/fetch 的 OPTIONS 预检:本地直接放行,不打源站(源站不处理预检也不回 CORS 头)。
    if req.method() == Method::OPTIONS {
        return preflight_response(&req);
    }

    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    // 展示资源(头像等)本地优先:命中即回缓存,**不依赖 target**——离线冷启动(discovery 失败、
    // target 从未设置)时看过的头像仍能显示;故此检查必须在下面的 target 检查之前。
    let display_cacheable = req.method() == Method::GET
        && !req.headers().contains_key(header::RANGE)
        && crate::display_cache::is_cacheable_path(&path_and_query);
    if display_cacheable
        && let Some(entry) = crate::display_cache::lookup(&path_and_query)
    {
        // 后台刷新仅在 target 已设时进行;未设时不登记、不 spawn,直接回缓存
        let maybe_tgt = target().clone(); // clone 后立即释放锁,不持 guard 过 await
        if let Some(t) = maybe_tgt
            && crate::display_cache::should_revalidate(&path_and_query)
        {
            let pq = path_and_query.clone();
            tokio::spawn(async move { revalidate_display_cache(t, pq).await });
        }
        return with_cors(cached_display_response(entry));
    }

    let Some(tgt) = target().clone() else {
        return with_cors(
            (StatusCode::SERVICE_UNAVAILABLE, "secure_proxy target unset").into_response(),
        );
    };

    let (parts, body) = req.into_parts();
    // 256MB 上限:覆盖大文件分片上传;回环本机无带宽瓶颈
    let body_bytes = match axum::body::to_bytes(body, 256 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return with_cors((StatusCode::BAD_REQUEST, format!("读请求体失败: {e}")).into_response());
        }
    };

    let url = format!("https://{}:{}{}", tgt.ip, tgt.port, path_and_query);

    // 反代专用 client:强制 HTTP/1.1(避免 h2 下 Host/:authority 冲突 400,见模块注释),
    // 超时=连接 + 读 idle,**无含 body 读完的总时限**(GB 视频流式透传所需,见模块头「超时拆分」节)
    let client = match proxy_client() {
        Ok(c) => c,
        Err(e) => return with_cors((StatusCode::INTERNAL_SERVER_ERROR, e).into_response()),
    };
    let mut rb = client.request(parts.method.clone(), &url);
    // 透传请求头;去掉 Host/Content-Length/Connection(下面显式重设 Host=逻辑域名)+ Origin
    // (webview 源对源站无意义,部分后端会因未知 Origin 拒)。
    for (k, v) in parts.headers.iter() {
        let kn = k.as_str().to_ascii_lowercase();
        if kn == "host" || kn == "content-length" || kn == "connection" || kn == "origin" {
            continue;
        }
        rb = rb.header(k, v);
    }
    rb = rb.header(header::HOST, &tgt.host);
    if !body_bytes.is_empty() {
        rb = rb.body(body_bytes);
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return with_cors((StatusCode::BAD_GATEWAY, format!("反代上游失败: {e}")).into_response()),
    };
    let status = resp.status();
    if !status.is_success() {
        // 上游非 2xx 诊断(头像 400 之类排障用):状态 + 方法 + 目标 URL
        eprintln!(
            "[secure_proxy] 上游非 2xx: {} {} {}",
            status.as_u16(),
            parts.method,
            url
        );
    }
    let resp_headers = resp.headers().clone();
    // 流式接力:仅"可缓存小资产 + 上游 200"做有界收集供落盘缓存;其余(含 206 视频流)
    // 逐 chunk 透传,不整段进内存(模块头「流式转发」节)。
    let collect_for_cache = display_cacheable && status == StatusCode::OK;
    let relayed = match relay_response_body(resp, collect_for_cache).await {
        Ok(r) => r,
        Err(e) => return with_cors((StatusCode::BAD_GATEWAY, format!("读上游响应失败: {e}")).into_response()),
    };

    // 展示资源回源成功:落盘缓存,下次同 URL 本地优先(Overflow=超上限不落盘——该体量
    // display_cache 本来就拒存,语义一致)
    if let RelayedBody::Collected(ref bytes) = relayed
        && collect_for_cache
    {
        let content_type = resp_headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream");
        crate::display_cache::store(&path_and_query, content_type, bytes);
    }

    let mut builder = Response::builder().status(status);
    for (k, v) in resp_headers.iter() {
        let kn = k.as_str().to_ascii_lowercase();
        // 跳过逐跳头 / 由 axum 按实际 body 重算的头 / 上游可能带的 CORS(由本地反代统一加,避免重复)
        if kn == "transfer-encoding"
            || kn == "connection"
            || kn == "content-length"
            || kn == "access-control-allow-origin"
            || kn == "access-control-expose-headers"
        {
            continue;
        }
        builder = builder.header(k, v);
    }
    // webview 跨源:补 CORS,否则上传 POST 的真实响应也被浏览器拦
    builder = builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "*");
    builder
        .body(body_from_relayed(relayed))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "构建响应失败").into_response())
}

/// 展示缓存命中响应:200 + Content-Type + `x-display-cache: hit`(排障/验收标记)。
fn cached_display_response(entry: crate::display_cache::CachedEntry) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, entry.content_type)
        .header("x-display-cache", "hit")
        .body(Body::from(entry.body))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "构建响应失败").into_response())
}

/// 展示缓存后台刷新:回源重取,200 且内容变化才覆写缓存。
/// 任何失败(client 构建/网络/非 200/读 body/超上限)只记日志 + 撤销刷新登记(下次命中静默重试),
/// **绝不删除缓存** — 后端不可达时旧内容照常可用。
async fn revalidate_display_cache(tgt: ProxyTarget, pq: String) {
    let client = match proxy_client() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[display_cache] 后台刷新失败(保留缓存,下次命中重试): {pq}: {e}");
            crate::display_cache::unmark_revalidated(&pq);
            return;
        }
    };
    let url = format!("https://{}:{}{}", tgt.ip, tgt.port, pq);
    let resp = match client.get(&url).header(header::HOST, &tgt.host).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[display_cache] 后台刷新失败(保留缓存,下次命中重试): {pq}: {e}");
            crate::display_cache::unmark_revalidated(&pq);
            return;
        }
    };
    if resp.status() != StatusCode::OK {
        eprintln!(
            "[display_cache] 后台刷新失败(保留缓存,下次命中重试): {pq}: 上游状态 {}",
            resp.status().as_u16()
        );
        crate::display_cache::unmark_revalidated(&pq);
        return;
    }
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    // 有界收集(上限 DISPLAY_COLLECT_CAP):超限即放弃本次刷新——该体量本来就不落盘,
    // 早停省带宽;缓存保留,下次命中重试。后台刷新无交付义务,不做前缀续传。
    match relay_response_body(resp, true).await {
        Ok(RelayedBody::Collected(bytes)) => {
            crate::display_cache::store_if_changed(&pq, &content_type, &bytes);
        }
        Ok(_) => {
            eprintln!("[display_cache] 后台刷新放弃(超有界上限,不缓存;保留旧缓存,下次命中重试): {pq}");
            crate::display_cache::unmark_revalidated(&pq);
        }
        Err(e) => {
            eprintln!("[display_cache] 后台刷新失败(保留缓存,下次命中重试): {pq}: 读 body 失败 {e}");
            crate::display_cache::unmark_revalidated(&pq);
        }
    }
}

#[cfg(test)]
mod tests {
    //! 流式性质的实测。**测试层级:Rust 单元测试**(tokio 真 runtime + 真 TCP 回环 mock 源,
    //! 非桩测;不打 TLS——钉 CA/mTLS 分支与"传输是否流式"正交,TLS 配置对 http:// URL 不生效,
    //! 但 client 构造走的是生产同款 `build_proxy_client`)。

    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use tokio::io::AsyncWriteExt;
    use tokio::sync::Notify;

    /// mock 源的发送脚本:一段 chunk / 睡 N 毫秒 / 等放行信号 / 永久停住(模拟上游挂死)。
    enum Step {
        Chunk(&'static [u8]),
        SleepMs(u64),
        WaitGate,
        Stall,
    }

    /// 起一个一次性 mock 源:accept 一条连接 → **先读完请求头**(不读就关 socket 会让内核
    /// 因收缓冲里有未读数据发 RST,客户端拿到 ConnectionReset 而非干净 EOF)→ 写响应头
    /// (无 Content-Length、connection: close)→ 按 plan 发 body → 关连接(EOF)。
    /// 返回 (url, gate, 是否已写出第一个 chunk)。
    async fn spawn_mock_upstream(plan: Vec<Step>) -> (String, Arc<Notify>, Arc<AtomicBool>) {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock 源绑定失败");
        let addr = listener.local_addr().expect("取 mock 源地址失败");
        let gate = Arc::new(Notify::new());
        let first_written = Arc::new(AtomicBool::new(false));
        let gate2 = gate.clone();
        let fw2 = first_written.clone();
        tokio::spawn(async move {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            // 读完请求头(直到空行);GET 无 body,测试里足够
            let mut req_buf = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                match sock.read(&mut byte).await {
                    Ok(0) | Err(_) => return, // 对端提前关/读失败
                    Ok(_) => {
                        req_buf.push(byte[0]);
                        if req_buf.ends_with(b"\r\n\r\n") {
                            break;
                        }
                    }
                }
            }
            let head: &[u8] = b"HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\nconnection: close\r\n\r\n";
            if sock.write_all(head).await.is_err() {
                return;
            }
            let mut wrote_any = false;
            for step in plan {
                match step {
                    Step::Chunk(data) => {
                        if sock.write_all(data).await.is_err() {
                            return;
                        }
                        if sock.flush().await.is_err() {
                            return;
                        }
                        if !wrote_any {
                            fw2.store(true, AtomicOrdering::SeqCst);
                            wrote_any = true;
                        }
                    }
                    Step::SleepMs(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
                    Step::WaitGate => gate2.notified().await,
                    Step::Stall => loop {
                        tokio::time::sleep(Duration::from_secs(3600)).await;
                    },
                }
            }
            // sock drop → 客户端读到 EOF
        });
        (format!("http://{addr}/file.bin"), gate, first_written)
    }

    /// 读反代响应体的下一帧(带 5s 护栏,防测试挂死)。
    async fn next_frame<S>(stream: &mut S) -> Option<Result<Bytes, axum::Error>>
    where
        S: futures_util::Stream<Item = Result<Bytes, axum::Error>> + Unpin,
    {
        tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("读帧超 5s —— 不符合本测试的时序设计")
    }

    /// 流式性质核心:首 chunk 在上游**尚未发完**时即到达下游(首字节与文件大小解耦),
    /// 且逐 chunk 透传(帧计数 = 上游分块数)。若退回整段缓冲,首帧会被 gate 卡死——
    /// 该负对照由 `buffered_shape_cannot_deliver_first_frame_early` 单独证明。
    #[tokio::test]
    async fn streaming_first_frame_before_upstream_finishes() {
        let (url, gate, first_written) = spawn_mock_upstream(vec![
            Step::Chunk(b"CHUNK-A"),
            Step::WaitGate, // 上游故意停在这里:body 远未发完
            Step::Chunk(b"CHUNK-B"),
        ])
        .await;
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        let relayed = relay_response_body(resp, false)
            .await
            .expect("流式接力不应失败");
        assert!(
            matches!(relayed, RelayedBody::Streaming(_)),
            "非缓存路径必须是纯流式"
        );
        let mut frames = body_from_relayed(relayed).into_data_stream();
        // 此刻上游仍被 gate 停住(只写了 CHUNK-A):首帧必须已经能到
        let first = next_frame(&mut frames)
            .await
            .expect("流不应在上游发完前结束")
            .expect("首帧不应是错误");
        assert_eq!(&first[..], b"CHUNK-A", "首帧内容应为上游第一个 chunk");
        assert!(
            first_written.load(AtomicOrdering::SeqCst),
            "mock 源确实已写出第一个 chunk(判据正对照)"
        );
        // 放行上游发完
        gate.notify_one();
        let second = next_frame(&mut frames)
            .await
            .expect("还应有第二帧")
            .expect("第二帧不应是错误");
        assert_eq!(&second[..], b"CHUNK-B");
        assert!(next_frame(&mut frames).await.is_none(), "两帧后应 EOF");
        // 帧计数 = 2 ⇒ 逐 chunk 透传;若整段缓冲则首帧要等 gate、且只有一帧
    }

    /// 因果负对照(判据有效性自证):同一条接力路径换成"收集完再回"(=改前 `resp.bytes().await`
    /// 的语义形状,cap 放大到实际不限)时,relay 在上游被 gate 停住期间**不返回**——
    /// 证明上一个测试断言的不是恒绿形态。
    #[tokio::test]
    async fn buffered_shape_cannot_deliver_first_frame_early() {
        let (url, gate, _fw) = spawn_mock_upstream(vec![
            Step::Chunk(b"CHUNK-A"),
            Step::WaitGate,
            Step::Chunk(b"CHUNK-B"),
        ])
        .await;
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        // 有界收集(cap 远大于 body ⇒ 等价于旧 `.bytes()` 全收形态)
        let relay_fut = relay_response_body_with_cap(resp, true, 64 * 1024 * 1024);
        let early = tokio::time::timeout(Duration::from_millis(300), relay_fut).await;
        assert!(
            early.is_err(),
            "整段收集形态在上游发完前不应返回(返回了 = 流式测试没有判别力)"
        );
        // 收尾:放行让 mock 源正常结束,避免悬挂连接
        gate.notify_one();
    }

    /// 超时拆分实测:总耗时 > 读 idle 超时仍成功(每个间隔 < idle)——存在的是"chunk 间隔"门
    /// 而非"总时长"门;同时实证 reqwest `read_timeout` 是 per-read 语义。
    /// 注:旧总时限是 300s,其消亡无法在单测窗口直接演示(那要等 300s);本测试证的是
    /// "不存在秒级总时限 + idle 门不按总时长计"。
    #[tokio::test]
    async fn slow_drip_total_exceeds_idle_still_succeeds() {
        let plan = vec![
            Step::Chunk(b"A"),
            Step::SleepMs(350),
            Step::Chunk(b"B"),
            Step::SleepMs(350),
            Step::Chunk(b"C"),
            Step::SleepMs(350),
            Step::Chunk(b"D"),
        ];
        let (url, _g, _f) = spawn_mock_upstream(plan).await;
        // 生产同款 client 构造器,小超时参数:connect 5s / 读 idle 1s / 无总时限
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let started = std::time::Instant::now();
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        let relayed = relay_response_body(resp, false)
            .await
            .expect("流式接力不应失败");
        let mut frames = body_from_relayed(relayed).into_data_stream();
        let mut body = Vec::new();
        let mut n = 0usize;
        while let Some(frame) = next_frame(&mut frames).await {
            body.extend_from_slice(&frame.expect("逐滴传输不应出错"));
            n += 1;
        }
        let elapsed = started.elapsed();
        assert_eq!(&body[..], b"ABCD");
        assert_eq!(n, 4, "4 个 chunk 应逐帧到达(实际 {n} 帧)");
        assert!(
            elapsed >= Duration::from_millis(1000),
            "总耗时({elapsed:?})应超过读 idle 超时(1s)——超过仍成功才证明没有总时长门"
        );
    }

    /// 读 idle 超时会响:上游发完首 chunk 后永久停住,下游应在 ≈idle 后收到**帧错误**
    /// (不是永久悬挂,也不是把截断流静默伪装成 EOF)。
    #[tokio::test]
    async fn read_idle_timeout_fires_on_stalled_upstream() {
        let (url, _g, _f) =
            spawn_mock_upstream(vec![Step::Chunk(b"HEAD-OK"), Step::Stall]).await;
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let started = std::time::Instant::now();
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        let relayed = relay_response_body(resp, false)
            .await
            .expect("流式接力不应失败");
        let mut frames = body_from_relayed(relayed).into_data_stream();
        let first = next_frame(&mut frames)
            .await
            .expect("应有首帧")
            .expect("首帧不应是错误");
        assert_eq!(&first[..], b"HEAD-OK");
        let outcome = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("idle 超时应在 5s 内触发(不触发 = 门不存在)");
        match outcome {
            Some(Err(_)) => {} // 预期:帧错误(reqwest 读 idle 超时)
            Some(Ok(_)) => panic!("上游已停住,不应再有正常帧"),
            None => panic!("上游停住而流静默结束 = 把截断响应伪装成完整响应"),
        }
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "idle 超时应远早于 5s 护栏"
        );
    }

    /// 有界收集:小 body 完整收集(展示资产缓存落盘路径的形态)。
    #[tokio::test]
    async fn bounded_collect_small_body_ok() {
        let (url, _g, _f) = spawn_mock_upstream(vec![
            Step::Chunk(b"hello"),
            Step::SleepMs(50),
            Step::Chunk(b"world"),
        ])
        .await;
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        let relayed = relay_response_body_with_cap(resp, true, 1024)
            .await
            .expect("收集不应失败");
        match relayed {
            RelayedBody::Collected(bytes) => assert_eq!(&bytes[..], b"helloworld"),
            _ => panic!("小 body 应为 Collected"),
        }
    }

    /// 有界收集超上限:转 Overflow,"已收前缀 + 剩余流"拼接后**完整交付**(不截断)、内存有界。
    #[tokio::test]
    async fn bounded_collect_overflow_still_delivers_full_body() {
        let (url, _g, _f) = spawn_mock_upstream(vec![
            Step::Chunk(b"AAAA"),
            Step::SleepMs(50),
            Step::Chunk(b"BBBB"),
            Step::SleepMs(50),
            Step::Chunk(b"CCCC"),
        ])
        .await;
        let client = build_proxy_client(5, 1).expect("构建反代 client 失败");
        let resp = client.get(&url).send().await.expect("mock 源不可达");
        let relayed = relay_response_body_with_cap(resp, true, 4)
            .await
            .expect("接力不应失败");
        match &relayed {
            RelayedBody::Overflow(prefix, _) => {
                assert_eq!(&prefix[..], b"AAAABBBB", "前缀 = 已收 + 触发 chunk")
            }
            _ => panic!("超上限应为 Overflow"),
        }
        let mut frames = body_from_relayed(relayed).into_data_stream();
        let mut body = Vec::new();
        while let Some(frame) = next_frame(&mut frames).await {
            body.extend_from_slice(&frame.expect("Overflow 续传不应出错"));
        }
        assert_eq!(&body[..], b"AAAABBBBCCCC", "Overflow 路径必须完整交付,不截断");
    }
}
