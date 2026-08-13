/**
 * 会话内查找的单条命中项（列表行 / 九宫格方格）
 *
 * ## 两种版式，由分类决定（版式在 ConversationMessageSearch 里选）
 *
 * - `row`   —— 全部 / 文字 / 文件 / 群成员：缩略图或文件图标 + 发件人 / 时间 / 徽标 / 正文
 * - `cover` —— 图片 / 视频：正方形九宫格封面（`aspect-ratio: 1/1` + `object-fit: cover`），
 *              只有封面本身，没有文字块（这两个分类里每条都是媒体，没有正文可显示）
 *
 * ## 交互（左键 = 打开，右键 / 长按 = 定位菜单）
 *
 * - **左键单击 / 触摸**：图片开大图预览、视频直接播。桌面端走独立预览窗
 *   （`openMediaWindow`，与聊天气泡里的图片 / 视频同一条通路），移动端没有多窗口 ⇒
 *   全屏 `MobileMediaPreview`（同样是聊天气泡在用的那个组件）。
 *   文字 / 文件命中**没有**主操作 —— 它们唯一的动作是「定位」，已归到次级菜单。
 * - **右键 / 长按 / 键盘 Enter·Space**：弹「定位到聊天消息」单项菜单，
 *   见 ConversationSearchHitMenu（含为什么没复用 FileContextMenu）。
 *
 * 「点命中项即定位」的旧交互**已整体移除**，没有保留任何回退分支。
 *
 * ## 媒体取源的红线
 *
 * 🔴 显示 src **必须**来自 useFileCache（其内部 fileCache.getFileSource / getVideoSource
 * 已经过唯一收口点 resolveDisplayUrl 改写成回环反代 URL）。**不得**把消息行里的
 * `file_url` 裸喂给 `<img>/<video>` —— 私有 CA 自签 leaf 过不了 webview 的系统信任库，
 * 真机上会静默变成裂图（见 .claude/rules/frontend-test.md「所有 X 必经 Y」与
 * tests/secure-display-routing.test.ts）。反过来，递给**独立预览窗**的必须是原始
 * presigned URL（不是反代 src）：跨窗字符串里不该烘进回环端口，且预览窗自己要用它下载。
 *
 * `autoCache` 关掉、点开也**不**触发后台下载：浏览态一页可能几十个媒体，逐个落盘会把带宽
 * 和磁盘打满；真正要落盘的时机仍在消息气泡本身（FileMessageContent）。
 *
 * ## 为什么每条命中项是一个组件而不是父组件里的一段 JSX
 *
 * 媒体命中项各自持有一份 useFileCache（按 file_uuid 取源）、一份菜单状态机、一份预览开关，
 * 都是 hook —— 在父组件的 `items.map()` 里直接写 hook 是非法的。
 */

import { useCallback, useState } from 'react';
import { formatMessageTime } from '../../utils/time';
import { formatFileSize } from '../../utils/format';
import { isMobile } from '../../utils/platform';
import { useFileCache } from '../../hooks/useFileCache';
import { useSession } from '../../contexts/SessionContext';
import { openMediaWindow } from '../../media';
import { MobileMediaPreview } from '../../chat/shared/MobileMediaPreview';
import { VideoThumbnail } from '../../chat/shared/VideoThumbnail';
import { highlightMatch } from './highlightMatch';
import { contentTypeBadge, contentTypeToCategory } from './messageCategory';
import { ConversationSearchHitMenu, useSearchHitMenu } from './ConversationSearchHitMenu';
import type { LocalMessage } from '../../db';

/** 命中项版式：列表行 / 九宫格方格 */
export type SearchHitLayout = 'row' | 'cover';

interface ConversationSearchHitProps {
  message: LocalMessage;
  /** 已 trim 的关键词，用于正文高亮（空串 = 纯浏览，不高亮） */
  query: string;
  layout: SearchHitLayout;
  /** 次级菜单里「定位到聊天消息」的动作（写定位请求 + 收面板） */
  onLocate: (message: LocalMessage) => void;
}

/** 文档类结果的行首图标（与消息气泡里的文件图标同款） */
function DocumentIcon() {
  return (
    <svg
      className="conv-msg-search-thumb conv-msg-search-thumb--doc"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/** 视频封面上的播放标记（九宫格里靠它区分图片和视频） */
function CoverPlayBadge() {
  return (
    <span className="conv-msg-search-cover-play" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
        <polygon points="6 4 20 12 6 20 6 4" />
      </svg>
    </span>
  );
}

/** 行版式的文字块：发件人 / 时间 / 类型徽标 / 高亮正文 / 文件大小 */
function HitBody({ message, query }: { message: LocalMessage; query: string }) {
  const badge = contentTypeBadge(message.content_type);
  return (
    <div className="conv-msg-search-hit-body">
      <div className="conv-msg-search-hit-meta">
        <span className="conv-msg-search-hit-sender">
          {message.sender_name ?? message.sender_id}
        </span>
        <span className="conv-msg-search-hit-time">{formatMessageTime(message.send_time)}</span>
        {badge && <span className="conv-msg-search-hit-badge">{badge}</span>}
      </div>
      <div className="conv-msg-search-hit-content">{highlightMatch(message.content, query)}</div>
      {badge && message.file_size !== null && (
        <div className="conv-msg-search-hit-size">{formatFileSize(message.file_size)}</div>
      )}
    </div>
  );
}

/**
 * 图片 / 视频命中项：自带取源 + 打开预览
 */
function MediaHit({
  message,
  query,
  layout,
  onLocate,
  isVideo,
}: ConversationSearchHitProps & { isVideo: boolean }) {
  const { session } = useSession();
  const fileUuid = message.file_uuid ?? '';
  const urlType = message.conversation_type === 'group' ? 'group' : 'friend';

  const { src, isLocal, localPath, presignedUrl, openInFolder } = useFileCache({
    fileUuid,
    fileHash: message.file_hash,
    fileName: message.content,
    fileType: isVideo ? 'video' : 'image',
    // 本地库里群消息的 conversation_type 是 'group'，其余（好友 / bot）走 friend 域
    urlType,
    autoCache: false,
    enabled: !!fileUuid,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const { menuAnchor, closeMenu, triggerProps, guardPrimaryClick } = useSearchHitMenu();

  const openPreview = useCallback(() => {
    if (!src) {
      return;
    }
    if (isMobile()) {
      setPreviewOpen(true);
      return;
    }
    if (!session) {
      return;
    }
    openMediaWindow(
      {
        type: isVideo ? 'video' : 'image',
        fileUuid,
        filename: message.content,
        fileSize: message.file_size ?? undefined,
        fileHash: message.file_hash,
        urlType,
        localPath,
        // 递原始 presigned URL（不是反代 src）：跨窗字符串不烘回环端口，预览窗下载也要它
        presignedUrl: isLocal ? undefined : presignedUrl,
      },
      { serverUrl: session.serverUrl, accessToken: session.accessToken },
    );
  }, [
    src, session, isVideo, fileUuid, message.content, message.file_size, message.file_hash,
    urlType, localPath, isLocal, presignedUrl,
  ]);

  const mediaClass = layout === 'cover' ? 'conv-msg-search-cover' : 'conv-msg-search-thumb';
  let media: React.ReactNode;
  if (!src) {
    // 取源未完成 / 该消息没有 file_uuid（历史脏数据）：同尺寸占位，避免列表逐条抖动
    media = <div className={`${mediaClass} ${mediaClass}--empty`} aria-hidden="true" />;
  } else if (isVideo) {
    // 全仓唯一那处 <video> 封面（取源 / #t=0.1 / preload / muted / playsInline 全在组件里），
    // 详见 chat/shared/VideoThumbnail.tsx。递**裸** src —— 片段由组件内部追。
    // decorative：格子自己已带 aria-label（「视频 {文件名}」），读屏不必再念一遍。
    // fileHash 是本地封面缓存的键：递的是与聊天气泡（chat/shared/FileMessageContent.tsx）
    // **同一个** message.file_hash ⇒ 两处命中同一个封面文件、就是同一帧；也正是靠它，
    // 这里从「先黑再显示」变成「重开就立刻有画面」。
    media = (
      <VideoThumbnail
        src={src}
        fileHash={message.file_hash}
        className={mediaClass}
        decorative
      />
    );
  } else {
    media = <img className={mediaClass} src={src} alt="" loading="lazy" />;
  }

  const menu = menuAnchor && (
    <ConversationSearchHitMenu
      anchor={menuAnchor}
      onLocate={() => onLocate(message)}
      onClose={closeMenu}
    />
  );

  // 移动端全屏预览按需挂载：一页几十条结果，每条常驻一个 portal 不划算
  //
  // 🔴 它必须渲染在下面那个 <li> 的**外面**（见 return 处）：createPortal 只搬 DOM，
  // React 合成事件仍沿 **React 树**冒泡 —— 挂在 <li> 里面时，预览里点 ✕ 触发 onClose 后
  // 会继续冒泡到 <li> 的 onClick 再 openPreview 一次，预览关不掉。
  // （FileMessageContent 里的同款预览一直就渲染在可点击容器之外，是被验证过的写法。）
  //
  // src 是**裸**的显示 src，不是 videoPosterSrc(src)：那个 #t=0.1 只给缩略图，
  // 加到播放器上会让视频从 0.1s 开始播。
  const mobilePreview = previewOpen && src && (
    <MobileMediaPreview
      isOpen={previewOpen}
      type={isVideo ? 'video' : 'image'}
      src={src}
      filename={message.content}
      localPath={localPath}
      onClose={() => setPreviewOpen(false)}
      onOpenWith={localPath ? () => openInFolder(localPath) : undefined}
    />
  );

  // mobilePreview 是 <li> 的**兄弟**（不是子节点），理由见它的定义处。
  // 它本身是 portal，不给 <ul> 添任何 DOM 子节点，所以 <ul> 的直接子节点仍只有 <li>。
  // 反观 {menu}：ConversationSearchHitMenu 在自己的根节点上 stopPropagation 掉了
  // click / contextMenu / keyDown / touchStart，是事件的封闭边界，留在 <li> 内无碍。
  if (layout === 'cover') {
    return (
      <>
        <li
          className="conv-msg-search-cell"
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-label={`${isVideo ? '视频' : '图片'} ${message.content}`}
          onClick={guardPrimaryClick(openPreview)}
          {...triggerProps}
        >
          {media}
          {isVideo && <CoverPlayBadge />}
          {menu}
        </li>
        {mobilePreview}
      </>
    );
  }

  return (
    <>
      <li
        className="conv-msg-search-hit"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        onClick={guardPrimaryClick(openPreview)}
        {...triggerProps}
      >
        {media}
        <HitBody message={message} query={query} />
        {menu}
      </li>
      {mobilePreview}
    </>
  );
}

/**
 * 文字 / 文件命中项：只有次级菜单（没有可「打开」的东西）
 */
function PlainHit({
  message,
  query,
  onLocate,
  isFile,
}: ConversationSearchHitProps & { isFile: boolean }) {
  const { menuAnchor, closeMenu, triggerProps } = useSearchHitMenu();

  return (
    <li
      className="conv-msg-search-hit"
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      {...triggerProps}
    >
      {isFile && <DocumentIcon />}
      <HitBody message={message} query={query} />
      {menuAnchor && (
        <ConversationSearchHitMenu
          anchor={menuAnchor}
          onLocate={() => onLocate(message)}
          onClose={closeMenu}
        />
      )}
    </li>
  );
}

export function ConversationSearchHit(props: ConversationSearchHitProps) {
  const kind = contentTypeToCategory(props.message.content_type);
  if (kind === 'image' || kind === 'video') {
    return <MediaHit {...props} isVideo={kind === 'video'} />;
  }
  // 文字 / 文件只出现在行版式（图片、视频两个分类的 SQL 过滤保证格子里全是媒体）
  return <PlainHit {...props} isFile={kind === 'file'} />;
}
