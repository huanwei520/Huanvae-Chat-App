/**
 * 消息气泡组件
 *
 * 功能：
 * - 入场动画（方案 A - 简约淡入）
 * - 退出动画（撤回时反向播放，配合 AnimatePresence 使用）
 * - 右键菜单（撤回/删除）
 * - 多选模式选中效果
 * - 点击头像显示用户信息弹出框
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
  /** 是否是新消息（需要播放入场动画） */
  isNew?: boolean;
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

// 自己发送的消息入场动画（从右侧淡入 + 轻微上滑）
// exit 动画为入场动画的反向播放（向右滑出 + 轻微下滑）
const ownMessageVariants = {
  initial: { opacity: 0, x: 20, y: 8 },
  animate: { opacity: 1, x: 0, y: 0 },
  exit: { opacity: 0, x: 20, y: 8, scale: 0.95 },
};

// 入场/退出动画的 transition 配置
const enterTransition = {
  duration: 0.35,
  ease: [0.25, 0.1, 0.25, 1] as const,
};

const exitTransition = {
  duration: 0.25,
  ease: [0.4, 0, 1, 1] as const,
};

// 接收消息的入场动画（从左侧淡入）
// exit 动画为入场动画的反向播放（向左滑出）
const receivedMessageVariants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20, scale: 0.95, transition: exitTransition },
};

// 无动画（用于已存在的消息，但保留 exit 动画）
const noAnimationOwnVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0, x: 20, y: 8, scale: 0.95, transition: exitTransition },
};

const noAnimationReceivedVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0, x: -20, scale: 0.95, transition: exitTransition },
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
  isNew = false,
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

  // 选择动画变体
  // - 新消息：使用完整的入场/退出动画
  // - 已存在的消息：无入场动画，但保留退出动画（用于撤回）
  let variants;
  if (isNew) {
    variants = isOwn ? ownMessageVariants : receivedMessageVariants;
  } else {
    variants = isOwn ? noAnimationOwnVariants : noAnimationReceivedVariants;
  }

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
        className={`message-bubble ${isOwn ? 'own' : 'other'} ${isMultiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''}`}
        layout
        variants={variants}
        initial="initial"
        animate="animate"
        transition={{
          ...enterTransition,
          layout: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
        }}
        exit="exit"
        onContextMenu={handleContextMenu}
        onClick={handleClick}
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
