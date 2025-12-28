/**
 * 群聊消息列表组件
 *
 * @module chat/group
 * @location src/chat/group/GroupChatMessages.tsx
 *
 * 使用 flex-direction: column + 图片尺寸预加载实现稳定的视角
 *
 * 功能：
 * - 使用 AnimatePresence 支持消息入场/撤回退出动画
 * - 支持多选模式进行批量操作
 * - 图片尺寸预加载：渲染前先加载所有图片尺寸，避免布局偏移
 *
 * 消息排序机制：
 * - 消息按时间正序排列（旧→新）
 * - 发送中的消息排在最后（显示在底部）
 *
 * 滚动机制：
 * - 切换会话时等待图片尺寸加载完成后渲染，然后滚动到底部
 * - 新消息到达时，如果用户在底部则自动滚动
 * - 加载历史消息时，手动补偿 scrollTop 保持视角
 */

import { useMemo, useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { GroupMessageBubble } from './GroupMessageBubble';
import { getImageDimensions } from '../../services/imageDimensions';
import type { GroupMessage } from '../../api/groupMessages';

/** 滚动到顶部触发加载的阈值（可视高度的两倍） */
const LOAD_MORE_THRESHOLD_MULTIPLIER = 2;

/** 判断是否在底部的阈值（像素） */
const AT_BOTTOM_THRESHOLD = 100;

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
  /** 群组 ID（用于检测切换） */
  groupId?: string;
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
  groupId,
}: GroupChatMessagesProps) {
  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null);

  // 是否为管理员或群主
  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // 是否在底部（用于判断新消息到达时是否自动滚动）
  const isAtBottomRef = useRef(true);

  // 上一次消息数量（-1 表示初始状态）
  const prevMessagesLengthRef = useRef(-1);

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 加载历史时的滚动高度记录（仅记录 scrollHeight，补偿时使用当前 scrollTop）
  const scrollSnapshotRef = useRef<number | null>(null);

  // 图片尺寸是否准备就绪
  const [dimensionsReady, setDimensionsReady] = useState(false);

  // 已预加载的消息数量（用于检测消息变化）
  const preloadedCountRef = useRef(-1);

  // 当前群组 ID（用于检测切换）
  const currentGroupIdRef = useRef(groupId);

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: GroupMessage) => msg.clientId || msg.message_uuid;

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

  // 切换群组时重置状态
  useEffect(() => {
    if (currentGroupIdRef.current !== groupId) {
      currentGroupIdRef.current = groupId;
      setDimensionsReady(false);
      prevMessagesLengthRef.current = -1;
      preloadedCountRef.current = -1;
    }
  }, [groupId]);

  // 预加载图片尺寸（仅在首次加载或切换群组时阻塞渲染）
  useEffect(() => {
    // 已经就绪时，只需后台预加载新图片尺寸（不阻塞渲染）
    if (dimensionsReady) {
      const imageMessages = messages.filter((m) => m.message_type === 'image' && m.file_hash);
      if (imageMessages.length > 0) {
        imageMessages.forEach((m) => {
          if (m.file_hash) {
            getImageDimensions(m.file_hash);
          }
        });
      }
      return;
    }

    // 没有消息时等待
    if (messages.length === 0) {
      return;
    }

    // 获取所有图片消息
    const imageMessages = messages.filter((m) => m.message_type === 'image' && m.file_hash);

    // 没有图片消息时直接标记为就绪
    if (imageMessages.length === 0) {
      preloadedCountRef.current = messages.length;
      setDimensionsReady(true);
      return;
    }

    // 并行加载所有图片尺寸
    const loadAllDimensions = async () => {
      const promises = imageMessages.map((m) => getImageDimensions(m.file_hash ?? ''));
      await Promise.all(promises);
      preloadedCountRef.current = messages.length;
      setDimensionsReady(true);
    };

    loadAllDimensions();
  }, [messages, messages.length, dimensionsReady]);

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

  // 消息数量变化时的滚动处理（仅在 dimensionsReady 时执行）
  useLayoutEffect(() => {
    // 尺寸未就绪时不处理
    if (!dimensionsReady) { return; }

    const currentLength = messages.length;

    // 初始渲染：滚动到底部
    if (prevMessagesLengthRef.current === -1 || prevMessagesLengthRef.current === 0) {
      prevMessagesLengthRef.current = currentLength;

      if (containerRef.current && currentLength > 0) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
        isAtBottomRef.current = true;
      }
      return;
    }

    const prevLength = prevMessagesLengthRef.current;
    const deltaMessages = currentLength - prevLength;
    prevMessagesLengthRef.current = currentLength;

    if (!containerRef.current) { return; }

    // 情况1：deltaMessages 为 0，无需处理
    if (deltaMessages === 0) { return; }

    // 情况2：加载历史消息（消息增加较多，且有滚动快照）
    // 情况2：加载历史消息（消息增加较多，且有滚动快照）
    // 浏览器的 scroll anchoring 会自动保持视角，无需手动补偿
    if (deltaMessages > 3 && scrollSnapshotRef.current !== null) {
      scrollSnapshotRef.current = null;
      return;
    }

    // 情况3：新消息到达（1-3条）
    if (deltaMessages > 0 && deltaMessages <= 3) {
      // 检查是否有发送中的消息（自己发送的消息始终滚动到底部）
      const hasSendingMessage = messages.some((m) => m.sendStatus === 'sending');

      if (hasSendingMessage || isAtBottomRef.current) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: 'smooth',
            });
            isAtBottomRef.current = true;
          }
        });
      }
    }
  }, [messages, messages.length, groupId, dimensionsReady]);

  // 是否显示消息列表
  const isEmpty = messages.length === 0;
  const shouldRenderMessages = dimensionsReady && !isEmpty;

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
      {!loadingMore && !hasMore && shouldRenderMessages && (
        <div className="load-more-indicator">
          <span className="no-more-text">无更多记录</span>
        </div>
      )}

      {/* 加载中提示（切换群组或预加载图片尺寸） */}
      {!dimensionsReady && !isEmpty && (
        <div className="load-more-indicator">
          <span className="loading-text">加载中...</span>
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
        <span>发送一条消息开始群聊吧</span>
      </motion.div>

      {/* 消息列表 - 仅在尺寸就绪后渲染 */}
      {shouldRenderMessages && (
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
      )}
    </div>
  );
}
