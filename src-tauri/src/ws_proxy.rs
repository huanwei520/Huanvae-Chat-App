//! ws_proxy — 数据面 WebSocket 走 Rust(tokio-tungstenite + rustls 内置私有 CA)。
//!
//! 为什么必须走 Rust:webview 的浏览器 `WebSocket` 用**系统信任**校验 TLS,
//! 验不过私有 CA 签发的自签 leaf(私有 CA 只内置在 App,不进系统信任库)。
//! HTTP/SSE 已迁到 secure_net.rs(reqwest+rustls),WS 同理迁到这里。
//!
//! TLS 策略与 secure_net.rs 完全一致:只信编译期内置 CA(`EMBEDDED_CA_PEM`)
//! (+ 轮换重叠期 `extra_ca_pem`)。前端传来的就是 `wss://<ip>:port` 的 **IP 字面量** URL
//! (前端 RustWebSocket 用 discovery 的 direct_ip 改写主机)——IP 不发 SNI,绕阿里云 ICP 的
//! SNI 拦截;**信任=链到内置 CA、不验主机名/SAN**(leaf 与 IP/域名解耦,换 IP 不重签)。
//! 全程 Rust 内自管 TLS → 绕过 iOS ATS / Android NSC。
//!
//! 前端经 `src/services/rustWebSocket.ts` 的 `RustWebSocket`(模拟浏览器
//! WebSocket 接口子集)驱动:
//!   - `ws_connect(url, opts, on_event)` 建连成功返回 `conn_id`,读循环经 Channel 推帧;
//!   - `ws_send_text` / `ws_send_binary` / `ws_close` 用 `conn_id` 操作。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::Connector;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::verify_server_cert_signed_by_trust_anchor;
use rustls::crypto::{WebPkiSupportedAlgorithms, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{DigitallySignedStruct, RootCertStore, SignatureScheme};

use crate::secure_net::{EMBEDDED_CA_PEM, EMBEDDED_CLIENT_CERT_PEM, EMBEDDED_CLIENT_KEY_PEM};

/// 自增连接 ID(从 1 开始;0 不用,便于前端区分"未建连")
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// 活动连接的 writer 通道:`conn_id` → 向 writer 任务投递待发帧的 sender。
/// reader 任务结束时移除自身;sender 全部 drop 后 writer 任务自然退出并关闭写半。
static CONNS: Lazy<Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 锁 CONNS(中毒时恢复内部值,不 panic 拖垮其它连接)
fn conns() -> std::sync::MutexGuard<'static, HashMap<u64, mpsc::UnboundedSender<Message>>> {
    CONNS.lock().unwrap_or_else(|p| p.into_inner())
}

/// 建连参数。数据面 WS 恒钉内置 CA,故无 `pin_ca` 字段;
/// 直接接收 discovery `SecureHttpResolve` 的子集(serde 默认忽略多余的 `pin_ca`/`direct_ip`/`direct_port`
/// —— 直连 IP 由前端改写 URL 主机实现,本侧只需 extra_ca)。
#[derive(Debug, Deserialize)]
pub struct WsConnectOpts {
    /// CA 轮换重叠期:除内置 CA 外额外信任的 CA(发现入口下发的 ca_pem)。
    #[serde(default)]
    pub extra_ca_pem: Option<String>,
}

/// 流式 WS 事件(Rust → JS,经 Tauri Channel)。
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum WsEvent {
    /// 文本帧(JSON 控制消息)
    Text { data: String },
    /// 二进制帧(语音音频等)。经 Channel 序列化为 JS number[],前端转回 ArrayBuffer。
    Binary { data: Vec<u8> },
    /// 收到对端 Close 帧 / 流正常结束(带关闭码)
    Close { code: u16 },
    /// 读取出错(WS 协议错误 / IO 错误)
    Error { message: String },
}

/// 服务端证书校验器:**只验"证书链到内置私有 CA"+ 验签,跳过主机名/SAN 校验**。
/// 信任建立在"这是我私有 CA 签的证书"这一件事上,而非"匹配某 IP/域名"。私有 CA 独占且单一用途
/// → SAN 校验本就多余(那是给公共 CA 防串台的);leaf 与 IP/域名彻底解耦,换 IP / 将来用域名都不重签。
/// 仍 `verify_server_cert_signed_by_trust_anchor`(验链)+ 委托 provider 验签 → 伪造不出链到 CA 的证书,挡 MITM。
#[derive(Debug)]
struct CaPinNoHostnameVerifier {
    roots: Arc<RootCertStore>,
    supported: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for CaPinNoHostnameVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let cert = ParsedCertificate::try_from(end_entity)?;
        verify_server_cert_signed_by_trust_anchor(
            &cert,
            &self.roots,
            intermediates,
            now,
            self.supported.all,
        )?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.supported)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.supported.supported_schemes()
    }
}

/// 构建 rustls 客户端配置:CA-pin + 跳主机名(见 `CaPinNoHostnameVerifier`)。
/// 用显式 ring provider(与全工程一致),不依赖进程级 default provider 是否安装。
fn build_tls_config(extra_ca_pem: Option<&str>) -> Result<Arc<rustls::ClientConfig>, String> {
    let mut roots = RootCertStore::empty();
    add_pem_certs(&mut roots, EMBEDDED_CA_PEM).map_err(|e| format!("内置 CA: {e}"))?;
    if let Some(extra) = extra_ca_pem {
        // 额外 CA 解析失败不致命(仍有内置 CA 兜底),但打日志便于 CA 轮换期排障
        if let Err(e) = add_pem_certs(&mut roots, extra.as_bytes()) {
            eprintln!("[ws_proxy] extra_ca 解析失败,忽略(仍信内置 CA): {e}");
        }
    }

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(CaPinNoHostnameVerifier {
        roots: Arc::new(roots),
        supported: provider.signature_verification_algorithms,
    });
    // mTLS:呈递内置客户端证书(edge nginx ssl_verify_client 要求)。与 secure_net 同一张证书。
    let (client_certs, client_key) = load_client_identity()?;
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS 协议版本配置失败: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_client_auth_cert(client_certs, client_key)
        .map_err(|e| format!("客户端证书配置失败: {e}"))?;
    Ok(Arc::new(config))
}

/// 解析内置客户端证书链 + 私钥(mTLS:握手时呈递给 edge nginx ssl_verify_client)。
fn load_client_identity() -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), String> {
    let mut cert_rd = std::io::BufReader::new(EMBEDDED_CLIENT_CERT_PEM);
    let certs = rustls_pemfile::certs(&mut cert_rd)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("客户端证书解析失败: {e}"))?;
    if certs.is_empty() {
        return Err("客户端证书 PEM 无有效证书".to_string());
    }
    let mut key_rd = std::io::BufReader::new(EMBEDDED_CLIENT_KEY_PEM);
    let key = rustls_pemfile::private_key(&mut key_rd)
        .map_err(|e| format!("客户端私钥解析失败: {e}"))?
        .ok_or_else(|| "客户端私钥 PEM 无有效私钥".to_string())?;
    Ok((certs, key))
}

/// 把 PEM bundle 中的全部证书加入信任库(任一条目解析/加入失败即返回 Err)。
fn add_pem_certs(roots: &mut rustls::RootCertStore, pem: &[u8]) -> Result<(), String> {
    let mut rd = std::io::BufReader::new(pem);
    let mut added = 0usize;
    for item in rustls_pemfile::certs(&mut rd) {
        let der = item.map_err(|e| format!("PEM 解析失败: {e}"))?;
        roots
            .add(der)
            .map_err(|e| format!("证书加入信任库失败: {e}"))?;
        added += 1;
    }
    if added == 0 {
        return Err("PEM 中无有效证书".to_string());
    }
    Ok(())
}

/// 建立数据面 WebSocket 连接。成功返回 `conn_id`(此后读循环经 `on_event` 推帧)。
/// 失败(握手/TLS/网络)直接 Err → 前端 `RustWebSocket` 触发 onerror+onclose。
#[tauri::command]
pub async fn ws_connect(
    url: String,
    opts: WsConnectOpts,
    on_event: Channel<WsEvent>,
) -> Result<u64, String> {
    let connector = Connector::Rustls(build_tls_config(opts.extra_ca_pem.as_deref())?);

    // url 已是 IP 字面量(wss://<ip>:port,前端 RustWebSocket 用 direct_ip 改写主机)→
    // 直连该 IP、不发 SNI、内置 CA 验链(不验主机名/SAN,见 CaPinNoHostnameVerifier)。disable_nagle=true 降低实时延迟。
    let (ws_stream, _resp) =
        tokio_tungstenite::connect_async_tls_with_config(url.as_str(), None, true, Some(connector))
            .await
            .map_err(|e| format!("WS 连接失败: {e}"))?;

    let (mut write, mut read) = ws_stream.split();
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    conns().insert(id, tx);

    // writer 任务:串行化所有出站帧(send 非 Sync,需独占 SplitSink)。
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    // reader 任务:逐帧经 Channel 推回 JS;终止时清理注册表。
    tokio::spawn(async move {
        let mut closed = false;
        while let Some(item) = read.next().await {
            match item {
                Ok(Message::Text(t)) => {
                    if on_event
                        .send(WsEvent::Text {
                            data: t.as_str().to_string(),
                        })
                        .is_err()
                    {
                        break; // 前端已断开(窗口关/置空 handler)
                    }
                }
                Ok(Message::Binary(b)) => {
                    if on_event
                        .send(WsEvent::Binary { data: b.to_vec() })
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Message::Close(frame)) => {
                    let code = frame.map(|f| u16::from(f.code)).unwrap_or(1005);
                    let _ = on_event.send(WsEvent::Close { code });
                    closed = true;
                    break;
                }
                // WS 协议级 ping/pong 由 tungstenite 自动应答;Frame 仅出现在写路径。
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(e) => {
                    let _ = on_event.send(WsEvent::Error {
                        message: e.to_string(),
                    });
                    closed = true;
                    break;
                }
            }
        }
        // 移除 sender → writer 任务的 rx 收到 None → 关闭写半。
        conns().remove(&id);
        // 流无显式 Close 帧就结束(TCP 断)→ 补 1006,保证前端 onclose 必触发。
        if !closed {
            let _ = on_event.send(WsEvent::Close { code: 1006 });
        }
    });

    Ok(id)
}

/// 发送文本帧(JSON 控制消息)。连接不存在 = no-op(对齐浏览器 send-after-close)。
#[tauri::command]
pub fn ws_send_text(conn_id: u64, data: String) {
    if let Some(tx) = conns().get(&conn_id) {
        let _ = tx.send(Message::Text(data.into()));
    }
}

/// 发送二进制帧(语音音频)。`data` 来自 JS number[]。
#[tauri::command]
pub fn ws_send_binary(conn_id: u64, data: Vec<u8>) {
    if let Some(tx) = conns().get(&conn_id) {
        let _ = tx.send(Message::Binary(data.into()));
    }
}

/// 主动关闭:发 Close 帧并从注册表移除。reader 收到对端 Close 回应后推 Close 事件。
#[tauri::command]
pub fn ws_close(conn_id: u64, code: Option<u16>, reason: Option<String>) {
    let tx = conns().remove(&conn_id);
    if let Some(tx) = tx {
        let frame = CloseFrame {
            code: CloseCode::from(code.unwrap_or(1000)),
            reason: reason.unwrap_or_default().into(),
        };
        let _ = tx.send(Message::Close(Some(frame)));
        // tx 在此 drop → writer 投完 Close 后 rx 收 None → 关闭写半。
    }
}
