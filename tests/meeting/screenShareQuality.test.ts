/**
 * screenShareQuality 单测（jsdom）
 *
 * 覆盖：
 * - nextTierFromSamples：起点 high、硬丢包立即降档、bandwidth 限速 3 窗降档、
 *   干净 6 窗升档、迟滞不对称（降快升慢）、low 封底/high 封顶、丢包清 streak
 * - applyScreenQualityTier：encodings 缺省补齐、maxBitrate/degradationPreference
 *   写入并调 setParameters；setParameters 拒绝时返回 false 不抛出
 * - qualitySampleFromStats：fractionLost（remote-inbound）优先、bandwidth 限定识别
 */

import { describe, it, expect } from 'vitest';
import {
  nextTierFromSamples,
  applyScreenQualityTier,
  qualitySampleFromStats,
  SCREEN_TIER_MAX_BITRATE,
  type AdaptiveState,
  type QualitySample,
} from '../../src/meeting/screenShareQuality';

const state = (over: Partial<AdaptiveState> = {}): AdaptiveState => ({
  tier: 'high',
  bandwidthLimitedStreak: 0,
  cleanStreak: 0,
  ...over,
});

const sample = (over: Partial<QualitySample> = {}): QualitySample => ({
  lossPct: 0,
  bandwidthLimited: false,
  ...over,
});

describe('screenShareQuality nextTierFromSamples', () => {
  it('干净样本维持 high', () => {
    const next = nextTierFromSamples(state(), sample());
    expect(next.tier).toBe('high');
    expect(next.cleanStreak).toBe(1);
  });

  it('丢包 > 8% 立即降档且清 streak', () => {
    const next = nextTierFromSamples(
      state({ cleanStreak: 5, bandwidthLimitedStreak: 2 }),
      sample({ lossPct: 12 }),
    );
    expect(next.tier).toBe('medium');
    expect(next.cleanStreak).toBe(0);
    expect(next.bandwidthLimitedStreak).toBe(0);
  });

  it('bandwidth 限速连续 3 窗降一档', () => {
    let s = state();
    s = nextTierFromSamples(s, sample({ bandwidthLimited: true }));
    s = nextTierFromSamples(s, sample({ bandwidthLimited: true }));
    expect(s.tier).toBe('high'); // 第 3 窗才降
    s = nextTierFromSamples(s, sample({ bandwidthLimited: true }));
    expect(s.tier).toBe('medium');
    // 计数归零后重新累计
    expect(s.bandwidthLimitedStreak).toBe(0);
  });

  it('干净 6 窗升一档，high 封顶', () => {
    let s = state({ tier: 'low' });
    for (let i = 0; i < 6; i++) s = nextTierFromSamples(s, sample());
    expect(s.tier).toBe('medium');
    let h = state({ tier: 'high' });
    for (let i = 0; i < 10; i++) h = nextTierFromSamples(h, sample());
    expect(h.tier).toBe('high');
  });

  it('low 封底：高丢包连击不再低于 low', () => {
    let s = state({ tier: 'low' });
    s = nextTierFromSamples(s, sample({ lossPct: 50 }));
    expect(s.tier).toBe('low');
  });

  it('限速窗口中间插丢包样本会打断 cleanStreak', () => {
    let s = state({ cleanStreak: 5 });
    s = nextTierFromSamples(s, sample({ lossPct: 3, bandwidthLimited: false }));
    expect(s.cleanStreak).toBe(0); // lossPct > 1% 打断干净连击
  });
});

describe('screenShareQuality applyScreenQualityTier', () => {
  const fakeSender = (opts: { rejectSet?: boolean } = {}) => {
    const calls: unknown[] = [];
    const captured: unknown[] = [];
    return {
      calls,
      captured,
      sender: {
        getParameters: () => {
          const p: Record<string, unknown> = { encodings: [] };
          captured.push(p);
          return p as unknown as RTCRtpSendParameters;
        },
        setParameters: (p: RTCRtpSendParameters) => {
          if (opts.rejectSet) return Promise.reject(new Error('denied'));
          calls.push(p);
          return Promise.resolve();
        },
      } as unknown as RTCRtpSender,
    };
  };

  it('high 档写入 maxBitrate=2.5Mbps + maintain-resolution', async () => {
    const { sender, captured } = fakeSender();
    const ok = await applyScreenQualityTier(sender, 'high');
    expect(ok).toBe(true);
    const p = captured[0] as { encodings: Array<{ maxBitrate?: number }>; degradationPreference?: string };
    expect(p.encodings[0].maxBitrate).toBe(SCREEN_TIER_MAX_BITRATE.high);
    expect(p.degradationPreference).toBe('maintain-resolution');
  });

  it('setParameters 拒绝时返回 false 不抛出', async () => {
    const { sender } = fakeSender({ rejectSet: true });
    await expect(applyScreenQualityTier(sender, 'low')).resolves.toBe(false);
  });

  it('三档码率标定值正确', () => {
    expect(SCREEN_TIER_MAX_BITRATE.low).toBe(500_000);
    expect(SCREEN_TIER_MAX_BITRATE.medium).toBe(1_200_000);
    expect(SCREEN_TIER_MAX_BITRATE.high).toBe(2_500_000);
  });
});

describe('screenShareQuality qualitySampleFromStats', () => {
  const reportOf = (entries: Array<Record<string, unknown>>) =>
    ({ forEach: (cb: (s: Record<string, unknown>) => void) => entries.forEach(cb) }) as unknown as RTCStatsReport;

  it('outbound bandwidth 限速与分辨率提取', () => {
    const { sample: s } = qualitySampleFromStats(
      reportOf([
        { type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'bandwidth', targetBitrate: 600_000, frameWidth: 320, frameHeight: 180 },
      ]),
    );
    expect(s.bandwidthLimited).toBe(true);
    expect(s.bitrateKbps).toBe(600);
    expect(s.width).toBe(320);
    expect(s.height).toBe(180);
  });

  it('remote-inbound fractionLost 换算百分数', () => {
    const { sample: s } = qualitySampleFromStats(
      reportOf([{ type: 'remote-inbound-rtp', fractionLost: 0.1 }]),
    );
    expect(s.lossPct).toBeCloseTo(10, 5);
  });
});
