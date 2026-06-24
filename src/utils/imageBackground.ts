/**
 * 背景图压缩为可上传的 jpeg File
 *
 * @location src/utils/imageBackground.ts
 *
 * 个人资料背景图改为后端持久化（落 MinIO 公开读桶，见 [profileBackground] store +
 * api/profile uploadBackground）。上传前把整张图等比缩到最长边 <= maxEdge 后用 canvas 导出
 * jpeg Blob，控制体积（先递减 jpeg 质量、仍超限再缩小边长），既减小上传带宽也稳过后端
 * 5MB 校验。思路与头像裁剪 [cropImage.ts] 一致，区别是不裁剪、整图等比缩 + 输出 File。
 */

/** 默认最长边上限（px）：超过则等比缩小，兼顾清晰度与体积 */
export const DEFAULT_MAX_EDGE = 1600;
/** 默认产物体积上限（字节）：远小于后端 5MB 限制，控制上传带宽 */
export const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { reject(new Error('背景图加载失败')); };
    img.src = src;
  });
}

/**
 * 由原始宽高与最长边上限算出等比缩放后的画布尺寸（纯函数，便于单测）。
 * 原图本身不超上限时不放大。
 */
export function fitWithinMaxEdge(width: number, height: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) {
    return { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** canvas.toBlob 的 Promise 化（jpeg） */
function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => { blob ? resolve(blob) : reject(new Error('背景图压缩失败')); },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * 把图片（通常是 URL.createObjectURL 的本地 blob URL）压缩为可上传的 jpeg File。
 *
 * @param src 图片地址
 * @param fileName 产物文件名（后端按扩展名判类型）
 * @param maxEdge 最长边上限（默认 1600）
 * @param maxBytes 产物体积上限（默认 ~1.5MB）
 * @returns image/jpeg 的 File
 */
export async function compressImageToFile(
  src: string,
  fileName = 'background.jpg',
  maxEdge = DEFAULT_MAX_EDGE,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<File> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建画布上下文');
  }
  ctx.imageSmoothingQuality = 'high';

  let { w, h } = fitWithinMaxEdge(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge);

  const draw = () => {
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
  };

  draw();
  let quality = 0.85;
  let blob = await canvasToJpegBlob(canvas, quality);

  // 递减质量；仍超限再逐步缩小边长。每轮的决策依赖上一轮产物体积，必须串行（关 no-await-in-loop）。
  /* eslint-disable no-await-in-loop */
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.15;
    blob = await canvasToJpegBlob(canvas, quality);
  }
  while (blob.size > maxBytes && Math.max(w, h) > 320) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    draw();
    blob = await canvasToJpegBlob(canvas, 0.8);
  }
  /* eslint-enable no-await-in-loop */

  return new File([blob], fileName, { type: 'image/jpeg' });
}
