/**
 * 群聊消息列表组件
 *
 * @module chat/group
 * @location src/chat/group/GroupChatMessages.tsx
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
import { isMobile } from '../../utils/platform';
import { useScrollKeyboardControls } from '../shared/useScrollKeyboardControls';
import { GroupMessageBubble } from './GroupMessageBubble';
import { useGroupReadReceipt, groupReadReceiptText } from './useGroupReadReceipt';
import type { GroupMessage } from '../../api/groupMessages';

/** 滚动到顶部触发加载的阈值（可视高度的两倍） */
const LOAD_MORE_THRESHOLD_MULTIPLIER = 2;

/** 判断是否在底部的阈值（像素） */
const AT_BOTTOM_THRESHOLD = 100;

/** 打开会话后持续重申"吸底"的帧数 —— 抵消重渲染 / 头像异步 / overflow-anchor 致 scrollHeight 后续增长 */
const OPEN_STICK_FRAMES = 6;

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

  // 上一次消息数量（用于增量滚动判断）
  const prevMessagesLengthRef = useRef(0);

  // 是否已完成"打开会话首次滚到底"（按 key 重挂后每次打开从 false 开始）
  const didInitialScrollRef = useRef(false);

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 加载历史时的滚动高度记录（仅记录 scrollHeight，补偿时使用当前 scrollTop）
  const scrollSnapshotRef = useRef<number | null>(null);

  // 打开会话"吸底泵"的 rAF 句柄 + 剩余重申帧数
  const stickRafRef = useRef<number | null>(null);
  const stickFramesRef = useRef(0);

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: GroupMessage) => msg.clientId || msg.message_uuid;

  // 消息去重 + 排序：按 message_uuid 去重后按时间正序（旧→新），发送中的消息排在最后
  const sortedMessages = useMemo(() => {
    const seen = new Set<string>();
    const deduped = messages.filter((msg) => {
      if (seen.has(msg.message_uuid)) { return false; }
      seen.add(msg.message_uuid);
      return true;
    });
    return deduped.sort((a, b) => {
      if (a.sendStatus === 'sending' && b.sendStatus !== 'sending') { return 1; }
      if (b.sendStatus === 'sending' && a.sendStatus !== 'sending') { return -1; }
      return new Date(a.send_time).getTime() - new Date(b.send_time).getTime();
    });
  }, [messages]);

  // 群已读回执：维护各成员已读位置，按每条消息 seq 统计已读人数（应读人数 = member_count − 1，排除发送者）
  const { countReaders, memberCount } = useGroupReadReceipt(groupId ?? null, sortedMessages);

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

  // 容器收缩（如 Android 键盘弹起致 WebView 变矮）时，若用户在底部则重新对齐
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') { return; }

    let prevHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) { return; }
      const newHeight = el.clientHeight;
      if (newHeight < prevHeight && isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      prevHeight = newHeight;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 打开会话"吸底泵"：立即吸底在调用点完成，这里负责随后几帧持续重申，
  // 抵消"合并重渲染 / 头像异步加载 / overflow-anchor 漂移"导致的 scrollHeight 后续增长，
  // 否则单帧 scrollTop 会落在旧底部之上 → 看不到最新一条（bug③）。
  // 用户中途上滑（handleScroll 置 isAtBottomRef=false）则停止，尊重用户操作。
  const startStickToBottom = useCallback(() => {
    if (stickRafRef.current !== null) {
      cancelAnimationFrame(stickRafRef.current);
    }
    stickFramesRef.current = OPEN_STICK_FRAMES;
    const step = () => {
      const el = containerRef.current;
      if (!el || stickFramesRef.current <= 0 || !isAtBottomRef.current) {
        stickRafRef.current = null;
        return;
      }
      el.scrollTop = el.scrollHeight;
      stickFramesRef.current -= 1;
      stickRafRef.current = requestAnimationFrame(step);
    };
    stickRafRef.current = requestAnimationFrame(step);
  }, []);

  // 卸载时取消吸底泵 rAF
  useEffect(() => () => {
    if (stickRafRef.current !== null) {
      cancelAnimationFrame(stickRafRef.current);
    }
  }, []);

  // 打开会话的滚动 + 消息变化时的增量滚动处理（useLayoutEffect 在 paint 前同步运行）
  useLayoutEffect(() => {
    const currentLength = messages.length;

    // 打开会话：第一帧有消息就立即滚到最新（底部），并启动吸底泵持续重申几帧。
    // GroupChatMessages 按 key={`group-${id}`} 重挂，didInitialScrollRef 每次打开从 false 开始。
    // 空首帧（缓存未命中、等 db 异步加载）不计，待真正有消息时再滚。
    if (!didInitialScrollRef.current) {
      prevMessagesLengthRef.current = currentLength;
      if (currentLength > 0 && containerRef.current) {
        didInitialScrollRef.current = true;
        const el = containerRef.current;
        el.scrollTop = el.scrollHeight;          // 立即吸底
        isAtBottomRef.current = true;
        startStickToBottom();                    // 随后几帧持续重申吸底
        // 打开会话即把键盘焦点落到消息区，End/Home/PageUp/PageDown 立即可用（桌面）。
        // 用 rAF 延后，确保压过 ChatInputArea mount 时的 textarea autofocus。
        if (!isMobile()) {
          requestAnimationFrame(() => {
            containerRef.current?.focus({ preventScroll: true });
          });
        }
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
  }, [messages, messages.length, groupId, startStickToBottom]);

  // 键盘滚动控制：容器可 Tab 聚焦，End 到最新 / Home 到顶 / PageUp·PageDown 翻页
  const { kbdFocused, containerProps } = useScrollKeyboardControls(containerRef);

  // 是否显示消息列表
  const isEmpty = messages.length === 0;

  return (
    <div
      ref={containerRef}
      className={`chat-messages-container${kbdFocused ? ' chat-messages-container--kbd-focused' : ''}`}
      {...containerProps}
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
        <span>发送一条消息开始群聊吧</span>
      </motion.div>

      {/* 消息列表 */}
      {!isEmpty && (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            {sortedMessages.map((message) => {
              const isOwn = message.sender_id === currentUserId;
              const stableKey = getStableKey(message);
              const isSelected = selectedMessages.has(message.message_uuid);

              // 每条消息（含他人发的）都显示阅读状态：已读人数排除该消息发送者，应读 = member_count − 1
              let readReceipt: { text: string } | undefined;
              if (message.sendStatus !== 'sending' && message.sendStatus !== 'failed' && !message.is_recalled) {
                const text = groupReadReceiptText(message.seq, countReaders(message.seq, message.sender_id), memberCount - 1);
                if (text) {
                  readReceipt = { text };
                }
              }

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
                  readReceipt={readReceipt}
                />
              );
            })}
          </AnimatePresence>
        </LayoutGroup>
      )}
    </div>
  );
}
