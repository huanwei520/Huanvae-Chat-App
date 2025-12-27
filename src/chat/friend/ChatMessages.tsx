/**
 * 私聊消息列表组件
 *
 * @module chat/friend
 * @location src/chat/friend/ChatMessages.tsx
 *
 * 使用 flex-direction: column + 手动滚动位置补偿实现稳定的视角
 * 加载历史消息时，通过计算 scrollHeight 差值来保持当前视角
 *
 * 功能：
 * - 使用 AnimatePresence 支持消息入场/撤回退出动画
 * - 支持多选模式进行批量操作
 * - 无加载动画：消息从本地 SQLite 加载，速度极快
 * - 切换会话时整体进入/退出动画（类似发送/撤回效果）
 *
 * 消息排序机制：
 * - 消息按时间正序排列（旧→新）
 * - 发送中的消息排在最后（显示在底部）
 * - 发送完成后自动通过 layout 动画平滑移动到正确位置
 *
 * 滚动机制：
 * - 初始加载和切换会话时滚动到底部
 * - 新消息到达时，如果用户在底部则自动滚动
 * - 加载历史消息时，手动补偿 scrollTop 保持视角
 */

import { useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageBubble } from './MessageBubble';
import type { SessionInfo } from '../../components/common/Avatar';
import type { Friend, Message } from '../../types/chat';

/** 滚动到顶部触发加载的阈值（像素） */
const LOAD_MORE_THRESHOLD = 500;

/** 判断是否在底部的阈值（像素） */
const AT_BOTTOM_THRESHOLD = 100;

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
  /** 是否有更多历史消息 */
  hasMore?: boolean;
  /** 是否正在加载更多 */
  loadingMore?: boolean;
  /** 加载更多回调 */
  onLoadMore?: () => void;
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
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: ChatMessagesProps) {
  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null);

  // 是否在底部（用于判断新消息到达时是否自动滚动）
  const isAtBottomRef = useRef(true);

  // 上一次消息数量（用于检测新消息 vs 加载历史）
  const prevMessagesLengthRef = useRef(messages.length);

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 是否是首次加载（用于初始滚动到底部）
  const isFirstLoadRef = useRef(true);

  // 加载历史时的滚动位置记录
  const scrollSnapshotRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: Message) => msg.clientId || msg.message_uuid;

  // 消息排序：按时间正序（旧→新），发送中的消息排在最后
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      // 发送中的消息排在最后（显示在底部）
      if (a.sendStatus === 'sending' && b.sendStatus !== 'sending') { return 1; }
      if (b.sendStatus === 'sending' && a.sendStatus !== 'sending') { return -1; }
      // 其他按时间正序（旧→新）
      return new Date(a.send_time).getTime() - new Date(b.send_time).getTime();
    });
  }, [messages]);

  // 滚动处理：检测是否接近顶部 + 更新是否在底部
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;

    // 更新是否在底部
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;

    // 检测是否需要加载更多（接近顶部）
    if (!hasMore || loadingMore || loadLockRef.current || !onLoadMore) return;

    if (scrollTop < LOAD_MORE_THRESHOLD) {
      // 记录加载前的滚动位置（用于后续补偿）
      scrollSnapshotRef.current = {
        scrollHeight: containerRef.current.scrollHeight,
        scrollTop: containerRef.current.scrollTop,
      };
      loadLockRef.current = true;
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

  // 加载完成后解锁（带冷却期）
  useEffect(() => {
    if (!loadingMore && loadLockRef.current) {
      const timer = setTimeout(() => {
        loadLockRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loadingMore]);

  // 初始加载或切换好友时滚动到底部
  useLayoutEffect(() => {
    if (isFirstLoadRef.current && messages.length > 0 && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      isFirstLoadRef.current = false;
    }
  }, [messages.length]);

  // 切换好友时重置状态
  useEffect(() => {
    isFirstLoadRef.current = true;
    isAtBottomRef.current = true;
    loadLockRef.current = false;
    scrollSnapshotRef.current = null;
  }, [friend.friend_id]);

  // 消息数量变化时的处理
  useLayoutEffect(() => {
    const prevLength = prevMessagesLengthRef.current;
    const currentLength = messages.length;
    const deltaMessages = currentLength - prevLength;
    prevMessagesLengthRef.current = currentLength;

    if (!containerRef.current || deltaMessages === 0) return;

    // 情况1：加载历史消息（消息增加较多，且有滚动快照）
    if (deltaMessages > 3 && scrollSnapshotRef.current) {
      const { scrollHeight: oldScrollHeight, scrollTop: oldScrollTop } = scrollSnapshotRef.current;
      const newScrollHeight = containerRef.current.scrollHeight;
      const deltaHeight = newScrollHeight - oldScrollHeight;

      // 补偿滚动位置：新内容在顶部，需要增加 scrollTop
      containerRef.current.scrollTop = oldScrollTop + deltaHeight;
      scrollSnapshotRef.current = null;
      return;
    }

    // 情况2：新消息到达（1-3条），如果用户在底部则自动滚动
    if (deltaMessages > 0 && deltaMessages <= 3 && isAtBottomRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
    }
  }, [messages.length]);

  // 消息从本地 SQLite 加载，速度很快，不需要加载动画
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
      {/* 加载更多指示器 - 在顶部（DOM 开头） */}
      {(loadingMore || hasMore) && !isEmpty && (
        <div className="load-more-indicator">
          {loadingMore ? (
            <span className="loading-text">加载中...</span>
          ) : hasMore ? (
            <span className="has-more-text">向上滚动加载更多</span>
          ) : null}
        </div>
      )}

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
          delay: isEmpty ? 0.25 : 0,
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
