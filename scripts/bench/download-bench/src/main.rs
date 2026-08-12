//! 更新下载器测速台（in-repo，随代码走）
//!
//! # 为什么它必须入仓
//!
//! 此前两次下载器调优（h2 窗口那次、分片那次）用的 harness 都是**一次性、未入仓**的，
//! 直接后果是：再问「新参数快多少」时**一个数字都拿不出来**，只能重新造一遍轮子。
//! 所以这次的第一条要求就是 —— 测速台入仓，跟代码一起活着。
//!
//! # 它量什么
//!
//! | 指标 | 用途 |
//! |---|---|
//! | 总耗时 / 均值速率 | 最直接的对比量 |
//! | 峰值速率（200ms 采样窗口） | 看链路上限，区分「慢」是上限低还是被拖尾 |
//! | **各分片各自的完成时刻** | ⭐ 决定「小块 + 有界并发 + 工作窃取」值不值得做的**唯一依据** |
//! | 分片完成时刻的离散度 / 空转占比 | 同上，量化「尾延迟」 |
//! | 重试次数 | 链路质量旁证；重试多说明测出来的数字含噪 |
//!
//! ⭐ 那一行是本测速台存在的主要理由：若 8 片的完成时刻很齐（离散度低），
//! 说明尾延迟不是瓶颈 ⇒ 工作窃取的收益接近 0，**应当直接放弃**，别先写代码再找理由。
//!
//! # 与生产代码的一致性（会漂移，看到就核）
//!
//! 本测速台**复刻**生产参数，但它是**另一份代码**，天然会漂移。三道防线：
//! 1. 下面 `PROD_*` 常量块逐条标注了生产侧出处（文件 + 常量名）；
//! 2. `src-tauri` 侧有静态守卫测试 `bench_harness_mirrors_production_http2_windows`，
//!    直接读本文件的字节断言两个 h2 窗口值与生产一致，漂了就翻红；
//! 3. Cargo.toml 里写死了「特性集必须与生产**解析结果**一致」的理由（http2 那个坑）。
//!
//! # 口径（与既有 decision doc 同口径，结果才可比）
//!
//! - 同机、同 URL、**交错**跑各变体（按轮次轮换次序，消位次偏差）、取**中位数**；
//! - 本机出口可能有透明代理 ⇒ **绝对值只对该路径成立，有意义的是比值**；
//! - 字节收到即丢弃（不落盘）：本台量的是**网络**，不是磁盘。
//!
//! # 用法
//!
//! ```text
//! download-bench --url <URL> [--rounds 10] [--shards 8] \
//!                [--variants sharded,single] [--h2-windows on|off] \
//!                [--label 改前基线] [--out result.json]
//! ```
//!
//! URL 也可经 `BENCH_URL` 环境变量注入 —— **本仓是 PUBLIC 公开仓，不写任何内网地址**，
//! 所以这里没有任何默认 URL，必须显式给。

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;

// ============================================================
// 生产参数复刻（每条都标出处，漂了就是 bug）
// ============================================================

/// 生产：`src-tauri/src/updater_download.rs` `SHARD_COUNT` / `android_update.rs` `APK_SHARD_COUNT`
const PROD_SHARD_COUNT: u64 = 8;
/// 生产：`updater_download.rs` `MAX_RETRY`
const PROD_MAX_RETRY: u32 = 3;
/// 生产：`updater_download.rs` `SHARD_TIMEOUT`
const PROD_SHARD_TIMEOUT: Duration = Duration::from_secs(120);
/// 生产：`updater_download.rs` `CONNECT_TIMEOUT`
const PROD_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 生产：两处 `build_client` 的 `http2_initial_stream_window_size`
const PROD_H2_STREAM_WINDOW: u32 = 4 * 1024 * 1024;
/// 生产：两处 `build_client` 的 `http2_initial_connection_window_size`
const PROD_H2_CONNECTION_WINDOW: u32 = 8 * 1024 * 1024;
/// 生产：`updater_download.rs` 的进度上报 tick（200ms）；这里同频采样，口径一致
const SAMPLE_TICK: Duration = Duration::from_millis(200);

// ============================================================
// 输出结构（机器可读）
// ============================================================

#[derive(Serialize, Clone)]
struct ShardSample {
    index: usize,
    start_byte: u64,
    end_byte: u64,
    bytes: u64,
    /// 相对本轮 run 起点的完成时刻（ms）—— 离散度就是从这一列算出来的
    finish_ms: f64,
    retries: u32,
}

#[derive(Serialize, Clone)]
struct RunResult {
    label: String,
    variant: String,
    round: u32,
    /// 本轮里该变体是第几个跑的（0 起）；用来事后核对交错次序真的轮换了
    slot: usize,
    ok: bool,
    error: Option<String>,
    total_bytes: u64,
    elapsed_ms: f64,
    mean_mbps: f64,
    peak_mbps: f64,
    retries: u32,
    shards: Vec<ShardSample>,
    /// 分片完成时刻的离散度指标（single 变体恒为 None）
    dispersion: Option<Dispersion>,
}

/// 分片完成时刻的离散度 —— 「小块 + 工作窃取」值不值得做，全看这几个数
#[derive(Serialize, Clone)]
struct Dispersion {
    shard_count: usize,
    first_finish_ms: f64,
    last_finish_ms: f64,
    /// last - first
    span_ms: f64,
    /// span / last —— 归一化的「尾巴有多长」；0 = 完全同时完成
    spread_ratio: f64,
    stddev_ms: f64,
    /// Σ(last - finish_i)：所有分片提前收工后**空转**的总时长（ms）
    idle_ms_sum: f64,
    /// idle_ms_sum / (n × last) —— 有多少并发容量被尾延迟浪费掉了。
    /// 这是判据本身：**接近 0 ⇒ 工作窃取无收益**；显著大于 0 才谈得上做。
    idle_fraction: f64,
}

#[derive(Serialize)]
struct BenchReport {
    label: String,
    url_host: String,
    total_bytes_expected: u64,
    rounds: u32,
    shard_count: u64,
    h2_windows: bool,
    started_at_unix: u64,
    runs: Vec<RunResult>,
    summary: Vec<VariantSummary>,
}

#[derive(Serialize)]
struct VariantSummary {
    variant: String,
    runs_ok: usize,
    runs_failed: usize,
    median_mean_mbps: f64,
    median_peak_mbps: f64,
    median_elapsed_ms: f64,
    total_retries: u32,
    /// 分片变体独有：离散度的中位数
    median_spread_ratio: Option<f64>,
    median_idle_fraction: Option<f64>,
    median_span_ms: Option<f64>,
}

// ============================================================
// 客户端
// ============================================================

/// 建 client —— 逐项对应生产 `updater_download.rs::build_client`。
///
/// `h2_windows=false` 用来复现「改前」（reqwest 默认 = 协议默认 64 KiB 窗口），
/// 让任何人都能自己把 decision doc 那张表再跑一遍，而不是只能相信它。
fn build_client(h2_windows: bool) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .user_agent("download-bench/0.1")
        .connect_timeout(PROD_CONNECT_TIMEOUT);
    if h2_windows {
        // 🔴 与生产逐字一致；改这两个值要同步改生产 + 那条静态守卫测试。
        //    绝不要改成 http2_adaptive_window(true)：实测更差，且它会覆盖这两行
        //    （见 .claude/rules/downloader-decision.md）。
        b = b
            .http2_initial_stream_window_size(PROD_H2_STREAM_WINDOW)
            .http2_initial_connection_window_size(PROD_H2_CONNECTION_WINDOW);
    }
    b.build().expect("client 必须能建出来")
}

async fn probe(client: &reqwest::Client, url: &str) -> Result<(u64, bool), String> {
    let resp = client
        .head(url)
        .timeout(PROD_SHARD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("HEAD 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HEAD 返回 {}", resp.status()));
    }
    let accepts = resp
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false);

    // 🔴 `Response::content_length()` **不是**读 `content-length` 头，而是 hyper 的 body
    // size hint（`reqwest-0.12.28/src/async_impl/response.rs:90-94`：
    // `Body::size_hint(self.res.body()).exact()`）。HEAD 响应按定义没有 body ⇒ 它给 0/None，
    // 与头里的真实长度无关。要拿 HEAD 的长度必须**自己读头**。
    // 这个坑正是本测速台第一次跑就撞上的（"HEAD 没给有效 content-length"），
    // 也顺带暴露了生产侧同款写法的缺陷 —— 见交付说明。
    let header_len = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let body_hint = resp.content_length();
    eprintln!(
        "[probe] content-length 头={header_len:?} / Response::content_length()={body_hint:?}（HEAD 上后者恒失真）"
    );

    let len = header_len.unwrap_or(0);
    if len == 0 {
        return Err("HEAD 的 content-length 头缺失或为 0".to_string());
    }
    Ok((len, accepts))
}

/// 与生产 `shard_ranges` 同一算法（闭区间、首尾相接、恰好覆盖 `[0, len)`）
fn shard_ranges(len: u64, shards: u64) -> Vec<(u64, u64)> {
    let chunk = len.div_ceil(shards);
    (0..shards)
        .map(|i| i * chunk)
        .take_while(|s| *s < len)
        .map(|s| (s, (s + chunk - 1).min(len - 1)))
        .collect()
}

/// 采样器：与生产同频（200ms）读累计字节，算峰值速率。
/// 返回 (peak_mbps, sample_count)。
fn spawn_sampler(progress: Arc<AtomicU64>, done: Arc<AtomicU64>) -> tokio::task::JoinHandle<f64> {
    tokio::spawn(async move {
        let mut prev = 0u64;
        let mut prev_t = Instant::now();
        let mut peak = 0f64;
        loop {
            tokio::time::sleep(SAMPLE_TICK).await;
            let cur = progress.load(Ordering::Relaxed);
            let now = Instant::now();
            let dt = now.duration_since(prev_t).as_secs_f64();
            if dt > 0.0 {
                let rate = (cur.saturating_sub(prev)) as f64 / dt / 1_048_576.0;
                if rate > peak {
                    peak = rate;
                }
            }
            prev = cur;
            prev_t = now;
            if done.load(Ordering::Relaxed) == 1 {
                break;
            }
        }
        peak
    })
}

/// 单条连接整包拉流（对照组：等价于浏览器 / 插件默认的单连接顺序下载）
async fn run_single(
    client: reqwest::Client,
    url: String,
    expected: u64,
) -> Result<(u64, f64, f64), String> {
    let progress = Arc::new(AtomicU64::new(0));
    let done = Arc::new(AtomicU64::new(0));
    let sampler = spawn_sampler(progress.clone(), done.clone());
    let t0 = Instant::now();

    let resp = client
        .get(&url)
        .timeout(PROD_SHARD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("GET 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GET 返回 {}", resp.status()));
    }
    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        let b = item.map_err(|e| format!("读取失败: {e}"))?;
        progress.fetch_add(b.len() as u64, Ordering::Relaxed);
    }
    let elapsed = t0.elapsed().as_secs_f64();
    done.store(1, Ordering::Relaxed);
    let peak = sampler.await.unwrap_or(0.0);

    let got = progress.load(Ordering::Relaxed);
    if got != expected {
        return Err(format!("字节数不符：期望 {expected}，实到 {got}"));
    }
    Ok((got, elapsed * 1000.0, peak))
}

/// 分片并发（复刻生产：8 片 / 每片 MAX_RETRY 次重试 / 300ms×attempt 退避）
async fn run_sharded(
    client: reqwest::Client,
    url: String,
    expected: u64,
    shards: u64,
) -> Result<(u64, f64, f64, Vec<ShardSample>), String> {
    let progress = Arc::new(AtomicU64::new(0));
    let done = Arc::new(AtomicU64::new(0));
    let sampler = spawn_sampler(progress.clone(), done.clone());
    let t0 = Instant::now();

    let ranges = shard_ranges(expected, shards);
    let mut tasks = Vec::new();
    for (idx, (start, end)) in ranges.into_iter().enumerate() {
        let client = client.clone();
        let url = url.clone();
        let progress = progress.clone();
        tasks.push(tokio::spawn(async move {
            let want = end - start + 1;
            let mut got = 0u64;
            let mut retries = 0u32;
            loop {
                let from = start + got;
                if from > end {
                    break;
                }
                let attempt = async {
                    let resp = client
                        .get(&url)
                        .header(reqwest::header::RANGE, format!("bytes={from}-{end}"))
                        .timeout(PROD_SHARD_TIMEOUT)
                        .send()
                        .await
                        .map_err(|e| format!("分片请求失败: {e}"))?;
                    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                        return Err(format!("非 206（实际 {}）", resp.status()));
                    }
                    let mut stream = resp.bytes_stream();
                    let mut n = 0u64;
                    while let Some(item) = stream.next().await {
                        match item {
                            Ok(b) => {
                                n += b.len() as u64;
                                progress.fetch_add(b.len() as u64, Ordering::Relaxed);
                            }
                            Err(e) => {
                                // 与生产一致：本次尝试作废，已计入的字节要回滚
                                progress.fetch_sub(n, Ordering::Relaxed);
                                return Err(format!("分片读取失败: {e}"));
                            }
                        }
                    }
                    Ok::<u64, String>(n)
                }
                .await;

                match attempt {
                    Ok(n) => {
                        got += n;
                        if got >= want {
                            break;
                        }
                    }
                    Err(e) => {
                        retries += 1;
                        if retries > PROD_MAX_RETRY {
                            return Err(format!("分片[{start}-{end}] 重试用尽: {e}"));
                        }
                        tokio::time::sleep(Duration::from_millis(300 * u64::from(retries))).await;
                    }
                }
            }
            Ok::<ShardSample, String>(ShardSample {
                index: idx,
                start_byte: start,
                end_byte: end,
                bytes: got,
                finish_ms: t0.elapsed().as_secs_f64() * 1000.0,
                retries,
            })
        }));
    }

    let mut samples = Vec::new();
    let mut first_err: Option<String> = None;
    for t in tasks {
        match t.await {
            Ok(Ok(s)) => samples.push(s),
            Ok(Err(e)) => {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("任务 panic: {e}"));
                }
            }
        }
    }
    let elapsed = t0.elapsed().as_secs_f64();
    done.store(1, Ordering::Relaxed);
    let peak = sampler.await.unwrap_or(0.0);

    if let Some(e) = first_err {
        return Err(e);
    }
    samples.sort_by_key(|s| s.index);
    let got: u64 = samples.iter().map(|s| s.bytes).sum();
    if got != expected {
        return Err(format!("字节数不符：期望 {expected}，实到 {got}"));
    }
    Ok((got, elapsed * 1000.0, peak, samples))
}

// ============================================================
// 统计
// ============================================================

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

fn dispersion_of(samples: &[ShardSample]) -> Option<Dispersion> {
    if samples.is_empty() {
        return None;
    }
    let fin: Vec<f64> = samples.iter().map(|s| s.finish_ms).collect();
    let first = fin.iter().cloned().fold(f64::INFINITY, f64::min);
    let last = fin.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let n = fin.len() as f64;
    let mean = fin.iter().sum::<f64>() / n;
    let var = fin.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    let idle_sum: f64 = fin.iter().map(|x| last - x).sum();
    Some(Dispersion {
        shard_count: samples.len(),
        first_finish_ms: first,
        last_finish_ms: last,
        span_ms: last - first,
        spread_ratio: if last > 0.0 { (last - first) / last } else { 0.0 },
        stddev_ms: var.sqrt(),
        idle_ms_sum: idle_sum,
        idle_fraction: if last > 0.0 { idle_sum / (n * last) } else { 0.0 },
    })
}

// ============================================================
// CLI
// ============================================================

struct Args {
    url: String,
    rounds: u32,
    shards: u64,
    variants: Vec<String>,
    h2_windows: bool,
    label: String,
    out: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut url = std::env::var("BENCH_URL").unwrap_or_default();
    let mut rounds = 10u32;
    let mut shards = PROD_SHARD_COUNT;
    let mut variants = vec!["sharded".to_string(), "single".to_string()];
    let mut h2_windows = true;
    let mut label = "current".to_string();
    let mut out = None;

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let need = |i: usize| -> Result<String, String> {
            argv.get(i + 1)
                .cloned()
                .ok_or_else(|| format!("{} 缺少取值", argv[i]))
        };
        match argv[i].as_str() {
            "--url" => {
                url = need(i)?;
                i += 2;
            }
            "--rounds" => {
                rounds = need(i)?.parse().map_err(|e| format!("--rounds 非法: {e}"))?;
                i += 2;
            }
            "--shards" => {
                shards = need(i)?.parse().map_err(|e| format!("--shards 非法: {e}"))?;
                i += 2;
            }
            "--variants" => {
                variants = need(i)?.split(',').map(|s| s.trim().to_string()).collect();
                i += 2;
            }
            "--h2-windows" => {
                h2_windows = matches!(need(i)?.as_str(), "on" | "true" | "1");
                i += 2;
            }
            "--label" => {
                label = need(i)?;
                i += 2;
            }
            "--out" => {
                out = Some(need(i)?);
                i += 2;
            }
            "--help" | "-h" => {
                println!(
                    "download-bench --url <URL> [--rounds 10] [--shards 8] \
                     [--variants sharded,single] [--h2-windows on|off] [--label <名>] [--out <json>]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("未知参数: {other}")),
        }
    }
    if url.is_empty() {
        return Err("必须给 --url（或设 BENCH_URL 环境变量）。本仓是 PUBLIC 公开仓，故无内置默认 URL。".to_string());
    }
    if shards == 0 {
        return Err("--shards 必须 > 0".to_string());
    }
    Ok(Args { url, rounds, shards, variants, h2_windows, label, out })
}

/// 只取 host 进报告 —— 完整 URL 可能带签名 query，不落进产物
fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or("<unparsed>")
        .to_string()
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("参数错误: {e}");
            std::process::exit(2);
        }
    };

    let client = build_client(args.h2_windows);
    let (total, accepts_range) = match probe(&client, &args.url).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("HEAD 探测失败，无法开跑: {e}");
            std::process::exit(3);
        }
    };
    if !accepts_range && args.variants.iter().any(|v| v == "sharded") {
        eprintln!("更新源未声明 accept-ranges: bytes，分片变体跑不了");
        std::process::exit(3);
    }

    eprintln!(
        "[bench] host={} total={} bytes ({:.2} MiB) rounds={} shards={} h2_windows={} label={}",
        host_of(&args.url),
        total,
        total as f64 / 1_048_576.0,
        args.rounds,
        args.shards,
        args.h2_windows,
        args.label
    );

    let mut runs: Vec<RunResult> = Vec::new();

    for round in 0..args.rounds {
        // 拉丁方轮换：每轮把变体次序旋转一位，消掉「先跑的总占便宜/吃亏」这类位次偏差
        let n = args.variants.len();
        for slot in 0..n {
            let variant = args.variants[(slot + round as usize) % n].clone();
            let t_start = Instant::now();
            let res = match variant.as_str() {
                "single" => run_single(client.clone(), args.url.clone(), total)
                    .await
                    .map(|(b, ms, peak)| (b, ms, peak, Vec::new())),
                "sharded" => {
                    run_sharded(client.clone(), args.url.clone(), total, args.shards).await
                }
                other => Err(format!("未知变体: {other}")),
            };
            let _ = t_start;

            let rr = match res {
                Ok((bytes, ms, peak, shards)) => {
                    let retries = shards.iter().map(|s| s.retries).sum();
                    let disp = if shards.is_empty() { None } else { dispersion_of(&shards) };
                    RunResult {
                        label: args.label.clone(),
                        variant: variant.clone(),
                        round,
                        slot,
                        ok: true,
                        error: None,
                        total_bytes: bytes,
                        elapsed_ms: ms,
                        mean_mbps: bytes as f64 / 1_048_576.0 / (ms / 1000.0),
                        peak_mbps: peak,
                        retries,
                        shards,
                        dispersion: disp,
                    }
                }
                Err(e) => RunResult {
                    label: args.label.clone(),
                    variant: variant.clone(),
                    round,
                    slot,
                    ok: false,
                    error: Some(e),
                    total_bytes: 0,
                    elapsed_ms: 0.0,
                    mean_mbps: 0.0,
                    peak_mbps: 0.0,
                    retries: 0,
                    shards: Vec::new(),
                    dispersion: None,
                },
            };
            eprintln!(
                "  round {:>2} slot {} {:<8} {}",
                round,
                slot,
                rr.variant,
                if rr.ok {
                    format!(
                        "{:.2} MB/s（峰值 {:.2}）{:.0}ms 重试 {}{}",
                        rr.mean_mbps,
                        rr.peak_mbps,
                        rr.elapsed_ms,
                        rr.retries,
                        rr.dispersion
                            .as_ref()
                            .map(|d| format!(
                                " | 分片跨度 {:.0}ms（{:.1}%）空转占比 {:.1}%",
                                d.span_ms,
                                d.spread_ratio * 100.0,
                                d.idle_fraction * 100.0
                            ))
                            .unwrap_or_default()
                    )
                } else {
                    format!("FAILED: {}", rr.error.clone().unwrap_or_default())
                }
            );
            runs.push(rr);
            // 轮次之间留一点间隔，别让上一轮的 TCP 状态影响下一轮
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }

    // 汇总
    let mut summary = Vec::new();
    for variant in &args.variants {
        let ok: Vec<&RunResult> = runs.iter().filter(|r| &r.variant == variant && r.ok).collect();
        let failed = runs.iter().filter(|r| &r.variant == variant && !r.ok).count();
        let disp: Vec<&Dispersion> = ok.iter().filter_map(|r| r.dispersion.as_ref()).collect();
        summary.push(VariantSummary {
            variant: variant.clone(),
            runs_ok: ok.len(),
            runs_failed: failed,
            median_mean_mbps: median(ok.iter().map(|r| r.mean_mbps).collect()),
            median_peak_mbps: median(ok.iter().map(|r| r.peak_mbps).collect()),
            median_elapsed_ms: median(ok.iter().map(|r| r.elapsed_ms).collect()),
            total_retries: ok.iter().map(|r| r.retries).sum(),
            median_spread_ratio: if disp.is_empty() {
                None
            } else {
                Some(median(disp.iter().map(|d| d.spread_ratio).collect()))
            },
            median_idle_fraction: if disp.is_empty() {
                None
            } else {
                Some(median(disp.iter().map(|d| d.idle_fraction).collect()))
            },
            median_span_ms: if disp.is_empty() {
                None
            } else {
                Some(median(disp.iter().map(|d| d.span_ms).collect()))
            },
        });
    }

    let report = BenchReport {
        label: args.label.clone(),
        url_host: host_of(&args.url),
        total_bytes_expected: total,
        rounds: args.rounds,
        shard_count: args.shards,
        h2_windows: args.h2_windows,
        started_at_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        runs,
        summary,
    };

    // 人读摘要（stderr 已逐轮打过，这里给收口结论）
    eprintln!("\n===== 汇总（中位数）label={} =====", report.label);
    for s in &report.summary {
        eprintln!(
            "  {:<8} ok={:<2} fail={:<2} 均值 {:.2} MB/s | 峰值 {:.2} MB/s | 耗时 {:.0}ms | 重试 {}",
            s.variant, s.runs_ok, s.runs_failed, s.median_mean_mbps, s.median_peak_mbps, s.median_elapsed_ms, s.total_retries
        );
        if let (Some(sp), Some(idle), Some(span)) =
            (s.median_spread_ratio, s.median_idle_fraction, s.median_span_ms)
        {
            eprintln!(
                "           ⭐ 分片完成时刻：跨度 {:.0}ms / 离散度 {:.1}% / 空转占比 {:.1}%",
                span,
                sp * 100.0,
                idle * 100.0
            );
            eprintln!(
                "           ⇒ 判据：空转占比接近 0 ⇒ 尾延迟不是瓶颈，工作窃取收益≈0；显著大于 0 才值得做"
            );
        }
    }
    if let (Some(sh), Some(si)) = (
        report.summary.iter().find(|s| s.variant == "sharded"),
        report.summary.iter().find(|s| s.variant == "single"),
    ) {
        if si.median_mean_mbps > 0.0 {
            eprintln!(
                "  分片/单流 = {:.2}x",
                sh.median_mean_mbps / si.median_mean_mbps
            );
        }
    }

    let json = serde_json::to_string_pretty(&report).expect("序列化失败");
    match &report_out(&args) {
        Some(path) => {
            if let Err(e) = std::fs::write(path, &json) {
                eprintln!("写 JSON 失败({path}): {e}");
                println!("{json}");
            } else {
                eprintln!("\nJSON 已写入 {path}");
            }
        }
        None => println!("{json}"),
    }
}

fn report_out(args: &Args) -> Option<String> {
    args.out.clone()
}
