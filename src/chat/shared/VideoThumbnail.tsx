/**
 * 视频缩略图 —— 全仓**唯一**一处把 `<video>` 当封面渲染的地方
 *
 * @module chat/shared
 * @location src/chat/shared/VideoThumbnail.tsx
 *
 * ## 为什么要有这个组件（而不是只共享 videoPosterSrc 那个纯函数）
 *
 * 在此之前，共享的只是「算 src 的函数」—— `videoPosterSrc` 被四处**各自接线**
 * （消息气泡 / 会话内查找九宫格 / 桌面「我的文件」/ 移动端「我的文件」），
 * 每一处都自己写一遍 `<video src={videoPosterSrc(src)} preload="metadata" muted playsInline>`。
 * 共享的是**算法**、不是**「显示视频缩略图」这件事**，于是「哪一处漏接」在结构上依然可能发生
 * —— 而它恰恰是**真机才看得见**的缺陷（漏了就是黑块，vitest / jsdom 一点也测不出来，
 * 见 .claude/rules/frontend-test.md「所有 X 必经 Y」）。
 * 事实上第四处（FilesModal）此前就漏了 `muted` 与 `playsInline`，无人复查。
 *
 * 收敛成组件之后，这条不变量从「四处都记得写对」变成「结构上只有一处可写」：
 * 全仓再出现第二个当缩略图用的 `<video>` 即属违规，由
 * tests/unit/videoPosterWiring.test.ts 静态扫描守着。
 *
 * ## 四个属性都不是可选项，缺一即劣化
 *
 * - `src={videoPosterSrc(src)}` —— 追 `#t=0.1` 逼引擎 seek 出首帧当封面。
 *   WKWebView（macOS）与 Android WebView **不会**自发画首帧，只有 Windows 的 WebView2 会
 *   ⇒ 漏了它，这个缺陷的分布恰好是「只有 Windows 有封面」。详见 ./videoPosterSrc.ts。
 * - `preload="metadata"` —— 只拉元数据，不预载整段（一屏几十个缩略图，全量预载会打满带宽）。
 * - `muted` —— 缩略图永远不该出声；且未静音的媒体在多数引擎里受自动播放策略限制。
 * - `playsInline` —— iOS/iPadOS 缺它会把视频接管成全屏播放器，缩略图直接失控。
 *
 * ## 不封装的是什么（有意为之）
 *
 * **播放角标不进来。** 四处的角标各有各的 CSS（`.video-play-overlay` / `.conv-msg-search-cover-play`
 * / `.video-play-icon` / `.mobile-file-play-icon`），位置、尺寸、显隐条件（气泡那处下载中要让位给
 * 进度环）都不同；把它们塞进来只会得到一个「四选一 + 一堆条件」的开关式组件，
 * 既不减少分支也不减少漏写风险。本组件只收敛**真正会漏、且漏了只有真机看得见**的那部分：
 * `<video>` 元素本身的取源与播放行为契约。
 *
 * ## 🔴 src 必须是**裸**的可显示 src
 *
 * 调用方传进来的 `src` 要是取源收口点解析出来的裸地址（本地媒体服务器 URL 或回环反代 URL），
 * `#t=0.1` 由本组件内部追加。**别在调用方先追一次**：同一个 src 变量通常还会被递给全屏播放器，
 * 带上片段会让视频从 0.1 秒开始播（见 videoPosterSrc.ts「只能在元素层用」）。
 *
 * ## 封面本地持久化：传了 `fileHash` 就走本地图片，不再建 `<video>`
 *
 * 上面那套「靠引擎 seek 出首帧」的机制有个结构性代价：**那一帧只活在这个 `<video>` 元素里**，
 * 元素一销毁就没了 —— 切回会话、进「查找记录 → 视频」、杀掉 App 重开，每次都要重拉元数据 +
 * seek + 解码，用户看到的就是「先黑再显示 / 每次都重新加载」。
 *
 * 传入 `fileHash` 后，本组件改由 `useVideoPoster` 驱动：
 * - 本地已存过封面 ⇒ 渲染 `<img>`（与图片消息**完全同一条**显示通路），`<video>` 连建都不建；
 * - 没存过 ⇒ 照旧渲染 `<video>`（用户立刻有画面），同时在离屏元素上截一帧落盘，
 *   落好后当场切成 `<img>`，此后永久走本地；
 * - 正在问「有没有存过」的那几毫秒 ⇒ 什么都不渲染（**不能**先渲染 `<video>`：
 *   一屏几十个格子会各开一次元数据拉取，恰是本功能要消灭的成本，理由见 useVideoPoster.ts）。
 *
 * 不传 `fileHash` 的调用点行为与此前**逐字节相同**（恒走 `<video>` 分支）。
 *
 * ⚠️ `onPlay` 只在 `<video>` 分支上有意义 —— 走本地封面时没有媒体元素，自然不会有播放事件。
 * 气泡那处靠它触发的后台缓存另有点击入口（`FileMessageContent` 的 `handleClick`），不受影响。
 */

import { videoPosterSrc } from './videoPosterSrc';
import { useVideoPoster } from './useVideoPoster';

export interface VideoThumbnailProps {
  /**
   * 已经过取源收口点解析的**裸**可显示 src。
   * 本组件内部追 `#t=0.1`，调用方不要自己追（理由见文件头）。
   */
  src: string;
  /**
   * 视频的稳定身份 —— 本地封面缓存的键（与图片本地缓存同一把键）。
   * 不传 = 不启用封面持久化，行为与本功能落地前相同。
   */
  fileHash?: string | null;
  /** 落到 `<video>` 上的类名（各调用点的尺寸 / 裁切样式仍归各自的 CSS） */
  className?: string;
  /**
   * 首帧真的画出来时的回调 —— 气泡里的视频用它收起自己的「加载中」占位。
   * （`#t=0.1` 触发的 seek 完成后引擎会渲染那一帧并派发播放相关事件。）
   */
  onPlay?: React.ReactEventHandler<HTMLVideoElement>;
  /**
   * 纯装饰时置 true：外层容器已经带了可读的 `aria-label`（如查找结果的格子），
   * 再让读屏念一遍这个 `<video>` 只是噪音。
   */
  decorative?: boolean;
}

export function VideoThumbnail({
  src,
  fileHash,
  className,
  onPlay,
  decorative,
}: VideoThumbnailProps) {
  const { status, posterSrc } = useVideoPoster(fileHash, src);

  if (status === 'pending') {
    // 解析本地封面的那几毫秒：不渲染任何媒体元素（理由见文件头）
    return null;
  }

  if (status === 'poster' && posterSrc) {
    // 本地已有封面：与图片消息同一条显示通路（asset 协议），零解码、零网络
    return (
      <img
        className={className}
        src={posterSrc}
        alt=""
        aria-hidden={decorative ? true : undefined}
      />
    );
  }

  return (
    <video
      className={className}
      src={videoPosterSrc(src)}
      preload="metadata"
      muted
      playsInline
      aria-hidden={decorative ? true : undefined}
      onPlay={onPlay}
    />
  );
}
