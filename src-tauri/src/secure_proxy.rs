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

use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, Ordering};

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
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

fn target() -> std::sync::MutexGuard<'static, Option<ProxyTarget>> {
    TARGET.lock().unwrap_or_else(|p| p.into_inner())
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
        .header(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        )
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, allow_headers)
        .header(header::ACCESS_CONTROL_MAX_AGE, "600")
        .body(Body::empty())
        .unwrap_or_else(|_| (StatusCode::NO_CONTENT, "").into_response())
}

/// 反代转发:把 webview 来的请求经 secure_net 钉 CA 客户端打到源站 IP(不发 SNI、内置 CA 验)。
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

    // 强制 HTTP/1.1 client:配合下面显式 Host=逻辑域名(避免 h2 下 Host/:authority 冲突 400,见模块注释)
    let client = match crate::secure_net::pinned_http1_client(300) {
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
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return with_cors((StatusCode::BAD_GATEWAY, format!("读上游响应失败: {e}")).into_response()),
    };

    // 展示资源回源成功:落盘缓存,下次同 URL 本地优先
    if display_cacheable && status == StatusCode::OK {
        let content_type = resp_headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream");
        crate::display_cache::store(&path_and_query, content_type, &bytes);
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
        .body(Body::from(bytes))
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
/// 任何失败(client 构建/网络/非 200/读 body)只记日志 + 撤销刷新登记(下次命中静默重试),
/// **绝不删除缓存** — 后端不可达时旧内容照常可用。
async fn revalidate_display_cache(tgt: ProxyTarget, pq: String) {
    let client = match crate::secure_net::pinned_http1_client(300) {
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
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[display_cache] 后台刷新失败(保留缓存,下次命中重试): {pq}: 读 body 失败 {e}");
            crate::display_cache::unmark_revalidated(&pq);
            return;
        }
    };
    crate::display_cache::store_if_changed(&pq, &content_type, &bytes);
}
