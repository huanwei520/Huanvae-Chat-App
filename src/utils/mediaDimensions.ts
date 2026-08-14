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
 *
 * ## 按 `File` 记忆结果（2026-08-13 补），以及它修的是什么
 *
 * 上面列的两个消费方其实是**三个读取点**：待发区 `add`、发送态 `enqueue`、上传链路。
 * 三处读的是**同一个 `File`**，此前各自从零解码一遍，而且——更要命的——
 * 待发区那次是 fire-and-forget：它 resolve 时如果那一项已经离开待发区
 * （用户粘贴完立刻回车 ⇒ `clear` 已经把它清掉），回写找不到目标，
 * **那组已经算出来的数字被直接丢掉**，下一处只能从零再读一次。
 *
 * ⇒ 这里按 `File` 记住结果（`WeakMap`，文件对象被回收即随之消失，不驻留内存）：
 * - **已 resolve** ⇒ {@link peekMediaDimensions} **同步**就能拿到，
 *   发送态入队那一刻即可把 `width/height` 填进去，一帧默认尺寸都不画（零窗口）；
 * - **在飞** ⇒ 复用同一个 promise，不再从零重启一次解码，
 *   于是入队侧的补探是「接着待发区那次继续等」，而不是「重新读一遍」。
 *
 * ⚠️ 仍有残余窗口（如实标注）：待发区那次探测**根本还没 resolve**、
 * 而上传已经完成（秒传命中的极小文件）时，那一次仍按默认尺寸画完全程。
 * 窗口只缩不增 —— 修复前是「已经算出来的数字也会被丢掉」，修复后是「只剩真没算完这一种」。
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

/** 真正去解码的那一层（不查记忆） */
function readUncached(file: File): Promise<MediaDimensions | null> {
  if (file.type.startsWith('image/')) {
    return readImageDimensions(file);
  }
  if (file.type.startsWith('video/')) {
    return readVideoDimensions(file);
  }
  return Promise.resolve(null);
}

/**
 * 已 resolve 的结果（含"读不出来"的 `null`）。
 * `WeakMap` ⇒ `File` 不再被引用时这条记录随之消失，不需要任何过期策略。
 */
const RESOLVED = new WeakMap<File, MediaDimensions | null>();
/** 正在飞的那次读取，用来让并发的多个读取点共用同一次解码 */
const INFLIGHT = new WeakMap<File, Promise<MediaDimensions | null>>();

/**
 * **同步**取这个文件已经读到过的尺寸；没读过（或还没 resolve）返回 `null`。
 *
 * 给"必须同步产出、不能 await"的地方用 —— 典型是
 * `stores/sendingMediaStore.enqueue`（回车那一帧消息就要出现在列表最新处）。
 * 拿到就当场把在途占位的尺寸填对，一帧默认尺寸都不画。
 */
export function peekMediaDimensions(file: File): MediaDimensions | null {
  return RESOLVED.get(file) ?? null;
}

/**
 * 读媒体文件（图片 / 视频）的原始像素尺寸。
 *
 * 同一个 `File` 只解码一次：已读过 ⇒ 直接给结果；在飞 ⇒ 复用同一个 promise
 * （理由见模块头「按 `File` 记忆结果」）。
 *
 * @returns 非媒体文件 / 读不出来时为 `null`（不抛）
 *
 * ⚠️ 依赖 `URL.createObjectURL`：jsdom 没有它，调用会抛。调用方要么在
 * 有该 API 的环境里调，要么先做能力判断（见 composerTrayStore 的探测点）。
 */
export function readMediaDimensions(file: File): Promise<MediaDimensions | null> {
  const remembered = RESOLVED.get(file);
  if (remembered !== undefined) {
    return Promise.resolve(remembered);
  }
  const inflight = INFLIGHT.get(file);
  if (inflight) {
    return inflight;
  }

  const pending = readUncached(file);
  INFLIGHT.set(file, pending);
  // 用双参 then 而不是 .then().catch()：失败分支要把在飞记录清掉，
  // 又不能把 pending 的拒绝吞掉（调用方的契约不变，仍然是"能力不足就抛"）。
  pending.then(
    (dim) => {
      RESOLVED.set(file, dim);
      INFLIGHT.delete(file);
    },
    () => {
      INFLIGHT.delete(file);
    },
  );
  return pending;
}
