/**
 * 头像裁剪工具
 *
 * 把用户在裁剪框中选定的区域用 canvas 重绘，导出为正方形 jpeg Blob。
 * 重绘时缩放到 <= outputSize 边长，既统一头像尺寸、又顺带压小文件体积。
 *
 * @module utils/cropImage
 */

/** react-easy-crop 的 onCropComplete 回传的像素区域 */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算导出边长：取裁剪区域宽与上限的较小值并取整，避免放大裁剪区域导致模糊。
 * 纯函数，便于单测（边界：area 比 max 小时不放大；非整数取整；非正值兜底为 1）。
 */
export function pickOutputSize(areaWidth: number, max: number): number {
  const size = Math.floor(Math.min(areaWidth, max));
  return size > 0 ? size : 1;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { reject(new Error('图片加载失败')); };
    img.src = src;
  });
}

/**
 * 将 imageSrc 按裁剪区域 area 裁出正方形并导出 jpeg Blob。
 *
 * @param imageSrc 图片地址（通常是 URL.createObjectURL 生成的本地 blob URL）
 * @param area 裁剪区域（像素，来自 react-easy-crop 的 croppedAreaPixels）
 * @param outputSize 导出边长上限（默认 512）
 * @param quality jpeg 质量 0-1（默认 0.9）
 */
export async function getCroppedBlob(
  imageSrc: string,
  area: CropArea,
  outputSize = 512,
  quality = 0.9,
): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const size = pickOutputSize(area.width, outputSize);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建画布上下文');
  }
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('裁剪导出失败'));
        }
      },
      'image/jpeg',
      quality,
    );
  });
}
