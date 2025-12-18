/**
 * 群聊消息列表组件
 */

import { useEffect, useRef } from 'react';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatMessageTime } from '../../utils/time';
import type { GroupMessage } from '../../api/groupMessages';

interface GroupChatMessagesProps {
  loading: boolean;
  messages: GroupMessage[];
  currentUserId: string;
}

// 群消息气泡组件
function GroupMessageBubble({
  message,
  isOwn,
}: {
  message: GroupMessage;
  isOwn: boolean;
}) {
  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
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
    </div>
  );
}

export function GroupChatMessages({
  loading,
  messages,
  currentUserId,
}: GroupChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 消息加载完成后滚动到底部
  useEffect(() => {
    if (!loading && messages.length > 0) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 100);
      return () => clearTimeout(timer);
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
      {[...messages].reverse().map((message) => (
        <GroupMessageBubble
          key={message.message_uuid}
          message={message}
          isOwn={message.sender_id === currentUserId}
        />
      ))}
      <div ref={messagesEndRef} />
    </>
  );
}
