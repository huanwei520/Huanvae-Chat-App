/**
 * 群消息气泡组件
 *
 * @module chat/group
 * @location src/chat/group/GroupMessageBubble.tsx
 *
 * 功能：
 * - 类似 Telegram 的入场动画（从侧边滑入 + 从下往上 + 淡入）
 * - 退出动画（反方向滑出）
 * - 右键菜单（桌面端右键/移动端长按触发：复制、撤回、删除、多选）
 * - 多选模式选中效果
 * - 点击头像显示用户信息弹出框
 * - 移动端双击全屏预览（仅文本消息）
 * - 文本消息使用 MarkdownRenderer 渲染（支持 GFM、代码高亮）
 *
 * 动画机制：
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 撤回/删除：反方向播放退出动画
 * - 使用 layout="position" 处理位置变化（发送完成后自动平滑移动）
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatMessageTime } from '../../utils/time';
import { MessageContextMenu } from '../shared/MessageContextMenu';
import { FileMessageContent } from '../shared/FileMessageContent';
import { MeetingInviteCard } from '../shared/MeetingInviteCard';
import { CardRenderer } from '../shared/CardRenderer';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { MobileMessageFullPreview } from '../shared/MobileMessageFullPreview';
import { useFileCache } from '../../hooks/useFileCache';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import { useChatStore, useProfileViewStore } from '../../stores';
import { useApi } from '../../contexts/SessionContext';
import {
  addGroupMessageBlock,
  removeGroupMessageBlock,
  addGroupSpecialCare,
  removeGroupSpecialCare,
  setGroupMemberRemark as apiSetGroupMemberRemark,
  removeGroupMemberRemark as apiRemoveGroupMemberRemark,
} from '../../api/groups';
import { isMobile } from '../../utils/platform';
import { groupMemberDisplayName } from '../../utils/groupRemark';
import { friendChatTarget } from '../../utils/chatTarget';
import { GroupRemarkInputModal } from './GroupRemarkInputModal';
import { ReplyQuote } from './ReplyQuote';
import { saveToGallery } from '../../utils/saveToGallery';
import type { GroupMessage } from '../../api/groupMessages';
import type { ResolvedReplyQuote } from './replyPreview';
import type { GroupReader } from './useGroupReadReceipt';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwn: boolean;
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
  /** 当前用户是否为管理员/群主（可撤回任意消息） */
  isAdmin?: boolean;
  /** 已读回执：仅自己发出的已送达消息传入（文案 + 已读者名单）；对方消息/发送中/失败/已撤回不传 */
  readReceipt?: { text: string | null; readers: GroupReader[] };
  /** 点击已读回执展开已读名单 */
  onOpenReadList?: (readers: GroupReader[]) => void;
  /** 所在群 ID（D6 群内屏蔽：右键屏蔽/取消屏蔽该发送者时调用 API + 更新 store） */
  groupId?: string;
  /** 是否播放入场滑入动画：仅"挂载后新增"的实时新消息为 true（由列表用 shouldPlayEnter 判定）；
   *  切换/打开时已有的历史为 false → 不并拢，整体走面板渐变。 */
  playEnter?: boolean;
  /** 本条消息引用的原消息（reply_to 解析结果）；null = 不是回复，不渲染引用块 */
  replyQuote?: ResolvedReplyQuote | null;
  /** 点击引用块 → 定位到原消息（由列表接到 pendingScrollToMessageId 通路） */
  onQuoteClick?: (targetUuid: string) => void;
  /** 右键/长按菜单「回复」→ 把本条设为回复目标；不传则菜单不显示该项 */
  onReply?: (message: GroupMessage) => void;
  /** 定位命中后短暂高亮本条（CSS keyframes 脉冲） */
  isHighlighted?: boolean;
}

// 使用统一的消息动画配置
import { getMessageVariants, messageTransition } from '../shared/animations';

// 重命名为 transition 以保持兼容
const transition = messageTransition;

/**
 * 检查消息是否可以撤回
 * - 自己发送的消息：2分钟内
 * - 管理员/群主：可撤回任意消息
 */
function canRecallMessage(message: GroupMessage, isOwn: boolean, isAdmin: boolean): boolean {
  if (message.is_recalled) { return false; }

  // 管理员可撤回任意消息
  if (isAdmin) { return true; }

  // 普通用户只能撤回自己的消息，且在2分钟内
  if (!isOwn) { return false; }

  const sendTime = new Date(message.send_time).getTime();
  const now = Date.now();
  const twoMinutes = 2 * 60 * 1000;

  return now - sendTime < twoMinutes;
}

// 群聊已读回执（仅自己消息，统一状态槽：时钟/红叹号/绿双勾+N人已读+头像堆叠）
import { GroupReadReceipt } from './GroupReadReceipt';

export function GroupMessageBubble({
  message,
  isOwn,
  isMultiSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  isAdmin = false,
  readReceipt,
  onOpenReadList,
  groupId,
  playEnter = false,
  replyQuote = null,
  onQuoteClick,
  onReply,
  isHighlighted = false,
}: GroupMessageBubbleProps) {
  const api = useApi();
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
  const isFileMessage =
    message.message_type !== 'text' &&
    message.message_type !== 'system' &&
    !!message.file_uuid;
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
    urlType: 'group',
    autoCache: false,
    enabled: isFileMessage,
  });

  // 移动端全屏预览状态
  const [showFullPreview, setShowFullPreview] = useState(false);
  // 双击检测
  const lastTapTimeRef = useRef<number>(0);

  // 打开公开资料只读页（单击头像看资料）
  const openProfileView = useProfileViewStore((s) => s.open);
  // store 方法和好友列表（双击头像：好友进私聊）
  const setChatTarget = useChatStore((state) => state.setChatTarget);
  const friends = useChatStore((state) => state.friends);
  // 头像单击/双击区分计时器（单击=看资料，双击=进私聊）
  const avatarClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 头像键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const avatarKbd = useKbdFocusRing();
  const avatarKbdHandlers = avatarKbd.handlersFor('avatar');

  useEffect(() => () => {
    if (avatarClickTimerRef.current) { clearTimeout(avatarClickTimerRef.current); }
  }, []);

  // 头像单击语义（鼠标单击计时器到期与键盘 Enter/Space 共用；键盘不走双击计时器）：
  // 多选切换选中，否则看资料
  const activateAvatar = useCallback(() => {
    if (isMultiSelectMode) {
      onToggleSelect?.();
      return;
    }
    openProfileView(message.sender_id);
  }, [isMultiSelectMode, onToggleSelect, openProfileView, message.sender_id]);

  // 单击成员头像 → 看公开资料；双击 → 进私聊（好友才有私聊，非好友/自己回退看资料）
  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 多选模式下，点击头像也触发选中（走共享单击语义，不进双击计时）
    if (isMultiSelectMode) {
      activateAvatar();
      return;
    }
    // 第二次点击落在计时窗口内 → 双击：进私聊
    if (avatarClickTimerRef.current) {
      clearTimeout(avatarClickTimerRef.current);
      avatarClickTimerRef.current = null;
      const friend = friends.find((f) => f.friend_id === message.sender_id);
      if (friend) {
        setChatTarget(friendChatTarget(friend));
      } else {
        openProfileView(message.sender_id);
      }
      return;
    }
    // 首次点击 → 延迟判定为单击：看资料（与键盘共用 activateAvatar）
    avatarClickTimerRef.current = setTimeout(() => {
      avatarClickTimerRef.current = null;
      activateAvatar();
    }, 250);
  }, [isMultiSelectMode, activateAvatar, message.sender_id, friends, setChatTarget, openProfileView]);

  // D6 群内屏蔽：该发送者是否已被我屏蔽（仅他人消息有意义）
  const isSenderBlocked = useChatStore((state) =>
    groupId && !isOwn ? (state.groupMessageBlocks[groupId] ?? []).includes(message.sender_id) : false,
  );
  const setGroupMemberBlocked = useChatStore((state) => state.setGroupMemberBlocked);

  // 好友拉黑：发送者是我拉黑的好友、且该消息发送时间晚于拉黑时间点 → 在所有群折叠
  // （只折叠拉黑之后发的；拉黑前的历史消息保留原文。取消拉黑后随 store 自动恢复）。
  // 与 D6 群屏蔽相互独立：群屏蔽走 groupMessageBlocks（右键取消），拉黑走好友黑名单（私聊/设置取消）。
  // friendBlacklistTimes 是单一真值源：拉黑时写入（服务器 created_at），取消拉黑时
  // setFriendBlacklisted(false) 一并删除该条 → 存在即「当前已拉黑」。无需再叠加
  // friends[].is_blacklisted 双源判定（两个异步源就绪时序不一致会让折叠静默失效）。
  const senderBlacklistTime = useChatStore((state) => state.friendBlacklistTimes[message.sender_id]);
  const isSenderBlacklisted = !isOwn
    && !!senderBlacklistTime
    && new Date(message.send_time).getTime() >= new Date(senderBlacklistTime).getTime();
  // 折叠占位的统一判定：群屏蔽 或 好友拉黑 任一命中
  const isSenderHidden = isSenderBlocked || isSenderBlacklisted;

  // 切换屏蔽/取消屏蔽该发送者：先 await API 成功再写 store（与好友关系操作 useChatMenu 一致，
  // 失败不写入），避免「乐观写 + 失败回滚」在并发/快速切换下落到旧值。右键菜单点击后即关闭，
  // 无法在 API 返回前重复点，next 始终基于已结算状态计算。被屏蔽者消息渲染成折叠占位，
  // 仍可右键此项取消屏蔽——这是取消屏蔽的唯一入口。
  const handleToggleBlockSender = useCallback(async () => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const next = !isSenderBlocked;
    try {
      if (next) {
        await addGroupMessageBlock(api, groupId, senderId);
      } else {
        await removeGroupMessageBlock(api, groupId, senderId);
      }
      setGroupMemberBlocked(groupId, senderId, next);
    } catch (err) {
      console.error('[GroupMessageBubble] 切换屏蔽失败:', err);
    }
  }, [api, groupId, isOwn, isSenderBlocked, message.sender_id, setGroupMemberBlocked]);

  // M3 群内特别关心：该发送者是否已被我特别关心（仅他人消息有意义）
  const isSenderSpecialCared = useChatStore((state) =>
    groupId && !isOwn ? (state.groupSpecialCares[groupId] ?? []).includes(message.sender_id) : false,
  );
  const setGroupMemberSpecialCare = useChatStore((state) => state.setGroupMemberSpecialCare);

  // 切换特别关心/取消：先 await API 成功再写 store（与好友关系操作一致，失败不写入）。
  // 效果仅作用于该成员发言时的通知强提醒（⭐）。
  const handleToggleSpecialCare = useCallback(async () => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const next = !isSenderSpecialCared;
    try {
      if (next) {
        await addGroupSpecialCare(api, groupId, senderId);
      } else {
        await removeGroupSpecialCare(api, groupId, senderId);
      }
      setGroupMemberSpecialCare(groupId, senderId, next);
    } catch (err) {
      console.error('[GroupMessageBubble] 切换特别关心失败:', err);
    }
  }, [api, groupId, isOwn, isSenderSpecialCared, message.sender_id, setGroupMemberSpecialCare]);

  // D7 群内私有备注：我给该发送者设的备注（仅他人消息有意义），用于替换显示名
  const senderRemark = useChatStore((state) =>
    groupId && !isOwn ? state.groupMemberRemarks[groupId]?.[message.sender_id] : undefined,
  );
  const setGroupMemberRemarkLocal = useChatStore((state) => state.setGroupMemberRemark);
  const [remarkModalOpen, setRemarkModalOpen] = useState(false);

  // 保存/清除备注：先 await API 成功再写 store（与好友关系操作一致，失败不写入）。空串 = 清除。
  const handleSaveRemark = useCallback(async (value: string) => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const trimmed = value.trim();
    try {
      if (trimmed) {
        await apiSetGroupMemberRemark(api, groupId, senderId, trimmed);
      } else {
        await apiRemoveGroupMemberRemark(api, groupId, senderId);
      }
      setGroupMemberRemarkLocal(groupId, senderId, trimmed || null);
    } catch (err) {
      console.error('[GroupMessageBubble] 保存备注失败:', err);
    }
  }, [api, groupId, isOwn, message.sender_id, setGroupMemberRemarkLocal]);

  // 发送者在本群对我显示的名字：备注优先，否则用消息携带的发送者名（群昵称/用户昵称）
  const senderDisplayName = groupMemberDisplayName(senderRemark, message.sender_nickname);

  // 长按计时器（移动端用）
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 右键打开菜单（桌面端）
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isMultiSelectMode) { return; }

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
    onToggleSelect?.();
  }, [onEnterMultiSelect, onToggleSelect]);

  // 回复本条消息（右键/长按菜单触发）
  const handleReply = useCallback(() => {
    onReply?.(message);
  }, [onReply, message]);

  // 点击引用块 → 定位原消息
  const handleQuoteClick = useCallback(() => {
    if (message.reply_to) {
      onQuoteClick?.(message.reply_to);
    }
  }, [onQuoteClick, message.reply_to]);

  // 「回复」菜单项的显示条件：
  // - 需要列表层给了 onReply（好友私聊不给 → 后端 friends_messages 表无 reply-to 列，不支持引用）
  // - 系统消息不可回复
  // - 发送中/失败的消息还没有服务端 UUID，拿它当 reply_to 发出去后端会 400
  const canReply = !!onReply
    && message.message_type !== 'system'
    && message.sendStatus !== 'sending'
    && message.sendStatus !== 'failed';

  // 保存到相册（移动端）
  const handleSaveToGallery = useCallback(async () => {
    if (!localPath) { return; }
    const fileType = message.message_type === 'image' ? 'image' : 'video';
    const result = await saveToGallery(localPath, fileType);
    if (result.success) {
      console.warn('[GroupMessageBubble] 保存成功:', result.savedPath);
    } else {
      console.error('[GroupMessageBubble] 保存失败:', result.message);
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
                  // 键盘=单击语义（共用 activateAvatar），不走 250ms 双击计时器
                  e.preventDefault();
                  e.stopPropagation();
                  activateAvatar();
                }}
                role="button"
                tabIndex={0}
                aria-label={`查看${senderDisplayName}资料`}
                onPointerDown={avatarKbdHandlers.onPointerDown}
                onFocus={avatarKbdHandlers.onFocus}
                onBlur={avatarKbdHandlers.onBlur}
              >
                {message.sender_avatar_url ? (
                  <img src={message.sender_avatar_url} alt={senderDisplayName} />
                ) : (
                  <AvatarPlaceholder name={senderDisplayName} fontSize={14} />
                )}
              </div>
              <div className="bubble-content">
                {!isOwn && (
                  <div className="bubble-sender">{senderDisplayName}</div>
                )}
                {/* 被引用的原消息（Telegram 风格引用块，点击定位）。
                    放在折叠判定之外：引用块只暴露"被回复的那条"的摘要，与本条发送者是否被屏蔽无关；
                    但被屏蔽者自己发的引用块也一并折叠掉更符合"屏蔽此人消息"的预期 → 故仍受 isSenderHidden 门控。 */}
                {!isSenderHidden && replyQuote && (
                  <ReplyQuote
                    senderName={replyQuote.senderName}
                    text={replyQuote.text}
                    resolved={replyQuote.resolved}
                    onClick={handleQuoteClick}
                  />
                )}
                {/* 折叠占位（内容隐藏）：D6 群屏蔽右键可取消；好友拉黑在私聊/设置取消后自动恢复 */}
                {isSenderHidden ? (
                  <div className="bubble-text bubble-blocked-placeholder">
                    {isSenderBlocked ? '已屏蔽此人消息' : '已拉黑此人消息'}
                  </div>
                ) : (
                  <>
                    {(message.message_type === 'text' || message.message_type === 'system') && (
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
                        sourceType="group"
                      />
                    )}
                    {message.message_type !== 'text'
                      && message.message_type !== 'system'
                      && message.message_type !== 'meeting_invite'
                      && message.message_type !== 'card' && (
                      <FileMessageContent
                        messageType={message.message_type as 'image' | 'video' | 'file'}
                        messageContent={message.message_content}
                        fileUuid={message.file_uuid}
                        fileSize={message.file_size}
                        fileHash={message.file_hash}
                        urlType="group"
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
                    <GroupReadReceipt
                      status={message.sendStatus}
                      text={readReceipt?.text ?? null}
                      readers={readReceipt?.readers ?? []}
                      onOpenList={() => onOpenReadList?.(readReceipt?.readers ?? [])}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 右键菜单（桌面端右键/移动端长按触发） */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        bubbleRect={contextMenu.bubbleRect}
        canRecall={canRecallMessage(message, isOwn, isAdmin)}
        localPath={localPath}
        messageContent={message.message_type === 'text' ? message.message_content : null}
        fileType={getFileType()}
        canBlockSender={!isOwn && !!groupId && message.message_type !== 'system'}
        isSenderBlocked={isSenderBlocked}
        canSpecialCareSender={!isOwn && !!groupId && message.message_type !== 'system'}
        isSenderSpecialCared={isSenderSpecialCared}
        canRemarkSender={!isOwn && !!groupId && message.message_type !== 'system'}
        hasRemark={!!senderRemark}
        onSetRemark={() => setRemarkModalOpen(true)}
        canReply={canReply}
        onReply={handleReply}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onSelectText={message.message_type === 'text' ? () => setShowFullPreview(true) : undefined}
        onSaveToGallery={handleSaveToGallery}
        onToggleBlockSender={handleToggleBlockSender}
        onToggleSpecialCareSender={handleToggleSpecialCare}
        onClose={handleCloseMenu}
      />

      {/* 移动端全屏消息预览（双击触发） */}
      {isMobile() && message.message_type === 'text' && (
        <MobileMessageFullPreview
          isOpen={showFullPreview}
          content={message.message_content}
          senderName={message.sender_nickname}
          sendTime={formatMessageTime(message.send_time)}
          onClose={() => setShowFullPreview(false)}
        />
      )}

      {/* D7 群内私有备注输入弹窗（右键「设置备注」触发） */}
      <GroupRemarkInputModal
        isOpen={remarkModalOpen}
        memberName={message.sender_nickname}
        currentRemark={senderRemark ?? ''}
        onSave={handleSaveRemark}
        onClose={() => setRemarkModalOpen(false)}
      />
    </>
  );
}
