/**
 * 屏享发送质量档位与自适应控制（任务块 1d0t34vy #4）
 *
 * ## 为什么需要
 * 基线实测（2026-09-13 双模拟器 + 生产 TURN）：屏享 sender 从不设置
 * maxBitrate/degradationPreference，WebView 编码器默认 target≈600kbps 且
 * qualityLimitationReason=bandwidth，静态画面下实际码率仅 5-30kbps，
 * 分辨率在 320x180 ↔ 1280x720 间呼吸 —— 观感「过糊」的直接原因。
 *
 * ## 档位定标
 * | 档位 | maxBitrate | 适用 |
 * |------|-----------|------|
 * | high | 2.5 Mbps  | 默认起点；无带宽限制迹象时保持 |
 * | medium | 1.2 Mbps | 带宽受限持续或丢包中等 |
 * | low | 500 kbps    | 高丢包/受限持续（保流畅底线） |
 *
 * ## 自适应规则（带迟滞，纯函数 nextTierFromSamples 可单测）
 * - 降档：窗口丢包率 > 8% 立即降；qualityLimitationReason === 'bandwidth'
 *   连续 ≥3 个采样窗降一档
 * - 升档：丢包 < 1% 且非 bandwidth 限速连续 ≥6 个采样窗升一档（回 high 封顶）
 * - 同向迟滞窗数不对称（降快升慢），避免档位振荡
 *
 * ## 作用面
 * 仅作用于「屏幕共享 track 的 RTCRtpSender」（桌面/安卓同一发送链路，
 * 摄像头/麦克风不受影响）。控制器是 opt-in 仪表盘之外的正式行为，
 * 但对 production 语义的改动只有 sender.setParameters 一处。
 *
 * @module meeting/screenShareQuality
 */

/** 质量档位（低 → 高） */
export type ScreenQualityTier = 'low' | 'medium' | 'high';

/** 档位 → RTP 发送码率上限（bps） */
export const SCREEN_TIER_MAX_BITRATE: Record<ScreenQualityTier, number> = {
  low: 500_000,
  medium: 1_200_000,
  high: 2_500_000,
};

/** 自适应输入样本（一个采样窗的聚合观察） */
export interface QualitySample {
  /** 窗口内丢包率（0-100，百分数；来自 fractionLost 或 ΔpacketsLost/ΔpacketsReceived） */
  lossPct: number;
  /** 编码器是否报告带宽限速（outbound-rtp.qualityLimitationReason === 'bandwidth'） */
  bandwidthLimited: boolean;
  /** 窗口内发送的实际码率（kbps，诊断用，不参与决策） */
  bitrateKbps?: number;
  /** 当前编码分辨率（诊断用） */
  width?: number;
  height?: number;
}

/** 自适应内部状态（采样窗计数器） */
export interface AdaptiveState {
  tier: ScreenQualityTier;
  bandwidthLimitedStreak: number;
  cleanStreak: number;
}

const LOSS_DROP_PCT = 8;
const LOSS_CLEAN_PCT = 1;
const BANDWIDTH_STREAK_DROP = 3;
const CLEAN_STREAK_UP = 6;

const TIER_ORDER: ScreenQualityTier[] = ['low', 'medium', 'high'];

/**
 * 纯函数：按当前状态 + 一个新样本决定（可能转移后的）状态。
 * 降快升慢的迟滞不对称在常量里（3 窗降 / 6 窗升）。
 */
export function nextTierFromSamples(state: AdaptiveState, sample: QualitySample): AdaptiveState {
  let { tier, bandwidthLimitedStreak, cleanStreak } = state;

  // 硬降档：突发高丢包，立即降（清空两个 streak）
  if (sample.lossPct > LOSS_DROP_PCT) {
    const idx = TIER_ORDER.indexOf(tier);
    return {
      tier: TIER_ORDER[Math.max(0, idx - 1)],
      bandwidthLimitedStreak: 0,
      cleanStreak: 0,
    };
  }

  // 带宽限速连击 → 降一档
  if (sample.bandwidthLimited) {
    bandwidthLimitedStreak += 1;
    cleanStreak = 0;
    if (bandwidthLimitedStreak >= BANDWIDTH_STREAK_DROP) {
      bandwidthLimitedStreak = 0;
      const idx = TIER_ORDER.indexOf(tier);
      tier = TIER_ORDER[Math.max(0, idx - 1)];
    }
  } else {
    bandwidthLimitedStreak = 0;
  }

  // 干净窗连击 → 升一档
  if (sample.lossPct <= LOSS_CLEAN_PCT && !sample.bandwidthLimited) {
    cleanStreak += 1;
    if (cleanStreak >= CLEAN_STREAK_UP) {
      cleanStreak = 0;
      const idx = TIER_ORDER.indexOf(tier);
      tier = TIER_ORDER[Math.min(TIER_ORDER.length - 1, idx + 1)];
    }
  } else {
    cleanStreak = 0;
  }

  return { tier, bandwidthLimitedStreak, cleanStreak };
}

/** 应用一个档位到屏幕共享 sender（setParameters 失败返回 false，不抛出） */
export async function applyScreenQualityTier(
  sender: RTCRtpSender,
  tier: ScreenQualityTier,
): Promise<boolean> {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = SCREEN_TIER_MAX_BITRATE[tier];
    // 屏幕内容（文字/表格为主）：分辨率优先于帧率，掉带宽先掉帧率不糊字。
    // degradationPreference 新于本仓 TS lib 目标，用结构化投影赋值。
    (params as unknown as { degradationPreference?: string }).degradationPreference =
      'maintain-resolution';
    await sender.setParameters(params);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 sender getStats 提取一个 QualitySample（一次 getStats 的原始 report）。
 * 丢包率优先 fractionLost（RR）；无则用 Δpackets（由调用方跨窗维护）。
 */
export function qualitySampleFromStats(report: RTCStatsReport): {
  sample: QualitySample;
  packetsReceived: number;
  packetsLost: number;
} {
  let lossPct = 0;
  let bandwidthLimited = false;
  let bitrateKbps: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let packetsReceived = 0;
  let packetsLost = 0;
  report.forEach((raw) => {
    const s = raw as unknown as Record<string, unknown>;
    if (s.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
      const lost = typeof s.packetsLost === 'number' && s.packetsLost > 0 ? s.packetsLost : 0;
      const rcvd = typeof s.packetsReceived === 'number' ? s.packetsReceived : 0;
      const total = lost + rcvd;
      if (total > 0) { lossPct = Math.max(lossPct, (lost / total) * 100); }
      packetsReceived = rcvd;
      packetsLost = lost;
    }
    if (s.type === 'outbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
      bandwidthLimited = s.qualityLimitationReason === 'bandwidth';
      if (typeof s.targetBitrate === 'number') {
        bitrateKbps = Math.round(s.targetBitrate / 1000);
      }
      width = typeof s.frameWidth === 'number' ? s.frameWidth : undefined;
      height = typeof s.frameHeight === 'number' ? s.frameHeight : undefined;
    }
    // remote-inbound 的 fractionLost 更可信（对端 RTCP 反馈）
    if (s.type === 'remote-inbound-rtp' && typeof s.fractionLost === 'number') {
      lossPct = Math.max(lossPct, s.fractionLost * 100);
    }
  });
  return { sample: { lossPct, bandwidthLimited, bitrateKbps, width, height }, packetsReceived, packetsLost };
}

/**
 * 启动自适应控制器（每 windowMs 采样一次 sender stats，按规则调档）。
 * 返回停止函数（幂等）。首次立即应用 startTier。
 */
export function startScreenQualityController(
  sender: RTCRtpSender,
  opts: { startTier?: ScreenQualityTier; windowMs?: number; onTierChange?: (t: ScreenQualityTier) => void } = {},
): () => void {
  const windowMs = Math.max(1000, opts.windowMs ?? 5000);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: AdaptiveState = {
    tier: opts.startTier ?? 'high',
    bandwidthLimitedStreak: 0,
    cleanStreak: 0,
  };
  let prevPackets = { received: 0, lost: 0, valid: false };

  void applyScreenQualityTier(sender, state.tier).then((ok) => {
    if (ok) { opts.onTierChange?.(state.tier); }
  });

  const tick = async () => {
    if (stopped) { return; }
    try {
      const report = await sender.getStats();
      const { sample, packetsReceived, packetsLost } = qualitySampleFromStats(report);
      // RR 不可用时用 Δpackets 计算窗口丢包率
      if (sample.lossPct === 0 && prevPackets.valid) {
        const dR = packetsReceived - prevPackets.received;
        const dL = Math.max(0, packetsLost - prevPackets.lost);
        if (dR + dL > 20) {
          sample.lossPct = (dL / (dR + dL)) * 100;
        }
      }
      prevPackets = { received: packetsReceived, lost: packetsLost, valid: true };
      const next = nextTierFromSamples(state, sample);
      if (next.tier !== state.tier) {
        const ok = await applyScreenQualityTier(sender, next.tier);
        if (ok) {
          state = next;
          opts.onTierChange?.(state.tier);
        }
      } else {
        state = next;
      }
    } catch {
      /* stats 暂不可用：跳过本窗 */
    }
    if (!stopped) {
      timer = setTimeout(tick, windowMs);
    }
  };
  timer = setTimeout(tick, windowMs);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
