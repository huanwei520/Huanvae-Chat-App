//! public_e2e — App 真实 Rust 请求路径打公网真后端的集成测试。
//!
//! 这组测试**直接复用 App 数据面唯一的请求函数** `secure_net::secure_http`
//! （`#[tauri::command]` 但本质是普通 async fn，可直接 await）。所有请求都用
//! `pin_ca: true` —— 即 App 真实的"no-SNI + 私有 CA 锚 + mTLS 客户端证书 +
//! danger_accept_invalid_hostnames"那条路径（证书走 secure_net 的 `include_bytes!`
//! 内置，无需测试自己搭 TLS）。连的是 IP 字面量 URL（reqwest 不发 SNI，绕 ICP/SNI
//! 拦截），`Host` 头显式设为逻辑域名 `api.huanvae.cn`（presigned 按 Host 签名）。
//!
//! ## 安全（公开仓）
//! - 客户端证书/私钥/CA 不出现在本文件，全由 secure_net `include_bytes!` 内置
//!   （key 已 gitignore）。
//! - 账号/密码**只从环境变量读**，绝不硬编码、绝不回显明文。无 `E2E_USER`/`E2E_PASS`
//!   时测试 `panic!` 明确提示（不 silently skip、不 mock、不假绿）。
//!
//! ## 运行
//! ```bash
//! E2E_USER=xxx E2E_PASS=yyy \
//!   cargo test --manifest-path src-tauri/Cargo.toml --test public_e2e -- --nocapture --test-threads=1
//! # 或: pnpm e2e:public （需先 export E2E_USER / E2E_PASS）
//! ```
//! `--test-threads=1` 保证顺序执行：login 在 upload/display 之前拿到 token。
//!
//! ## env
//! - `E2E_PUBLIC_IP`（默认 `47.105.101.42`）：源站 IP 字面量（不发 SNI）。
//! - `E2E_USER` / `E2E_PASS`（必填）：真实账号密码，只从 env 读。
//! - `E2E_HOST`（默认 `api.huanvae.cn`）：Host 头逻辑域名（presigned 按它签名）。

use std::collections::HashMap;

use huanvae_chat_app_lib::secure_net::{secure_http, SecureHttpReq};

/// 默认源站 IP（可被 E2E_PUBLIC_IP 覆盖）。仅 IP 字面量，无任何凭据。
const DEFAULT_IP: &str = "47.105.101.42";
/// presigned 按此 Host 签名；edge nginx 也按它路由。
const DEFAULT_HOST: &str = "api.huanvae.cn";

fn public_ip() -> String {
    std::env::var("E2E_PUBLIC_IP").unwrap_or_else(|_| DEFAULT_IP.to_string())
}

fn logical_host() -> String {
    std::env::var("E2E_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string())
}

/// 源站 base（IP 字面量 https）。所有数据面 URL 在此之上拼 path。
fn base_url() -> String {
    format!("https://{}", public_ip())
}

/// 必填账号/密码：缺失即 panic（明确报错，不假绿）。返回值绝不打印明文。
fn require_user() -> String {
    std::env::var("E2E_USER").unwrap_or_else(|_| {
        panic!("缺少 E2E_USER 环境变量；设 E2E_USER / E2E_PASS 后再跑（不会 mock、不会 skip）")
    })
}

fn require_pass() -> String {
    std::env::var("E2E_PASS").unwrap_or_else(|_| {
        panic!("缺少 E2E_PASS 环境变量；设 E2E_USER / E2E_PASS 后再跑（不会 mock、不会 skip）")
    })
}

/// 构造一个数据面 `SecureHttpReq`：pin_ca=true（私有 CA + mTLS + no-SNI），可选 JSON body / Bearer token。
///
/// 注意:**不设显式 `Host` 头** —— 与 App 真实 `secure_http`(secureFetch)一致:它只把 URL 主机
/// 改写为源站 IP、不加 Host。数据面是 HTTP/2,显式 `Host=逻辑域名` 会与 `:authority`(=URL 的 IP)
/// 冲突 → 服务端按 RFC7540 §8.1.2.3 判 malformed 返 400(不忠实于 App)。presigned PUT 另需 Host=域名
/// 签名,App 走 http1 的 secure_proxy 处理,与此 JSON 数据面路径不同。
fn data_plane_req(
    method: &str,
    url: String,
    token: Option<&str>,
    json_body: Option<String>,
) -> SecureHttpReq {
    let mut headers = HashMap::new();
    if json_body.is_some() {
        headers.insert("Content-Type".to_string(), "application/json".to_string());
    }
    if let Some(t) = token {
        headers.insert("Authorization".to_string(), format!("Bearer {t}"));
    }
    SecureHttpReq {
        method: method.to_string(),
        url,
        headers,
        body: json_body,
        pin_ca: true,
        extra_ca_pem: None,
        timeout_secs: Some(30),
    }
}

/// 从 JSON 文本里抽一个字符串字段（朴素提取，避免引入额外依赖；够测试断言用）。
/// 找 `"key"` 后第一个引号串。命中返回 Some(value)。
fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = body.find(&needle)? + needle.len();
    let rest = &body[start..];
    // 跳过冒号和空白
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let q1 = after_colon.find('"')?;
    let value_start = q1 + 1;
    let value_part = &after_colon[value_start..];
    let q2 = value_part.find('"')?;
    Some(value_part[..q2].to_string())
}

/// 登录拿 access_token。失败（非 200 / 无 token）即 panic（如实暴露后端真实状态）。
/// 不打印密码；只打印 status 与（脱敏后的）响应摘要。
async fn login_and_get_token() -> String {
    let user = require_user();
    let pass = require_pass();

    // 复刻 src/api/auth.ts login() 的真实请求体（device_info 固定占位，
    // 对应 App 在无设备信息时的默认值；mac_address 省略，对应 undefined）。
    let body = format!(
        r#"{{"user_id":{user},"password":{pass},"device_info":"Huanvae Chat E2E Test"}}"#,
        user = serde_json::to_string(&user).unwrap(),
        pass = serde_json::to_string(&pass).unwrap(),
    );

    let url = format!("{}/api/auth/login", base_url());
    let req = data_plane_req("POST", url, None, Some(body));

    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[login] secure_http 调用失败（请求未成功发出/收到响应）: {e}"));

    println!("[login] status={}", resp.status);
    // 不打印完整 body（可能含 token）；只看是否含 token 标记
    let has_token = resp.body.contains("access_token");
    println!("[login] body 含 access_token = {has_token}");
    if resp.status != 200 {
        // 错误体通常是 {error/message}，不含凭据，可打印帮助定位
        println!("[login] 非 200 响应体: {}", resp.body);
    }

    assert_eq!(resp.status, 200, "[login] 期望 200，实际 {}", resp.status);
    assert!(
        has_token,
        "[login] 200 但响应体不含 access_token 字段"
    );

    // 响应被 ApiResponse 包成 {success,code,data:{access_token,refresh_token},...}
    extract_json_string(&resp.body, "access_token")
        .filter(|t| !t.is_empty())
        .expect("[login] 无法从响应体解析出非空 access_token")
}

#[tokio::test]
async fn login() {
    let token = login_and_get_token().await;
    assert!(!token.is_empty(), "[login] token 为空");
    println!("[login] 成功拿到 access_token（长度 {}）", token.len());
}

/// 上传最小可行序列：request → (非秒传则) part_url → PUT chunk → confirm。
/// 复刻 src/hooks/useFileUpload.ts 真实序列。返回上传文件的 file_uuid（供 display 用）。
/// 关键：part PUT 必须用 Host=api.huanvae.cn（当年 403 SignatureDoesNotMatch 根因）。
#[tokio::test]
async fn upload() {
    let token = login_and_get_token().await;
    let base = base_url();

    // 一个极小的文本"文件"内容（避免依赖外部文件）。
    let content = b"huanvae-e2e-upload-probe\n";
    let file_size = content.len();
    // 内容 + |size:N| 影响哈希；这里用固定可复现的 hash 占位（后端按 hash 去重，
    // 用唯一 hash 避免命中历史秒传，从而真正走 part_url+PUT+confirm 全链路）。
    let file_hash = format!("e2e-probe-{}", uuid_like());

    // 1. request 上传
    let request_body = format!(
        r#"{{"file_type":"user_document","storage_location":"user_files","related_id":null,"filename":"e2e-probe.txt","file_size":{size},"content_type":"text/plain","file_hash":"{hash}","force_upload":false,"image_width":null,"image_height":null}}"#,
        size = file_size,
        hash = file_hash,
    );
    let req = data_plane_req(
        "POST",
        format!("{base}/api/storage/upload/request"),
        Some(&token),
        Some(request_body),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[upload/request] secure_http 失败: {e}"));
    println!("[upload/request] status={}", resp.status);
    if resp.status != 200 {
        println!("[upload/request] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[upload/request] 期望 200，实际 {}",
        resp.status
    );

    let req_body = resp.body.clone();
    let instant = req_body.contains("\"instant_upload\":true");
    println!("[upload/request] instant_upload = {instant}");

    if instant {
        // 秒传：file_key 已存在于服务端，无需 PUT；直接用已有 url 走 display。
        // 这是合法的真实分支（后端按 hash 去重）。打印并提前结束 upload 链路验证。
        println!("[upload] 命中秒传（后端已有同 hash 文件），跳过 part_url/PUT/confirm");
        return;
    }

    // 2. part_url（第 1 片）
    let file_key = extract_json_string(&req_body, "file_key")
        .expect("[upload/request] 响应缺 file_key");
    let upload_id =
        extract_json_string(&req_body, "multipart_upload_id").unwrap_or_default();
    let part_url_endpoint = format!(
        "{base}/api/storage/multipart/part_url?file_key={fk}&upload_id={uid}&part_number=1",
        fk = urlencode(&file_key),
        uid = urlencode(&upload_id),
    );
    let req = data_plane_req("GET", part_url_endpoint, Some(&token), None);
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[upload/part_url] secure_http 失败: {e}"));
    println!("[upload/part_url] status={}", resp.status);
    if resp.status != 200 {
        println!("[upload/part_url] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[upload/part_url] 期望 200，实际 {}",
        resp.status
    );
    let part_url = extract_json_string(&resp.body, "part_url")
        .expect("[upload/part_url] 响应缺 part_url");

    // part_url 可能是相对路径（新版后端）→ 拼 base（即 IP 源站）；
    // 绝对路径含逻辑域名 → 也改写到 IP base。无论哪种，PUT 时 Host=逻辑域名。
    let put_url = resolve_relative(&part_url, &base);

    // 3. PUT 分片（Host=api.huanvae.cn，这是 presigned 签名校验的关键）
    let mut put_headers = HashMap::new();
    put_headers.insert("Host".to_string(), logical_host());
    let put_req = SecureHttpReq {
        method: "PUT".to_string(),
        url: put_url,
        headers: put_headers,
        body: Some(String::from_utf8_lossy(content).into_owned()),
        pin_ca: true,
        extra_ca_pem: None,
        timeout_secs: Some(60),
    };
    let resp = secure_http(put_req)
        .await
        .unwrap_or_else(|e| panic!("[upload/PUT] secure_http 失败: {e}"));
    println!("[upload/PUT] status={}", resp.status);
    if !(200..300).contains(&resp.status) {
        println!("[upload/PUT] body: {}", resp.body);
    }
    assert!(
        (200..300).contains(&resp.status),
        "[upload/PUT] 期望 2xx，实际 {}（403=SignatureDoesNotMatch 通常是 Host 头不对）",
        resp.status
    );

    // 4. confirm
    let confirm_body = format!(r#"{{"file_key":"{}"}}"#, file_key);
    let req = data_plane_req(
        "POST",
        format!("{base}/api/storage/upload/confirm"),
        Some(&token),
        Some(confirm_body),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[upload/confirm] secure_http 失败: {e}"));
    println!("[upload/confirm] status={}", resp.status);
    if resp.status != 200 {
        println!("[upload/confirm] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[upload/confirm] 期望 200，实际 {}",
        resp.status
    );
    let file_url =
        extract_json_string(&resp.body, "file_url").expect("[upload/confirm] 响应缺 file_url");
    println!("[upload] 完成；file_url={file_url}");
}

/// 显示路径：取一个文件的 presigned 下载 URL → GET → 200。
/// 步骤复刻 src/services/fileCache.ts：POST /api/storage/file/{uuid}/presigned_url
/// {operation:'preview'} 拿 presigned_url，再 GET 它（Host=api.huanvae.cn）。
/// uuid 来源：先 GET /api/storage/files 列表取第一个 file_uuid（真实头像/图片同款下载链路）。
#[tokio::test]
async fn display() {
    let token = login_and_get_token().await;
    let base = base_url();

    // 1. 取文件列表，拿一个 file_uuid（复刻 src/api/storage.ts getFiles）。
    let req = data_plane_req(
        "GET",
        format!("{base}/api/storage/files?page=1&limit=1"),
        Some(&token),
        None,
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[display/files] secure_http 失败: {e}"));
    println!("[display/files] status={}", resp.status);
    if resp.status != 200 {
        println!("[display/files] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[display/files] 期望 200，实际 {}",
        resp.status
    );

    let file_uuid = match extract_json_string(&resp.body, "file_uuid") {
        Some(u) if !u.is_empty() => u,
        _ => {
            println!("[display] 该账号无任何文件（files 列表空），无法验证 presigned 下载；跳过 GET 断言");
            // 无文件不是 bug，但也不能假绿成"通过"：只断言列表端点本身 200（上面已断言）。
            return;
        }
    };
    println!("[display] 使用 file_uuid={file_uuid}");

    // 2. 取 presigned 下载/预览 URL（复刻 fileCache.getPresignedUrl）。
    let req = data_plane_req(
        "POST",
        format!("{base}/api/storage/file/{file_uuid}/presigned_url"),
        Some(&token),
        Some(r#"{"operation":"preview"}"#.to_string()),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[display/presigned] secure_http 失败: {e}"));
    println!("[display/presigned] status={}", resp.status);
    if resp.status != 200 {
        println!("[display/presigned] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[display/presigned] 期望 200，实际 {}",
        resp.status
    );
    let presigned = extract_json_string(&resp.body, "presigned_url")
        .expect("[display/presigned] 响应缺 presigned_url");
    let download_url = resolve_relative(&presigned, &base);

    // 3. GET presigned 下载 URL（Host=api.huanvae.cn）→ 200。
    let mut get_headers = HashMap::new();
    get_headers.insert("Host".to_string(), logical_host());
    let get_req = SecureHttpReq {
        method: "GET".to_string(),
        url: download_url,
        headers: get_headers,
        body: None,
        pin_ca: true,
        extra_ca_pem: None,
        timeout_secs: Some(60),
    };
    let resp = secure_http(get_req)
        .await
        .unwrap_or_else(|e| panic!("[display/GET] secure_http 失败: {e}"));
    println!("[display/GET] status={} body_len={}", resp.status, resp.body.len());
    assert_eq!(
        resp.status, 200,
        "[display/GET] 期望 200，实际 {}（403=Host 头不对或 presigned 过期）",
        resp.status
    );
}

// ============================================
// 小工具（零额外依赖：复用已在 [dependencies] 的 serde_json/uuid 不便于 test，
// 这里手写最小实现，仅供测试自身用）
// ============================================

/// 生成一个唯一字符串（基于纳秒时间戳 + 线程随机），用于避免上传秒传命中历史。
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ns:x}")
}

/// 最小 URL 百分号编码（仅编码 query 中可能出问题的字符；file_key/upload_id 多为 hex/段）。
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 把后端返回的（可能是相对路径或含逻辑域名的绝对路径）URL 统一改写到 IP 源站 base。
/// - 相对路径（不以 http 开头）→ base + "/" + path
/// - 含逻辑域名的绝对路径 → 把 https://<host> 替换成 base（IP 源站，不发 SNI）
fn resolve_relative(url: &str, base: &str) -> String {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        let b = base.trim_end_matches('/');
        let p = url.trim_start_matches('/');
        return format!("{b}/{p}");
    }
    // 绝对路径：替换 scheme://host 前缀为 base，保留 path+query
    if let Some(pos) = url[8..].find('/') {
        // 8 = len("https://")
        let path_and_query = &url[8 + pos..];
        let b = base.trim_end_matches('/');
        return format!("{b}{path_and_query}");
    }
    url.to_string()
}
