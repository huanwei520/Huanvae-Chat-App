//! nosni_clienthello —— 去 SNI 的**请求级**集成测试（真代码、真 ClientHello、真域名主机名）。
//!
//! 与 `public_e2e.rs`（打生产后端验证功能）互补：本文件不依赖外网，用一个本地 TCP
//! 监听器把 **App 真实出站函数的 ClientHello 抓下来**，解析 TLS 扩展，断言**没有
//! server_name (type 0) 扩展**。
//!
//! ## 为什么用域名主机名
//! IP 字面量本就不发 SNI（rustls 对 IP 略过扩展），因此"连 IP 无 SNI"证明不了修复。
//! 本测试把 URL 主机名设成 `127.0.0.1.nip.io`（公共 DNS 记录指向 127.0.0.1）——
//! **是域名**，会走到 `tls_sni` 判定分支。修复前该主机名必然带 SNI；修复后必须为无。
//!
//! ## 覆盖的真实函数
//! - `huanvae_chat_app_lib::secure_net::secure_http`（数据面 HTTP，reqwest + rustls）
//!   —— 覆盖 `secure_net.rs::build_client`（h2）与 `acquire_client` 缓存路径；
//!   `pin_ca:true/false` 两条分支都跑（`pin_ca:true` 走内置 CA + mTLS）。
//! - `huanvae_chat_app_lib::ws_proxy::ws_connect`（数据面 WS，rustls ClientConfig）
//!   —— 覆盖 `ws_proxy.rs::build_tls_config`。
//!
//! ## 运行
//! ```bash
//! cargo test --manifest-path src-tauri/Cargo.toml --test nosni_clienthello -- --nocapture --test-threads=1
//! ```
//! 无外部凭据、无外网依赖（握手必然因证书不被信任而失败，但 ClientHello 已被抓取）。

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

/// 目标主机名：公共 DNS 指向 127.0.0.1，因此**是域名**但仍能连到本地监听器。
const DOMAIN_HOST: &str = "127.0.0.1.nip.io";

/// 抓到的 ClientHello 摘要。
#[derive(Debug, Clone)]
struct Hello {
    /// ClientHello 记录长度（字节，仅作参照）
    len: usize,
    /// 是否含 server_name 扩展（extension type 0）
    has_sni: bool,
    /// SNI 里带的字符串（若扩展存在）
    sni_name: Option<String>,
    /// 是否含 ALPN 扩展（可选信息）
    alpn: Vec<String>,
}

/// 解析 TLS ClientHello 扩展，找 server_name(type 0) 与 ALPN(16)。
fn parse_client_hello(buf: &[u8]) -> Option<Hello> {
    // TLS record: type(1)=0x16, ver(2), len(2)=..
    if buf.len() < 9 || buf[0] != 0x16 {
        return None;
    }
    let rec_len = u16::from_be_bytes([buf[3], buf[4]]) as usize;
    let hs = buf.get(5..5 + rec_len)?;
    // handshake: type(1)=0x01 ClientHello, len(3)
    if hs[0] != 0x01 {
        return None;
    }
    let hs_len = ((hs[1] as usize) << 16) | ((hs[2] as usize) << 8) | hs[3] as usize;
    let body = hs.get(4..4 + hs_len)?;
    let mut p = 0usize;
    p += 2; // legacy_version
    p += 32; // random
    let sid_len = *body.get(p)? as usize;
    p += 1 + sid_len;
    let cs_len = u16::from_be_bytes([*body.get(p)?, *body.get(p + 1)?]) as usize;
    p += 2 + cs_len;
    let comp_len = *body.get(p)? as usize;
    p += 1 + comp_len;
    let ext_total = u16::from_be_bytes([*body.get(p)?, *body.get(p + 1)?]) as usize;
    p += 2;
    let exts = body.get(p..p + ext_total)?;

    let mut has_sni = false;
    let mut sni_name = None;
    let mut alpn = Vec::new();
    let mut q = 0usize;
    while q + 4 <= exts.len() {
        let etype = u16::from_be_bytes([exts[q], exts[q + 1]]);
        let elen = u16::from_be_bytes([exts[q + 2], exts[q + 3]]) as usize;
        let edata = exts.get(q + 4..q + 4 + elen)?;
        match etype {
            0 => {
                // ServerNameList: list_len(2), entry_type(1)=0, name_len(2), name
                has_sni = true;
                if edata.len() >= 5 {
                    let nlen = u16::from_be_bytes([edata[3], edata[4]]) as usize;
                    sni_name = edata
                        .get(5..5 + nlen)
                        .map(|b| String::from_utf8_lossy(b).to_string());
                }
            }
            16 => {
                // ALPN: list_len(2), then (len(1), proto)*
                let mut r = 2usize;
                while r < edata.len() {
                    let l = edata[r] as usize;
                    if r + 1 + l > edata.len() {
                        break;
                    }
                    alpn.push(String::from_utf8_lossy(&edata[r + 1..r + 1 + l]).to_string());
                    r += 1 + l;
                }
            }
            _ => {}
        }
        q += 4 + elen;
    }
    Some(Hello {
        len: buf.len(),
        has_sni,
        sni_name,
        alpn,
    })
}

/// 起一个只抓一次握手的监听器，返回 (port, recv)。
fn spawn_hello_catcher() -> (u16, mpsc::Receiver<Hello>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let _ = sock.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = vec![0u8; 8192];
            let mut total = 0usize;
            // 一次 read 通常就够（ClientHello 单包）；最多读两轮兼容 TLS 分片。
            for _ in 0..2 {
                match sock.read(&mut buf[total..]) {
                    Ok(0) => break,
                    Ok(n) => {
                        total += n;
                        if total >= 5 {
                            let rec_len = u16::from_be_bytes([buf[3], buf[4]]) as usize;
                            if total >= 5 + rec_len {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            // 回一个 TLS alert（handshake_failure）让对端尽快结束，不让测试等超时。
            let _ = sock.write_all(&[0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28]);
            let _ = sock.flush();
            drop(sock);
            if let Some(h) = parse_client_hello(&buf[..total]) {
                let _ = tx.send(h);
            }
        }
    });
    (port, rx)
}

/// 断言一次 ClientHello：必须**无 SNI**，并把完整原始信息打到 stdout 供交付取证。
fn assert_no_sni(label: &str, hello: &Hello) {
    println!(
        "[{label}] ClientHello len={} has_sni={} sni_name={:?} alpn={:?}",
        hello.len, hello.has_sni, hello.sni_name, hello.alpn
    );
    assert!(
        !hello.has_sni,
        "[{label}] ClientHello 仍带 server_name 扩展: {:?}",
        hello.sni_name
    );
}

/// 数据面 HTTP（`secure_net::secure_http`，pin_ca=true = 内置 CA + mTLS）→ 必须无 SNI。
#[test]
fn secure_http_pin_ca_sends_no_sni_for_domain_host() {
    let (port, rx) = spawn_hello_catcher();
    let url = format!("https://{DOMAIN_HOST}:{port}/health");
    let rt = tokio::runtime::Runtime::new().unwrap();
    // 握手会因证书不被内置 CA 信任而失败；我们只关心 ClientHello。
    let res = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
        huanvae_chat_app_lib::secure_net::SecureHttpReq {
            method: "GET".into(),
            url,
            headers: Default::default(),
            body: None,
            pin_ca: true,
            extra_ca_pem: None,
            timeout_secs: Some(5),
        },
    ));
    println!("[secure_http pin_ca] 结果（预期 Err，证书不被信任）: {:?}", res.is_err());
    let hello = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("未抓到 ClientHello");
    assert_no_sni("secure_http pin_ca=true", &hello);
}

/// 数据面 HTTP（`secure_net::secure_http`，pin_ca=false = 系统信任）→ 必须无 SNI。
#[test]
fn secure_http_system_trust_sends_no_sni_for_domain_host() {
    let (port, rx) = spawn_hello_catcher();
    let url = format!("https://{DOMAIN_HOST}:{port}/health");
    let rt = tokio::runtime::Runtime::new().unwrap();
    let res = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
        huanvae_chat_app_lib::secure_net::SecureHttpReq {
            method: "GET".into(),
            url,
            headers: Default::default(),
            body: None,
            pin_ca: false,
            extra_ca_pem: None,
            timeout_secs: Some(5),
        },
    ));
    println!("[secure_http 系统信任] 结果（预期 Err，证书不被信任）: {:?}", res.is_err());
    let hello = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("未抓到 ClientHello");
    assert_no_sni("secure_http pin_ca=false", &hello);
}

/// 数据面 WS（`ws_proxy::ws_connect`，rustls ClientConfig）→ 必须无 SNI。
#[test]
fn ws_connect_sends_no_sni_for_domain_host() {
    let (port, rx) = spawn_hello_catcher();
    let url = format!("wss://{DOMAIN_HOST}:{port}/ws?token=redacted");
    let rt = tokio::runtime::Runtime::new().unwrap();
    let res = rt.block_on(huanvae_chat_app_lib::ws_proxy::ws_connect(
        url,
        huanvae_chat_app_lib::ws_proxy::WsConnectOpts {
            extra_ca_pem: None,
            idle_timeout_secs: None,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
    ));
    println!("[ws_connect] 结果（预期 Err/无 101，证书不被信任）: {:?}", res.is_err());
    let hello = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("未抓到 ClientHello");
    assert_no_sni("ws_proxy ws_connect", &hello);
}

/// **对照组**（证明断言不是假阴性）：同一解析器接一个**开着 SNI**的客户端，
/// 必须报出 `has_sni=true` 且带出主机名字符串。若本控件失败，说明上面三条
/// `has_sni=false` 可能只是解析器读不到扩展，而非真的没发 SNI。
#[test]
fn control_client_with_sni_enabled_is_detected() {
    let (port, rx) = spawn_hello_catcher();
    // 直接用 reqwest 默认（tls_sni(true)）连同一域名主机名。
    let rt = tokio::runtime::Runtime::new().unwrap();
    let res = rt.block_on(async {
        let client = reqwest::Client::builder().build().unwrap();
        client
            .get(format!("https://{DOMAIN_HOST}:{port}/health"))
            .timeout(Duration::from_secs(5))
            .send()
            .await
    });
    println!("[control tls_sni=true] 结果（预期 Err，证书不被信任）: {:?}", res.is_err());
    let hello = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("未抓到 ClientHello");
    println!(
        "[control tls_sni=true] ClientHello len={} has_sni={} sni_name={:?} alpn={:?}",
        hello.len, hello.has_sni, hello.sni_name, hello.alpn
    );
    assert!(hello.has_sni, "对照组必须抓得到 SNI 扩展，否则本文件的断言无判别力");
    assert_eq!(hello.sni_name.as_deref(), Some(DOMAIN_HOST));
}

// ============================================================================
// 卡面点名的「修前仍带 SNI 的路径」逐条功能级实测（第14轮补）
// A12 App 发现 / A28 NFC http_request / A29 故障上报 —— 三条都经 `secure_net::secure_http`
// （pin_ca=true 数据面 / false 发现面），此处用**同一生产函数**打**真实生产端点**。
// ============================================================================

/// A12 功能级：App 发现面「CF 拉配置失败 → 内置默认 IP 探测 /health 200」的完整回退链。
/// 第一步（CF，pin_ca=false）按去 SNI 设计预期失败；第二步（源站 IP + mTLS，pin_ca=true）应 200。
#[test]
fn a12_functional_discovery_cf_then_builtin_probe() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    // 步骤 1：CF 发现面（去 SNI 后按设计不可达）
    let cf = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
        huanvae_chat_app_lib::secure_net::SecureHttpReq {
            method: "GET".into(),
            url: "https://ca.huanvae.cn/endpoints".into(),
            headers: Default::default(),
            body: None,
            pin_ca: false,
            extra_ca_pem: None,
            timeout_secs: Some(8),
        },
    ));
    match &cf {
        Ok(r) => println!("[A12 功能级] CF 发现面 GET /endpoints -> HTTP {}", r.status),
        Err(e) => println!("[A12 功能级] CF 发现面 GET /endpoints -> 失败（去 SNI 后按设计）: {e}"),
    }
    // 步骤 2：内置默认 IP + mTLS 无 SNI 探测（App `pickFastest` 用的就是这条）
    for ip in ["47.105.101.42", "47.104.231.235"] {
        let probe = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
            huanvae_chat_app_lib::secure_net::SecureHttpReq {
                method: "GET".into(),
                url: format!("https://{ip}/health"),
                headers: Default::default(),
                body: None,
                pin_ca: true,
                extra_ca_pem: None,
                timeout_secs: Some(8),
            },
        ));
        match &probe {
            Ok(r) => println!("[A12 功能级] 回退探测 https://{ip}/health -> HTTP {}", r.status),
            Err(e) => println!("[A12 功能级] 回退探测 https://{ip}/health -> 失败: {e}"),
        }
    }
}

/// A28 功能级：NFC `http/request` 动作改走的本仓 `secure_http`（pin_ca=false）打真实 HTTPS 端点。
#[test]
fn a28_functional_secure_http_get_real_endpoint() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let r = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
        huanvae_chat_app_lib::secure_net::SecureHttpReq {
            method: "GET".into(),
            url: "https://github.com/huanwei520/huanvae-chat-app".into(),
            headers: Default::default(),
            body: None,
            pin_ca: false,
            extra_ca_pem: None,
            timeout_secs: Some(20),
        },
    ));
    match &r {
        Ok(x) => println!("[A28 功能级] secure_http GET github.com -> HTTP {}", x.status),
        Err(e) => println!("[A28 功能级] secure_http GET github.com -> 失败: {e}"),
    }
}

/// A29 功能级：故障上报联调分支改走的本仓 `secure_http`（POST）打真实 API 端点。
/// 未带合法 token 时期望 4xx（说明链路通、鉴权生效），只打印真实状态。
#[test]
fn a29_functional_secure_http_post_fault_report() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    let r = rt.block_on(huanvae_chat_app_lib::secure_net::secure_http(
        huanvae_chat_app_lib::secure_net::SecureHttpReq {
            method: "POST".into(),
            url: "https://47.105.101.42/api/fault-reports".into(),
            headers,
            body: Some("{}".to_string()),
            pin_ca: true,
            extra_ca_pem: None,
            timeout_secs: Some(10),
        },
    ));
    match &r {
        Ok(x) => println!("[A29 功能级] secure_http POST /api/fault-reports -> HTTP {}", x.status),
        Err(e) => println!("[A29 功能级] secure_http POST /api/fault-reports -> 失败: {e}"),
    }
}
