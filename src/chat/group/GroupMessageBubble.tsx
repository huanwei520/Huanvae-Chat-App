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
 *
 * 动画机制：
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 撤回/删除：反方向播放退出动画
 * - 使用 layout="position" 处理位置变化（发送完成后自动平滑移动）
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { formatMessageTime } from '../../utils/time';
import { MessageContextMenu } from '../shared/MessageContextMenu';
import { FileMessageContent } from '../shared/FileMessageContent';
import { UserProfilePopup, type UserInfo } from '../shared/UserProfilePopup';
import { MobileMessageFullPreview } from '../shared/MobileMessageFullPreview';
import { getCachedFilePath } from '../../services/fileCache';
import { useChatStore } from '../../stores';
import { isMobile } from '../../utils/platform';
import type { GroupMessage } from '../../api/groupMessages';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwn: boolean;
  /** 当前用户 ID */
  currentUserId?: string;
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
}

/**
 * 生成消息动画变体（类似 Telegram）
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 退出时反方向播放
 */
function getMessageVariants(isOwn: boolean) {
  const xOffset = isOwn ? 20 : -20; // 自己的消息从右边来，对方的从左边来
  const yOffset = 10; // 从下往上

  return {
    initial: {
      opacity: 0,
      x: xOffset,
      y: yOffset,
      scale: 0.98,
    },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
    },
    exit: {
      opacity: 0,
      x: xOffset, // 退出时往原方向滑出
      y: yOffset,
      scale: 0.98,
    },
  };
}

// 动画过渡配置（使用 as const 确保类型正确）
const transition = {
  // 入场/退出动画
  opacity: { duration: 0.2, ease: [0.0, 0.0, 0.2, 1] as const },
  x: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] as const },
  y: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] as const },
  scale: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const },
  // 布局动画（消息位置变化时）
  layout: { duration: 0.25, ease: [0.4, 0, 0.2, 1] as const },
};

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

/**
 * 发送状态指示器
 * - sending: 旋转的圆圈
 * - failed: 红色感叹号
 */
function SendStatusIndicator({ status }: { status?: GroupMessage['sendStatus'] }) {
  if (!status || status === 'sent') {
    return null;
  }

  if (status === 'sending') {
    return (
      <motion.div
        className="send-status-indicator sending"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        title="发送中..."
      >
        <svg className="sending-spinner" viewBox="0 0 24 24" width={16} height={16}>
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="31.4 31.4"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
    );
  }

  if (status === 'failed') {
    return (
      <motion.div
        className="send-status-indicator failed"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        title="发送失败"
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
      </motion.div>
    );
  }

  return null;
}

export function GroupMessageBubble({
  message,
  isOwn,
  currentUserId,
  isMultiSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  isAdmin = false,
}: GroupMessageBubbleProps) {
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
  const [localPath, setLocalPath] = useState<string | null>(null);

  // 移动端全屏预览状态
  const [showFullPreview, setShowFullPreview] = useState(false);
  // 双击检测
  const lastTapTimeRef = useRef<number>(0);

  // 获取文件消息的本地缓存路径
  useEffect(() => {
    if (message.message_type !== 'text' && message.message_type !== 'system' && message.file_hash) {
      getCachedFilePath(message.file_hash).then((path) => {
        setLocalPath(path);
      });
    }
  }, [message.message_type, message.file_hash]);

  // 用户信息弹出框状态
  const avatarRef = useRef<HTMLDivElement>(null);
  const [profilePopup, setProfilePopup] = useState<{
    isOpen: boolean;
    user: UserInfo | null;
    anchorRect: DOMRect | null;
  }>({
    isOpen: false,
    user: null,
    anchorRect: null,
  });

  // 点击头像显示/隐藏用户信息
  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMultiSelectMode) { return; }

    // 如果弹出框已打开且是同一用户，则关闭
    if (profilePopup.isOpen && profilePopup.user?.userId === message.sender_id) {
      setProfilePopup((prev) => ({ ...prev, isOpen: false }));
      return;
    }

    const rect = avatarRef.current?.getBoundingClientRect() || null;
    setProfilePopup({
      isOpen: true,
      user: {
        userId: message.sender_id,
        nickname: message.sender_nickname,
        avatarUrl: message.sender_avatar_url || null,
      },
      anchorRect: rect,
    });
  }, [isMultiSelectMode, message, profilePopup.isOpen, profilePopup.user?.userId]);

  // 关闭用户信息弹出框
  const handleCloseProfile = useCallback(() => {
    setProfilePopup((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // 获取 store 方法和好友列表
  const setChatTarget = useChatStore((state) => state.setChatTarget);
  const friends = useChatStore((state) => state.friends);

  // 发送消息（切换到好友私聊）
  const handleSendMessage = useCallback((userId: string) => {
    const friend = friends.find((f) => f.friend_id === userId);
    if (friend) {
      setChatTarget({ type: 'friend', data: friend });
    }
  }, [friends, setChatTarget]);

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
  const handleClick = useCallback(() => {
    if (isMultiSelectMode && onToggleSelect) {
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

  return (
    <>
      <motion.div
        ref={bubbleRef}
        className={`message-bubble ${isOwn ? 'own' : 'other'} ${isMultiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''} ${message.sendStatus === 'sending' ? 'sending' : ''} ${message.sendStatus === 'failed' ? 'send-failed' : ''}`}
        // 只有发送中的消息才启用 layout 动画，避免切换会话时从顶部掉落
        layout={message.sendStatus === 'sending' ? 'position' : false}
        variants={getMessageVariants(isOwn)}
        // 只有新发送的消息（有 clientId）才触发入场动画，避免同步后所有消息闪烁
        initial={message.clientId ? 'initial' : false}
        animate="animate"
        exit="exit"
        transition={transition}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        // 移动端长按触发菜单
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {/* 发送状态指示器（在左侧显示） */}
        {isOwn && <SendStatusIndicator status={message.sendStatus} />}

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
          ref={avatarRef}
          className="bubble-avatar clickable"
          onClick={handleAvatarClick}
        >
          {message.sender_avatar_url ? (
            <img src={message.sender_avatar_url} alt={message.sender_nickname} />
          ) : (
            <div className="avatar-placeholder">
              {message.sender_nickname.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="bubble-content">
          {!isOwn && (
            <div className="bubble-sender">{message.sender_nickname}</div>
          )}
          {message.message_type === 'text' || message.message_type === 'system' ? (
            <div className="bubble-text">{message.message_content}</div>
          ) : (
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
          <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
        </div>
      </motion.div>

      {/* 右键菜单（桌面端右键/移动端长按触发） */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        bubbleRect={contextMenu.bubbleRect}
        canRecall={canRecallMessage(message, isOwn, isAdmin)}
        localPath={localPath}
        messageContent={message.message_type === 'text' ? message.message_content : null}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onSelectText={message.message_type === 'text' ? () => setShowFullPreview(true) : undefined}
        onClose={handleCloseMenu}
      />

      {/* 用户信息弹出框 */}
      {profilePopup.user && (
        <UserProfilePopup
          user={profilePopup.user}
          anchorRect={profilePopup.anchorRect}
          isOpen={profilePopup.isOpen}
          onClose={handleCloseProfile}
          isSelf={currentUserId === profilePopup.user.userId}
          onSendMessage={handleSendMessage}
        />
      )}

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
    </>
  );
}
