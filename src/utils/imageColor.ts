/**
 * 图片主色调提取 + 颜色互转（个人资料背景用）
 *
 * @location src/utils/imageColor.ts
 *
 * 把背景图缩到小尺寸画到离屏 canvas，按「量化直方图 + 饱和度/明度加权」选出最能代表
 * 画面的主体色调（而非简单平均，简单平均会糊成灰）。提取出的主色用于：
 * - QQ 资料卡卡底淡染（见 [profileCover]）
 * - 「主题色跟随背景」开启时驱动全局主题色（RGB→hex，见 [profileBackground]）
 *
 * 纯前端、无依赖。blob: / 同源 URL 不会污染 canvas，可安全 getImageData。
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 加载图片为 HTMLImageElement（失败 reject） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 跨源图需服务端 CORS 头才不污染 canvas
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/**
 * 提取图片主色调。失败（加载失败 / canvas 被污染 / 全透明）返回 null。
 */
export async function extractDominantColor(url: string): Promise<RGB | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) { return null; }
  ctx.drawImage(img, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null; // 污染的 canvas
  }

  // 量化到 5 位/通道（32 级）做直方图，同时累计每桶真实均值与全图均值兜底
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) { continue; } // 跳过近透明像素
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    n += 1;

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const slot = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    slot.count += 1;
    slot.r += r;
    slot.g += g;
    slot.b += b;
    buckets.set(key, slot);
  }

  if (n === 0) { return null; }
  const average: RGB = { r: sumR / n, g: sumG / n, b: sumB / n };

  // 主色 = 「桶内像素数 × 饱和度权重 × 明度权重」得分最高者：
  // 偏好有色彩、明度适中的桶；过暗/过亮降权但不排除（暗色封面仍要能取到色）。
  let best: RGB | null = null;
  let bestScore = -1;
  for (const slot of buckets.values()) {
    const r = slot.r / slot.count;
    const g = slot.g / slot.count;
    const b = slot.b / slot.count;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const lumWeight = lum < 0.08 || lum > 0.95 ? 0.25 : 1;
    const score = slot.count * (0.4 + saturation) * lumWeight;
    if (score > bestScore) {
      bestScore = score;
      best = { r, g, b };
    }
  }

  return best ?? average;
}

/** RGB → CSS rgba 字符串 */
export function rgbToCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/** 单通道（0..255）转两位十六进制 */
function channelToHex(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return n.toString(16).padStart(2, '0');
}

/** RGB → #rrggbb 十六进制（主题 setPrimaryColor 需 hex，rgbToCss 的 rgba 不被其解析） */
export function rgbToHex(c: RGB): string {
  return `#${channelToHex(c.r)}${channelToHex(c.g)}${channelToHex(c.b)}`;
}

/** #rgb / #rrggbb 十六进制 → RGB（解析失败返回 null）。用于纯色背景取 dominant=该色。 */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) { return null; }
  let h = m[1];
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 相对亮度 0..1（感知加权） */
export function relativeLuminance(c: RGB): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** 该色作背景时是否应配深色文字（亮色背景 → 深字） */
export function prefersDarkText(c: RGB): boolean {
  return relativeLuminance(c) > 0.6;
}

/** 把色向白色混合 t（0=原色，1=纯白），用于柔和淡染背景 */
export function mixWithWhite(c: RGB, t: number): RGB {
  return {
    r: c.r + (255 - c.r) * t,
    g: c.g + (255 - c.g) * t,
    b: c.b + (255 - c.b) * t,
  };
}
