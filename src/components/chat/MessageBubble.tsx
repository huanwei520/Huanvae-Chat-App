/**
 * 消息气泡组件
 *
 * 入场动画（方案 A - 简约淡入）：
 * - 自己的消息：从右侧淡入 + 轻微上滑
 * - 对方的消息：从左侧淡入
 * - 动画时长：150-200ms
 */

import { motion } from 'framer-motion';
import { UserAvatar, FriendAvatar, type SessionInfo } from '../common/Avatar';
import { formatMessageTime } from '../../utils/time';
import type { Friend, Message } from '../../types/chat';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  session: SessionInfo;
  friend: Friend;
  /** 是否是新消息（需要播放入场动画） */
  isNew?: boolean;
}

// 自己发送的消息入场动画（从右侧淡入 + 轻微上滑）
const ownMessageVariants = {
  initial: {
    opacity: 0,
    x: 20,
    y: 10,
  },
  animate: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: {
      duration: 0.18,
      ease: [0, 0, 0.2, 1], // ease-out
    },
  },
};

// 接收消息的入场动画（从左侧淡入）
const receivedMessageVariants = {
  initial: {
    opacity: 0,
    x: -20,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.18,
      ease: [0, 0, 0.2, 1], // ease-out
    },
  },
};

// 无动画（用于已存在的消息）
const noAnimationVariants = {
  initial: { opacity: 1, x: 0, y: 0 },
  animate: { opacity: 1, x: 0, y: 0 },
};

export function MessageBubble({
  message,
  isOwn,
  session,
  friend,
  isNew = false,
}: MessageBubbleProps) {
  // 新消息播放入场动画
  let variants = noAnimationVariants;
  if (isNew) {
    variants = isOwn ? ownMessageVariants : receivedMessageVariants;
  }

  return (
    <motion.div
      className={`message-bubble ${isOwn ? 'own' : 'other'}`}
      variants={variants}
      initial="initial"
      animate="animate"
    >
      <div className="bubble-avatar">
        {isOwn ? <UserAvatar session={session} /> : <FriendAvatar friend={friend} size={32} />}
      </div>
      <div className="bubble-content">
        <div className="bubble-text">{message.message_content}</div>
        <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
      </div>
    </motion.div>
  );
}
