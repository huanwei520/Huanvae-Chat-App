/**
 * cropImage 工具测试
 *
 * - pickOutputSize：min/floor/兜底纯逻辑。
 * - getCroppedBlob 的 ≤maxBytes 收缩：mock Image + canvas.toBlob（体积 = 边长² × 质量），
 *   覆盖「不收缩 / 仅降质 / 降质到底再砍边长」三条路径。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickOutputSize, getCroppedBlob } from '../../src/utils/cropImage';

describe('pickOutputSize', () => {
  it('裁剪区域小于上限时不放大，按区域宽取整', () => {
    expect(pickOutputSize(300, 512)).toBe(300);
  });
  it('裁剪区域大于上限时取上限', () => {
    expect(pickOutputSize(1000, 512)).toBe(512);
  });
  it('非整数向下取整', () => {
    expect(pickOutputSize(300.9, 512)).toBe(300);
  });
  it('非正值兜底为 1（避免 0/负数画布）', () => {
    expect(pickOutputSize(0, 512)).toBe(1);
    expect(pickOutputSize(-10, 512)).toBe(1);
  });
});

describe('getCroppedBlob ≤maxBytes 收缩', () => {
  beforeEach(() => {
    // Image：设置 src 后下一个微任务触发 onload
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);

    // canvas 2d 上下文：仅需 drawImage/clearRect/imageSmoothingQuality
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      imageSmoothingQuality: 'low',
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // toBlob：模拟体积 = 当前边长² × 质量（边长越大/质量越高，体积越大）
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, cb: BlobCallback, _type?: string, quality?: number) {
      const bytes = Math.max(1, Math.round(this.width * this.width * (quality ?? 1)));
      cb(new Blob([new Uint8Array(bytes)]));
    } as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('产物已小于上限 → 不收缩，直接返回首帧', async () => {
    // 64² × 0.9 ≈ 3686B，远小于 2MB → 两个循环都不触发
    const blob = await getCroppedBlob('blob:x', { x: 0, y: 0, width: 64, height: 64 });
    expect(blob.size).toBe(Math.round(64 * 64 * 0.9));
    expect(blob.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('仅靠降质量即可达标', async () => {
    // 512² × 0.9 ≈ 236KB 超 100KB；降到 q0.30（512²×0.3≈78KB）达标，无需砍边长
    const initial = Math.round(512 * 512 * 0.9);
    const blob = await getCroppedBlob('blob:x', { x: 0, y: 0, width: 512, height: 512 }, 512, 100_000);
    expect(blob.size).toBeLessThanOrEqual(100_000);
    expect(blob.size).toBeLessThan(initial);
  });

  it('降质到底仍超限 → 砍边长直到达标', async () => {
    // 上限 60KB：降质到 q0.30 仍 ~78KB 超限 → 砍边长 512→256（256²×0.8≈52KB）达标
    const initial = Math.round(512 * 512 * 0.9);
    const blob = await getCroppedBlob('blob:x', { x: 0, y: 0, width: 512, height: 512 }, 512, 60_000);
    expect(blob.size).toBeLessThanOrEqual(60_000);
    expect(blob.size).toBeLessThan(initial);
  });
});
