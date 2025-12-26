/**
 * 私聊消息列表组件
 *
 * @module chat/friend
 * @location src/chat/friend/ChatMessages.tsx
 *
 * 使用 flex-direction: column-reverse 实现从下往上显示
 * 最新消息自然在底部可视区域，无需滚动
 *
 * 功能：
 * - 使用 AnimatePresence 支持消息入场/撤回退出动画
 * - 支持多选模式进行批量操作
 * - 无加载动画：消息从本地 SQLite 加载，速度极快
 * - 切换会话时整体进入/退出动画（类似发送/撤回效果）
 *
 * 消息排序机制：
 * - 发送中的消息始终排在最前面（column-reverse 显示为最下方）
 * - 发送完成后自动通过 layout 动画平滑移动到正确位置
 *
 * 占位符动画（解决布局变化导致的抽搐问题）：
 * - 占位符始终存在于 DOM 中，使用 position: absolute 脱离文档流
 * - 通过 opacity 和 pointerEvents 控制显示/隐藏
 */

import { useMemo } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageBubble } from './MessageBubble';
import type { SessionInfo } from '../../components/common/Avatar';
import type { Friend, Message } from '../../types/chat';

// ============================================
// 切换会话时的整体动画
// ============================================

/** 消息列表容器动画变体 - 类似发送消息的滑入效果 */
const containerVariants = {
  initial: {
    opacity: 0,
    x: 30,       // 从右侧滑入
    scale: 0.98,
  },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: {
    opacity: 0,
    x: -30,      // 向左侧滑出（类似撤回）
    scale: 0.98,
  },
};

/** 动画过渡配置 */
const containerTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  opacity: { duration: 0.2 },
};

interface ChatMessagesProps {
  /** @deprecated 不再使用，消息从本地加载速度很快 */
  loading?: boolean;
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
  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: Message) => msg.clientId || msg.message_uuid;

  // 消息排序：发送中的消息排在最前面（column-reverse 显示为最下方）
  // 其他消息按时间倒序排列
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      // 发送中的消息优先
      if (a.sendStatus === 'sending' && b.sendStatus !== 'sending') { return -1; }
      if (b.sendStatus === 'sending' && a.sendStatus !== 'sending') { return 1; }
      // 其他按时间倒序
      return new Date(b.send_time).getTime() - new Date(a.send_time).getTime();
    });
  }, [messages]);

  // 消息从本地 SQLite 加载，速度很快，不需要加载动画
  // 占位符始终存在于DOM中，使用 absolute 定位脱离文档流
  // 通过 opacity 控制显示/隐藏，避免布局变化导致的抽搐
  const isEmpty = messages.length === 0;

  return (
    <motion.div
      className="chat-messages-container"
      variants={containerVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={containerTransition}
    >
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

      {/* 消息列表 - LayoutGroup 确保消息间布局动画协调 */}
      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          {sortedMessages.map((message) => {
            const isOwn = message.sender_id === session.userId;
            const stableKey = getStableKey(message);
            const isSelected = selectedMessages.has(message.message_uuid);

            return (
              <MessageBubble
                key={stableKey}
                message={message}
                isOwn={isOwn}
                session={session}
                friend={friend}
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
      </LayoutGroup>
    </motion.div>
  );
}
