/**
 * screenShareProbe 纯函数单测（jsdom）
 *
 * 覆盖打桩探针可确定性驱动的部分：
 * - deltaOf：增量计算（bytes/frames/keyFrames/qpSum 单调、bitrateKbps 换算、
 *   计数器回绕钳零、jitterDelayMs 均值换算、可选字段透传）
 * - sampleFromStats：RTCStatsReport(Map 形态) 分类——outbound→sender（取帧数最大者）、
 *   inbound→receivers（按 mid 键控，缺 mid 用 id 兜底）、audio 条目忽略、
 *   pairId→candidate-pair 的 rtt 关联
 *
 * 定时器/getStats/渲染段为副作用面，由设备级 E2E 驱动（__hgSSPipe.start/installRenderProbe），
 * 不在本单测范围。
 */

import { describe, it, expect } from 'vitest';
import { __probeInternals, type RtpSample } from '../../src/meeting/screenShareProbe';

const { deltaOf, sampleFromStats } = __probeInternals;

const baseSample = (over: Partial<RtpSample>): RtpSample => ({
  t: 1000,
  bytes: 0,
  frames: 0,
  keyFrames: 0,
  qpSum: 0,
  fps: 0,
  packetsLost: 0,
  fractionLost: 0,
  rtt: 0,
  width: 0,
  height: 0,
  freezeCount: 0,
  freezesDuration: 0,
  pli: 0,
  nack: 0,
  fir: 0,
  jitterDelay: 0,
  jitterEmitted: 0,
  framesDropped: 0,
  ...over,
});

describe('screenShareProbe deltaOf', () => {
  it('计算增量与码率换算（1s 内 50KB → 400kbps）', () => {
    const prev = baseSample({ t: 1000, bytes: 1000, frames: 10, keyFrames: 1, qpSum: 100 });
    const cur = baseSample({ t: 2000, bytes: 52000, frames: 20, keyFrames: 2, qpSum: 300 });
    const d = deltaOf(prev, cur);
    expect(d.dtMs).toBe(1000);
    expect(d.bytes).toBe(51000);
    expect(d.frames).toBe(10);
    expect(d.keyFrames).toBe(1);
    expect(d.qpSum).toBe(200);
    expect(d.bitrateKbps).toBe(408); // 51000*8/1000 = 408
  });

  it('计数器回绕/重置时钳零，不产生负增量', () => {
    const prev = baseSample({ t: 1000, bytes: 99999, frames: 100, packetsLost: 5 });
    const cur = baseSample({ t: 2000, bytes: 10, frames: 3, packetsLost: 2 });
    const d = deltaOf(prev, cur);
    expect(d.bytes).toBe(0);
    expect(d.frames).toBe(0);
    expect(d.packetsLost).toBe(0);
  });

  it('jitterDelayMs = jitterBufferDelay/jitterBufferEmittedCount 换算', () => {
    const prev = baseSample({ t: 1000, jitterDelay: 0, jitterEmitted: 0 });
    const cur = baseSample({ t: 2000, jitterDelay: 2, jitterEmitted: 1 });
    expect(deltaOf(prev, cur).jitterDelayMs).toBe(2000);
    const curZero = baseSample({ t: 2000, jitterDelay: 0, jitterEmitted: 0 });
    expect(deltaOf(prev, curZero).jitterDelayMs).toBe(0);
  });

  it('可选字段（targetBitrate/qualityLimitation/encoder/decoder）透传换算', () => {
    const prev = baseSample({ t: 1000 });
    const cur = baseSample({
      t: 2000,
      targetBitrate: 2_500_000,
      qualityLimitation: 'bandwidth',
      encoder: 'libvpx',
      decoder: 'ffmpeg',
    });
    const d = deltaOf(prev, cur);
    expect(d.targetBitrateKbps).toBe(2500);
    expect(d.qualityLimitation).toBe('bandwidth');
    expect(d.encoder).toBe('libvpx');
    expect(d.decoder).toBe('ffmpeg');
  });
});

describe('screenShareProbe sampleFromStats', () => {
  const reportOf = (entries: Array<[string, Record<string, unknown>]>) => new Map(entries);

  it('outbound video → sender；inbound video → receivers（mid 键控）', () => {
    const report = reportOf([
      ['s1', { type: 'outbound-rtp', kind: 'video', bytesSent: 100, framesEncoded: 5, mid: '0' }],
      ['s2', { type: 'inbound-rtp', kind: 'video', bytesReceived: 200, framesDecoded: 7, mid: '1' }],
      ['s3', { type: 'inbound-rtp', kind: 'video', bytesReceived: 300, framesDecoded: 9, mid: '2' }],
    ]);
    const { sender, receivers } = sampleFromStats(report);
    expect(sender).not.toBeNull();
    expect(sender?.bytes).toBe(100);
    expect(sender?.frames).toBe(5);
    expect(receivers.size).toBe(2);
    expect(receivers.get('1')?.frames).toBe(7);
    expect(receivers.get('2')?.frames).toBe(9);
  });

  it('audio 条目与非 rtp 条目忽略；inbound 缺 mid 用 id 兜底', () => {
    const report = reportOf([
      ['a1', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 999, framesDecoded: 1 }],
      ['q1', { type: 'codec', mimeType: 'video/VP8' }],
      ['i1', { type: 'inbound-rtp', kind: 'video', bytesReceived: 10, framesDecoded: 2 }],
    ]);
    const { sender, receivers } = sampleFromStats(report);
    expect(sender).toBeNull();
    expect(receivers.size).toBe(1);
    expect(receivers.get('id:i1')?.bytes).toBe(10);
  });

  it('多 outbound 时 sender 取帧数最大者（screen 优先于 camera 的近似）', () => {
    const report = reportOf([
      ['c1', { type: 'outbound-rtp', kind: 'video', bytesSent: 10, framesEncoded: 3 }],
      ['s1', { type: 'outbound-rtp', kind: 'video', bytesSent: 20, framesEncoded: 50 }],
    ]);
    const { sender } = sampleFromStats(report);
    expect(sender?.bytes).toBe(20);
    expect(sender?.frames).toBe(50);
  });

  it('pairId 关联 candidate-pair 的 currentRoundTripTime（秒→毫秒）', () => {
    const report = reportOf([
      ['p1', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.025 }],
      ['s1', { type: 'outbound-rtp', kind: 'video', bytesSent: 1, framesEncoded: 1, pairId: 'p1' }],
    ]);
    const { sender } = sampleFromStats(report);
    expect(sender?.rtt).toBe(25);
  });
});
