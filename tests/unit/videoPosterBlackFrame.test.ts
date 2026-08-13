/**
 * 黑帧判据（`src/services/videoPosterCapture.ts` 的 analyzeFrameLuma / isNearlyBlackFrame）
 *
 * ## 它守的是什么
 *
 * 视频封面是**永久缓存**。Android 硬解把帧画进 canvas，在部分机型上得到的是全黑 / 全透明；
 * 这样一帧一旦落盘就会每次命中 ⇒ 用户**每次都错**，而且系统自己不会恢复。
 * 「没有缓存」只是每次慢 —— 两种代价不对等，所以落盘前必须有这道闸。
 *
 * ## 为什么这一层测得到（而截帧本体测不到）
 *
 * 判据被刻意抽成**纯函数**：入参是一块 RGBA 缓冲，不碰 `<video>`、不碰 canvas。
 * jsdom 不解码不 seek、`canvas.toBlob` 也没实现 —— 那些都在结构性盲区里
 * （见 .claude/rules/frontend-test.md），但**判据本身不在**。
 * 本文件直接构造像素缓冲做断言；「黑帧不落盘」这条端到端行为由
 * tests/unit/videoPosterService.test.ts 用**同一个真判据**再验一遍。
 *
 * ## 阈值（改动前先读这一段）
 *
 * - 单像素"算黑"的亮度阈值 24/255：H.264 等按 limited range 编码，黑是 `Y'=16` 而非 0，
 *   解码链路少做一次 16..235 → 0..255 展开，**真黑帧**送进 canvas 就是 RGB≈16；再留 8 级
 *   给解码振铃 ⇒ 24。
 * - **判决只用一条**：非暗像素占比 < 0.5%。均值只作诊断输出。
 *   下面两条用例把"为什么不用均值"钉成可执行的判据：
 *   「limited-range 黑电平」那条均值 = 16，任何「均值 < 6」的下限都会放过它；
 *   「夜景」那条均值 = 2.55 却明显有内容，把均值当独立否决条件会误杀它。
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeFrameLuma,
  isNearlyBlackFrame,
} from '../../src/services/videoPosterCapture';

/** 造一块 RGBA 缓冲：先按 fill 铺满，再把前 litCount 个像素涂成 lit 颜色 */
function frame(
  pixelCount: number,
  fill: [number, number, number, number],
  litCount = 0,
  lit: [number, number, number, number] = [255, 255, 255, 255],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const [r, g, b, a] = i < litCount ? lit : fill;
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

describe('analyzeFrameLuma：亮度统计（alpha 参与加权）', () => {
  it('全白不透明 ⇒ 均值 255、非暗占比 1', () => {
    const stats = analyzeFrameLuma(frame(100, [255, 255, 255, 255]));
    expect(stats.pixelCount).toBe(100);
    expect(stats.meanLuma).toBeCloseTo(255, 5);
    expect(stats.nonDarkRatio).toBe(1);
  });

  it('全白但**全透明** ⇒ 均值 0：canvas 转 JPEG 会把透明合成到黑底，两者是同一件事', () => {
    const stats = analyzeFrameLuma(frame(100, [255, 255, 255, 0]));
    expect(stats.meanLuma).toBe(0);
    expect(stats.nonDarkRatio).toBe(0);
  });

  it('空缓冲 ⇒ pixelCount 0（不除零、不产出 NaN）', () => {
    const stats = analyzeFrameLuma(new Uint8ClampedArray(0));
    expect(stats).toEqual({ pixelCount: 0, meanLuma: 0, nonDarkRatio: 0 });
  });

  it('长度不是 4 的倍数时只统计完整像素（不读越界字节）', () => {
    const buf = new Uint8ClampedArray([255, 255, 255, 255, 9, 9]);
    expect(analyzeFrameLuma(buf).pixelCount).toBe(1);
  });
});

describe('isNearlyBlackFrame：哪些帧不许写进封面缓存', () => {
  it('🔴 纯黑帧（全 0）判黑', () => {
    expect(isNearlyBlackFrame(new Uint8ClampedArray(1000 * 4))).toBe(true);
  });

  it('🔴 全透明帧（Android 硬解的另一种失效形态）判黑', () => {
    expect(isNearlyBlackFrame(frame(1000, [255, 255, 255, 0]))).toBe(true);
  });

  it('🔴 limited-range 黑电平（RGB 16，未做 16..235 展开）仍判黑', () => {
    const lifted = frame(1000, [16, 16, 16, 255]);
    // 这一条同时是「判决为什么不 AND 均值」的反例：它的均值就是 16，
    // 任何「均值 < 6」之类的下限都会把这张真黑帧放过去。
    expect(analyzeFrameLuma(lifted).meanLuma).toBeCloseTo(16, 5);
    expect(isNearlyBlackFrame(lifted)).toBe(true);
  });

  it('取不到像素（空缓冲）判黑 —— 没有证据说明它是好的，默认必须偏向不写缓存', () => {
    expect(isNearlyBlackFrame(new Uint8ClampedArray(0))).toBe(true);
  });

  it('正常画面（全白）放行', () => {
    expect(isNearlyBlackFrame(frame(1000, [255, 255, 255, 255]))).toBe(false);
  });

  it('中灰画面放行（阈值不是"只放行很亮的图"）', () => {
    expect(isNearlyBlackFrame(frame(1000, [90, 90, 90, 255]))).toBe(false);
  });

  it('夜景不误杀：整体极暗（均值 2.55）、但有 1% 的像素亮起来 ⇒ 放行', () => {
    const night = frame(1000, [0, 0, 0, 255], 10);
    const stats = analyzeFrameLuma(night);
    // 这一条是「判决为什么不把均值当独立否决条件」的反例
    expect(stats.meanLuma).toBeCloseTo(2.55, 2);
    expect(stats.nonDarkRatio).toBeGreaterThanOrEqual(0.005);
    expect(isNearlyBlackFrame(night)).toBe(false);
  });

  it('亮点太少（0.2% < 0.5%）⇒ 仍判黑', () => {
    const almostBlack = frame(1000, [0, 0, 0, 255], 2);
    expect(analyzeFrameLuma(almostBlack).nonDarkRatio).toBeLessThan(0.005);
    expect(isNearlyBlackFrame(almostBlack)).toBe(true);
  });

  it('均匀极暗灰（RGB 20，肉眼与黑不可分）判黑', () => {
    expect(isNearlyBlackFrame(frame(1000, [20, 20, 20, 255]))).toBe(true);
  });

  it('边界：恰好 0.5% 的像素非暗 ⇒ 放行（阈值是"低于才拒"，不是"不高于就拒"）', () => {
    const edge = frame(1000, [0, 0, 0, 255], 5);
    expect(analyzeFrameLuma(edge).nonDarkRatio).toBeCloseTo(0.005, 6);
    expect(isNearlyBlackFrame(edge)).toBe(false);
  });
});
