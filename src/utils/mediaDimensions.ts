/**
 * 读一个本地媒体文件的原始像素尺寸（图片 / 视频）
 *
 * @module utils
 * @location src/utils/mediaDimensions.ts
 *
 * ## 为什么是独立模块而不是留在 useFileUpload 里
 *
 * 这套尺寸有**两个**消费方，而且它们必须拿到**逐字节相同**的结果：
 *
 * 1. 上传链路（`hooks/useFileUpload.ts`）—— 把 `image_width` / `image_height` 交给后端，
 *    并经 `chat/shared/uploadPersist.ts` 落进本地库；**完成态**的气泡就是按这两个数
 *    算出容器尺寸的（`FileMessageContent.calculateDisplaySize`）。
 * 2. 待发区（`stores/composerTrayStore.ts`）—— 让**上传中**的占位提前知道同一组数字，
 *    于是在途占位与完成态用同一个函数算出**同一个**容器尺寸 ⇒ 上传完成那一刻不跳版。
 *
 * 两处各写一份读法（`new Image()` vs `<video>` 的 `naturalWidth` / `videoWidth`）迟早会漂，
 * 而漂了的表现恰恰是"上传完成时图突然变大/变小一下"——最不容易被归因到这里的那种缺陷。
 * ⇒ 收敛成一个函数，两处都 import 它。
 *
 * ## 失败一律返回 null，不抛
 *
 * 拿不到尺寸不是错误路径：非媒体文件、解码失败、损坏的头部都会走到这里，
 * 上传照常进行（后端不强制 `image_width`），占位退回默认尺寸。
 */

/** 媒体的原始像素尺寸；读不出来时为 null */
export interface MediaDimensions {
  width: number;
  height: number;
}

/** 读图片文件的原始尺寸（解码失败返回 null） */
function readImageDimensions(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/** 读视频文件的原始尺寸（只拉元数据，不解整段；失败返回 null） */
function readVideoDimensions(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    video.preload = 'metadata';
    video.src = url;
  });
}

/**
 * 读媒体文件（图片 / 视频）的原始像素尺寸。
 *
 * @returns 非媒体文件 / 读不出来时为 `null`（不抛）
 *
 * ⚠️ 依赖 `URL.createObjectURL`：jsdom 没有它，调用会抛。调用方要么在
 * 有该 API 的环境里调，要么先做能力判断（见 composerTrayStore 的探测点）。
 */
export function readMediaDimensions(file: File): Promise<MediaDimensions | null> {
  if (file.type.startsWith('image/')) {
    return readImageDimensions(file);
  }
  if (file.type.startsWith('video/')) {
    return readVideoDimensions(file);
  }
  return Promise.resolve(null);
}
