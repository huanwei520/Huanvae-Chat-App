/**
 * 私聊消息列表组件
 *
 * 使用 flex-direction: column-reverse 实现从下往上显示
 * 最新消息自然在底部可视区域，无需滚动
 *
 * 功能：
 * - 使用 AnimatePresence 支持消息入场/撤回退出动画
 * - 支持多选模式进行批量操作
 *
 * 动画机制：
 * - initialLoadDone: 标记初始加载是否完成（即使消息列表为空也会标记）
 * - renderedIds: 已渲染过的消息 ID 集合
 * - isNew: 判断消息是否需要入场动画（初始加载完成后的新消息）
 *
 * 占位符动画（解决布局变化导致的抽搐问题）：
 * - 占位符始终存在于 DOM 中，使用 position: absolute 脱离文档流
 * - 通过 opacity 和 pointerEvents 控制显示/隐藏
 * - 淡入时延迟 0.25s（等待消息退出动画完成），淡出时立即开始
 * - 这样消息删除/撤回时不会触发布局重排，避免视觉跳动
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  // 注意：即使消息列表为空，也要标记初始加载完成，这样后续发送的第一条消息才会有动画
  useEffect(() => {
    if (!loading && !initialLoadDone.current) {
      initialLoadDone.current = true;
      // 只记录当前已有的消息（可能为空集合）
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

  // 占位符始终存在于DOM中，使用 absolute 定位脱离文档流
  // 通过 opacity 控制显示/隐藏，避免布局变化导致的抽搐
  const isEmpty = messages.length === 0;

  return (
    <>
      {/* 暂无消息占位符 - 始终存在，通过透明度控制 */}
      <motion.div
        className="message-placeholder message-placeholder-absolute"
        initial={false}
        animate={{
          opacity: isEmpty ? 1 : 0,
          pointerEvents: isEmpty ? 'auto' : 'none',
        }}
        transition={{
          duration: 0.3,
          ease: 'easeOut',
          delay: isEmpty ? 0.25 : 0, // 淡入时延迟，淡出时立即
        }}
      >
        <p>暂无消息</p>
        <span>发送一条消息开始聊天吧</span>
      </motion.div>

      {/* 消息列表 */}
      <AnimatePresence mode="popLayout">
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
      </AnimatePresence>
    </>
  );
}
