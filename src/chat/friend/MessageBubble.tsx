/**
 * 私聊消息气泡组件
 *
 * @module chat/friend
 * @location src/chat/friend/MessageBubble.tsx
 *
 * 功能：
 * - 类似 Telegram 的入场动画（从侧边滑入 + 从下往上 + 淡入）
 * - 退出动画（反方向滑出）
 * - 右键菜单（桌面端右键/移动端长按触发：复制、撤回、删除、多选）
 * - 多选模式选中效果
 * - 点击头像查看对方公开资料（只读资料页）
 * - 移动端双击全屏预览（仅文本消息）
 * - 文本消息使用 MarkdownRenderer 渲染（支持 GFM、代码高亮）
 *
 * 动画机制：
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 撤回/删除：反方向播放退出动画
 * - 使用 layout="position" 处理位置变化（发送完成后自动平滑移动）
 */

import { useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { UserAvatar, FriendAvatar, type SessionInfo } from '../../components/common/Avatar';
import { formatMessageTime } from '../../utils/time';
import { friendDisplayName } from '../../utils/friendName';
import { MessageContextMenu } from '../shared/MessageContextMenu';
import { ReplyQuote } from '../shared/ReplyQuote';
import { AlbumMessage, type AlbumMediaItem } from '../shared/AlbumMessage';
import type { AlbumNode } from '../shared/mediaGroup';
import type { ResolvedReplyQuote } from '../shared/replyPreview';
import { FileMessageContent } from '../shared/FileMessageContent';
import { MeetingInviteCard } from '../shared/MeetingInviteCard';
import { CardRenderer } from '../shared/CardRenderer';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import { FailedIcon } from '../shared/ReadReceiptIcons';
import { MobileMessageFullPreview } from '../shared/MobileMessageFullPreview';
import { useFileCache } from '../../hooks/useFileCache';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import { isMobile } from '../../utils/platform';
import { useProfileViewStore } from '../../stores';
import { saveToGallery } from '../../utils/saveToGallery';
import type { Friend, Message } from '../../types/chat';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  session: SessionInfo & { userId: string };
  friend: Friend;
  /** 是否处于多选模式 */
  isMultiSelectMode?: boolean;
  /** 是否被选中 */
  isSelected?: boolean;
  /** 选中/取消选中回调 */
  onToggleSelect?: () => void;
  /** 撤回消息回调 */
  onRecall?: () => void;
  /** 删除消息回调 */
  onDelete?: () => void;
  /** 进入多选模式回调 */
  onEnterMultiSelect?: () => void;
  /** 已读回执：仅**我发出的最新一条**已送达消息传入 isRead（对方是否已读）；更早的自己消息 /
   *  对方消息 / 发送中 / 失败 / 已撤回都不传（门控在 ChatMessages，见 shared/readReceiptGate）。
   *  不传 ⇒ 不渲染已读态；isRead=false 同样不渲染（见 PrivateReadReceipt）。 */
  readReceipt?: { isRead: boolean };
  /** 被引用原消息的解析结果；非回复消息为 null（不渲染引用块） */
  replyQuote?: ResolvedReplyQuote | null;
  /** 点击引用块 → 定位到原消息 */
  onQuoteClick?: (targetUuid: string) => void;
  /** 把本条设为回复目标（列表层不给则「回复」菜单项不出现） */
  onReply?: (message: Message) => void;
  /** 是否为定位高亮目标（引用块/搜索跳转后短暂高亮） */
  isHighlighted?: boolean;
  /**
   * 相册（媒体组）：非空时气泡正文渲染整个相册网格，而不是本条自己的媒体。
   * 此时 `message` 是该组的**代表消息**（组内最小位次那条），头像 / 时间 / 已读回执 /
   * 右键菜单都以它为准 —— 后端保证整组同时撤回，故 is_recalled 用代表消息的即可。
   */
  album?: AlbumNode<AlbumMediaItem> | null;
  /** 是否播放入场滑入动画：仅"挂载后新增"的实时新消息为 true（由列表用 shouldPlayEnter 判定）；
   *  切换/打开时已有的历史为 false → 不并拢，整体走面板渐变。 */
  playEnter?: boolean;
}

// 私聊已读回执（仅自己消息，统一状态槽：时钟/灰双勾/绿双勾/红叹号）
import { PrivateReadReceipt } from '../shared/PrivateReadReceipt';

// 使用统一的消息动画配置
import { getMessageVariants, messageTransition } from '../shared/animations';

// 重命名为 transition 以保持兼容
const transition = messageTransition;

/**
 * 检查消息是否可以撤回
 * - 必须是自己发送的消息
 * - 发送时间在 2 分钟内
 */
function canRecallMessage(message: Message, isOwn: boolean): boolean {
  if (message.is_recalled) { return false; }
  if (!isOwn) { return false; }

  const sendTime = new Date(message.send_time).getTime();
  const now = Date.now();
  const twoMinutes = 2 * 60 * 1000;

  return now - sendTime < twoMinutes;
}

export function MessageBubble({
  message,
  isOwn,
  session,
  friend,
  isMultiSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  readReceipt,
  replyQuote,
  onQuoteClick,
  onReply,
  isHighlighted = false,
  album,
  playEnter = false,
}: MessageBubbleProps) {
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    bubbleRect?: DOMRect | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    bubbleRect: null,
  });

  // 气泡元素 ref（用于移动端菜单定位）
  const bubbleRef = useRef<HTMLDivElement>(null);

  // 本地文件路径（用于"在文件夹中显示"功能）
  //
  // 通过 useFileCache 拿 localPath（订阅 store）而非自己 useState + 一次性 useEffect，
  // 是因为：右上角 LocalBadge 用 useFileCache 拿 isLocal 已经订阅了 store；如果这里
  // 用一次性 getCachedFilePath，下载完成后 store 更新但本地 state 不刷新 → 右键菜单
  // 的"在文件夹中显示"按钮取决于 localPath 是否非空 → 看不到（需切换会话才生效）。
  // 改用 useFileCache 后两者共用同一数据源，下载完成即时刷新。
  const isFileMessage = message.message_type !== 'text' && !!message.file_uuid;
  const fileCacheType = (() => {
    if (message.message_type === 'image') {
      return 'image';
    }
    if (message.message_type === 'video') {
      return 'video';
    }
    return 'document';
  })();
  const { localPath } = useFileCache({
    fileUuid: message.file_uuid ?? '',
    fileHash: message.file_hash,
    fileName: '',
    fileType: fileCacheType,
    urlType: 'friend',
    friendId: friend.friend_id,
    autoCache: false,
    enabled: isFileMessage,
  });

  // 移动端全屏预览状态
  const [showFullPreview, setShowFullPreview] = useState(false);
  // 双击检测
  const lastTapTimeRef = useRef<number>(0);

  // 打开公开资料只读页（点头像统一走资料页，桌面/移动一致）
  const openProfileView = useProfileViewStore((s) => s.open);
  // 头像键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const avatarKbd = useKbdFocusRing();
  const avatarKbdHandlers = avatarKbd.handlersFor('avatar');

  // 头像激活语义（鼠标单击与键盘 Enter/Space 共用）：多选切换选中，否则看资料
  const activateAvatar = useCallback(() => {
    if (isMultiSelectMode) {
      onToggleSelect?.();
      return;
    }
    openProfileView(isOwn ? session.userId : friend.friend_id);
  }, [isMultiSelectMode, onToggleSelect, isOwn, session.userId, friend.friend_id, openProfileView]);

  // 点击头像查看对方（或自己）的公开资料只读页
  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    activateAvatar();
  }, [activateAvatar]);

  // 长按计时器（移动端用）
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 右键打开菜单（桌面端）
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isMultiSelectMode) { return; } // 多选模式下不显示右键菜单

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, [isMultiSelectMode]);

  // 长按开始（移动端）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile() || isMultiSelectMode) { return; }

    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    // 500ms 长按触发菜单
    longPressTimerRef.current = setTimeout(() => {
      if (touchStartPosRef.current) {
        // 获取气泡元素的位置
        const rect = bubbleRef.current?.getBoundingClientRect() || null;

        setContextMenu({
          isOpen: true,
          position: { x: touchStartPosRef.current.x, y: touchStartPosRef.current.y },
          bubbleRect: rect,
        });
      }
    }, 500);
  }, [isMultiSelectMode]);

  // 长按取消（手指移动或抬起）
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  const handleTouchMove = useCallback(() => {
    // 手指移动时取消长按
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // 点击消息（多选模式下切换选中状态，移动端双击显示全屏预览）
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isMultiSelectMode && onToggleSelect) {
      e.stopPropagation(); // 阻止冒泡到 message-row，避免重复触发
      onToggleSelect();
      return;
    }

    // 移动端双击检测（仅文本消息）
    if (isMobile() && message.message_type === 'text') {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // 双击触发全屏预览
        setShowFullPreview(true);
        lastTapTimeRef.current = 0; // 重置，避免连续触发
      } else {
        lastTapTimeRef.current = now;
      }
    }
  }, [isMultiSelectMode, onToggleSelect, message.message_type]);

  // 关闭菜单
  const handleCloseMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // 处理撤回
  const handleRecall = useCallback(() => {
    onRecall?.();
  }, [onRecall]);

  // 处理删除
  const handleDelete = useCallback(() => {
    onDelete?.();
  }, [onDelete]);

  // 进入多选模式
  const handleEnterMultiSelect = useCallback(() => {
    onEnterMultiSelect?.();
    onToggleSelect?.(); // 同时选中当前消息
  }, [onEnterMultiSelect, onToggleSelect]);

  // 设为回复目标
  const handleReply = useCallback(() => {
    onReply?.(message);
  }, [onReply, message]);

  // 点击引用块 → 定位到原消息
  const handleQuoteClick = useCallback(() => {
    if (message.reply_to) {
      onQuoteClick?.(message.reply_to);
    }
  }, [onQuoteClick, message.reply_to]);

  // 「回复」菜单项的显示条件（与群聊同口径）：
  // - 需要列表层给了 onReply
  // - 发送中/失败的消息还没有服务端 UUID，拿它当 reply_to 发出去后端会 400
  const canReply = !!onReply
    && message.sendStatus !== 'sending'
    && message.sendStatus !== 'failed';

  // 保存到相册（移动端）
  const handleSaveToGallery = useCallback(async () => {
    if (!localPath) { return; }
    const fileType = message.message_type === 'image' ? 'image' : 'video';
    const result = await saveToGallery(localPath, fileType);
    if (result.success) {
      console.warn('[MessageBubble] 保存成功:', result.savedPath);
    } else {
      console.error('[MessageBubble] 保存失败:', result.message);
    }
  }, [localPath, message.message_type]);

  // 获取文件类型（用于右键菜单）
  const getFileType = useCallback((): 'image' | 'video' | 'file' | null => {
    switch (message.message_type) {
      case 'image': return 'image';
      case 'video': return 'video';
      case 'file': return 'file';
      default: return null;
    }
  }, [message.message_type]);

  // 多选模式下的行点击处理
  const handleRowClick = useCallback((e: React.MouseEvent) => {
    // 只在多选模式下处理
    if (!isMultiSelectMode) { return; }
    // 阻止事件冒泡
    e.stopPropagation();
    onToggleSelect?.();
  }, [isMultiSelectMode, onToggleSelect]);

  // 撤回切换动画：普通气泡 / 撤回胶囊作为 AnimatePresence 的两个 sibling motion.div
  // - 切换时（is_recalled false → true）：
  //     旧 motion.div(key="bubble") unmount → 触发 getMessageVariants(isOwn).exit
  //         （own 向右 / other 向左 + 下移 + 缩小 + 淡出）
  //     新 motion.div(key="recall") mount → initial { y: 16, opacity: 0 } → animate { y: 0, opacity: 1 }
  //         （从对应位置下方 16px 向上渐入）
  // - mode="popLayout" 让退场和入场可叠加，layout 平滑
  // - initial={false} 让 reload / 首次 mount 时不重播入场动画（与列表用 playEnter/shouldPlayEnter 仅给"挂载后新增"消息播入场的语义一致）
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        {message.is_recalled ? (
          <motion.div
            key="recall"
            className="recall-system-row"
            layout="position"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="recall-system-bubble recalled-message">
              <span className="recall-system-text">消息已撤回</span>
              <span className="recall-system-time">{formatMessageTime(message.send_time)}</span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="bubble"
            className={`message-row ${isOwn ? 'own' : 'other'} ${isMultiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''}`}
            data-message-uuid={message.message_uuid}
            onClick={handleRowClick}
            // 只有发送中的消息才启用 layout 动画，避免切换会话时从顶部掉落
            layout={message.sendStatus === 'sending' ? 'position' : false}
            variants={getMessageVariants(isOwn)}
            // 仅"挂载后新增"的实时新消息才演入场（playEnter 由列表用 shouldPlayEnter 判定）；
            // 切换/打开会话时已有的历史 initial=false → 不并拢，整体走面板渐变。
            initial={playEnter ? 'initial' : false}
            animate="animate"
            exit="exit"
            transition={transition}
          >
            {/* 多选模式下的选择指示器 */}
            {isMultiSelectMode && (
              <motion.div
                className="select-indicator"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div className={`select-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && (
                    <motion.svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width={14}
                      height={14}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.15 }}
                    >
                      <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.739a.75.75 0 011.04-.208z" clipRule="evenodd" />
                    </motion.svg>
                  )}
                </div>
              </motion.div>
            )}

            <div
              ref={bubbleRef}
              className={`message-bubble ${isOwn ? 'own' : 'other'} ${message.sendStatus === 'sending' ? 'sending' : ''} ${message.sendStatus === 'failed' ? 'send-failed' : ''}${isHighlighted ? ' message-bubble--highlight' : ''}`}
              onContextMenu={handleContextMenu}
              onClick={handleClick}
              // 移动端长按触发菜单
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              <div
                className={`bubble-avatar clickable${avatarKbd.isKbdFocused('avatar') ? ' a11y-kbd-focus' : ''}`}
                onClick={handleAvatarClick}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') { return; }
                  // 键盘=单击语义，与 handleAvatarClick 共用 activateAvatar
                  e.preventDefault();
                  e.stopPropagation();
                  activateAvatar();
                }}
                role="button"
                tabIndex={0}
                aria-label={isOwn ? '查看我的资料' : `查看${friendDisplayName(friend)}资料`}
                onPointerDown={avatarKbdHandlers.onPointerDown}
                onFocus={avatarKbdHandlers.onFocus}
                onBlur={avatarKbdHandlers.onBlur}
              >
                {isOwn ? <UserAvatar session={session} /> : <FriendAvatar friend={friend} />}
              </div>
              <div className="bubble-content">
                {/* 被引用的原消息（Telegram 风格引用块，点击定位）。
                    私聊 reply_to 自 migration 036 起后端支持，与群聊共用同一套 shared/replyPreview。 */}
                {replyQuote && (
                  <ReplyQuote
                    senderName={replyQuote.senderName}
                    text={replyQuote.text}
                    resolved={replyQuote.resolved}
                    onClick={handleQuoteClick}
                  />
                )}
                {album ? (
                  // 相册：整组渲染成一个网格，本条自己的媒体不再单独出现
                  <AlbumMessage album={album} urlType="friend" friendId={friend.friend_id} />
                ) : (
                  <>
                    {message.message_type === 'text' && (
                      <div className="bubble-text">
                        <MarkdownRenderer content={message.message_content} />
                      </div>
                    )}
                    {message.message_type === 'meeting_invite' && (
                      <MeetingInviteCard messageContent={message.message_content} />
                    )}
                    {message.message_type === 'card' && (
                      <CardRenderer
                        messageContent={message.message_content}
                        messageUuid={message.message_uuid}
                        messageRev={message.rev}
                        sourceType="friend"
                      />
                    )}
                    {message.message_type !== 'text' && message.message_type !== 'meeting_invite' && message.message_type !== 'card' && (
                      <FileMessageContent
                        messageType={message.message_type}
                        messageContent={message.message_content}
                        fileUuid={message.file_uuid}
                        fileSize={message.file_size}
                        fileHash={message.file_hash}
                        urlType="friend"
                        imageWidth={message.image_width}
                        imageHeight={message.image_height}
                      />
                    )}
                  </>
                )}
                {/* 元信息行：时间戳 + 已读状态槽（固定结构，各消息类型落点一致） */}
                <div className="bubble-meta">
                  <span className="bubble-time">{formatMessageTime(message.send_time)}</span>
                  {isOwn && (
                    <PrivateReadReceipt status={message.sendStatus} isRead={readReceipt?.isRead ?? false} />
                  )}
                </div>
              </div>
              {/* 拉黑未送达标记：我发出且 seq=0（拉黑关系下被静默丢弃）→ 气泡左侧红叹号。
                  own 消息行为 row-reverse，此处置于 bubble-content 之后即渲染在气泡左侧。 */}
              {isOwn && message.seq === 0
                && message.sendStatus !== 'sending'
                && message.sendStatus !== 'failed' && (
                <span className="bubble-undelivered" title="未送达：对方收不到此消息" aria-label="未送达">
                  <FailedIcon size={16} />
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 右键菜单（桌面端右键/移动端长按触发） */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        bubbleRect={contextMenu.bubbleRect}
        canRecall={canRecallMessage(message, isOwn)}
        canReply={canReply}
        onReply={handleReply}
        localPath={localPath}
        messageContent={message.message_type === 'text' ? message.message_content : null}
        fileType={getFileType()}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onSelectText={message.message_type === 'text' ? () => setShowFullPreview(true) : undefined}
        onSaveToGallery={handleSaveToGallery}
        onClose={handleCloseMenu}
      />

      {/* 移动端全屏消息预览（双击触发） */}
      {isMobile() && message.message_type === 'text' && (
        <MobileMessageFullPreview
          isOpen={showFullPreview}
          content={message.message_content}
          senderName={isOwn ? session.profile.user_nickname : friendDisplayName(friend)}
          sendTime={formatMessageTime(message.send_time)}
          onClose={() => setShowFullPreview(false)}
        />
      )}
    </>
  );
}
