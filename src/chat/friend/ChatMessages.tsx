/**
 * 私聊消息列表组件
 *
 * @module chat/friend
 * @location src/chat/friend/ChatMessages.tsx
 *
 * 使用 flex-direction: column 实现稳定的视角
 *
 * 功能：
 * - 使用 AnimatePresence 支持消息入场/撤回退出动画
 * - 支持多选模式进行批量操作
 * - 图片尺寸由后端消息携带 image_width/image_height，无需预加载
 *
 * 消息排序机制：
 * - 消息按时间正序排列（旧→新）
 * - 发送中的消息排在最后（显示在底部）
 *
 * 滚动机制：
 * - 切换会话时滚动到底部
 * - 新消息到达时，如果用户在底部则自动滚动
 * - 加载历史消息时，浏览器 scroll anchoring 自动保持视角
 */

import { useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageBubble } from './MessageBubble';
import type { SessionInfo } from '../../components/common/Avatar';
import type { Friend, Message } from '../../types/chat';

/** 滚动到顶部触发加载的阈值（可视高度的两倍） */
const LOAD_MORE_THRESHOLD_MULTIPLIER = 2;

/** 判断是否在底部的阈值（像素） */
const AT_BOTTOM_THRESHOLD = 100;

/** 调试模式 */
const DEBUG_SCROLL = true;

/** 调试日志 */
function logScroll(action: string, data?: Record<string, unknown>) {
  if (DEBUG_SCROLL) {
    // eslint-disable-next-line no-console
    console.log(`%c[Scroll] ${action}`, 'color: #E91E63; font-weight: bold', data ?? '');
  }
}

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

  // 上一次消息数量（-1 表示初始状态，用于跳过首次渲染的旧消息）
  const prevMessagesLengthRef = useRef(-1);

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 加载历史时的滚动高度记录（仅记录 scrollHeight，补偿时使用当前 scrollTop）
  const scrollSnapshotRef = useRef<number | null>(null);

  // 当前好友 ID
  const currentFriendIdRef = useRef(friend.friend_id);

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

  // 切换好友时重置状态
  useEffect(() => {
    if (currentFriendIdRef.current !== friend.friend_id) {
      logScroll('切换好友，重置状态', { from: currentFriendIdRef.current, to: friend.friend_id });
      currentFriendIdRef.current = friend.friend_id;
      prevMessagesLengthRef.current = -1;
    }
  }, [friend.friend_id]);

  // 滚动处理：检测是否接近顶部 + 更新是否在底部
  const handleScroll = useCallback(() => {
    if (!containerRef.current) { return; }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;

    // 更新是否在底部
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;

    // 检测是否需要加载更多（距离顶部三分之一可视高度时触发）
    if (!hasMore || loadingMore || loadLockRef.current || !onLoadMore) { return; }

    const threshold = clientHeight * LOAD_MORE_THRESHOLD_MULTIPLIER;
    if (scrollTop < threshold) {
      // 记录加载前的滚动高度（用于后续补偿）
      scrollSnapshotRef.current = containerRef.current.scrollHeight;
      loadLockRef.current = true;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // 添加滚动事件监听
  useEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }

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

  // 统计图片消息的尺寸信息
  const imageStats = useMemo(() => {
    const imageMessages = messages.filter((m) => m.message_type === 'image');
    const withDimensions = imageMessages.filter((m) => m.image_width && m.image_height);
    const withoutDimensions = imageMessages.filter((m) => !m.image_width || !m.image_height);
    return {
      total: imageMessages.length,
      withDimensions: withDimensions.length,
      withoutDimensions: withoutDimensions.length,
      missingList: withoutDimensions.map((m) => ({
        uuid: m.message_uuid.slice(0, 8),
        content: m.message_content.slice(0, 20),
      })),
    };
  }, [messages]);

  // 滚动到底部的辅助函数
  const scrollToBottom = useCallback((immediate = false) => {
    if (!containerRef.current) { return; }

    const { scrollHeight, scrollTop, clientHeight } = containerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;

    logScroll('执行滚动到底部', {
      scrollHeight,
      scrollTop,
      clientHeight,
      distanceToBottom,
      immediate,
    });

    if (immediate) {
      containerRef.current.scrollTop = scrollHeight;
    } else {
      containerRef.current.scrollTo({
        top: scrollHeight,
        behavior: 'smooth',
      });
    }
    isAtBottomRef.current = true;
  }, []);

  // 消息数量变化时的滚动处理
  useLayoutEffect(() => {
    const currentLength = messages.length;

    // 初始渲染：滚动到底部
    if (prevMessagesLengthRef.current === -1 || prevMessagesLengthRef.current === 0) {
      logScroll('首次渲染/从0加载', {
        currentLength,
        friendId: friend.friend_id,
        imageStats,
      });
      prevMessagesLengthRef.current = currentLength;

      // 滚动到底部
      if (containerRef.current && currentLength > 0) {
        scrollToBottom(true);
      }
      return;
    }

    const prevLength = prevMessagesLengthRef.current;
    const deltaMessages = currentLength - prevLength;
    prevMessagesLengthRef.current = currentLength;

    if (!containerRef.current) { return; }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;

    logScroll('消息变化', {
      friendId: friend.friend_id,
      prevLength,
      currentLength,
      deltaMessages,
      scrollHeight,
      scrollTop,
      distanceToBottom,
      isAtBottom: isAtBottomRef.current,
      imageStats,
    });

    // 情况1：deltaMessages 为 0，无需处理
    if (deltaMessages === 0) { return; }

    // 情况2：加载历史消息（消息增加较多，且有滚动快照）
    // 浏览器的 scroll anchoring 会自动保持视角，无需手动补偿
    if (deltaMessages > 3 && scrollSnapshotRef.current !== null) {
      logScroll('加载历史消息，依赖 scroll anchoring');
      scrollSnapshotRef.current = null;
      return;
    }

    // 情况3：新消息到达（1-3条）
    if (deltaMessages > 0 && deltaMessages <= 3) {
      // 检查是否有发送中的消息（自己发送的消息始终滚动到底部）
      const hasSendingMessage = messages.some((m) => m.sendStatus === 'sending');
      // 检查新消息中是否有图片
      const newMessages = messages.slice(-deltaMessages);
      const hasImageMessage = newMessages.some((m) => m.message_type === 'image');
      const newImageDimensions = newMessages
        .filter((m) => m.message_type === 'image')
        .map((m) => ({
          uuid: m.message_uuid.slice(0, 8),
          width: m.image_width,
          height: m.image_height,
        }));

      logScroll('新消息到达', {
        deltaMessages,
        hasSendingMessage,
        hasImageMessage,
        newImageDimensions,
        isAtBottom: isAtBottomRef.current,
        willScroll: hasSendingMessage || isAtBottomRef.current,
      });

      if (hasSendingMessage || isAtBottomRef.current) {
        // 使用 requestAnimationFrame 等待渲染完成
        requestAnimationFrame(() => {
          scrollToBottom(false);
        });
      }
    }
  }, [messages, messages.length, friend.friend_id, imageStats, scrollToBottom]);

  // 是否显示消息列表
  const isEmpty = messages.length === 0;

  return (
    <div
      ref={containerRef}
      className="chat-messages-container"
    >
      {/* 顶部指示器 */}
      {loadingMore && !isEmpty && (
        <div className="load-more-indicator">
          <span className="loading-text">加载中...</span>
        </div>
      )}
      {!loadingMore && !hasMore && !isEmpty && (
        <div className="load-more-indicator">
          <span className="no-more-text">无更多记录</span>
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

      {/* 消息列表 */}
      {!isEmpty && (
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
      )}
    </div>
  );
}
