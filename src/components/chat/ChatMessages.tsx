/**
 * 私聊消息列表组件
 *
 * 使用 flex-direction: column-reverse 实现从下往上显示
 * 最新消息自然在底部可视区域，无需滚动
 *
 * 支持多选模式进行批量操作
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
  /** 是否处于多选模式 */
  isMultiSelectMode?: boolean;
  /** 已选中的消息 UUID 集合 */
  selectedMessages?: Set<string>;
  /** 切换消息选中状态 */
  onToggleSelect?: (messageUuid: string) => void;
  /** 撤回消息 */
  onRecall?: (messageUuid: string) => void;
  /** 删除消息 */
  onDelete?: (messageUuid: string) => void;
  /** 进入多选模式 */
  onEnterMultiSelect?: () => void;
}

export function ChatMessages({
  loading,
  messages,
  session,
  friend,
  isMultiSelectMode = false,
  selectedMessages = new Set(),
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
}: ChatMessagesProps) {
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
        }, 250);
        return () => clearTimeout(timer);
      }
    }
  }, [messages, renderedIds]);

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
      {messages.map((message) => {
        const isOwn = message.sender_id === session.userId;
        const isNew = initialLoadDone.current && !renderedIds.has(message.message_uuid);
        const isSelected = selectedMessages.has(message.message_uuid);

        return (
          <MessageBubble
            key={message.message_uuid}
            message={message}
            isOwn={isOwn}
            session={session}
            friend={friend}
            isNew={isNew}
            isMultiSelectMode={isMultiSelectMode}
            isSelected={isSelected}
            onToggleSelect={() => onToggleSelect?.(message.message_uuid)}
            onRecall={() => onRecall?.(message.message_uuid)}
            onDelete={() => onDelete?.(message.message_uuid)}
            onEnterMultiSelect={onEnterMultiSelect}
          />
        );
      })}
    </>
  );
}
