/**
 * 群聊消息列表组件
 *
 * 入场动画（方案 A - 简约淡入）：
 * - 自己的消息：从右侧淡入 + 轻微上滑
 * - 对方的消息：从左侧淡入
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatMessageTime } from '../../utils/time';
import type { GroupMessage } from '../../api/groupMessages';

interface GroupChatMessagesProps {
  loading: boolean;
  messages: GroupMessage[];
  currentUserId: string;
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

// 群消息气泡组件
function GroupMessageBubble({
  message,
  isOwn,
  isNew = false,
}: {
  message: GroupMessage;
  isOwn: boolean;
  isNew?: boolean;
}) {
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
        {message.sender_avatar_url ? (
          <img
            src={message.sender_avatar_url}
            alt={message.sender_nickname}
          />
        ) : (
          <div className="avatar-placeholder">
            {message.sender_nickname.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="bubble-content">
        {!isOwn && (
          <div className="bubble-sender">
            {message.sender_nickname}
          </div>
        )}
        <div className="bubble-text">
          {message.is_recalled ? (
            <span className="recalled-message">[消息已撤回]</span>
          ) : (
            message.message_content
          )}
        </div>
        <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
      </div>
    </motion.div>
  );
}

export function GroupChatMessages({
  loading,
  messages,
  currentUserId,
}: GroupChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 追踪已渲染的消息 ID
  const [renderedIds, setRenderedIds] = useState<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  // 初次加载完成后，记录所有已有消息
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialLoadDone.current) {
      initialLoadDone.current = true;
      setRenderedIds(new Set(messages.map((m) => m.message_uuid)));
    }
  }, [loading, messages]);

  // 当有新消息时，延迟更新已渲染集合（让动画播放）
  useEffect(() => {
    if (initialLoadDone.current && messages.length > 0) {
      const currentIds = messages.map((m) => m.message_uuid);
      const hasNew = currentIds.some((id) => !renderedIds.has(id));
      
      if (hasNew) {
        const timer = setTimeout(() => {
          setRenderedIds(new Set(currentIds));
        }, 250); // 动画时长后更新
        return () => clearTimeout(timer);
      }
    }
  }, [messages, renderedIds]);

  // 新消息时立即开始平滑滚动（与动画同步）
  useEffect(() => {
    if (!loading && messages.length > 0) {
      // 使用 requestAnimationFrame 确保在渲染后立即滚动
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
      });
    }
  }, [loading, messages.length]);

  if (loading) {
    return (
      <div className="message-placeholder">
        <LoadingSpinner />
        <span>加载消息中...</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="message-placeholder">
        <p>暂无消息</p>
        <span>发送一条消息开始群聊吧</span>
      </div>
    );
  }

  return (
    <>
      {[...messages].reverse().map((message) => {
        const isOwn = message.sender_id === currentUserId;
        const isNew = initialLoadDone.current && !renderedIds.has(message.message_uuid);

        return (
          <GroupMessageBubble
            key={message.message_uuid}
            message={message}
            isOwn={isOwn}
            isNew={isNew}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </>
  );
}
