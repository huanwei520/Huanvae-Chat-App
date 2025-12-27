/**
 * 群聊消息列表组件
 *
 * @module chat/group
 * @location src/chat/group/GroupChatMessages.tsx
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

import { useMemo, useRef, useCallback, useEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { GroupMessageBubble } from './GroupMessageBubble';
import type { GroupMessage } from '../../api/groupMessages';

/** 滚动到顶部触发加载的阈值（像素） - 提前加载避免画面抽搐 */
const LOAD_MORE_THRESHOLD = 500;

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

interface GroupChatMessagesProps {
  /** @deprecated 不再使用，消息从本地加载速度很快 */
  loading?: boolean;
  messages: GroupMessage[];
  currentUserId: string;
  /** 当前用户在群中的角色 */
  userRole?: 'owner' | 'admin' | 'member';
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
  /** 是否有更多历史消息 */
  hasMore?: boolean;
  /** 是否正在加载更多 */
  loadingMore?: boolean;
  /** 加载更多回调 */
  onLoadMore?: () => void;
}

export function GroupChatMessages({
  messages,
  currentUserId,
  userRole = 'member',
  isMultiSelectMode = false,
  selectedMessages = new Set(),
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: GroupChatMessagesProps) {
  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null);

  // 是否为管理员或群主
  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: GroupMessage) => msg.clientId || msg.message_uuid;

  // 滚动处理：检测是否接近顶部（由于 column-reverse，顶部是 scrollTop 最大值附近）
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !hasMore || loadingMore || !onLoadMore) {
      return;
    }

    const container = containerRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    
    // 计算距离顶部的距离
    const distanceFromTop = scrollHeight + scrollTop - clientHeight;
    
    if (distanceFromTop < LOAD_MORE_THRESHOLD) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // 添加滚动事件监听
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

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
      ref={containerRef}
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
        <span>发送一条消息开始群聊吧</span>
      </motion.div>

      {/* 消息列表 - LayoutGroup 确保消息间布局动画协调 */}
      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          {sortedMessages.map((message) => {
            const isOwn = message.sender_id === currentUserId;
            const stableKey = getStableKey(message);
            const isSelected = selectedMessages.has(message.message_uuid);

            return (
              <GroupMessageBubble
                key={stableKey}
                message={message}
                isOwn={isOwn}
                currentUserId={currentUserId}
                isMultiSelectMode={isMultiSelectMode}
                isSelected={isSelected}
                onToggleSelect={() => onToggleSelect?.(message.message_uuid)}
                onRecall={() => onRecall?.(message.message_uuid)}
                onDelete={() => onDelete?.(message.message_uuid)}
                onEnterMultiSelect={onEnterMultiSelect}
                isAdmin={isAdmin}
              />
            );
          })}
        </AnimatePresence>
      </LayoutGroup>

      {/* 加载更多指示器 - 在顶部显示（由于 column-reverse 实际在 DOM 末尾） */}
      {(loadingMore || hasMore) && !isEmpty && (
        <div className="load-more-indicator">
          {loadingMore ? (
            <span className="loading-text">加载中...</span>
          ) : hasMore ? (
            <span className="has-more-text">向上滚动加载更多</span>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
