/**
 * 消息气泡组件
 *
 * 功能：
 * - 简化的入场动画（仅淡入）
 * - 退出动画（撤回时淡出 + 缩小）
 * - 右键菜单（撤回/删除）
 * - 多选模式选中效果
 * - 点击头像显示用户信息弹出框
 *
 * 动画机制：
 * - 使用 layout="position" 处理位置变化（发送完成后自动平滑移动）
 * - 入场/退出仅处理 opacity，不含 x/y 偏移，避免与 layout 动画冲突
 */

import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { UserAvatar, FriendAvatar, type SessionInfo } from '../common/Avatar';
import { formatMessageTime } from '../../utils/time';
import { MessageContextMenu } from './MessageContextMenu';
import { FileMessageContent } from './FileMessageContent';
import { UserProfilePopup, type UserInfo } from './UserProfilePopup';
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
}

/**
 * 发送状态指示器
 * - sending: 旋转的圆圈
 * - failed: 红色感叹号
 */
function SendStatusIndicator({ status }: { status?: Message['sendStatus'] }) {
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

// 简化的动画变体 - 仅处理 opacity，位置变化由 layout="position" 处理
const messageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

// 动画过渡配置（使用 as const 确保类型正确）
const transition = {
  opacity: { duration: 0.2, ease: [0.0, 0.0, 0.2, 1] as const },
  layout: { duration: 0.25, ease: [0.4, 0, 0.2, 1] as const },
};

/**
 * 检查消息是否可以撤回
 * - 必须是自己发送的消息
 * - 发送时间在 2 分钟内
 */
function canRecallMessage(message: Message, isOwn: boolean): boolean {
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
}: MessageBubbleProps) {
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
  });

  // 用户信息弹出框状态
  const avatarRef = useRef<HTMLDivElement>(null);
  const [profilePopup, setProfilePopup] = useState<{
    isOpen: boolean;
    user: UserInfo | null;
    anchorRect: DOMRect | null;
    isSelf: boolean;
  }>({
    isOpen: false,
    user: null,
    anchorRect: null,
    isSelf: false,
  });

  // 点击头像显示/隐藏用户信息
  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMultiSelectMode) { return; }

    const targetUserId = isOwn ? session.userId : friend.friend_id;

    // 如果弹出框已打开且是同一用户，则关闭
    if (profilePopup.isOpen && profilePopup.user?.userId === targetUserId) {
      setProfilePopup((prev) => ({ ...prev, isOpen: false }));
      return;
    }

    const rect = avatarRef.current?.getBoundingClientRect() || null;

    if (isOwn) {
      // 点击自己的头像
      setProfilePopup({
        isOpen: true,
        user: {
          userId: session.userId,
          nickname: session.profile.user_nickname,
          avatarUrl: session.profile.user_avatar_url,
        },
        anchorRect: rect,
        isSelf: true,
      });
    } else {
      // 点击好友的头像
      setProfilePopup({
        isOpen: true,
        user: {
          userId: friend.friend_id,
          nickname: friend.friend_nickname,
          avatarUrl: friend.friend_avatar_url,
        },
        anchorRect: rect,
        isSelf: false,
      });
    }
  }, [isMultiSelectMode, isOwn, session, friend, profilePopup.isOpen, profilePopup.user?.userId]);

  // 关闭用户信息弹出框
  const handleCloseProfile = useCallback(() => {
    setProfilePopup((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // 右键打开菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isMultiSelectMode) { return; } // 多选模式下不显示右键菜单

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, [isMultiSelectMode]);

  // 点击消息（多选模式下切换选中状态）
  const handleClick = useCallback(() => {
    if (isMultiSelectMode && onToggleSelect) {
      onToggleSelect();
    }
  }, [isMultiSelectMode, onToggleSelect]);

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

  return (
    <>
      <motion.div
        className={`message-bubble ${isOwn ? 'own' : 'other'} ${isMultiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''} ${message.sendStatus === 'sending' ? 'sending' : ''} ${message.sendStatus === 'failed' ? 'send-failed' : ''}`}
        layout="position"
        variants={messageVariants}
        // 只有新发送的消息（有 clientId）才触发入场动画，避免同步后所有消息闪烁
        initial={message.clientId ? 'initial' : false}
        animate="animate"
        exit="exit"
        transition={transition}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
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
          {isOwn ? <UserAvatar session={session} /> : <FriendAvatar friend={friend} />}
        </div>
        <div className="bubble-content">
          {message.message_type === 'text' ? (
            <div className="bubble-text">{message.message_content}</div>
          ) : (
            <FileMessageContent
              messageType={message.message_type}
              messageContent={message.message_content}
              fileUuid={message.file_uuid}
              fileSize={message.file_size}
              fileHash={message.file_hash}
            />
          )}
          <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
        </div>
      </motion.div>

      {/* 右键菜单 */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        canRecall={canRecallMessage(message, isOwn)}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onClose={handleCloseMenu}
      />

      {/* 用户信息弹出框 */}
      {profilePopup.user && (
        <UserProfilePopup
          user={profilePopup.user}
          anchorRect={profilePopup.anchorRect}
          isOpen={profilePopup.isOpen}
          onClose={handleCloseProfile}
          isSelf={profilePopup.isSelf}
        />
      )}
    </>
  );
}
