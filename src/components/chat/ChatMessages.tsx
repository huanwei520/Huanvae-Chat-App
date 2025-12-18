/**
 * 消息列表组件
 */

import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { LoadingSpinner } from '../common/LoadingSpinner';
import type { SessionInfo } from '../common/Avatar';
import type { Friend, Message } from '../../types/chat';

interface ChatMessagesProps {
    loading: boolean;
    messages: Message[];
    session: SessionInfo & { userId: string };
    friend: Friend;
}

export function ChatMessages({ loading, messages, session, friend }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 消息加载完成后滚动到底部
  useEffect(() => {
    if (!loading && messages.length > 0) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest', // 只在必要时滚动，避免影响父容器
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
        <span>发送一条消息开始聊天吧</span>
      </div>
    );
  }

  return (
    <>
      {[...messages].reverse().map((message) => (
        <MessageBubble
          key={message.message_uuid}
          message={message}
          isOwn={message.sender_id === session.userId}
          session={session}
          friend={friend}
        />
      ))}
      <div ref={messagesEndRef} />
    </>
  );
}
