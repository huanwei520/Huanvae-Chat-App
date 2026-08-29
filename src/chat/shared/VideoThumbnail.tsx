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
 * ## 🔴 src 必须是**裸**的可显示 src，而且**允许还没解析出来**
 *
 * 调用方传进来的 `src` 要是取源收口点解析出来的裸地址（本地媒体服务器 URL 或回环反代 URL），
 * `#t=0.1` 由本组件内部追加。**别在调用方先追一次**：同一个 src 变量通常还会被递给全屏播放器，
 * 带上片段会让视频从 0.1 秒开始播（见 videoPosterSrc.ts「只能在元素层用」）。
 *
 * 🔴 **取源还没完成时把 `null` 递进来，不要等** —— 见下一节。
 *
 * ## 封面本地持久化：给得出封面键（`fileUuid` 或 `fileHash`）就走本地图片，不再建 `<video>`
 *
 * 上面那套「靠引擎 seek 出首帧」的机制有个结构性代价：**那一帧只活在这个 `<video>` 元素里**，
 * 元素一销毁就没了 —— 切回会话、进「查找记录 → 视频」、杀掉 App 重开，每次都要重拉元数据 +
 * seek + 解码，用户看到的就是「先黑再显示 / 每次都重新加载」。
 *
 * 拿得到封面键后，本组件改由 `useVideoPoster` 驱动：
 * - 本地已存过封面 ⇒ 渲染 `<img>`（与图片消息**完全同一条**显示通路），`<video>` 连建都不建；
 * - 没存过 ⇒ 照旧渲染 `<video>`（用户立刻有画面），同时在离屏元素上截一帧落盘，
 *   落好后当场切成 `<img>`，此后永久走本地；
 * - 正在问「有没有存过」的那几毫秒 ⇒ 渲染一个**同尺寸的空占位**（见下一节）。
 *   这几毫秒里**不能**先渲染 `<video>`：一屏几十个格子会各开一次元数据拉取，
 *   恰是本功能要消灭的成本，理由见 useVideoPoster.ts。
 *
 * ## 🔴 封面**不等取源** —— `src` 为空时本组件照样出封面
 *
 * 「首帧本地存下来、之后不再从云端取」这条要求，只有本组件先出得来封面才算数。
 * 而 `src` 是**取源**的产物：视频没下载到本地时，取源要先解一次 `file_uuid → 内容哈希`、
 * 再向服务端要一把预签名 URL —— 那是一次**云端往返**。
 * 若调用方按老写法「等 `src` 出来了才挂载本组件」，本地那张封面就被压在这次往返**之后**，
 * 用户看到的仍旧是「先黑（等取源）→ 再显示」，与没做这个功能几乎无差别。
 *
 * 所以本组件的 `src` 声明成可空，三条分支按**能不能出画面**排序，而不是按取源进度排序：
 * 1. 本地有封面 ⇒ 立刻 `<img>`（**与 `src` 无关**，取源还在飞也照出）；
 * 2. 还在问本地 / 或取源还没给出 `src` ⇒ 同尺寸占位（可由 {@link VideoThumbnailProps.placeholder}
 *    换成调用方自己的「加载中 / 加载失败」）；
 * 3. 本地没有且 `src` 已就绪 ⇒ `<video>` 现 seek 首帧，并在后台截一帧落盘。
 *
 * ⚠️ 调用方因此**必须无条件挂载本组件**，不要再写 `{src && <VideoThumbnail …/>}` ——
 * 那一行就是把封面重新压回云端往返之后。
 *
 * ## pending 期渲染同尺寸占位，而不是 `return null`
 *
 * 原实现在 pending 分支 `return null` —— 媒体元素**整个从 DOM 里消失**那几毫秒。
 * 最明显的一帧是**上传完成的切换**：在途气泡走的是拿不到封面键的分支（同步 `capture`，
 * 画面一直在），换成完成态那一刻有了键 ⇒ 进 pending ⇒ 画面先没了再回来。
 *
 * 占位的**尺寸必须与两个完成态同源**，否则「空一下」就换成了「跳一下」，等于没修：
 * 本组件三条分支（占位 / `<img>` / `<video>`）都只戴调用方给的同一个 `className`，
 * 而各调用点的容器尺寸本来就由 `FileMessageContent.calculateDisplaySize` 一处算出
 * （气泡）或由格子的 `aspect-ratio` 决定（九宫格 / 我的文件）——
 * 占位再补一条 `width/height: 100%` 的行内样式，让**没传 className 的调用点**
 * （FilesModal / MobileFilesPage：它们的 CSS 用 `video` / `img` 元素选择器定尺寸，
 * 选不到 `<div>`）也拿到与 `<video>` 完全相同的盒子。
 *
 * ⚠️ 它只保证**盒子**同形，不保证**像素**连续：这几毫秒里画面仍是容器底色。
 * 要让画面也连续得让 pending 期就有媒体元素，而那正是本组件刻意消灭的成本。
 * 这一帧的视觉结论只能靠真机录屏（jsdom 无布局引擎，见 .claude/rules/frontend-test.md）。
 *
 * 两个键都不传的调用点行为与此前**逐字节相同**（恒走 `<video>` 分支）。
 *
 * ⚠️ `onPlay` 只在 `<video>` 分支上有意义 —— 走本地封面时没有媒体元素，自然不会有播放事件。
 * 气泡那处靠它触发的后台缓存另有点击入口（`FileMessageContent` 的 `handleClick`），不受影响。
 */

import { videoPosterSrc } from './videoPosterSrc';
import { useVideoPoster } from './useVideoPoster';

export interface VideoThumbnailProps {
  /**
   * 已经过取源收口点解析的**裸**可显示 src；取源还没完成时递 `null`。
   * 本组件内部追 `#t=0.1`，调用方不要自己追（理由见文件头）。
   *
   * 🔴 **不要等它非空再挂载本组件** —— 本地封面不依赖它（文件头「封面不等取源」）。
   */
  src: string | null;
  /**
   * 文件 UUID —— **消息面**的封面键（气泡 / 相册 / 查找命中传它）。
   *
   * 🔴 2026-08-16 两层键：后端接收面已不再下发 `file_hash`，而封面要在**下载之前**就出得来
   * （内容哈希是下载完才自算的）。所以消息面改用下载前就有的 `file_uuid` 当键。
   * 口径见 services/videoPoster.ts 模块头。
   */
  fileUuid?: string | null;
  /**
   * 已知的内容哈希 —— **个人文件面**的封面键（`GET /api/storage/files` 仍下发它）。
   *
   * 两者都不传 = 不启用封面持久化，行为与本功能落地前相同。
   * 两者都有时以 `fileHash` 优先（与该来源既有的落盘封面继续命中，不必重截）。
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
  /**
   * 「还没有画面可显示」那一段要放的东西（调用方自己的「加载中 / 加载失败」占位）。
   *
   * 它**只在没有本地封面时**出现 —— 所以有封面时它永远盖不住封面，这正是把调用方原先
   * 那套 loading / error 分支搬进来的理由：留在调用方就必须写成 `{loading ? …: src && …}`，
   * 而那种写法会把封面一起挡在取源之后。
   *
   * 🔴 传进来的节点必须**自己撑满父容器**（`width/height: 100%` 或等价的 CSS）：
   * 三条分支的盒子同形是「不闪不跳」的前提。不传则用本组件的同尺寸空占位。
   */
  placeholder?: React.ReactNode;
}

export function VideoThumbnail({
  src,
  fileUuid,
  fileHash,
  className,
  onPlay,
  decorative,
  placeholder,
}: VideoThumbnailProps) {
  // 封面键：个人文件面有服务端下发的哈希就用它（老封面继续命中），消息面用 file_uuid
  const { status, posterSrc } = useVideoPoster(fileHash || fileUuid, src);

  // 🔴 命中分支排在最前，而且**不看 src**：这一条就是「本地存过就别再等云端」。
  // 本地已有封面 ⇒ 与图片消息同一条显示通路（asset 协议），零解码、零网络。
  if (status === 'poster' && posterSrc) {
    return (
      <img
        className={className}
        src={posterSrc}
        alt=""
        aria-hidden={decorative ? true : undefined}
      />
    );
  }

  // 还没有画面可显示，两种原因合流到同一条分支（对用户是同一件事：这一格暂时是空的）：
  //   pending —— 正在问 Rust「本地有没有存过」（本地 IPC，毫秒级）
  //   nosrc   —— 取源还没给出 src；没有 src 就建不了 <video>，只能等
  // 不建媒体元素但把盒子占住 —— 尺寸与上下两条分支同源（同一个 className + 填满父容器），
  // 理由见文件头「pending 期渲染同尺寸占位」。
  if (status === 'pending' || !src) {
    if (placeholder !== null && placeholder !== undefined) {
      return <>{placeholder}</>;
    }
    return (
      <div
        className={className}
        style={{ width: '100%', height: '100%' }}
        aria-hidden
        data-video-poster-placeholder={status === 'pending' ? 'pending' : 'nosrc'}
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
