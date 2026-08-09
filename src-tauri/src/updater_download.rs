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
//! # 🔴 不做任何兜底 / 降级（产品决定）
//!
//! - 服务端不支持 Range → **直接报错**，不退回单连接；
//! - 分片重试用尽 → **直接报错**，不退回插件默认下载；
//! - 验签失败 → **直接报错**。
//! 失败就明确告诉用户，不静默降级。

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
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
/// 低于该大小不值得分片（并发建连开销大于收益）。
const MIN_SHARD_TOTAL: u64 = 1024 * 1024;

/// 下载进度事件（字段名与前端 `src/update/service.ts` 的解析保持一致）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ShardedEvent {
    /// 已知总长度才发；`contentLength = None` 表示不定态（前端据此显示不定态进度条，
    /// 而不是把百分比钉死在 0%）
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
            resp.bytes()
                .await
                .map_err(|e| format!("分片读取失败: {e}"))
        }
        .await;

        match result {
            Ok(bytes) => {
                progress.fetch_add(bytes.len() as u64, Ordering::Relaxed);
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

/// 单连接顺序下载（仅用于「总长度未知」或「文件很小」这两种**分片本就不适用**的情形；
/// 这不是失败降级 —— 分片失败一律直接报错，不会走到这里）
async fn fetch_whole(
    client: &reqwest::Client,
    url: &str,
    progress: Arc<AtomicU64>,
    on_event: &Channel<ShardedEvent>,
    total: Option<u64>,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载返回 {}", resp.status()));
    }
    let mut out = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
        out.extend_from_slice(&chunk);
        let done = progress.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
        let _ = on_event.send(ShardedEvent::Progress {
            downloaded: done,
            content_length: total,
        });
    }
    Ok(out)
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

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(err)?;

    let (total, accepts_range) = probe(&client, &url).await?;
    let _ = on_event.send(ShardedEvent::Started {
        content_length: total,
    });

    let progress = Arc::new(AtomicU64::new(0));

    let bytes: Vec<u8> = match total {
        // 已知长度且够大且服务端支持 Range ⇒ 走分片并发
        Some(len) if len >= MIN_SHARD_TOTAL && accepts_range => {
            let shard = len.div_ceil(SHARD_COUNT);
            let mut tasks = Vec::new();
            for i in 0..SHARD_COUNT {
                let start = i * shard;
                if start >= len {
                    break;
                }
                let end = std::cmp::min(start + shard - 1, len - 1);
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
                // 任一分片失败 ⇒ 整体失败，不降级
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
        }
        // 服务端不支持 Range 而长度已知 ⇒ 明确报错（产品要求：不兜底）
        Some(_) if !accepts_range => {
            return Err(
                "更新源不支持 Range 分片下载（accept-ranges 非 bytes），已中止。".to_string(),
            );
        }
        // 长度未知或文件很小 ⇒ 分片本就不适用，单连接直下
        _ => fetch_whole(&client, &url, progress.clone(), &on_event, total).await?,
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

    /// 分片边界不能重叠、不能漏字节 —— 合并大小必须恰好等于总长
    #[test]
    fn shard_boundaries_cover_exactly() {
        for len in [1u64, 1023, 1024 * 1024, 13_646_531, 13_646_532] {
            let shard = len.div_ceil(SHARD_COUNT);
            let mut covered = 0u64;
            let mut prev_end: Option<u64> = None;
            for i in 0..SHARD_COUNT {
                let start = i * shard;
                if start >= len {
                    break;
                }
                let end = std::cmp::min(start + shard - 1, len - 1);
                if let Some(pe) = prev_end {
                    assert_eq!(start, pe + 1, "分片之间必须连续无缝 (len={len})");
                }
                covered += end - start + 1;
                prev_end = Some(end);
            }
            assert_eq!(covered, len, "分片必须恰好覆盖全部字节 (len={len})");
            assert_eq!(prev_end, Some(len - 1), "最后一片必须到达末字节 (len={len})");
        }
    }
}
