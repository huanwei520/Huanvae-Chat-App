/**
 * 用户信息弹出框组件
 *
 * 点击头像时显示用户信息，包括：
 * - 头像、昵称、ID
 * - 个人简介（如果有）
 * - 添加好友按钮（如果不是好友）
 * - 发送消息按钮（如果是好友）
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useChatStore } from '../../stores';
import { useApi, useSession } from '../../contexts/SessionContext';
import { sendFriendRequest } from '../../api/friends';
import { AddUserIcon, ChatIcon } from '../../components/common/Icons';

/** 用户信息 */
export interface UserInfo {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  signature?: string | null;
}

interface UserProfilePopupProps {
  /** 用户信息 */
  user: UserInfo;
  /** 触发弹出框的元素位置 */
  anchorRect: DOMRect | null;
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 是否是自己 */
  isSelf?: boolean;
  /** 发送消息回调（点击后切换到好友私聊） */
  onSendMessage?: (userId: string) => void;
}

/** 获取按钮文本 */
function getButtonText(sent: boolean, sending: boolean): string {
  if (sent) { return '已发送'; }
  if (sending) { return '发送中...'; }
  return '添加好友';
}

/** 弹出框动画变体 */
const popupVariants = {
  initial: { opacity: 0, scale: 0.9, y: -10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    y: -10,
    transition: { duration: 0.15 },
  },
};

export function UserProfilePopup({
  user,
  anchorRect,
  isOpen,
  onClose,
  isSelf = false,
  onSendMessage,
}: UserProfilePopupProps) {
  const api = useApi();
  const { session } = useSession();
  const popupRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 检查是否是好友，并获取好友对象
  const friends = useChatStore((state) => state.friends);
  const friendData = friends.find((f) => f.friend_id === user.userId);
  const isFriend = !!friendData;

  // 点击发送消息
  const handleSendMessage = useCallback(() => {
    if (friendData && onSendMessage) {
      onSendMessage(user.userId);
      onClose();
    }
  }, [friendData, onSendMessage, user.userId, onClose]);

  // 计算弹出框位置
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorRect || !isOpen) { return; }

    const popupWidth = 280;
    const popupHeight = 240; // 预估高度，包含按钮
    const padding = 12;

    // 计算水平位置：优先右侧，不够则左侧，都不够则居中
    let left = anchorRect.right + padding;
    if (left + popupWidth > window.innerWidth) {
      left = anchorRect.left - popupWidth - padding;
    }
    if (left < 0) {
      left = (window.innerWidth - popupWidth) / 2;
    }

    // 计算垂直位置：根据头像在屏幕中的位置决定向上还是向下弹出
    const anchorCenterY = anchorRect.top + anchorRect.height / 2;
    const screenCenterY = window.innerHeight / 2;

    let top: number;
    if (anchorCenterY > screenCenterY) {
      // 头像在屏幕下半部分：向上弹出（弹出框底部对齐头像底部）
      top = anchorRect.bottom - popupHeight;
      // 确保不超出顶部
      if (top < padding) {
        top = padding;
      }
    } else {
      // 头像在屏幕上半部分：向下弹出（弹出框顶部对齐头像顶部）
      top = anchorRect.top;
      // 确保不超出底部
      if (top + popupHeight > window.innerHeight - padding) {
        top = window.innerHeight - popupHeight - padding;
      }
    }

    setPosition({ top, left });
  }, [anchorRect, isOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) { return; }

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加事件监听，避免立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) { return; }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 发送好友请求
  const handleAddFriend = useCallback(async () => {
    if (!session || sending || sent) { return; }

    setSending(true);
    setError(null);

    try {
      await sendFriendRequest(api, session.userId, user.userId);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [api, session, user.userId, sending, sent]);

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      setSent(false);
      setError(null);
    }
  }, [isOpen]);

  const content = (
    <AnimatePresence>
      {isOpen && anchorRect && (
        <motion.div
          ref={popupRef}
          className="user-profile-popup"
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            zIndex: 10000,
          }}
          variants={popupVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {/* 头像 */}
          <div className="popup-avatar">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.nickname} />
            ) : (
              <div className="avatar-placeholder">
                {user.nickname.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* 用户信息 */}
          <div className="popup-info">
            <div className="popup-nickname">{user.nickname}</div>
            <div className="popup-id">@{user.userId}</div>
            {user.signature && (
              <div className="popup-signature">{user.signature}</div>
            )}
          </div>

          {/* 操作按钮 */}
          {!isSelf && (
            <div className="popup-actions">
              {error && <div className="popup-error">{error}</div>}
              {isFriend ? (
                <button
                  className="popup-action-btn message"
                  onClick={handleSendMessage}
                >
                  <ChatIcon />
                  <span>发送消息</span>
                </button>
              ) : (
                <button
                  className={`popup-action-btn add ${sent ? 'sent' : ''}`}
                  onClick={handleAddFriend}
                  disabled={sending || sent}
                >
                  <AddUserIcon />
                  <span>{getButtonText(sent, sending)}</span>
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
