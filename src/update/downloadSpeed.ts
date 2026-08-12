/**
 * 更新下载的实时传输速率估算（EMA）
 *
 * 输入是两端下载器**已有的** 200ms 进度上报（桌面 `ShardedEvent::Progress`、
 * 安卓 `apk-download-progress`）。本模块**不新增任何定时器、不提高上报频率** ——
 * 每收到一次上报顺带算一次速率，零额外开销。
 *
 * ## 为什么是 EMA(α=0.3)，而不是「最近 N 次均值」或长窗口
 *
 * Δt≈200ms ⇒ 时间常数 τ ≈ Δt/α ≈ 0.67s，90% 收敛 ≈ 1.5s。两侧都被真实约束卡死：
 *
 * - **α ≥ 0.5 会跟着单 tick 抖**：h2 stream window 已放大到 4 MiB
 *   （见 `src-tauri/src/updater_download.rs` 的 `build_client`，以及
 *   `.claude/rules/downloader-decision.md`），窗口刷新是**突发**投递，
 *   单个 200ms 窗口内 ±40% 是常态 —— 读数会乱跳到没法看。
 * - **α ≤ 0.1 根本来不及收敛**：τ≈2s、90% 收敛≈4.6s；而桌面包 13.7 MB @ 17.46 MB/s
 *   ≈ **0.8s** 就下完（拢共约 4 个 tick），数字会全程还在爬升就结束。
 *   **这是决定性约束**，也是不能用「长窗口 / 最近 N 次均值」的原因：样本压根不够。
 *
 * ## 状态机（每条分支都对应一个真实存在的上游行为，不是防御性兜底）
 *
 * 见 `push()` 内逐条注释。所有时间戳由调用方注入（生产传 `performance.now()`，
 * 测试直接传数字），因此本模块是纯逻辑、可独立单测，不依赖计时器。
 *
 * @module update/downloadSpeed
 */

/**
 * EMA 平滑系数。改它之前先读上面「为什么是 0.3」——两侧都有硬约束，不是随手取的。
 */
export const SPEED_EMA_ALPHA = 0.3;

/**
 * 样本最小间隔（毫秒）。低于它的上报整条丢弃，同时也是除零防护。
 */
export const MIN_SAMPLE_INTERVAL_MS = 50;

/**
 * 断档阈值（毫秒）。间隔超过它的样本按 seed 覆盖，而不是按 α 混入。
 */
export const RESEED_INTERVAL_MS = 2000;

/** 一次进度上报（累计值，非增量） */
export interface SpeedSample {
  /** 已下载字节数（累计） */
  downloaded: number;
  /** 总字节数；0 = 未知（不定态），此时不参与「下完冻结」判定 */
  total: number;
  /** 单调时间戳（毫秒）：生产传 `performance.now()`，测试直接传数字 */
  now: number;
}

export interface DownloadSpeedTracker {
  /**
   * 吃一次进度上报，返回当前速率（bytes/s）。
   *
   * `null` = 目前没有可显示的读数（还没起量 / 已冻结但从未算出过），调用方应当**不显示**，
   * 而不是显示一个 `0 B/s` 这种零信息量的数字。
   */
  push(sample: SpeedSample): number | null;
  /** 回到「一次下载都没开始」的状态；每轮 `startDownload` 调一次 */
  reset(): void;
}

export function createDownloadSpeedTracker(): DownloadSpeedTracker {
  /** 当前 EMA（bytes/s）；null = 还没有任何有效样本 */
  let ema: number | null = null;
  /** 上一个被采纳的样本的时间戳 / 字节数（仅当 hasBaseline 时有意义） */
  let lastT = 0;
  let lastBytes = 0;
  /** 有没有立过基线（`lastT`/`lastBytes` 是否为真实值，而不是初始的 0） */
  let hasBaseline = false;

  const reset = (): void => {
    ema = null;
    lastT = 0;
    lastBytes = 0;
    hasBaseline = false;
  };

  const push = ({ downloaded, total, now }: SpeedSample): number | null => {
    // ① 下完即冻结：8 个分片**不同时**收尾，最后几个 tick 只剩 1~2 条连接在跑，
    //    真实吞吐本来就在跌 —— 那是"收尾"不是"变慢"，继续算只会让用户眼看着数字往下掉。
    //    🔴 `total > 0` 这个前提不能省：不定态（服务端没给 Content-Length）下 total=0，
    //       `downloaded >= 0` 恒真 ⇒ 不加前提会**开局即冻结**、整场下载一个读数都出不来。
    if (total > 0 && downloaded >= total) {
      return ema;
    }

    // ② 第一次上报只用来立基线：此刻没有"上一次"可比，`lastT` 还是初始的 0
    //    （拿它当时间戳去减会得到一个巨大的假 dt）。
    //    ⚠️ 基线必须立在**第一次上报**、而不是 `startDownload()` 那一刻：安卓在下载前要
    //       `await ensureInstallPermission()`，用户在系统授权页停留多久都有可能，
    //       用 startDownload 的时间当 t0 会把这段等待算进分母。
    if (!hasBaseline) {
      hasBaseline = true;
      lastT = now;
      lastBytes = downloaded;
      return null;
    }

    const dt = now - lastT;

    // ③ dt 下限：正常样本 dt≈200ms（两端都是 200ms tick）。低于 50ms 的只可能来自
    //    安卓的**终末补发**（`android_update.rs` 在 `reporter.abort()` 之后还会再 emit
    //    一次 `(100, done, total)`，与前一次间隔可以远小于 200ms）或事件积压后的连发 ——
    //    分母太小，算出来的数失真到没有意义。
    //    **整条丢弃**：既不更新 ema 也**不动基线**，让下一次上报以更长的窗口去算
    //    （字节仍在累计，一个都不会漏算）。这同时就是除零防护（dt=0 恒被挡在这里）。
    if (dt < MIN_SAMPLE_INTERVAL_MS) {
      return ema;
    }

    const delta = downloaded - lastBytes;

    // ④ 桌面计数器**会回退**：分片读失败时 Rust 侧回滚已计字节
    //    （`updater_download.rs` 的 `progress.fetch_sub`，防百分比冲过 100%）。
    //    回滚是**记账修正**、不是"负速率" ⇒ 丢样本；但**基线必须重置到当前值**，
    //    否则下一 tick 会把回滚掉的那段字节**再算一遍**，速率虚高。
    //    ema 保持不变：这段时间的真实吞吐我们没有新信息，不该乱改。
    if (delta < 0) {
      lastT = now;
      lastBytes = downloaded;
      return ema;
    }

    // ⑤ **首字节到达之前**的 delta=0 不是"停滞"，是还没开始传
    //    （桌面 `Started` 事件带的就是 `downloaded: 0`）。此时把基线推到"传输真正开始"
    //    的时刻：既不把连接建立/校验的耗时算进第一个样本的分母，也避免用 0 去 seed ——
    //    一旦 seed 成 0，真值要好几个 tick 才爬得上来，而拢共只有 4 个 tick。
    //    注意这条**只在 ema 尚未建立时**成立；之后的 delta=0 是真停滞，走 ⑦。
    if (delta === 0 && ema === null) {
      lastT = now;
      lastBytes = downloaded;
      return null;
    }

    const sample = (delta * 1000) / dt;

    if (ema === null) {
      // ⑥ 首样本**直接 seed**，不做 `α*sample + (1-α)*0`：
      //    否则首帧只显示真值的 30%，在只有 4 个 tick 的下载里永远追不上。
      ema = sample;
    } else if (dt > RESEED_INTERVAL_MS) {
      // ⑦ 断档（安卓进程被 cached、事件停投，回前台一次性拿到跨越数秒的巨样本）：
      //    它描述的是"过去这几秒的平均"，跟当下吞吐无关。按 α 慢慢混进旧 ema 只会让
      //    读数长时间失真 ⇒ 直接 **seed 覆盖**更诚实。
      ema = sample;
    } else {
      // ⑧ 常规 EMA。注意 delta=0 且 dt 正常 = **真的卡住了**，必须走到这里参与衰减：
      //    α=0.3 下约 1.5s 掉到接近 0，正合"卡住了"的直觉。跳过它反而是骗人 ——
      //    进度条不动，速率却还挂着上一秒那个漂亮数字。
      ema = SPEED_EMA_ALPHA * sample + (1 - SPEED_EMA_ALPHA) * ema;
    }

    lastT = now;
    lastBytes = downloaded;
    return ema;
  };

  return { push, reset };
}
