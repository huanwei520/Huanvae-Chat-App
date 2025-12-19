/**
 * 群消息气泡组件
 *
 * 功能：
 * - 入场动画
 * - 右键菜单（撤回/删除）
 * - 多选模式选中效果
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { formatMessageTime } from '../../utils/time';
import { MessageContextMenu } from './MessageContextMenu';
import { FileMessageContent } from './FileMessageContent';
import type { GroupMessage } from '../../api/groupMessages';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwn: boolean;
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
  /** 当前用户是否为管理员/群主（可撤回任意消息） */
  isAdmin?: boolean;
}

// 自己发送的消息入场动画
const ownMessageVariants = {
  initial: { opacity: 0, x: 20, y: 8 },
  animate: { opacity: 1, x: 0, y: 0 },
};

// 接收消息的入场动画
const receivedMessageVariants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
};

// 无动画
const noAnimationVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
};

// 入场动画的 transition 配置
const enterTransition = {
  duration: 0.35,
  ease: [0.25, 0.1, 0.25, 1],
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

export function GroupMessageBubble({
  message,
  isOwn,
  isNew = false,
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
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
  });

  // 新消息播放入场动画
  let variants = noAnimationVariants;
  if (isNew) {
    variants = isOwn ? ownMessageVariants : receivedMessageVariants;
  }

  // 右键打开菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isMultiSelectMode) { return; }

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, [isMultiSelectMode]);

  // 点击消息
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
    onToggleSelect?.();
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
          layout: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] },
        }}
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

        <div className="bubble-avatar">
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
            />
          )}
          <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
        </div>
      </motion.div>

      {/* 右键菜单 */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        canRecall={canRecallMessage(message, isOwn, isAdmin)}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onClose={handleCloseMenu}
      />
    </>
  );
}
