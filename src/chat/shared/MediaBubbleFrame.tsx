/**
 * 媒体 + 配文的**同一个大气泡**（Telegram 式 media + caption）
 *
 * @module chat/shared
 * @location src/chat/shared/MediaBubbleFrame.tsx
 *
 * 相册 / 单图 / 单视频 三种形态共用这一个渲染层包裹：统一圆角、统一背景，
 * 媒体贴着气泡上沿（媒体不留内边距），配文在媒体下方、有正常内边距。
 * 左右两侧（自己发 / 对方发）的底色由 `.message-bubble.own|.other` 后代选择器给，
 * 见 src/styles/components/media-bubble.css。
 *
 * ## 四条硬约束
 *
 * 1. **无配文且不递 `meta` 时不产生任何多余节点** —— 直接把 children 原样吐回去。
 *    Telegram 惯例：纯媒体只有媒体自身的圆角，不额外套一层背景框。
 *    ⚠️ 2026-08-14 起多一条例外：递了 `meta`（时间戳要落进气泡内）时，纯媒体也要套一层
 *    **定位容器** `.media-bubble-bare`，否则时间戳药丸没有定位参照系。这一层不画任何背景、
 *    不改圆角、宽度贴着媒体本身（`width: fit-content`），视觉上仍是「只有媒体自身的圆角」。
 *
 * 2. **这是渲染层的视觉包裹，不改消息结构** —— 给单图/单视频套气泡只是套样式；
 *    绝不把单条塞进 media_group。相册折叠会抹掉组内非代表成员的 DOM 锚点
 *    （见 AlbumMessage.tsx 的 `.album-cell` 注释），那正是「定位报『原消息不在本地记录中』」
 *    的根因，单条一旦被折叠就会踩同一个坑。
 *
 * 3. **配文判定只有这一个收口点**（`resolveMediaCaption`）—— 调用方一律递**原始正文**，
 *    不要各自判一遍。多一处判定就多一处会漂的规则。
 *
 * 4. **媒体形态由调用方声明**（`media`）—— 单媒体与相册的媒体区尺寸规则不同，而本组件
 *    看不出 children 是一格图还是一整个网格。单媒体多出一层 `.media-bubble-media`
 *    媒体带（撑满气泡宽 + 图居中 + 余下补黑，见下方 MediaBubbleFrame 注释）；
 *    相册的 children 原样放（网格自己排布），DOM 与改这条之前逐字节相同。
 */

import type { ReactNode } from 'react';

/**
 * 后端「文件名派生正文」形态：`[图片] foo.jpg` / `[视频] a.mp4` / `[文件] b.pdf`。
 *
 * 契约（backend-docs/storage/文件存储管理.md）：`caption` **取代**该条由文件名派生的正文。
 * ⇒ 带这个前缀 = 没给配文；不带 = 正文本身就是配文。
 */
const FILENAME_DERIVED_CONTENT = /^\[(图片|视频|文件)\]\s/;

/**
 * 从媒体消息正文里解出配文；没有配文时返回 null。
 *
 * 相册取组首项（index=0）的正文，单条取自己的正文 —— 两者在后端是同一个字段、同一条规则
 * （backend-docs/messages/好友消息.md 表 6：不成组的单条媒体消息也可以带 caption）。
 *
 * ## 只有一条规则（曾经有第二条「裸文件名不算配文」的兜底，已删）
 *
 * 那条兜底当初存在的唯一理由是**上游写坏了**：本地乐观副本写的是裸 `file.name`，
 * 少了后端 `resolve_content` 的 `[图片] ` 前缀 —— 于是「自己看到的正文」与「对方看到的」
 * 形状不同，只按前缀判会把自己发的每张图的文件名当配文显示出来。
 *
 * 上游现在已经修好：本地落库统一走 `chat/shared/uploadPersist.ts` 的
 * `resolveUploadedContent`，无配文时写的就是 `[图片] / [视频] / [文件] + 文件名`，
 * 与后端逐字同口径。⇒ 兜底失去存在理由，必须删掉，因为**它有真实代价**：
 * 一条恰好长得像文件名的**真配文**（例 `notes.txt`）会被整条漏显。
 */
export function resolveMediaCaption(content: string | null | undefined): string | null {
  const text = content?.trim();
  if (!text) { return null; }
  if (FILENAME_DERIVED_CONTENT.test(text)) { return null; }
  return text;
}

/**
 * 单条消息里哪些类型可以带配文进大气泡：只有图片与视频。
 *
 * 文档（file）不进：它自带白底卡片 `.document-message`，再套一层气泡就是两层背景叠着；
 * 而且 huanwei 给的适用范围就是「相册 + 文字 / 单图 + 文字 / 单视频 + 文字」三种。
 */
export function isCaptionableMediaType(messageType: string): boolean {
  return messageType === 'image' || messageType === 'video';
}

interface MediaBubbleFrameProps {
  /**
   * 媒体消息的**原始正文**（相册递组首项正文 / 单条递本条正文）。
   * 是不是配文由 `resolveMediaCaption` 判，调用方不要自己判。
   */
  content: string | null | undefined;
  /**
   * 媒体形态：`single` 单图 / 单视频，`album` 相册网格。
   *
   * 本组件看不出 children 是一格图还是一整个网格，而两者的媒体区尺寸规则不同 ——
   * 单媒体要「媒体区与配文严格同宽」（见下方组件注释），相册的宽度归网格自己。
   * 所以由调用方声明，不猜。
   */
  media: 'single' | 'album';
  /**
   * 时间戳 + 已读状态槽（`.bubble-meta`）。递了就落进**气泡内部**：
   * 有配文 ⇒ 内联在配文末尾右下（与文本气泡同一套 flex 布局）；
   * 无配文 ⇒ 媒体右下角的半透明深色药丸浮层（Telegram 同款）。
   * 不递（文档 / 会议邀请 / 卡片那几类）⇒ 由调用方自己摆在气泡下方，本组件不管。
   */
  meta?: ReactNode;
  /**
   * 群聊发送者昵称（`.bubble-sender-name`）。递了就落进**气泡内部**，与 `meta` 对称：
   * 有配文 ⇒ 大气泡内顶部、媒体之上；无配文 ⇒ 媒体**左上角**的半透明药丸浮层
   * （时间戳药丸在右下角，两者不会撞）。
   * 不递（私聊 / 自己的消息 / 组内非最上面那条 / 文档卡片）⇒ 本组件当它不存在。
   */
  senderName?: ReactNode;
  /** 媒体本体：相册网格 或 单条的 FileMessageContent */
  children: ReactNode;
}

/**
 * ## 单媒体那一路多出一层 `.media-bubble-media` 媒体带（huanwei 2026-08-13 04:32）
 *
 * 他的原话：「这个图片单张图我需要它的宽度和文字一致，塞不满的让其以黑色背景显示图片
 * 居中，不要出现图只有文字一半的情况，要全部对齐」。
 *
 * 缺陷的形状：单媒体容器的宽高由 `FileMessageContent.calculateDisplaySize` 内联写死
 * （先卡宽 280、再卡高 300，卡高那一步会把宽度按比例缩回去）⇒ 任何宽高比 < 280/300
 * 的竖图宽度都 < 280；而长配文会把气泡撑到 280 上限 ⇒ 9:16 竖图只有 169px，
 * 旁边空出 111px，媒体与文字左右边缘对不齐。内联宽度是**确定值**，在 flex 列里
 * 不会被 stretch 拉宽，所以只改 CSS 拉不动它。
 *
 * 修法不是去动那个内联尺寸（它同时是「加载完不跳版」的依据，列表是 column-reverse，
 * 任何高度跳变都会把阅读位置推走），而是**在它外面套一条媒体带**：
 * 带子撑满气泡宽（`.media-bubble--single` 把气泡钉到上限），媒体在带内水平居中，
 * 带子自己是黑底 ⇒ 图没填满的部分就是黑的。图一个像素都没被裁（`object-fit: contain`
 * 原样保留，M-1 硬判据）。
 *
 * 黑底为什么落在带子上、不落在气泡框上：对方那侧的配文底色是**半透明**白
 * （`--white-alpha-70`），涂黑气泡框会从它底下透出来、把配文条压成深灰。
 */
export function MediaBubbleFrame({ content, media, meta, senderName, children }: MediaBubbleFrameProps) {
  const caption = resolveMediaCaption(content);

  // 无配文：媒体自身圆角即可，一个多余节点都不产生
  if (!caption) {
    // 但时间戳 / 昵称要落进气泡内时，得有个定位参照系 —— 只加一层不画背景的定位壳
    if (meta || senderName) {
      return (
        <div className="media-bubble-bare" data-testid="media-bubble-bare">
          {children}
          {senderName}
          {meta}
        </div>
      );
    }
    return <>{children}</>;
  }

  return (
    <div
      className={media === 'single' ? 'media-bubble media-bubble--single' : 'media-bubble'}
      data-testid="media-bubble"
    >
      {/* 昵称在媒体之上、气泡之内（telegram 参照图的形态）；它自己带内边距，
          媒体仍然贴着气泡上沿 —— 只有在真有昵称时才占一行。 */}
      {senderName}
      {media === 'single'
        ? (
          <div className="media-bubble-media" data-testid="media-bubble-media">
            {children}
          </div>
        )
        : children}
      {/* 配文条：时间戳内联在文末右下（与 .bubble-text 同一套 flex 布局，见 chat-bubble-meta.css） */}
      <div className={meta ? 'media-bubble-caption bubble-metafoot' : 'media-bubble-caption'}>
        <div className="bubble-metafoot-body">{caption}</div>
        {meta}
      </div>
    </div>
  );
}
