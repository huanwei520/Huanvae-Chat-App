/**
 * 视频首帧截取（只做「把一帧变成 JPEG 字节」这一件事）
 *
 * @module services/videoPosterCapture
 *
 * ## 为什么用一个**离屏**的 `<video>`，而不是直接截可见的那个缩略图元素
 *
 * 截帧必须走 `canvas.drawImage(video)`，而 canvas 一旦画入**跨源**媒体就会被标记为
 * tainted，`toBlob` 直接抛 SecurityError。要不被污染，那个 `<video>` 必须带
 * `crossOrigin="anonymous"` —— 而带上它之后，**响应没有 CORS 头就会直接加载失败**。
 *
 * 本仓的视频取源有四条通路，前三条都有 CORS 头：
 *  1. Tauri asset 协议（桌面本地文件）：`Access-Control-Allow-Origin: <window_origin>`
 *     （tauri-2.11.1 `src/protocol/asset.rs`）
 *  2. 回环安全反代（远程 presigned）：`*`（`src-tauri/src/secure_proxy.rs` 的 `with_cors`）
 *  3. 本地媒体服务器（Android / macOS 本地文件）：`*`（本次一并补上，见
 *     `src-tauri/src/local_media_server.rs` 的 `serve_video`）
 *  4. `resolveDisplayUrl` 判定为**外部**资源时原样放行的裸 URL —— 这条**没有** CORS 头。
 *
 * 第 4 条决定了不能把 `crossOrigin` 加到**可见**的那个 `<video>` 上：那样在第 4 条通路上
 * 缩略图会**整个加载失败**（从"有封面但要等"劣化成"永远没有画面"）。放在离屏元素上，
 * 最坏情况只是"这次没截到、不落盘"，可见缩略图与今天逐字节相同。
 *
 * 代价：某个视频**第一次**显示时会多一次 metadata 拉取（可见元素一次 + 离屏一次）。
 * 只发生一次 —— 之后缩略图渲染的是 `<img>`，连 `<video>` 都不建。并发上限由
 * `services/videoPoster.ts` 的信号量控制，不会一屏几十个同时开工。
 *
 * ## jsdom 测不到这里
 *
 * jsdom 的 `<video>` 不解码、不 seek，`canvas.toBlob` 也没实现 —— **取像素这一段**属于
 * 「vitest 结构性盲区」（同 .claude/rules/frontend-test.md「滚动 / 布局相关行为」那条）。
 * 故编排层（`services/videoPoster.ts`）把它 `vi.mock` 掉单独测。
 *
 * ⚠️ 但**黑帧判据本身不在盲区里**：本模块把「像素缓冲 → 是不是黑帧」抽成了纯函数
 * （{@link analyzeFrameLuma} / {@link isNearlyBlackFrame}），它不碰 canvas、不碰 `<video>`，
 * 可以直接喂一个构造出来的像素缓冲做断言 —— 这正是「纯黑帧不许落盘」这条能被机器守住的原因。
 * 取像素的函数因此**只返回像素**、不自己下判断：**判断留给编排层**，这样
 * 「黑帧 ⇒ 不写缓存」是一条在 jsdom 里可以端到端跑通的真断言，而不是对 mock 的断言。
 */

/** 封面长边上限（px）。缩略图最大也就一屏宽，480 足够，再大只是白占磁盘。 */
const POSTER_MAX_EDGE = 480;

/** JPEG 质量。0.7 在缩略图尺寸上肉眼无损，单张实测十几 KB。 */
const POSTER_JPEG_QUALITY = 0.7;

/** 截帧目标时间点（秒）。与可见缩略图的 `#t=0.1` 取同一位置，保证两处是**同一帧**。 */
const POSTER_FRAME_TIME = 0.1;

/** 单次截帧的总时限（毫秒）。超时即放弃并清理元素，避免离屏 `<video>` 永久挂着。 */
const CAPTURE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// 黑帧判据（写缓存前的闸门 + 已落盘条目的自愈判据，两处用同一套）
//
// 🔴 为什么必须有它：Android 硬解把帧画进 canvas，在部分机型上得到的是**全黑 / 全透明**。
// 而封面是**永久缓存**：黑帧一旦落盘就会每次命中，用户此后**每次都错**，且系统自己不会恢复。
// 没有缓存只是每次慢 —— 所以「宁可这次不存、下次再截」严格优于「先存下来再说」。
// ---------------------------------------------------------------------------

/**
 * 单个像素"算不算黑"的亮度阈值（0..255，Rec.709 亮度、按 alpha 加权后）。
 *
 * 取 24 而不是 0/1/8 的理由是**解码链路的黑电平**：H.264 等按 BT.601/709 的
 * limited range 编码，黑是 `Y'=16` 而不是 0；一旦某条解码/绘制路径没做
 * 16..235 → 0..255 的展开，一张**真正的黑帧**送进 canvas 就是 RGB≈16 而不是 0。
 * 再留 8 级给解码振铃/去块滤波的抖动 ⇒ 24。低于它的像素在屏幕上与纯黑不可分辨。
 */
const DARK_PIXEL_LUMA = 24;

/**
 * 非暗像素占比下限 —— **判决就用这一条**。
 *
 * 0.005 = 0.5%：本模块把长边压到 480px，典型 480×270 ≈ 129600 像素，0.5% ≈ 648 个像素。
 * 少于这个数的亮点撑不起一张「能认出内容」的封面。
 */
const MIN_NON_DARK_RATIO = 0.005;

/** 一帧的亮度统计（{@link analyzeFrameLuma} 的产物） */
export interface FrameLuma {
  /** 采样到的像素数（0 表示缓冲为空 / 长度非法） */
  pixelCount: number;
  /** 平均亮度，0..255，按 alpha 加权 */
  meanLuma: number;
  /** 亮度 ≥ {@link DARK_PIXEL_LUMA} 的像素占比，0..1 */
  nonDarkRatio: number;
}

/**
 * 统计一帧 RGBA 缓冲的亮度分布。**纯函数**：不碰 DOM，可直接喂构造出来的缓冲。
 *
 * alpha 参与加权（`luma * a / 255`）的理由：canvas 转 JPEG 时透明区域会被**合成到黑底**，
 * 所以"全透明"与"全黑"在最终产物里是同一件事 —— Android 那条失效路径两种都出现过。
 *
 * @param pixels `ImageData.data` 形态的 RGBA 缓冲（长度必须是 4 的倍数）
 */
export function analyzeFrameLuma(pixels: Uint8ClampedArray | Uint8Array): FrameLuma {
  const usable = pixels.length - (pixels.length % 4);
  const pixelCount = usable / 4;
  if (pixelCount === 0) {
    return { pixelCount: 0, meanLuma: 0, nonDarkRatio: 0 };
  }
  let lumaSum = 0;
  let nonDark = 0;
  for (let i = 0; i < usable; i += 4) {
    // Rec.709 亮度；alpha 加权见上（透明 = 合成成黑）
    const luma = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2])
      * (pixels[i + 3] / 255);
    lumaSum += luma;
    if (luma >= DARK_PIXEL_LUMA) {
      nonDark += 1;
    }
  }
  return {
    pixelCount,
    meanLuma: lumaSum / pixelCount,
    nonDarkRatio: nonDark / pixelCount,
  };
}

/**
 * 这一帧是不是「（近）全黑」⇒ **不许写进封面缓存**。**纯函数**。
 *
 * 判据：**非暗像素占比 < {@link MIN_NON_DARK_RATIO}**（连一小块亮区都没有）。
 * 「暗」的口径是单像素亮度 < {@link DARK_PIXEL_LUMA}，见该常量对黑电平的说明。
 *
 * ### 为什么判决只用占比，不把均值也 AND 进来
 *
 * 均值**没有额外判别力**，而且方向反了：
 *  - 占比 < 0.5% 时，均值在数学上必然 < `24×0.995 + 255×0.005 ≈ 25.2` —— 也就是说
 *    "占比低"已经蕴含"均值低"，再 AND 一个均值条件只会**放过**一部分真黑帧：
 *    limited-range 黑电平那种**均匀 RGB≈16** 的帧，均值就是 16，任何
 *    「均值 < 6」之类的下限都会把它判成"不黑"（实测反例，故本实现不采用该组合）。
 *  - 反过来，把均值当**独立**否决条件（OR）会误杀夜景：整帧均值可以只有 2~3，
 *    但有 1% 的像素是路灯 / 字幕 / logo —— 那是一张完全能用的封面。
 * ⇒ 均值仍然算出来（{@link FrameLuma.meanLuma}），但只作为**诊断输出**，不参与判决。
 *
 * ### 失败方向是刻意选的
 *  - 误判成黑（拒绝一张其实能用的封面）= 这次不落盘、下次会话再截一次 ⇒ **每次慢**；
 *  - 漏判（把黑帧存进去）= **每次都错**，而且缓存命中后自己不会恢复。
 * 两者不对等，所以边界上偏向"拒绝"。
 *
 * **空缓冲判黑**：取不到像素（长度 0）时返回 true —— 此时没有任何证据说明这帧是好的，
 * 而这条路径的默认必须偏向"不写缓存"。
 */
export function isNearlyBlackFrame(pixels: Uint8ClampedArray | Uint8Array): boolean {
  const { pixelCount, nonDarkRatio } = analyzeFrameLuma(pixels);
  if (pixelCount === 0) {
    return true;
  }
  return nonDarkRatio < MIN_NON_DARK_RATIO;
}

/**
 * 按长边上限等比缩放；比上限小的**不放大**（放大只会糊，还更占盘）。
 *
 * @returns 目标尺寸；宽高非法（0 / NaN / 负数，元数据没读出来时会出现）返回 null
 */
export function posterTargetSize(
  videoWidth: number,
  videoHeight: number,
  maxEdge: number = POSTER_MAX_EDGE,
): { width: number; height: number } | null {
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) {
    return null;
  }
  if (videoWidth <= 0 || videoHeight <= 0) {
    return null;
  }
  const longest = Math.max(videoWidth, videoHeight);
  if (longest <= maxEdge) {
    return { width: Math.round(videoWidth), height: Math.round(videoHeight) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}

/** 建一个离屏、静音、不进画面的取帧用 `<video>`。 */
function createCaptureVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  // 见文件头：不带它 canvas 会被污染，toBlob 抛 SecurityError
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = src;
  return video;
}

/** 把 canvas 的 `toBlob` 包成 Promise（回调形态在编排里不好串）。 */
function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('canvas.toBlob 返回空'));
        }
      },
      'image/jpeg',
      POSTER_JPEG_QUALITY,
    );
  });
}

/** 截出来的一帧：JPEG 字节 + 原始 RGBA 像素（后者供黑帧判据用，不落盘） */
export interface CapturedFrame {
  /** 可直接交给 Rust 落盘的 JPEG 字节 */
  bytes: Uint8Array;
  /** 编码**之前**的 RGBA 缓冲，喂给 {@link isNearlyBlackFrame} */
  pixels: Uint8ClampedArray;
}

/**
 * 从视频 src 截取首帧：给出 JPEG 字节**和**编码前的像素。
 *
 * 流程：加载元数据 → seek 到 0.1s → `seeked` 事件 → drawImage → getImageData → toBlob。
 * 显式 seek 而不是靠 `#t=0.1` 片段：片段是"请求引擎在可能的时候跳过去"，
 * 而 `currentTime =` + 等 `seeked` 是**确定**该帧已解码可画。
 *
 * 🔴 **本函数不判断这帧能不能用** —— 判断在编排层（`services/videoPoster.ts`）用
 * {@link isNearlyBlackFrame} 做。这样切分的唯一理由是**可测**：本函数整体落在 jsdom 盲区里
 * （没有解码、没有 `toBlob`），而编排层加纯函数判据可以在 vitest 里端到端跑通
 * 「纯黑帧 ⇒ 不写缓存」。把判断塞进这里会把那条硬判据一起拖进盲区。
 *
 * @throws 加载失败 / seek 失败 / 元数据尺寸非法 / 超时 / canvas 不可用（含被污染）
 */
export async function captureVideoFrame(videoSrc: string): Promise<CapturedFrame> {
  const video = createCaptureVideo(videoSrc);
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`截帧超时（${CAPTURE_TIMEOUT_MS}ms）`));
      }, CAPTURE_TIMEOUT_MS);

      video.addEventListener('error', () => {
        reject(new Error('视频加载失败（多半是取源通路没有 CORS 头）'));
      });
      video.addEventListener('loadedmetadata', () => {
        // 时长比目标点还短的视频（极短 GIF 转码件）就取正中间那一帧
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = duration > POSTER_FRAME_TIME ? POSTER_FRAME_TIME : duration / 2;
      });
      video.addEventListener('seeked', () => {
        resolve();
      });
    });

    const size = posterTargetSize(video.videoWidth, video.videoHeight);
    if (!size) {
      throw new Error(`视频尺寸非法: ${video.videoWidth}x${video.videoHeight}`);
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('取不到 2d 绘图上下文');
    }
    ctx.drawImage(video, 0, 0, size.width, size.height);

    // 先取像素再编码：黑帧判据要看的是**编码前**的真实内容，JPEG 解回来会带量化噪声
    const pixels = ctx.getImageData(0, 0, size.width, size.height).data;
    const blob = await canvasToJpegBlob(canvas);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pixels };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    // 停掉正在进行的网络请求 + 断开元素，避免离屏 <video> 拖着连接不放
    video.removeAttribute('src');
    video.load();
  }
}

/** 读回已落盘封面时的解码时限（毫秒）。本地文件，给足也不该拖住首屏。 */
const INSPECT_TIMEOUT_MS = 5_000;

/**
 * 把一张**已落盘的封面**解码回 RGBA 像素（自愈路径的取证手段）。
 *
 * 用途只有一个：判断"以前存下来的这张封面是不是黑帧"。所以它**吞掉所有失败**并返回 `null`
 * —— 读不出来 ≠ 它是坏的，此时必须保持现状（返回 null 让调用方**不要**删缓存）。
 * 把"读不出"当成"是黑帧"会让一次偶发的解码失败删掉一张好封面，那是净损失。
 *
 * `crossOrigin='anonymous'`：封面走 asset 协议 / 本地媒体服务器，两条都带 CORS 头
 * （见文件头通路 1、3）；不带它 canvas 会被污染，`getImageData` 直接抛 SecurityError。
 */
export async function readImagePixels(src: string): Promise<Uint8ClampedArray | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`封面解码超时（${INSPECT_TIMEOUT_MS}ms）`));
      }, INSPECT_TIMEOUT_MS);
      img.addEventListener('load', () => { resolve(); });
      img.addEventListener('error', () => { reject(new Error('封面解码失败')); });
      img.src = src;
    });

    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
