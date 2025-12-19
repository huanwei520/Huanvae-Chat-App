/**
 * 私聊消息列表组件
 *
 * 入场动画（方案 A - 简约淡入）：
 * - 自己的消息：从右侧淡入 + 轻微上滑
 * - 对方的消息：从左侧淡入
 */

import { useEffect, useRef, useState } from 'react';
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
        <span>发送一条消息开始聊天吧</span>
      </div>
    );
  }

  return (
    <>
      {[...messages].reverse().map((message) => {
        const isOwn = message.sender_id === session.userId;
        const isNew = initialLoadDone.current && !renderedIds.has(message.message_uuid);

        return (
          <MessageBubble
            key={message.message_uuid}
            message={message}
            isOwn={isOwn}
            session={session}
            friend={friend}
            isNew={isNew}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </>
  );
}
