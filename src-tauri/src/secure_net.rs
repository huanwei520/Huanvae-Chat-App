//! secure_net — 统一 HTTP 命令:Rust 层自管 TLS(rustls),只信**内置私有 CA**(硬信任锚)。
//!
//! 用途(见工作区 DESIGN-app-discovery-selfsigned-tls.md):
//!   - 发现面:请求 ca.huanvae.cn(CF 真证书)→ `pin_ca=false`,走系统信任。
//!   - 数据面:前端传来的就是 `https://<ip>:port` 的 **IP 字面量** URL(discovery 用 direct_ip 改写主机)
//!     → `pin_ca=true`,IP 不发 SNI(绕阿里云 ICP 的 SNI 拦截)。**信任 = 链到内置私有 CA,
//!     不验主机名/SAN**:私有 CA 独占且单一用途 → SAN 校验多余;leaf 与 IP/域名彻底解耦,换 IP 永不重签
//!     (+ 轮换重叠期可选 extra_ca_pem)。
//!
//! 全程 Rust 内自管 TLS → **绕过 iOS ATS / Android NSC**,macOS/Win/Linux/iOS/Android 行为一致。
//! 直接依赖本 crate 的 reqwest(非 plugin-http re-export,后者在 Android 不导出,issue #3027)。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// 编译期内置的私有根 CA(硬信任锚)。数据面只信它 → 即使发现入口被攻破,
/// 任何 leaf 必须链到内置 CA 才被接受,无法 MITM。
/// `pub(crate)` 供 ws_proxy 复用同一信任锚(数据面 WS 同套 TLS 策略)。
pub(crate) const EMBEDDED_CA_PEM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/huanvae-ca.pem"));

/// 编译期内置的客户端证书 + 私钥(数据面 mTLS 双向验证:edge nginx `ssl_verify_client` 要求客户端呈递
/// 证书,否则 nginx 层直接拒)。全局共享一张,由**独立 client-CA** 签(EKU=clientAuth)。
/// **私钥内置二进制可被逆向提取** → 定位=网络层准入(收缩攻击面、挡无证书客户端/扫描),真用户身份仍靠 JWT。
/// `pub(crate)` 供 ws_proxy 复用(数据面 WS 同套 mTLS)。仅 pin_ca(数据面)分支呈递,发现面(CF Worker)不发。
pub(crate) const EMBEDDED_CLIENT_CERT_PEM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/app-client.cert.pem"));
pub(crate) const EMBEDDED_CLIENT_KEY_PEM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/app-client.key.pem"));

/// client 缓存:同配置(pin_ca/extra_ca/timeout)复用,避免每请求重建 TLS client。
static CLIENTS: Lazy<Mutex<HashMap<String, reqwest::Client>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Deserialize)]
pub struct SecureHttpReq {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 文本/JSON body(当前 HTTP API 均为 JSON;二进制端点后续单独处理)
    #[serde(default)]
    pub body: Option<String>,
    /// true=数据面:只信内置私有 CA(+可选 extra_ca),连的是 direct_ip 改写后的 IP URL(不发 SNI);
    /// false/缺省=发现面:系统信任(ca.huanvae.cn 的 CF 真证书)。
    #[serde(default)]
    pub pin_ca: bool,
    /// CA 轮换重叠期:除内置 CA 外额外信任的 CA(来自发现入口下发的 ca_pem)。
    #[serde(default)]
    pub extra_ca_pem: Option<String>,
    /// 超时秒(默认 30)
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SecureHttpResp {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

fn build_client(
    pin_ca: bool,
    extra_ca_pem: Option<&str>,
    timeout_secs: u64,
    http1_only: bool,
) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_secs(timeout_secs))
        .pool_max_idle_per_host(5);
    if http1_only {
        // 反代场景:需显式设 Host=逻辑域名(兼容 presigned 按 Host 签名)。HTTP/2 下显式 `Host` 与
        // `:authority`(由 URL 取=源站 IP)不一致 → 服务端按 RFC7540 §8.1.2.3 判 malformed 返 400。
        // 强制 HTTP/1.1:无 :authority,显式 Host 即权威 → "连 IP + 不发 SNI + Host=域名"三者并存。
        b = b.http1_only();
    }
    if pin_ca {
        // 信任 = "链到内置私有 CA",**不验主机名/SAN**(reqwest 的 IgnoreHostname:仍验证书链到
        // 配置的根=内置 CA,只跳过 hostname)。私有 CA 独占单一用途 → SAN 校验多余;leaf 与 IP/域名
        // 解耦,换 IP 永不重签。关掉系统/webpki 根,只信内置 CA(+ 重叠期额外 CA)。
        b = b
            .tls_built_in_root_certs(false)
            .danger_accept_invalid_hostnames(true);
        for cert in reqwest::Certificate::from_pem_bundle(EMBEDDED_CA_PEM)
            .map_err(|e| format!("内置 CA 解析失败: {e}"))?
        {
            b = b.add_root_certificate(cert);
        }
        if let Some(extra) = extra_ca_pem {
            // 额外 CA 解析失败不致命(仍有内置 CA 兜底),但打日志便于 CA 轮换期排障
            match reqwest::Certificate::from_pem_bundle(extra.as_bytes()) {
                Ok(certs) => {
                    for cert in certs {
                        b = b.add_root_certificate(cert);
                    }
                }
                Err(e) => eprintln!("[secure_net] extra_ca 解析失败,忽略(仍信内置 CA): {e}"),
            }
        }
        // mTLS:呈递内置客户端证书(reqwest Identity 需 key+cert 在同一 PEM buf)。仅数据面(pin_ca)带,
        // 发现面连 CF Worker(系统信任、无 mTLS)不应发客户端证书。
        let mut identity_pem =
            Vec::with_capacity(EMBEDDED_CLIENT_KEY_PEM.len() + EMBEDDED_CLIENT_CERT_PEM.len());
        identity_pem.extend_from_slice(EMBEDDED_CLIENT_KEY_PEM);
        identity_pem.extend_from_slice(EMBEDDED_CLIENT_CERT_PEM);
        let identity = reqwest::Identity::from_pem(&identity_pem)
            .map_err(|e| format!("客户端证书加载失败: {e}"))?;
        b = b.identity(identity);
    }
    b.build().map_err(|e| format!("构建 HTTP client 失败: {e}"))
}

fn client_key(pin_ca: bool, extra_ca: Option<&str>, timeout: u64, http1_only: bool) -> String {
    // extra_ca 用长度+前缀近似指纹(避免整证书入键),足够区分轮换
    let e = extra_ca
        .map(|s| format!("{}:{}", s.len(), &s[..s.len().min(40)]))
        .unwrap_or_default();
    format!("{pin_ca}|{timeout}|{http1_only}|{e}")
}

/// 取(或按配置新建并缓存)reqwest client。secure_http 与 secure_http_stream 共用(HTTP/2 可用)。
fn acquire_client(req: &SecureHttpReq, timeout: u64) -> Result<reqwest::Client, String> {
    let key = client_key(req.pin_ca, req.extra_ca_pem.as_deref(), timeout, false);
    let mut guard = CLIENTS.lock().map_err(|_| "client 缓存锁中毒".to_string())?;
    if let Some(c) = guard.get(&key) {
        return Ok(c.clone());
    }
    let c = build_client(req.pin_ca, req.extra_ca_pem.as_deref(), timeout, false)?;
    guard.insert(key, c.clone());
    Ok(c)
}

/// 数据面"Rust 侧直连源站下载"复用的钉 CA 客户端(pin_ca + 不验主机名 + 内置 CA,与 secure_http 同套信任)。
/// 供 download.rs / storage.rs 等复用;调用方传入**已改写成源站 IP 的 URL**(不发 SNI,绕 ICP)。
pub(crate) fn pinned_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    let key = client_key(true, None, timeout_secs, false);
    let mut guard = CLIENTS.lock().map_err(|_| "client 缓存锁中毒".to_string())?;
    if let Some(c) = guard.get(&key) {
        return Ok(c.clone());
    }
    let c = build_client(true, None, timeout_secs, false)?;
    guard.insert(key, c.clone());
    Ok(c)
}

/// 同 `pinned_client`,但**强制 HTTP/1.1** —— 专供 `secure_proxy` 反代:它显式设 `Host=逻辑域名`
/// (兼容 presigned 按 Host 签名)。HTTP/2 下显式 Host 与 :authority(=URL 的源站 IP)冲突会被服务端
/// 判 malformed 返 400(头像/上传全挂);HTTP/1.1 无 :authority,显式 Host 即权威。
pub(crate) fn pinned_http1_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    let key = client_key(true, None, timeout_secs, true);
    let mut guard = CLIENTS.lock().map_err(|_| "client 缓存锁中毒".to_string())?;
    if let Some(c) = guard.get(&key) {
        return Ok(c.clone());
    }
    let c = build_client(true, None, timeout_secs, true)?;
    guard.insert(key, c.clone());
    Ok(c)
}

/// 统一安全 HTTP 请求。前端(client.ts 等)经 `invoke('secure_http', { req })` 调用。
#[tauri::command]
pub async fn secure_http(req: SecureHttpReq) -> Result<SecureHttpResp, String> {
    let timeout = req.timeout_secs.unwrap_or(30);
    let client = acquire_client(&req, timeout)?;

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("method 非法: {e}"))?;
    let mut rb = client.request(method, &req.url);
    for (k, v) in &req.headers {
        rb = rb.header(k, v);
    }
    if let Some(body) = req.body {
        rb = rb.body(body);
    }
    let resp = rb.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| format!("读响应失败: {e}"))?;
    Ok(SecureHttpResp {
        status,
        headers,
        body,
    })
}

/// 流式响应事件(Rust → JS,经 Tauri Channel)。
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum StreamEvent {
    /// 连接已建立,带响应状态码
    Open { status: u16 },
    /// 一段响应文本(已按 UTF-8 边界切分,可直接 append)
    Chunk { data: String },
    /// 流正常结束
    Done,
    /// 出错(请求失败 / 非 2xx / 流读取失败)
    Error { message: String },
}

/// 流式安全 HTTP(SSE 等)。经 `invoke('secure_http_stream', { req, onEvent })` 调用,
/// 逐块经 Channel 推回 JS —— 绕过 plugin-http "IPC 一次性收完、无法真流式" 的限制(见 SSE 研究结论)。
/// TLS / CA / resolve 与 secure_http 同套(数据面 pin_ca + 内置 CA)。
///
/// 取消:前端中止(窗口关/AbortSignal 后停止接收)使 Channel send 失败 → 本函数提前返回、
/// resp drop 关闭连接。注:页面内 AbortSignal 不会 drop Channel,此时为"停止 UI 更新、
/// 服务端流自然跑完"(AI 生成通常数秒,可接受;彻底中止服务端生成需后续加 cancel 命令)。
#[tauri::command]
pub async fn secure_http_stream(
    req: SecureHttpReq,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    // 流式默认更长超时(AI 生成可能数十秒)
    let timeout = req.timeout_secs.unwrap_or(120);
    let client = acquire_client(&req, timeout)?;

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("method 非法: {e}"))?;
    let mut rb = client.request(method, &req.url);
    for (k, v) in &req.headers {
        rb = rb.header(k, v);
    }
    if let Some(body) = &req.body {
        rb = rb.body(body.clone());
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = on_event.send(StreamEvent::Error {
                message: format!("请求失败: {e}"),
            });
            return Ok(());
        }
    };
    let status = resp.status();
    if !status.is_success() {
        // 非 2xx:读 body 作为错误消息(JSON {error} 由 JS 侧提取),只发 Error 不发 Open
        let body = resp.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("HTTP {}", status.as_u16())
        } else {
            body
        };
        let _ = on_event.send(StreamEvent::Error { message });
        return Ok(());
    }
    let _ = on_event.send(StreamEvent::Open {
        status: status.as_u16(),
    });

    // 逐块读;只发完整 UTF-8 前缀,尾部不完整字节留到下一块(避免多字节字符被切坏)
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let _ = on_event.send(StreamEvent::Error {
                    message: format!("流读取失败: {e}"),
                });
                return Ok(());
            }
        };
        buf.extend_from_slice(&bytes);
        let valid = match std::str::from_utf8(&buf) {
            Ok(_) => buf.len(),
            Err(e) => e.valid_up_to(),
        };
        if valid > 0 {
            let text = String::from_utf8_lossy(&buf[..valid]).into_owned();
            // 前端已断开 → send 失败 → 提前结束(resp drop 关闭连接)
            if on_event.send(StreamEvent::Chunk { data: text }).is_err() {
                return Ok(());
            }
            buf.drain(..valid);
        }
    }
    if !buf.is_empty() {
        let _ = on_event.send(StreamEvent::Chunk {
            data: String::from_utf8_lossy(&buf).into_owned(),
        });
    }
    let _ = on_event.send(StreamEvent::Done);
    Ok(())
}
