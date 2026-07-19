//! local_e2e — App 真实 Rust 数据面打【本地隔离多实例后端】的集成测试。
//!
//! ## 分层诚实标注:这是 **e2e(L2.5-rust)**
//! 直接驱动 App 数据面**仅有的两个真实请求函数**:
//!   - `secure_net::secure_http`  —— HTTP(`#[tauri::command]` 但本质普通 async fn,可直接 await)
//!   - `ws_proxy::ws_connect`     —— WebSocket(经 Tauri `Channel<WsEvent>` 回推帧)
//! 打本地隔离集群的实例 A(HTTP `http://127.0.0.1:18080`,WS `ws://127.0.0.1:18080/ws`)。
//!
//! **不是 L3 真机**:没有 webview、没有真 UI、没有真设备,只跑 App 的 Rust 数据面逻辑。
//! 层级仅到 "真实 App Rust 请求路径 × 本地多实例真后端",故记为 L2.5-rust。
//!
//! 与 [`public_e2e`] 的区别:那组用 `pin_ca:true`(私有 CA + mTLS + no-SNI)打公网源站;
//! 本组用 `pin_ca:false` + 明文本地 `http://` / `ws://`(本地隔离栈无 TLS,直连回环)。
//!
//! ## 安全(公开仓,无任何机密)
//! - **每次运行用随机账号**:`user_id` 含纳秒 + 自增计数后缀(见 [`unique_suffix`]),
//!   运行时现注册、用完即弃。无真实凭据、无环境密钥、无生产账号。
//! - 密码是一次性抛弃口令 [`TEST_PASSWORD`](对应前端 e2e helper 同款 `pw123456`)——
//!   **非机密**:它只用于临时随机测试用户,不对应任何真实账号。
//! - 不做任何 git 操作、不硬编码生产凭据。
//!
//! ## Fail-loud(集群不在 → 响亮失败,绝不静默跳过)
//! - 集群未起 → `secure_http` / `ws_connect` 返回 Err → `.expect`/`unwrap_or_else(panic!)`
//!   → 测试 panic **响亮失败**。全部硬断言(assert_eq!/assert! + 描述信息),
//!   无 `if let ... {}` 之类会让失败悄悄放行的软吞路径。
//!
//! ## 运行
//! ```bash
//! cargo test --manifest-path src-tauri/Cargo.toml --test local_e2e -- --nocapture
//! ```
//! 每个测试用**各自随机账号**(A/B 前缀 + 唯一后缀)→ 可并行(默认 test-threads),
//! 无跨测试账号冲突。
//!
//! ## env(可选覆盖,均有默认值,无需任何密钥)
//! - `LOCAL_E2E_BASE`(默认 `http://127.0.0.1:18080`):HTTP 数据面 base。
//! - `LOCAL_E2E_WS_BASE`(默认 `ws://127.0.0.1:18080`):WS base(其后拼 `/ws?token=<jwt>`)。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};

use huanvae_chat_app_lib::secure_net::{secure_http, SecureHttpReq};
use huanvae_chat_app_lib::ws_proxy::{ws_close, ws_connect, WsConnectOpts, WsEvent};

/// 抛弃式测试口令(**非机密**):账号是运行时随机创建的临时用户,用完即弃。
/// 与前端 e2e helper 同款 `pw123456` —— 不对应任何真实账号。
const TEST_PASSWORD: &str = "pw123456";

/// HTTP 数据面 base(本地隔离栈实例 A,明文回环)。可被 `LOCAL_E2E_BASE` 覆盖。
const DEFAULT_BASE: &str = "http://127.0.0.1:18080";
/// WS base(其后拼 `/ws?token=<jwt>`)。可被 `LOCAL_E2E_WS_BASE` 覆盖。
const DEFAULT_WS_BASE: &str = "ws://127.0.0.1:18080";

/// 进程内自增计数:与纳秒拼接,杜绝"同一时钟刻度并行调用"撞后缀(见 [`unique_suffix`])。
static SUFFIX_COUNTER: AtomicU64 = AtomicU64::new(0);

fn base_url() -> String {
    std::env::var("LOCAL_E2E_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string())
}

fn ws_base() -> String {
    std::env::var("LOCAL_E2E_WS_BASE").unwrap_or_else(|_| DEFAULT_WS_BASE.to_string())
}

// ============================================
// HTTP 请求/解析基础工具
// ============================================

/// 构造本地数据面 `SecureHttpReq`:`pin_ca=false` + 明文 http(本地隔离栈无 TLS,直连回环)。
/// 有 body 时带 `Content-Type: application/json`;有 token 时带 `Authorization: Bearer <token>`。
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
        pin_ca: false,
        extra_ca_pem: None,
        timeout_secs: Some(30),
    }
}

/// 从 JSON 文本抽一个字符串字段(朴素提取,复刻 public_e2e.rs;够测试断言用,不引额外依赖)。
/// 找 `"key"` 后第一个引号串。命中返回 Some(value)。
fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = body.find(&needle)? + needle.len();
    let rest = &body[start..];
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let q1 = after_colon.find('"')?;
    let value_part = &after_colon[q1 + 1..];
    let q2 = value_part.find('"')?;
    Some(value_part[..q2].to_string())
}

/// 从 JSON 文本抽一个整数字段(找 `"key":` 后紧跟的整数)。
/// 注意:needle 带前导引号(`"seq"`)→ 不会误命中 `"last_seq"` / `"max_seq"`(其 `seq` 前是 `_` 非 `"`)。
fn extract_json_number(body: &str, key: &str) -> Option<i64> {
    let needle = format!("\"{key}\"");
    let start = body.find(&needle)? + needle.len();
    let rest = &body[start..];
    let colon = rest.find(':')?;
    let after = rest[colon + 1..].trim_start();
    let end = after
        .find(|c: char| !c.is_ascii_digit() && c != '-')
        .unwrap_or(after.len());
    after[..end].parse::<i64>().ok()
}

/// 唯一后缀:纳秒 hex + 进程内自增计数 hex。用于随机账号 `user_id`,避免跨运行/跨并行测试冲突。
fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let c = SUFFIX_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{ns:x}{c:x}")
}

/// `conversation_id` = `"conv-"` + 两个 `user_id` 字典序排序后用 `"-"` 连接。
/// (ASCII 用户 id 的字节序 == 字典序,与后端一致。)
fn conv_id(a: &str, b: &str) -> String {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    format!("conv-{lo}-{hi}")
}

// ============================================
// 业务动作 helper(每步硬断言 2xx / 200)
// ============================================

/// 注册一个随机账号(`user` 已含随机后缀)。昵称 = `"nick"+user`(必 >= 2 字符,
/// 后端拒绝 <2 字符昵称)。断言 2xx。
async fn register(base: &str, user: &str) {
    let body = format!(
        r#"{{"user_id":{uid},"nickname":{nick},"password":{pass}}}"#,
        uid = serde_json::to_string(user).unwrap(),
        nick = serde_json::to_string(&format!("nick{user}")).unwrap(),
        pass = serde_json::to_string(TEST_PASSWORD).unwrap(),
    );
    let req = data_plane_req("POST", format!("{base}/api/auth/register"), None, Some(body));
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[register {user}] secure_http 调用失败(集群未起?): {e}"));
    println!("[register {user}] status={}", resp.status);
    if !(200..300).contains(&resp.status) {
        println!("[register {user}] body: {}", resp.body);
    }
    assert!(
        (200..300).contains(&resp.status),
        "[register {user}] 期望 2xx,实际 {}: {}",
        resp.status,
        resp.body
    );
}

/// 登录拿 access_token(JWT)。断言 200 + 非空 token。返回值绝不打印明文。
async fn login_token(base: &str, user: &str, pass: &str) -> String {
    let body = format!(
        r#"{{"user_id":{uid},"password":{pw},"device_info":"Huanvae Chat Local E2E"}}"#,
        uid = serde_json::to_string(user).unwrap(),
        pw = serde_json::to_string(pass).unwrap(),
    );
    let req = data_plane_req("POST", format!("{base}/api/auth/login"), None, Some(body));
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[login {user}] secure_http 调用失败(集群未起?): {e}"));
    println!("[login {user}] status={}", resp.status);
    if resp.status != 200 {
        println!("[login {user}] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[login {user}] 期望 200,实际 {}: {}",
        resp.status, resp.body
    );
    extract_json_string(&resp.body, "access_token")
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| panic!("[login {user}] 响应体无非空 access_token(body 不回显)"))
}

/// A(`ua` / token `ta`)向 B(`ub` / token `tb`)发好友请求 → B 批准。两步均硬断言 2xx。
async fn send_friend_and_approve(base: &str, ta: &str, tb: &str, ua: &str, ub: &str) {
    // 1) A 发起好友请求(Bearer A)。request_time 用真实 now 的 RFC3339(ISO8601,末尾 Z)。
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let request_body = format!(
        r#"{{"user_id":{ua},"target_user_id":{ub},"reason":"","request_time":{ts}}}"#,
        ua = serde_json::to_string(ua).unwrap(),
        ub = serde_json::to_string(ub).unwrap(),
        ts = serde_json::to_string(&now).unwrap(),
    );
    let req = data_plane_req(
        "POST",
        format!("{base}/api/friends/requests"),
        Some(ta),
        Some(request_body),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[friend/request {ua}->{ub}] secure_http 失败: {e}"));
    println!("[friend/request {ua}->{ub}] status={}", resp.status);
    if !(200..300).contains(&resp.status) {
        println!("[friend/request] body: {}", resp.body);
    }
    assert!(
        (200..300).contains(&resp.status),
        "[friend/request {ua}->{ub}] 期望 2xx,实际 {}: {}",
        resp.status,
        resp.body
    );

    // 2) B 批准(Bearer B)。成功后端返回 200 空体。
    let approve_body = format!(
        r#"{{"user_id":{ub},"applicant_user_id":{ua}}}"#,
        ub = serde_json::to_string(ub).unwrap(),
        ua = serde_json::to_string(ua).unwrap(),
    );
    let req = data_plane_req(
        "POST",
        format!("{base}/api/friends/requests/approve"),
        Some(tb),
        Some(approve_body),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[friend/approve {ub}<-{ua}] secure_http 失败: {e}"));
    println!("[friend/approve {ub}<-{ua}] status={}", resp.status);
    if !(200..300).contains(&resp.status) {
        println!("[friend/approve] body: {}", resp.body);
    }
    assert!(
        (200..300).contains(&resp.status),
        "[friend/approve {ub}<-{ua}] 期望 2xx,实际 {}: {}",
        resp.status,
        resp.body
    );
}

/// 发一条文本消息(Bearer sender)→ 硬断言 200。
async fn send_text(base: &str, token: &str, receiver: &str, content: &str) {
    let body = format!(
        r#"{{"receiver_id":{rid},"message_content":{mc},"message_type":"text","file_uuid":null,"file_url":null,"file_size":null}}"#,
        rid = serde_json::to_string(receiver).unwrap(),
        mc = serde_json::to_string(content).unwrap(),
    );
    let req = data_plane_req("POST", format!("{base}/api/messages"), Some(token), Some(body));
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[send_text ->{receiver}] secure_http 失败: {e}"));
    println!("[send_text ->{receiver}] status={} content={content}", resp.status);
    if resp.status != 200 {
        println!("[send_text] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[send_text ->{receiver}] 期望 200,实际 {}: {}",
        resp.status, resp.body
    );
}

// ============================================
// 测试 1:登录
// ============================================

#[tokio::test]
async fn login() {
    let base = base_url();
    let suffix = unique_suffix();
    let user = format!("le2ea{suffix}");

    register(&base, &user).await;
    let token = login_token(&base, &user, TEST_PASSWORD).await;

    assert!(!token.is_empty(), "[login] token 为空");
    println!("[login] user={user} 拿到 access_token(长度 {})", token.len());
}

// ============================================
// 测试 2:发消息 → 对端 sync 收到(硬断言 content + seq==1)
// ============================================

#[tokio::test]
async fn send_message_and_receive_via_sync() {
    let base = base_url();
    let suffix = unique_suffix();
    // 同后缀 + 不同前缀 → A/B 天然不同;字典序 le2ea < le2eb。
    let ua = format!("le2ea{suffix}");
    let ub = format!("le2eb{suffix}");

    register(&base, &ua).await;
    register(&base, &ub).await;
    let ta = login_token(&base, &ua, TEST_PASSWORD).await;
    let tb = login_token(&base, &ub, TEST_PASSWORD).await;

    send_friend_and_approve(&base, &ta, &tb, &ua, &ub).await;

    let content = format!("le2e-sync-{suffix}");
    send_text(&base, &ta, &ub, &content).await;

    // B 同步会话 conv-<sorted a,b>,last_seq=0 → 应拿回刚发的这条(全新会话唯一一条,seq==1)。
    let cid = conv_id(&ua, &ub);
    let sync_body = format!(
        r#"{{"conversations":[{{"conversation_id":{cid},"conversation_type":"friend","last_seq":0}}]}}"#,
        cid = serde_json::to_string(&cid).unwrap(),
    );
    let req = data_plane_req(
        "POST",
        format!("{base}/api/messages/sync"),
        Some(&tb),
        Some(sync_body),
    );
    let resp = secure_http(req)
        .await
        .unwrap_or_else(|e| panic!("[sync] secure_http 失败: {e}"));
    println!("[sync] status={}", resp.status);
    if resp.status != 200 {
        println!("[sync] body: {}", resp.body);
    }
    assert_eq!(
        resp.status, 200,
        "[sync] 期望 200,实际 {}: {}",
        resp.status, resp.body
    );

    let body = &resp.body;
    // 硬断言 ①:确切内容出现在 message_content 字段(比裸 contains(content) 更严:确认落在正确字段)。
    let content_field = format!(
        "\"message_content\":{}",
        serde_json::to_string(&content).unwrap()
    );
    assert!(
        body.contains(content_field.as_str()),
        "[sync] 同步结果的 message_content 不含刚发送的确切内容 '{content}':{body}"
    );
    // 硬断言 ②:该条(全新会话唯一一条)seq == 1。
    let seq = extract_json_number(body, "seq")
        .unwrap_or_else(|| panic!("[sync] 无法从同步结果解析出 seq:{body}"));
    assert_eq!(
        seq, 1,
        "[sync] 全新会话首条消息 seq 应为 1,实际 {seq}:{body}"
    );
    println!("[sync] B 收到 A 的消息,content 命中且 seq={seq}");
}

// ============================================
// WS 测试工具
// ============================================

/// 捕获 `Channel<WsEvent>` 事件为**序列化后的 JSON 字符串**序列(复刻 ws_proxy.rs `#[cfg(test)]`)。
/// 注意:这里存的是 `WsEvent` 序列化结果,如 `{"event":"text","data":"<内层 WS 帧文本>"}`,
/// 内层帧的引号被 serde 转义为 `\"`(见 [`any_frame_has_all`] 反转义处理)。
fn capture_channel() -> (Channel<WsEvent>, Arc<Mutex<Vec<String>>>) {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let sink = captured.clone();
    let ch = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Json(s) = body {
            sink.lock().unwrap_or_else(|p| p.into_inner()).push(s);
        }
        Ok(())
    });
    (ch, captured)
}

fn snapshot(captured: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
    captured.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// 判定:是否存在**任一**帧,其【反转义后】文本同时包含所有 `needles`。
///
/// 每个捕获串是序列化后的 `WsEvent`(`WsEvent::Text{data}` → `{"event":"text","data":"<内层帧>"}`)。
/// serde 把内层原始 WS 帧文本嵌入 `data` 时会把其中的 `"` 转义成 `\"`。先把 `\"` 反转义回 `"`,
/// 内层帧的原始 token(如 `"type":"connected"`)即可直接子串匹配。
fn any_frame_has_all(frames: &[String], needles: &[&str]) -> bool {
    frames.iter().any(|f| {
        let unescaped = f.replace("\\\"", "\"");
        needles.iter().all(|n| unescaped.contains(*n))
    })
}

/// 轮询直到 `pred()` 为真或超时(~10s:20 轮 × 500ms)。返回是否在超时内满足。
/// WS 消息近即时投递,该窗口足够稳;`#[tokio::test]`(current-thread)下每次 sleep 让出,
/// ws_connect 后台读任务得以推帧。
async fn poll_until<F: FnMut() -> bool>(mut pred: F) -> bool {
    for _ in 0..20 {
        if pred() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    pred()
}

// ============================================
// 测试 3:WS 收到 connected + new_message(真实 ws_connect,硬断言)
// ============================================

#[tokio::test]
async fn ws_proxy_receives_connected_and_new_message() {
    let base = base_url();
    let suffix = unique_suffix();
    let ua = format!("le2ea{suffix}");
    let ub = format!("le2eb{suffix}");

    register(&base, &ua).await;
    register(&base, &ub).await;
    let ta = login_token(&base, &ua, TEST_PASSWORD).await;
    let tb = login_token(&base, &ub, TEST_PASSWORD).await;
    send_friend_and_approve(&base, &ta, &tb, &ua, &ub).await;

    // B 用真实 App 数据面 ws_connect 建 WS(ws:// 明文 → tungstenite 跳过 TLS,connector 不生效)。
    let ws_url = format!("{}/ws?token={}", ws_base(), tb);
    let (ch, captured) = capture_channel();
    let conn_id = ws_connect(
        ws_url,
        WsConnectOpts {
            extra_ca_pem: None,
            idle_timeout_secs: Some(30),
        },
        ch,
    )
    .await
    .unwrap_or_else(|e| panic!("[ws] B ws_connect 失败(集群未起?): {e}"));
    assert!(conn_id > 0, "[ws] conn_id 应 >0(从 1 起),实际 {conn_id}");
    println!("[ws] B 建连成功 conn_id={conn_id}");

    // 建连后首帧:connected。
    let connected = poll_until(|| any_frame_has_all(&snapshot(&captured), &["\"type\":\"connected\""])).await;
    let frames_after_connect = snapshot(&captured);
    assert!(
        connected,
        "[ws] 未在超时内收到 connected 帧,已捕获: {frames_after_connect:?}"
    );
    println!("[ws] 收到 connected 帧");

    // A 向 B 发文本 → B 的 WS 应收到 new_message 帧(含确切 content + source_type:friend)。
    let content = format!("le2e-ws-{suffix}");
    send_text(&base, &ta, &ub, &content).await;

    let content_needle = format!("\"content\":\"{content}\"");
    let got_msg = poll_until(|| {
        any_frame_has_all(
            &snapshot(&captured),
            &[
                "\"type\":\"new_message\"",
                content_needle.as_str(),
                "\"source_type\":\"friend\"",
            ],
        )
    })
    .await;
    let frames_after_send = snapshot(&captured);
    assert!(
        got_msg,
        "[ws] 未在超时内收到含内容 '{content}' 的 new_message 帧,已捕获: {frames_after_send:?}"
    );
    println!("[ws] 收到 new_message 帧,content 命中");

    // 收尾:主动关连接(同步 fn,不影响上面断言;即便不调用,读任务/writer 也会在 drop 后自然清理)。
    ws_close(conn_id, None, None);
    println!("[ws] 完成,已 ws_close(conn_id={conn_id})");
}
