//! 统一下载引擎（聊天/文件/头像共用）：Range 分片 + 断点续传 + 重试 + 采样哈希校验 + 降级
//!
//! # 设计依据（线C' 单1/review 实测 + 本线 If-Range 生产探针）
//!
//! - **探测用 `Range: bytes=0-0` 的 GET**，不用 HEAD：预签名 URL 按方法做 SigV4 签名，
//!   HEAD 实测恒 403（单1 附带发现，证据 run-1787761643/02-range-probe.txt）。
//! - **validator 不用 If-Range，用 If-Match + 412 处理**（本线探针实测，
//!   证据 02-ifrange-probe.txt）：MinIO 对伪造 ETag 的 `If-Range` 仍回 206（**静默忽略**，
//!   内容变了也会把新旧字节拼成一个坏文件且零报错）；对伪造 ETag 的 `If-Match` 回 412
//!   （**遵守**）。故分片请求带 If-Match（仅 Last-Modified 时退 `If-Unmodified-Since`），
//!   412 ⇒ 远端已变 ⇒ 丢弃重下。
//! - **续传键 = 调用方身份键（file_uuid 等）+ ETag**，不按 URL 相等判：预签名 URL 3h 轮换，
//!   同一对象的 URL 每次都可能不同，但 uuid 与 ETag 稳定。`resume_meta::ResumeMeta.url`
//!   字段在本引擎里承载的是这个身份键（更新器沿用 URL，两侧互不混用——键空间不同）。
//! - **URL 过期是可识别错误形态**（`HV_URL_EXPIRED`）：401/403 时保留 sidecar 断点原样返回，
//!   调用方重取 URL 后再调本引擎即可从断点续传（validator 与 URL 无关，天然成立）。
//! - **超时拆分**：connect 15s + 读 idle 60s（每收到一个 chunk 即重置），
//!   **不设含 body 读完的总时长**（GB 级文件任何总时长门都是错的，与反代流式化同口径）。
//! - **client 必须 `.no_proxy()`**：本引擎只打源站内网 IP（钉 CA + mTLS + 显式 Host），
//!   且 reqwest 默认 builder 的系统代理检测在本机非 bundle 进程里是分钟级卡顿
//!   （SCDynamicStore → CFBundle readdir 网络盘 deps 目录，单A 采栈实证）。
//! - **完整性校验 = 采样 SHA-256 对账**（`content_hash` 算法，与上传侧同源）：
//!   file_hash 是带 size 前缀的采样哈希，整文件 sha256 永远对不上，不做。
//!   调用方无 hash 时（消息面 fileHash 下载前为 null）自算结果仅作身份/去重。
//! - **降级**：源不支持 Range（探测回 200）⇒ 单流整拉，显式吃读 idle 超时，重试 3 次，
//!   无法续传（没有 206 就没有可信的偏移语义），不写 sidecar。
//!
//! 与更新器（updater_download.rs）刻意**不共享实现**：更新器的 fail-hard、固定 8 片、
//! minisign 验签是更新面特有语义，不进本抽象层；两边只共用 `resume_meta` 的 sidecar 语义。

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;

use crate::resume_meta::{
    can_resume, discard_part, fresh_layout, if_range_value, load_meta, remote_validator, save_meta,
    snapshot_meta, ShardProgress,
};

/// 大文件分片数（≥ [`SHARD_THRESHOLD`]）。沿用更新器实测参数（5% 丢包 8 片优于 4 片）。
const SHARD_COUNT: u64 = 8;
/// 小于该值走单片（一次 Range 拿全片，仍带续传/重试/校验）。
const SHARD_THRESHOLD: u64 = 4 * 1024 * 1024;
/// 每个分片的失败重试次数（不含首次）。沿用更新器参数。
const MAX_RETRY: u32 = 3;
/// 建连超时（秒）：连源站内网 IP，15s 足够；建不起来就该早失败。
const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 15;
/// 读 idle 超时（秒）：相邻两个 chunk 的最大间隔，**不是**总时长。
/// 60s 容忍源站取数卡顿，又能让真挂死的连接被回收。
const DEFAULT_READ_IDLE_TIMEOUT_SECS: u64 = 60;
/// sidecar 清单持久化节流间隔（崩溃最多多下 1 秒的量）。
const META_FLUSH_INTERVAL: Duration = Duration::from_millis(1000);

/// 进度回调：`(已下载字节, 总字节)`。分片并发下每次写盘成功都会触发，
/// 调用方负责节流（download.rs 按 1% 节流发窗口事件）。
pub type ProgressSink = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// 一次统一下载的请求参数。
pub struct DownloadRequest {
    /// 预签名下载 URL（主机已被前端改写成源站 IP）。
    pub url: String,
    /// SigV4 按 host 签名（SignedHeaders=host）：需带**改写前的原始 host** 当 Host 头，
    /// 否则签名 host 不匹配 → 403。无改写需求时传 None（reqwest 默认 Host=URL 主机）。
    pub host: Option<String>,
    /// 续传身份键：消息面 = file_uuid，个人文件面 = file_hash，头像 = 头像文件名。
    /// sidecar 的相等判定用它（+ ETag），**不是 URL**（URL 3h 轮换）。
    pub identity: String,
    /// 半截文件的落盘路径（sidecar 清单 = 该路径 + `.json`）。
    /// 下载成功后由调用方改名到最终路径。
    pub part_path: PathBuf,
    /// 调用方已知的文件大小（仅作进度展示的起点，权威值来自探测）。
    pub expected_size: Option<u64>,
    /// 调用方已知的服务端采样哈希（个人文件面有、消息面为 null）。
    /// 有 ⇒ 下载完成后对账，不一致丢弃并报 `HV_HASH_MISMATCH`；无 ⇒ 自算仅作身份/去重。
    pub expected_sampled_hash: Option<String>,
    /// 进度回调（可选）。
    pub on_progress: Option<ProgressSink>,
    /// 建连超时（秒）。测试用小值；生产用默认 15。
    pub connect_timeout_secs: u64,
    /// 读 idle 超时（秒）。测试用小值；生产用默认 60。
    pub read_idle_timeout_secs: u64,
}

impl DownloadRequest {
    /// 生产默认值：connect 15s / 读 idle 60s / 无总时长。
    pub fn new(url: String, identity: String, part_path: PathBuf) -> Self {
        Self {
            url,
            host: None,
            identity,
            part_path,
            expected_size: None,
            expected_sampled_hash: None,
            on_progress: None,
            connect_timeout_secs: DEFAULT_CONNECT_TIMEOUT_SECS,
            read_idle_timeout_secs: DEFAULT_READ_IDLE_TIMEOUT_SECS,
        }
    }
}

/// 下载结果。
#[derive(Debug)]
pub struct DownloadOutcome {
    /// 文件总字节数（以探测/响应为准）。
    pub bytes: u64,
    /// 本机自算的内容身份哈希（采样 SHA-256，`content_hash` 算法）。
    /// 调用方给了 `expected_sampled_hash` 时，该值已与它对账一致。
    pub sampled_hash: String,
    /// 响应的 Content-Type（无则 None，调用方给缺省）。
    pub content_type: Option<String>,
    /// 本次开跑前已在盘上的字节数（断点续传起点；全新下载为 0）。
    pub resumed_from: u64,
    /// 是否走了 Range 分片路径（false = 降级单流）。
    pub sharded: bool,
}

/// 引擎错误。Display 带稳定机器可读前缀，供编排层识别（如 URL 过期后重取 URL 续传）。
#[derive(Debug)]
pub enum DownloadError {
    /// 预签名 URL 过期/失效（401/403）。sidecar 已保留，重取 URL 后再调即可续传。
    UrlExpired(String),
    /// 下载途中远端内容变更（If-Match 412）。part + sidecar 已丢弃，重调即全新下载。
    RemoteChanged(String),
    /// 采样哈希对账不一致。part + sidecar 已丢弃。
    HashMismatch { expected: String, actual: String },
    /// 其它非 2xx/206/412 的 HTTP 状态。
    Http { status: u16, detail: String },
    /// 网络/读写流错误（含重试耗尽）。
    Net(String),
    /// 本地文件 IO 错误。
    Io(String),
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DownloadError::UrlExpired(d) => write!(f, "HV_URL_EXPIRED: {d}"),
            DownloadError::RemoteChanged(d) => write!(f, "HV_REMOTE_CHANGED: {d}"),
            DownloadError::HashMismatch { expected, actual } => write!(
                f,
                "HV_HASH_MISMATCH: 采样哈希对账不一致 expected={expected} actual={actual}"
            ),
            DownloadError::Http { status, detail } => write!(f, "HV_HTTP_{status}: {detail}"),
            DownloadError::Net(d) => write!(f, "HV_NET: {d}"),
            DownloadError::Io(d) => write!(f, "HV_IO: {d}"),
        }
    }
}

impl std::error::Error for DownloadError {}

fn net_err(ctx: &str, e: impl fmt::Display) -> DownloadError {
    DownloadError::Net(format!("{ctx}: {e}"))
}

fn io_err(ctx: &str, e: impl fmt::Display) -> DownloadError {
    DownloadError::Io(format!("{ctx}: {e}"))
}

/// 把响应状态映射为引擎错误：401/403 → URL 过期形态，412 → 远端已变，其余 → Http。
fn status_err(ctx: &str, status: reqwest::StatusCode) -> DownloadError {
    let code = status.as_u16();
    match code {
        401 | 403 => DownloadError::UrlExpired(format!(
            "{ctx}: HTTP {code}（预签名 URL 已过期或失效，重取 URL 后可从断点续传）"
        )),
        412 => DownloadError::RemoteChanged(format!(
            "{ctx}: HTTP 412（If-Match 不匹配，远端内容已变更）"
        )),
        _ => DownloadError::Http {
            status: code,
            detail: ctx.to_string(),
        },
    }
}

/// 构建下载专用 reqwest client：与 secure_net 同套信任（内置 CA + mTLS + 不验主机名
/// + 强制 HTTP/1.1），但**超时语义是 connect + 读 idle，不设含 body 读完的总时限**。
/// 必须 `.no_proxy()` 的理由见模块头（系统代理检测分钟级卡顿 + 直连语义）。
fn build_download_client(
    connect_secs: u64,
    read_idle_secs: u64,
) -> Result<reqwest::Client, DownloadError> {
    let mut b = reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(Duration::from_secs(connect_secs))
        .read_timeout(Duration::from_secs(read_idle_secs))
        .pool_max_idle_per_host(5)
        .no_proxy()
        // 强制 HTTP/1.1：显式 Host=逻辑域名与 h2 的 :authority（=URL 的 IP）冲突会被判
        // malformed 返 400（见 secure_net / secure_proxy 同款注释）。
        .http1_only();
    b = b
        .tls_built_in_root_certs(false)
        .danger_accept_invalid_hostnames(true);
    for cert in reqwest::Certificate::from_pem_bundle(crate::secure_net::EMBEDDED_CA_PEM)
        .map_err(|e| DownloadError::Net(format!("内置 CA 解析失败: {e}")))?
    {
        b = b.add_root_certificate(cert);
    }
    // mTLS：与 secure_net 同一张内置客户端证书（Identity 需 key+cert 同一 PEM buf）
    let mut identity_pem = Vec::with_capacity(
        crate::secure_net::EMBEDDED_CLIENT_KEY_PEM.len()
            + crate::secure_net::EMBEDDED_CLIENT_CERT_PEM.len(),
    );
    identity_pem.extend_from_slice(crate::secure_net::EMBEDDED_CLIENT_KEY_PEM);
    identity_pem.extend_from_slice(crate::secure_net::EMBEDDED_CLIENT_CERT_PEM);
    let identity = reqwest::Identity::from_pem(&identity_pem)
        .map_err(|e| DownloadError::Net(format!("客户端证书加载失败: {e}")))?;
    b.identity(identity)
        .build()
        .map_err(|e| DownloadError::Net(format!("构建下载 client 失败: {e}")))
}

/// 探测结果。
struct ProbeResult {
    total: Option<u64>,
    accepts_range: bool,
    /// 强校验标识（`etag:"…"` / `lm:…`；None ⇒ 不可能续传）。
    validator: Option<String>,
    content_type: Option<String>,
}

/// 从 `Content-Range: bytes 0-0/<total>` 里取总长。
fn parse_content_range_total(v: &str) -> Option<u64> {
    v.rsplit('/').next()?.trim().parse::<u64>().ok()
}

/// 范围探测：`Range: bytes=0-0` 的 GET（**不用 HEAD**：预签名 SigV4 按方法签名，HEAD 恒 403）。
/// 206 ⇒ 支持 Range，总长取自 Content-Range；200 ⇒ 不支持，降级单流（总长取 Content-Length）。
async fn probe(
    client: &reqwest::Client,
    url: &str,
    host: Option<&str>,
) -> Result<ProbeResult, DownloadError> {
    let mut req = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0");
    if let Some(h) = host {
        req = req.header(reqwest::header::HOST, h);
    }
    let resp = req.send().await.map_err(|e| net_err("范围探测请求失败", e))?;
    let status = resp.status();
    if status != reqwest::StatusCode::PARTIAL_CONTENT && !status.is_success() {
        return Err(status_err("范围探测", status));
    }
    let headers = resp.headers();
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let validator = remote_validator(
        headers
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok()),
        headers
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok()),
    );
    let accepts_range = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let total = if accepts_range {
        headers
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range_total)
    } else {
        headers
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
    };
    // 响应体（1 字节或整包开头）直接丢弃：连接关掉即可，探测不关心内容。
    Ok(ProbeResult {
        total,
        accepts_range,
        validator,
        content_type,
    })
}

/// sidecar 清单路径：`<part>.json`（与 part 同目录成对存在）。
fn meta_path_for(part_path: &Path) -> PathBuf {
    let mut s = part_path.as_os_str().to_os_string();
    s.push(".json");
    PathBuf::from(s)
}

/// 切分片区间：闭区间、首尾相接、恰好覆盖 `[0, total)`。
/// < [`SHARD_THRESHOLD`] 时单片（一次 Range 拿全文件，仍有续传/重试/校验）。
fn shard_ranges_for(total: u64) -> Vec<(u64, u64)> {
    if total <= SHARD_THRESHOLD {
        return vec![(0, total - 1)];
    }
    let shard = total.div_ceil(SHARD_COUNT);
    (0..SHARD_COUNT)
        .map(|i| i * shard)
        .take_while(|start| *start < total)
        .map(|start| (start, std::cmp::min(start + shard - 1, total - 1)))
        .collect()
}

/// 给请求挂上「远端未变」条件头（本引擎的 If-Range 替代物，实测依据见模块头）：
/// 强 ETag ⇒ `If-Match`；仅 Last-Modified ⇒ `If-Unmodified-Since`；无 ⇒ 不挂。
fn with_validator_header(
    req: reqwest::RequestBuilder,
    validator: Option<&str>,
) -> reqwest::RequestBuilder {
    match validator {
        Some(v) if v.starts_with("etag:") => {
            req.header(reqwest::header::IF_MATCH, if_range_value(v))
        }
        Some(v) if v.starts_with("lm:") => {
            req.header(reqwest::header::IF_UNMODIFIED_SINCE, if_range_value(v))
        }
        _ => req,
    }
}

/// 取一段 Range 直接写进 part 文件的对应偏移，返回本次写入的字节数。
/// 写盘成功才计数（断点的唯一事实来源）；越界写字节 = 坏包，宁可判失败重来。
#[allow(clippy::too_many_arguments)]
async fn fetch_range_into(
    client: &reqwest::Client,
    url: &str,
    host: Option<&str>,
    from: u64,
    end: u64,
    validator: Option<&str>,
    file: &mut File,
    done_counter: &AtomicU64,
    progress: &AtomicU64,
    total: u64,
    on_progress: &Option<ProgressSink>,
) -> Result<u64, DownloadError> {
    use tokio::io::AsyncSeekExt;
    file.seek(std::io::SeekFrom::Start(from))
        .await
        .map_err(|e| io_err("定位 part 失败", e))?;

    let mut req = client
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes={from}-{end}"));
    if let Some(h) = host {
        req = req.header(reqwest::header::HOST, h);
    }
    req = with_validator_header(req, validator);

    let resp = req.send().await.map_err(|e| net_err("分片请求失败", e))?;
    let status = resp.status();
    // 必须是 206：200 = 服务端忽略 Range（会把整个文件塞回来）；412 = 远端已变；
    // 401/403 = URL 过期。
    if status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(status_err("分片请求", status));
    }

    let mut stream = resp.bytes_stream();
    let allowed = end - from + 1;
    let mut written = 0u64;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| net_err("分片读取失败", e))?;
        let n = chunk.len() as u64;
        // 服务端多给字节会写进下一片的区间、覆盖它已下好的内容 ⇒ 坏包。
        if written + n > allowed {
            return Err(DownloadError::Net(format!(
                "服务端返回超出请求区间的字节（请求 {allowed}，已收 {}）",
                written + n
            )));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| io_err("分片写入失败", e))?;
        written += n;
        done_counter.fetch_add(n, Ordering::Relaxed);
        let done = progress.fetch_add(n, Ordering::Relaxed) + n;
        if let Some(sink) = on_progress {
            sink(done, total);
        }
    }
    file.flush().await.map_err(|e| io_err("分片刷新失败", e))?;
    Ok(written)
}

/// 下载单个分片（带重试 + 片内续传：每次只请求这片还差的那段）。
#[allow(clippy::too_many_arguments)]
async fn fetch_shard(
    client: reqwest::Client,
    url: String,
    host: Option<String>,
    part_path: PathBuf,
    shard: ShardProgress,
    validator: Option<String>,
    done_counter: Arc<AtomicU64>,
    progress: Arc<AtomicU64>,
    total: u64,
    on_progress: Option<ProgressSink>,
) -> Result<(), DownloadError> {
    let ShardProgress { start, end, .. } = shard;
    let want = end - start + 1;
    let mut attempt = 0u32;

    let mut file = OpenOptions::new()
        .write(true)
        .open(&part_path)
        .await
        .map_err(|e| io_err("分片打开 part 失败", e))?;

    loop {
        let done = done_counter.load(Ordering::Relaxed);
        if done >= want {
            break;
        }
        let res = fetch_range_into(
            &client,
            &url,
            host.as_deref(),
            start + done,
            end,
            validator.as_deref(),
            &mut file,
            &done_counter,
            &progress,
            total,
            &on_progress,
        )
        .await;

        match res {
            // 短读：继续循环补齐，不计入重试
            Ok(n) if n > 0 => {}
            // 一个字节都没给却报成功 ⇒ 再循环就是死循环，按失败计
            Ok(_) => {
                attempt += 1;
                if attempt > MAX_RETRY {
                    return Err(DownloadError::Net(format!(
                        "分片 [{start}-{end}] 重试 {MAX_RETRY} 次仍失败: 服务端返回 206 但无数据"
                    )));
                }
                tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
            }
            Err(e) => {
                // URL 过期 / 远端已变：重试无意义（重试同一个过期 URL 只会再 403），直接上浮
                if matches!(
                    e,
                    DownloadError::UrlExpired(_) | DownloadError::RemoteChanged(_)
                ) {
                    return Err(e);
                }
                attempt += 1;
                if attempt > MAX_RETRY {
                    return Err(DownloadError::Net(format!(
                        "分片 [{start}-{end}] 重试 {MAX_RETRY} 次仍失败: {e}"
                    )));
                }
                tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
            }
        }
    }

    let done = done_counter.load(Ordering::Relaxed);
    if done != want {
        return Err(DownloadError::Net(format!(
            "分片 [{start}-{end}] 字节数不符：期望 {want}，实到 {done}"
        )));
    }
    Ok(())
}

/// 下载入口：探测 →（支持 Range）分片续传 /（不支持）降级单流 → 采样哈希对账。
pub async fn download(req: DownloadRequest) -> Result<DownloadOutcome, DownloadError> {
    let client = build_download_client(req.connect_timeout_secs, req.read_idle_timeout_secs)?;
    let probe_result = probe(&client, &req.url, req.host.as_deref()).await?;
    match (probe_result.accepts_range, probe_result.total) {
        (true, Some(total)) if total > 0 => download_sharded(&client, req, probe_result, total).await,
        // 源不支持 Range 或长度未知 ⇒ 降级单流（洞3：显式读 idle 超时、无总时长）
        _ => download_single_stream(&client, req, probe_result).await,
    }
}

/// 分片路径：sidecar 续传（键 = identity + ETag，与 URL 无关）+ 8 片并发 + 每片 3 次重试。
async fn download_sharded(
    client: &reqwest::Client,
    req: DownloadRequest,
    probe_result: ProbeResult,
    total: u64,
) -> Result<DownloadOutcome, DownloadError> {
    let meta_path = meta_path_for(&req.part_path);
    let validator = probe_result.validator;

    // ── 决定「接着下」还是「重下」──
    // 清单存在且自洽、续传键（identity + validator）与当前远端一致、part 长度 == total
    // （part 是预分配出来的；长度对不上说明不是本轮产物）。
    let layout: Vec<ShardProgress> = match load_meta(&meta_path) {
        Some(meta)
            if can_resume(&meta, &req.identity, total, validator.as_deref())
                && std::fs::metadata(&req.part_path)
                    .map(|m| m.len() == total)
                    .unwrap_or(false) =>
        {
            let already: u64 = meta.shards.iter().map(|s| s.done).sum();
            println!("[UnifiedDownload] 断点续传：{already}/{total} 字节已在盘上，只补剩下的");
            meta.shards
        }
        other => {
            if other.is_some() {
                println!("[UnifiedDownload] 断点清单与当前远端对不上（或 part 已损坏），丢弃重下");
            }
            discard_part(&req.part_path, &meta_path);
            fresh_layout(shard_ranges_for(total))
        }
    };

    // 预分配：各片按偏移写入，文件必须先有足够长度（续传时这一步幂等）
    {
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&req.part_path)
            .await
            .map_err(|e| io_err("创建 part 失败", e))?;
        f.set_len(total)
            .await
            .map_err(|e| io_err("预分配 part 失败", e))?;
    }

    let resumed: u64 = layout.iter().map(|s| s.done).sum();
    let progress = Arc::new(AtomicU64::new(resumed));
    let counters: Vec<Arc<AtomicU64>> = layout
        .iter()
        .map(|s| Arc::new(AtomicU64::new(s.done)))
        .collect();

    // 起点先报一次：进度条一上来就停在断点处（不是先 0 再跳）
    if let Some(sink) = &req.on_progress {
        sink(resumed, total);
    }

    // 清单先落一份：没有 validator 就不可能续（can_resume 会拒），此时不写清单，
    // 免得留一个注定被丢弃的脏文件。
    if let Some(v) = &validator {
        save_meta(&meta_path, &snapshot_meta(&req.identity, total, v, &layout, &counters));
    }

    let mut tasks = Vec::new();
    for (shard, counter) in layout.iter().cloned().zip(counters.iter().cloned()) {
        tasks.push(tokio::spawn(fetch_shard(
            client.clone(),
            req.url.clone(),
            req.host.clone(),
            req.part_path.clone(),
            shard,
            validator.clone(),
            counter,
            progress.clone(),
            total,
            req.on_progress.clone(),
        )));
    }

    // 清单持久化：节流 1s，跑在独立任务里，长时间下载中途被杀也留得下断点。
    let persister = validator.clone().map(|v| {
        let meta_path = meta_path.clone();
        let identity = req.identity.clone();
        let layout = layout.clone();
        let counters = counters.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(META_FLUSH_INTERVAL).await;
                save_meta(&meta_path, &snapshot_meta(&identity, total, &v, &layout, &counters));
            }
        })
    });

    // 等所有分片都结束再收口（不早退）：早退会把还在跑的分片刚写下的字节扔掉，
    // 而那些字节本可以计进断点。
    let mut first_err: Option<DownloadError> = None;
    for t in tasks {
        let outcome = match t.await {
            Ok(inner) => inner,
            Err(e) => Err(DownloadError::Net(format!("分片任务 panic: {e}"))),
        };
        if let Err(e) = outcome {
            first_err.get_or_insert(e);
        }
    }
    if let Some(p) = persister {
        p.abort();
    }

    // 无论成败都落一次最终清单：失败时这正是「下次接着下」的唯一依据。
    if let Some(v) = &validator {
        save_meta(&meta_path, &snapshot_meta(&req.identity, total, v, &layout, &counters));
    }

    if let Some(e) = first_err {
        // 远端已变 ⇒ 这堆字节新旧混杂、不可信，连 part 带清单一起丢（否则下次续传
        // 永远从这堆坏字节接着下）。URL 过期 ⇒ 保留断点，重取 URL 后续传。
        if matches!(e, DownloadError::RemoteChanged(_)) {
            discard_part(&req.part_path, &meta_path);
        }
        return Err(e);
    }

    finalize_download(&req, &meta_path, total, probe_result.content_type, resumed, true)
}

/// 降级路径（洞3）：源不支持 Range ⇒ 单流整拉 + 读 idle 超时 + 整体重试，不写 sidecar。
async fn download_single_stream(
    client: &reqwest::Client,
    req: DownloadRequest,
    probe_result: ProbeResult,
) -> Result<DownloadOutcome, DownloadError> {
    let meta_path = meta_path_for(&req.part_path);
    let mut attempt = 0u32;

    let downloaded = loop {
        match stream_once(client, &req).await {
            Ok(n) => break n,
            Err(e) => {
                // URL 过期重试无意义，直接上浮
                if matches!(e, DownloadError::UrlExpired(_)) {
                    return Err(e);
                }
                attempt += 1;
                if attempt > MAX_RETRY {
                    return Err(DownloadError::Net(format!(
                        "降级单流重试 {MAX_RETRY} 次仍失败: {e}"
                    )));
                }
                tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt))).await;
            }
        }
    };

    let total = probe_result.total.unwrap_or(downloaded);
    if probe_result.total.is_some_and(|t| t != downloaded) {
        return Err(DownloadError::Net(format!(
            "降级单流字节数不符：期望 {total}，实到 {downloaded}"
        )));
    }
    // 降级路径没有可信的偏移语义 ⇒ 不留 sidecar（part 要么完整要么重来）
    let _ = std::fs::remove_file(&meta_path);
    finalize_download(&req, &meta_path, downloaded, probe_result.content_type, 0, false)
}

/// 降级路径的单次整拉（每次重试都从头开始：不支持 Range 就没有续传可言）。
async fn stream_once(client: &reqwest::Client, req: &DownloadRequest) -> Result<u64, DownloadError> {
    let mut request = client.get(&req.url);
    if let Some(h) = req.host.as_deref() {
        request = request.header(reqwest::header::HOST, h);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| net_err("降级单流请求失败", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(status_err("降级单流", status));
    }

    // 每次尝试都重建 part（truncate）：不支持 Range 时半截字节没有可信偏移，不能接着写。
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&req.part_path)
        .await
        .map_err(|e| io_err("创建 part 失败", e))?;
    let mut writer = tokio::io::BufWriter::with_capacity(8 * 1024 * 1024, file);

    let total = req.expected_size.unwrap_or(0);
    let mut downloaded = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| net_err("降级单流读取失败", e))?;
        writer
            .write_all(&chunk)
            .await
            .map_err(|e| io_err("写入 part 失败", e))?;
        downloaded += chunk.len() as u64;
        if let Some(sink) = &req.on_progress {
            sink(downloaded, total);
        }
    }
    writer.flush().await.map_err(|e| io_err("刷新 part 失败", e))?;
    drop(writer);
    Ok(downloaded)
}

/// 成功收口：尺寸断言 → 采样哈希对账/自算 → 清 sidecar。
fn finalize_download(
    req: &DownloadRequest,
    meta_path: &Path,
    total: u64,
    content_type: Option<String>,
    resumed_from: u64,
    sharded: bool,
) -> Result<DownloadOutcome, DownloadError> {
    let actual_len = std::fs::metadata(&req.part_path)
        .map_err(|e| io_err("读取 part 元信息失败", e))?
        .len();
    if actual_len != total {
        return Err(DownloadError::Io(format!(
            "part 大小不符：期望 {total}，实到 {actual_len}"
        )));
    }

    // 采样 SHA-256（content_hash 算法，与上传侧同源）。这是接收方唯一能拿到内容身份的时机；
    // 调用方给了期望值就对账，不一致 = 这堆字节不可信，连 part 带清单丢弃。
    let actual_hash = crate::content_hash::sampled_sha256_of_file(&req.part_path)
        .map_err(|e| io_err("计算采样哈希失败", e))?;
    if let Some(expected) = &req.expected_sampled_hash {
        if expected != &actual_hash {
            discard_part(&req.part_path, meta_path);
            return Err(DownloadError::HashMismatch {
                expected: expected.clone(),
                actual: actual_hash,
            });
        }
    }

    // 下载完整 ⇒ 清单删掉（清单在 = part 是半截的，见 resume_meta 模块头）
    let _ = std::fs::remove_file(meta_path);

    Ok(DownloadOutcome {
        bytes: total,
        sampled_hash: actual_hash,
        content_type,
        resumed_from,
        sharded,
    })
}

#[cfg(test)]
mod tests {
    //! 本地 mock 源测试：真 TCP HTTP/1.1 服务器，覆盖 206 分片 / 中断续传 /
    //! validator 失配重下 / If-Match 412 / 不支持 Range 降级 / 重试 / 采样哈希对账 /
    //! URL 过期形态 / GB 级中断续传（替代口径：生产侧无 GB 对象，见交付说明）。
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    // ---------------- mock 源 ----------------

    /// 确定性内容生成器：byte(i) 只由 (seed, i) 决定，服务端与校验方各自独立生成同一内容。
    fn gen_byte(seed: u64, i: u64) -> u8 {
        ((i ^ seed).wrapping_mul(2654435761).wrapping_add(12345) >> 13) as u8
    }

    fn gen_chunk(seed: u64, start: u64, len: usize) -> Vec<u8> {
        let mut v = Vec::with_capacity(len);
        for k in 0..len as u64 {
            v.push(gen_byte(seed, start + k));
        }
        v
    }

    /// 参考采样哈希：按 content_hash 模块头算法（prefix + 头/中/尾各 10MiB）对生成器直接算，
    /// 不读任何文件 —— 与「读下载产物算出来的值」互为独立两侧。
    fn reference_sampled_hash(seed: u64, size: u64) -> String {
        use sha2::{Digest, Sha256};
        const SAMPLE: u64 = 10 * 1024 * 1024;
        let mut h = Sha256::new();
        h.update(format!("|size:{size}|").as_bytes());
        let mut feed = |start: u64, len: u64| {
            let mut off = start;
            let end = start + len;
            while off < end {
                let n = std::cmp::min(end - off, 1024 * 1024) as usize;
                h.update(&gen_chunk(seed, off, n));
                off += n as u64;
            }
        };
        if size <= SAMPLE * 3 {
            feed(0, size);
        } else {
            feed(0, SAMPLE);
            feed((size - SAMPLE) / 2, SAMPLE);
            feed(size - SAMPLE, SAMPLE);
        }
        hex::encode(h.finalize())
    }

    #[derive(Default)]
    struct MockBehavior {
        /// 全局字节预算：耗尽后请求直接断连（模拟人为中断/网络切断）。
        byte_budget: Option<i64>,
        /// 前 N 个请求直接断连（模拟瞬时故障，测重试）。
        drop_first_n: usize,
        /// 对带 If-Match 的请求一律 412（模拟探测与取数之间内容变更）。
        if_match_412: bool,
        /// 是否支持 Range（false ⇒ 无视 Range 回 200 整包）。
        support_range: bool,
    }

    struct MockServer {
        addr: std::net::SocketAddr,
        state: Arc<MockState>,
    }

    struct MockState {
        /// 内容种子（Mutex 包住：validator_mismatch 用例要中途换内容）。
        seed: Mutex<u64>,
        len: u64,
        etag: Mutex<String>,
        behavior: Mutex<MockBehavior>,
        /// 每个请求的 (range_start, range_end, 实际发出字节数)；按 256KiB chunk 记账。
        served: Mutex<VecDeque<(u64, u64, u64)>>,
        /// 每个**被实际处理**的请求的 Range 区间（None = 无 Range 整包 GET）。
        /// 请求级事实，与 body 发出去多少无关（客户端可能半路断连）。
        requests: Mutex<Vec<Option<(u64, u64)>>>,
    }

    impl MockServer {
        async fn start(seed: u64, len: u64, support_range: bool) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
            let addr = listener.local_addr().expect("local addr");
            let state = Arc::new(MockState {
                seed: Mutex::new(seed),
                len,
                etag: Mutex::new(format!("\"{seed:016x}-1\"")),
                behavior: Mutex::new(MockBehavior {
                    support_range,
                    ..Default::default()
                }),
                served: Mutex::new(VecDeque::new()),
                requests: Mutex::new(Vec::new()),
            });
            let st = state.clone();
            tokio::spawn(async move {
                loop {
                    let (sock, _) = match listener.accept().await {
                        Ok(x) => x,
                        Err(_) => return,
                    };
                    let st2 = st.clone();
                    tokio::spawn(async move {
                        let _ = handle_conn(sock, st2).await;
                    });
                }
            });
            MockServer { addr, state }
        }

        fn url(&self) -> String {
            format!("http://127.0.0.1:{}/obj", self.addr.port())
        }

        fn served_bytes(&self) -> u64 {
            self.state.served.lock().unwrap().iter().map(|r| r.2).sum()
        }

        fn request_log(&self) -> Vec<Option<(u64, u64)>> {
            self.state.requests.lock().unwrap().clone()
        }
    }

    async fn handle_conn(
        mut sock: tokio::net::TcpStream,
        st: Arc<MockState>,
    ) -> Result<(), String> {
        // 读请求头（GET 无 body）
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = sock
                .read(&mut tmp)
                .await
                .map_err(|e| format!("mock read: {e}"))?;
            if n == 0 {
                return Ok(());
            }
            buf.extend_from_slice(&tmp[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
            if buf.len() > 64 * 1024 {
                return Err("mock: header too large".into());
            }
        }
        let text = String::from_utf8_lossy(&buf).to_string();
        let header = |name: &str| -> Option<String> {
            text.lines().find_map(|l| {
                l.split_once(':').and_then(|(k, v)| {
                    if k.trim().eq_ignore_ascii_case(name) {
                        Some(v.trim().to_string())
                    } else {
                        None
                    }
                })
            })
        };

        let etag = st.etag.lock().unwrap().clone();
        let range = header("range").and_then(|v| {
            // 只解析 "bytes=a-b"（b 可省）
            let spec = v.strip_prefix("bytes=")?;
            let (a, b) = spec.split_once('-')?;
            let start: u64 = a.trim().parse().ok()?;
            let end: u64 = if b.trim().is_empty() {
                st.len - 1
            } else {
                b.trim().parse().ok()?
            };
            Some((start, end.min(st.len - 1)))
        });
        let support_range = st.behavior.lock().unwrap().support_range;

        // 请求级记账（区间语义，与 body 实际发出多少无关）
        st.requests.lock().unwrap().push(range);

        // 行为开关：断连（前 N 个数据请求 / 预算耗尽）。
        // 探测（bytes=0-0）不掐：探测被掐就连「引擎先探测」都不成立，测的就不是分片重试了。
        {
            let mut beh = st.behavior.lock().unwrap();
            let is_probe = range == Some((0, 0));
            if beh.drop_first_n > 0 && !is_probe {
                beh.drop_first_n -= 1;
                return Ok(()); // 直接断连
            }
            if matches!(beh.byte_budget, Some(b) if b <= 0) {
                return Ok(()); // 预算耗尽：断连
            }
        }

        // If-Match 412 形态（探测不带 If-Match，故能先拿到 validator）
        if header("if-match").is_some() && st.behavior.lock().unwrap().if_match_412 {
            let body = b"<Error>PreconditionFailed</Error>";
            let resp = format!(
                "HTTP/1.1 412 Precondition Failed\r\nContent-Length: {}\r\nContent-Type: application/xml\r\nConnection: close\r\n\r\n",
                body.len()
            );
            sock.write_all(resp.as_bytes()).await.ok();
            sock.write_all(body).await.ok();
            return Ok(());
        }

        match (support_range, range) {
            (true, Some((start, end))) if start <= end => {
                let want = end - start + 1;
                let head = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{}\r\nAccept-Ranges: bytes\r\nContent-Length: {want}\r\nContent-Type: application/octet-stream\r\nETag: {etag}\r\nLast-Modified: Fri, 14 Aug 2026 09:11:35 GMT\r\nConnection: close\r\n\r\n",
                    st.len
                );
                sock.write_all(head.as_bytes()).await.ok();
                send_body(&mut sock, &st, start, want).await?;
            }
            _ => {
                // 200 整包（不支持 Range，或没带 Range）
                let head = format!(
                    "HTTP/1.1 200 OK\r\nAccept-Ranges: {}\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nETag: {etag}\r\nLast-Modified: Fri, 14 Aug 2026 09:11:35 GMT\r\nConnection: close\r\n\r\n",
                    if support_range { "bytes" } else { "none" },
                    st.len
                );
                sock.write_all(head.as_bytes()).await.ok();
                send_body(&mut sock, &st, 0, st.len).await?;
            }
        }
        Ok(())
    }

    /// 发 body：按 256KiB chunk 从生成器产出；受全局字节预算约束（耗尽即断连 = 中断）。
    async fn send_body(
        sock: &mut tokio::net::TcpStream,
        st: &Arc<MockState>,
        start: u64,
        want: u64,
    ) -> Result<(), String> {
        const CHUNK: u64 = 256 * 1024;
        let mut sent = 0u64;
        let mut off = start;
        while sent < want {
            let budget_left = st.behavior.lock().unwrap().byte_budget;
            let allowance = match budget_left {
                Some(b) if b <= 0 => return Ok(()), // 预算耗尽：中途断连
                Some(b) => (b as u64).min(CHUNK).min(want - sent),
                None => CHUNK.min(want - sent),
            };
            let buf = gen_chunk(*st.seed.lock().unwrap(), off, allowance as usize);
            sock.write_all(&buf).await.map_err(|e| format!("mock write: {e}"))?;
            // 每 chunk 立即记账：中断的请求也要计入已发字节（续传断言依赖此值）
            st.served
                .lock()
                .unwrap()
                .push_back((off, off + allowance - 1, allowance));
            sent += allowance;
            off += allowance;
            if let Some(ref mut b) = st.behavior.lock().unwrap().byte_budget {
                *b -= allowance as i64;
            }
        }
        Ok(())
    }

    // ---------------- 测试工具 ----------------

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hv-unified-dl-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn request_for(url: String, part_path: PathBuf, identity: &str) -> DownloadRequest {
        // 测试用小 idle 超时（2s），否则挂死类用例要等 60s
        let mut r = DownloadRequest::new(url, identity.to_string(), part_path);
        r.connect_timeout_secs = 5;
        r.read_idle_timeout_secs = 2;
        r
    }

    fn file_bytes_match_seed(path: &Path, seed: u64, len: u64) -> bool {
        // 分窗口比对（整读大文件进内存没必要）：头/中/尾各取一段核对
        use std::io::{Read, Seek, SeekFrom};
        let mut f = std::fs::File::open(path).expect("打开产物");
        let actual_len = f.metadata().expect("元信息").len();
        if actual_len != len {
            return false;
        }
        let windows: Vec<u64> = {
            let mut w = vec![0u64];
            if len > 4096 {
                w.push(len / 2);
                w.push(len - 2048);
            }
            w
        };
        let mut buf = [0u8; 2048];
        for start in windows {
            let n = std::cmp::min(2048, len - start) as usize;
            f.seek(SeekFrom::Start(start)).expect("seek");
            f.read_exact(&mut buf[..n]).expect("read");
            for (k, b) in buf[..n].iter().enumerate() {
                if *b != gen_byte(seed, start + k as u64) {
                    return false;
                }
            }
        }
        true
    }

    // ---------------- 用例 ----------------

    /// 分片路径：>4MB 内容走 8 片并发，产物逐字节正确，采样哈希对账一致，清单已清。
    #[tokio::test]
    async fn sharded_download_reassembles_and_verifies_hash() {
        let seed = 42u64;
        let len = 10 * 1024 * 1024 + 12345u64; // >4MB ⇒ 8 片
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("sharded");
        let part = dir.join("f.hvpart");

        let mut req = request_for(srv.url(), part.clone(), "uuid-sharded");
        req.expected_sampled_hash = Some(reference_sampled_hash(seed, len));
        let out = download(req).await.expect("分片下载必须成功");

        assert_eq!(out.bytes, len);
        assert!(out.sharded, "必须走分片路径");
        assert_eq!(out.resumed_from, 0);
        assert_eq!(out.sampled_hash, reference_sampled_hash(seed, len));
        assert!(file_bytes_match_seed(&part, seed, len), "产物逐字节核对失败");
        // 8 片 ⇒ 恰好 9 个请求（1 探测 + 8 分片，无重试），分片区间首尾相接覆盖全长
        let reqs = srv.request_log();
        assert_eq!(reqs.len(), 9, "请求数应为 1 探测 + 8 分片: {reqs:?}");
        assert_eq!(reqs[0], Some((0, 0)), "首请求必须是探测");
        let mut shards: Vec<(u64, u64)> = reqs.into_iter().flatten().filter(|r| *r != (0, 0)).collect();
        shards.sort();
        let mut expect = 0u64;
        for (s, e) in &shards {
            assert_eq!(*s, expect, "分片区间有空洞/重叠: {shards:?}");
            expect = e + 1;
        }
        assert_eq!(expect, len, "分片没覆盖到末字节");
        // 成功后清单必须不在了（清单在 = 半截语义）
        assert!(!meta_path_for(&part).exists(), "成功后 sidecar 必须清除");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 单片路径：<4MB 内容只发一次覆盖全长的 Range 请求。
    #[tokio::test]
    async fn small_file_uses_single_shard() {
        let seed = 7u64;
        let len = 100 * 1024u64; // <4MB ⇒ 单片
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("small");
        let part = dir.join("s.hvpart");

        let out = download(request_for(srv.url(), part.clone(), "uuid-small"))
            .await
            .expect("单片下载必须成功");
        assert_eq!(out.bytes, len);
        assert!(out.sharded);
        let reqs = srv.request_log();
        // 探测 (0,0) + 恰好一个整片请求 (0, len-1)
        assert_eq!(
            reqs,
            vec![Some((0, 0)), Some((0, len - 1))],
            "小文件必须 探测+单片: {reqs:?}"
        );
        assert!(file_bytes_match_seed(&part, seed, len));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 中断续传：第一轮用字节预算掐断 ⇒ 引擎报错、断点落盘；
    /// 第二轮（同一 identity、同一内容）必须只补缺的字节，最终哈希对账一致。
    #[tokio::test]
    async fn resume_after_interrupt_only_fetches_missing_bytes() {
        let seed = 99u64;
        let len = 12 * 1024 * 1024 + 777u64; // >4MB ⇒ 8 片
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("resume");
        let part = dir.join("r.hvpart");
        let identity = "uuid-resume";

        // 第一轮：预算 = 约 1/3 总量 ⇒ 中途断连
        srv.state.behavior.lock().unwrap().byte_budget = Some((len / 3) as i64);
        let first = download(request_for(srv.url(), part.clone(), identity)).await;
        assert!(first.is_err(), "预算掐断必须让第一轮失败");
        let served_first = srv.served_bytes();
        assert!(served_first > 0 && served_first < len, "第一轮应只下到一部分");
        assert!(meta_path_for(&part).exists(), "失败后 sidecar 必须在（续传依据）");

        // 第二轮：放开预算 ⇒ 续传成功
        srv.state.behavior.lock().unwrap().byte_budget = None;
        let mut req2 = request_for(srv.url(), part.clone(), identity);
        req2.expected_sampled_hash = Some(reference_sampled_hash(seed, len));
        let out = download(req2).await.expect("续传必须成功");

        assert!(out.resumed_from > 0, "必须从断点续传（非重下）");
        assert_eq!(out.bytes, len);
        assert_eq!(out.sampled_hash, reference_sampled_hash(seed, len));
        assert!(file_bytes_match_seed(&part, seed, len), "续传产物逐字节核对失败");
        // 第二轮只补了缺口：两轮发出的总字节 == 文件总长（允许片内短读重取的最小冗余 ⇒ 用 ≥ 与上界）
        let served_second = srv.served_bytes() - served_first;
        assert!(
            served_second >= len - served_first && served_second < len,
            "续传应只补缺字节: first={served_first} second={served_second} len={len}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// validator 失配（ETag 变了 = 远端换了内容）⇒ 丢弃断点、整份重下。
    #[tokio::test]
    async fn validator_mismatch_discards_and_redownloads() {
        let seed_v1 = 11u64;
        let len = 6 * 1024 * 1024u64;
        let srv = MockServer::start(seed_v1, len, true).await;
        let dir = temp_dir("mismatch");
        let part = dir.join("m.hvpart");
        let identity = "uuid-mismatch";

        // 第一轮下到一半被掐断（v1 内容）
        srv.state.behavior.lock().unwrap().byte_budget = Some((len / 2) as i64);
        let first = download(request_for(srv.url(), part.clone(), identity)).await;
        assert!(first.is_err());
        let served_first = srv.served_bytes();

        // 远端换内容：seed 变 ⇒ 内容变 + ETag 变
        let seed_v2 = 22u64;
        *srv.state.seed.lock().unwrap() = seed_v2;
        *srv.state.etag.lock().unwrap() = format!("\"{seed_v2:016x}-1\"");
        srv.state.behavior.lock().unwrap().byte_budget = None;

        let out = download(request_for(srv.url(), part.clone(), identity))
            .await
            .expect("失配后整份重下必须成功");
        assert_eq!(out.resumed_from, 0, "validator 失配必须整份重下，不是续传");
        assert_eq!(out.sampled_hash, reference_sampled_hash(seed_v2, len));
        assert!(file_bytes_match_seed(&part, seed_v2, len), "重下产物必须是新内容");
        // 第二轮重新拉了整份（不是只补缺口）：1 字节探测 + 整份 len
        let served_second = srv.served_bytes() - served_first;
        assert_eq!(served_second, len + 1, "失配后必须整份重拉: {served_second}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// If-Match 被遵守的实测语义：探测与取数之间内容变更 ⇒ 分片请求吃 412 ⇒
    /// 引擎报 HV_REMOTE_CHANGED 并丢弃 part+sidecar（不拼坏文件）。
    #[tokio::test]
    async fn if_match_412_surfaces_remote_changed_and_discards() {
        let seed = 5u64;
        let len = 6 * 1024 * 1024u64;
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("412");
        let part = dir.join("c.hvpart");

        srv.state.behavior.lock().unwrap().if_match_412 = true;
        let err = download(request_for(srv.url(), part.clone(), "uuid-412"))
            .await
            .expect_err("412 必须让下载失败");
        assert!(
            matches!(err, DownloadError::RemoteChanged(_)),
            "必须是 RemoteChanged，实得: {err:?}"
        );
        assert!(err.to_string().starts_with("HV_REMOTE_CHANGED"), "错误形态前缀: {err}");
        assert!(!part.exists(), "412 后 part 必须被丢弃（新旧字节不能拼）");
        assert!(!meta_path_for(&part).exists(), "412 后 sidecar 必须被丢弃");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 降级路径：源不支持 Range（探测回 200）⇒ 单流整拉成功、内容正确、不写 sidecar。
    #[tokio::test]
    async fn no_range_source_degrades_to_single_stream() {
        let seed = 33u64;
        let len = 2 * 1024 * 1024u64;
        let srv = MockServer::start(seed, len, false).await; // 不支持 Range
        let dir = temp_dir("degrade");
        let part = dir.join("d.hvpart");

        let out = download(request_for(srv.url(), part.clone(), "uuid-degrade"))
            .await
            .expect("降级单流必须成功");
        assert!(!out.sharded, "必须走了降级单流");
        assert_eq!(out.bytes, len);
        assert_eq!(out.sampled_hash, reference_sampled_hash(seed, len));
        assert!(file_bytes_match_seed(&part, seed, len));
        assert!(!meta_path_for(&part).exists(), "降级路径不写 sidecar");
        // 降级路径只发 200 整包：请求级记账里，探测之后不许再出现任何 Range 请求
        let reqs = srv.request_log();
        assert_eq!(reqs.first(), Some(&Some((0, 0))), "首请求必须是探测: {reqs:?}");
        assert!(reqs.len() >= 2, "探测之外必须有整拉请求: {reqs:?}");
        assert!(
            reqs[1..].iter().all(|r| r.is_none()),
            "降级路径不该出现 Range 分段: {reqs:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 重试：前 3 个数据请求断连（瞬时故障，探测不掐）⇒ 引擎每片重试后仍成功。
    #[tokio::test]
    async fn transient_failures_are_retried() {
        let seed = 55u64;
        let len = 6 * 1024 * 1024u64;
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("retry");
        let part = dir.join("t.hvpart");

        srv.state.behavior.lock().unwrap().drop_first_n = 3;
        let out = download(request_for(srv.url(), part.clone(), "uuid-retry"))
            .await
            .expect("瞬时故障经重试必须成功");
        assert_eq!(out.bytes, len);
        assert!(file_bytes_match_seed(&part, seed, len));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// URL 过期形态：403 ⇒ HV_URL_EXPIRED，且 sidecar 语义不介入（没下过东西）。
    #[tokio::test]
    async fn expired_url_is_recognizable() {
        let srv = MockServer::start(1, 1024, true).await;
        let dir = temp_dir("expired");
        let part = dir.join("e.hvpart");

        // 让 mock 对所有请求断连以外的另一种失败：这里直接打一个恒 403 的迷你服务器
        // （mock 不支持 403 注入，用 TcpListener 现起一个）
        drop(srv);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind 403 mock");
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = match listener.accept().await {
                    Ok(x) => x,
                    Err(_) => return,
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf).await;
                    let body = b"<Error>AccessDenied</Error>";
                    let resp = format!(
                        "HTTP/1.1 403 Forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = s.write_all(resp.as_bytes()).await;
                    let _ = s.write_all(body).await;
                });
            }
        });

        let err = download(request_for(
            format!("http://127.0.0.1:{}/obj", addr.port()),
            part.clone(),
            "uuid-expired",
        ))
        .await
        .expect_err("403 必须失败");
        assert!(matches!(err, DownloadError::UrlExpired(_)), "实得: {err:?}");
        assert!(err.to_string().starts_with("HV_URL_EXPIRED"), "前缀: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 采样哈希对账：调用方给的期望值不对 ⇒ HV_HASH_MISMATCH 且 part+sidecar 丢弃。
    #[tokio::test]
    async fn hash_mismatch_discards_part() {
        let seed = 77u64;
        let len = 1024 * 1024u64;
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("hash");
        let part = dir.join("h.hvpart");

        let mut req = request_for(srv.url(), part.clone(), "uuid-hash");
        req.expected_sampled_hash = Some("0".repeat(64)); // 必错
        let err = download(req).await.expect_err("哈希对不上必须失败");
        assert!(
            matches!(err, DownloadError::HashMismatch { .. }),
            "实得: {err:?}"
        );
        assert!(err.to_string().starts_with("HV_HASH_MISMATCH"), "前缀: {err}");
        assert!(!part.exists(), "对账失败 part 必须丢弃");
        assert!(!meta_path_for(&part).exists(), "对账失败 sidecar 必须丢弃");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// GB 级中断续传（替代口径：生产侧无 ≥1GB 对象，本用例用本地 mock 源 1.2GiB 流
    /// 模拟「人为中断 → 续传成功且校验一致」；测试层级 = Rust 集成测试（mock 源），非生产实测）。
    #[tokio::test]
    async fn gb_scale_interrupt_resume_via_mock() {
        let seed = 2026u64;
        let len = 1_288_490_188u64; // 1.2 GiB
        let srv = MockServer::start(seed, len, true).await;
        let dir = temp_dir("gb");
        let part = dir.join("g.hvpart");
        let identity = "uuid-gb";

        // 第一轮：下到 ~300MB 掐断
        srv.state.behavior.lock().unwrap().byte_budget = Some(300 * 1024 * 1024);
        let first = download(request_for(srv.url(), part.clone(), identity)).await;
        assert!(first.is_err(), "掐断必须失败");
        let served_first = srv.served_bytes();
        assert!(served_first > 200 * 1024 * 1024 && served_first < len);
        // 断点必须落盘且 part 预分配到全长
        assert!(meta_path_for(&part).exists());
        assert_eq!(std::fs::metadata(&part).unwrap().len(), len);

        // 第二轮：续传到完
        srv.state.behavior.lock().unwrap().byte_budget = None;
        let mut req2 = request_for(srv.url(), part.clone(), identity);
        req2.expected_sampled_hash = Some(reference_sampled_hash(seed, len));
        let out = download(req2).await.expect("GB 级续传必须成功");

        assert!(out.resumed_from >= served_first - 8 * 1024 * 1024, "断点应接近第一轮所下");
        assert_eq!(out.bytes, len);
        // 校验一致：采样哈希对账（引擎内部已比对 expected；这里再对独立参考值断言一次）
        assert_eq!(out.sampled_hash, reference_sampled_hash(seed, len));
        assert!(file_bytes_match_seed(&part, seed, len), "GB 产物逐字节核对失败");
        let served_second = srv.served_bytes() - served_first;
        assert!(
            served_second >= len - served_first && served_second < len,
            "GB 续传应只补缺字节: first={served_first} second={served_second}"
        );
        assert!(!meta_path_for(&part).exists(), "完成后 sidecar 必须清除");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
