/**
 * 群聊消息列表组件
 *
 * @module chat/group
 * @location src/chat/group/GroupChatMessages.tsx
 *
 * 使用 flex-direction: column-reverse 实现"自锚定底部"——滚动原点在底部，
 * 上方内容增高（已读回执 / 头像 / 图片 / 未来任何组件）时浏览器原生保持贴底，
 * 无需 JS 重滚、无需任何组件预留高度。打开/切换会话天然停在最新一条。
 *
 * 消息排序机制：
 * - 按时间倒序排列（新→旧，与数据层 [newMessage, ...prev] 一致）
 * - column-reverse 把 DOM index 0（最新）渲染在视觉底部
 * - 发送中的消息排在 index 0（视觉最底）
 *
 * 滚动机制（全部由 column-reverse 原生保证，无 JS 重滚）：
 * - 打开会话：scrollTop=0 即底部，首帧即停在最新
 * - 新消息到达：prepend 到 index 0（视觉底），在底部时原生跟随、上滑时不打扰
 * - 内容增高：滚动锚定在底部，上方增高不推走最新一条
 * - 加载历史：older 追加到 DOM 末尾（视觉顶），底部原生不动，无需补偿
 *
 * 出现动画：打开/切换会话（组件按会话 key 重挂）时，容器整块 opacity 淡入
 * （panelFadeTransition，~200ms）；历史消息不逐条入场（shouldPlayEnter→initial=false），
 * 实时新消息仍滑入。三者合起来 = 无「从上向下逐条插入」的撑开/推挤/滚动跳变，只有柔和整体淡入。
 */

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { useScrollKeyboardControls } from '../shared/useScrollKeyboardControls';
import { GroupMessageBubble } from './GroupMessageBubble';
import { useGroupReadReceipt, groupReadReceiptText } from './useGroupReadReceipt';
import type { GroupReader } from './useGroupReadReceipt';
import { GroupReadListModal } from './GroupReadListModal';
import { useChatStore } from '../../stores';
import { groupMemberDisplayName } from '../../utils/groupRemark';
import { shouldPlayEnter, panelFadeTransition } from '../shared/animations';
import {
  buildReplyPreviewIndex,
  resolveReplyQuote,
  summarizeMessageForReply,
} from '../shared/replyPreview';
import { groupConversationKey } from '../shared/conversationKey';
import { groupMessagesIntoAlbums } from '../shared/mediaGroup';
import type { GroupMessage } from '../../api/groupMessages';

/** 滚动到顶部触发加载的阈值（可视高度的两倍） */
const LOAD_MORE_THRESHOLD_MULTIPLIER = 2;

interface GroupChatMessagesProps {
  /** 消息是否加载中：用于占位门控——仅 !loading && 列表为空 才显示"暂无消息"，避免缓存未命中加载期占位闪烁 */
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
  loading = false,
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

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 是否已把键盘焦点落到消息区（按会话 key 重挂后每次打开从 false 开始）
  const didFocusRef = useRef(false);

  // 入场动画基准：列表首帧非空时的 key 快照。在快照内 = 挂载时已有的历史（切换/打开不演入场）；
  // 不在 = 挂载后新增的实时新消息（演滑入）。组件按会话 key 重挂，故每个会话各自捕获一次。
  const mountedKeysRef = useRef<Set<string> | null>(null);

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: GroupMessage) => msg.clientId || msg.message_uuid;

  // 消息去重 + 排序：按 message_uuid 去重后按时间倒序（新→旧）。
  // column-reverse 把 index 0（最新）放在视觉底部；发送中的消息排在 index 0（视觉最底）。
  const sortedMessages = useMemo(() => {
    const seen = new Set<string>();
    const deduped = messages.filter((msg) => {
      if (seen.has(msg.message_uuid)) { return false; }
      seen.add(msg.message_uuid);
      return true;
    });
    return deduped.sort((a, b) => {
      if (a.sendStatus === 'sending' && b.sendStatus !== 'sending') { return -1; }
      if (b.sendStatus === 'sending' && a.sendStatus !== 'sending') { return 1; }
      return new Date(b.send_time).getTime() - new Date(a.send_time).getTime();
    });
  }, [messages]);

  // 捕获挂载入场基准：首帧非空时记下当前 key 快照（缓存未命中首帧为空，待 db 加载到的首批再捕获，
  // 它们都属"挂载时已有"→ 不演入场；此后真正新增的实时消息不在快照内 → 演滑入）。
  if (mountedKeysRef.current === null && sortedMessages.length > 0) {
    mountedKeysRef.current = new Set(sortedMessages.map((m) => getStableKey(m)));
  }

  // 群已读回执：维护各成员已读位置，按每条消息 seq 统计已读人数（应读人数 = member_count − 1，排除发送者）
  const { countReaders, readersAt, memberCount } = useGroupReadReceipt(groupId ?? null, sortedMessages);

  // 已读名单弹层：保存当前打开的已读者列表（null = 关闭）
  const [openReaders, setOpenReaders] = useState<GroupReader[] | null>(null);

  // D7 群内私有备注：本群「我设的备注」映射，用于已读名单显示名替换
  const groupRemarks = useChatStore((s) => (groupId ? s.groupMemberRemarks[groupId] : undefined));

  // ==================== 回复（引用）接线 ====================
  // 这层是「回复」功能在群消息列表侧的唯一接线点：气泡本身保持纯 props 驱动，
  // 不直接碰 store —— 这样既让气泡好测，也不会让 4 个既有气泡测试的 store mock 被打穿
  // （见 .claude/rules/frontend-test.md「改完 src/ 先 grep 谁 mock 了我」）。
  const setReplyDraft = useChatStore((s) => s.setReplyDraft);
  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);

  // 发送者在本群对我显示的名字（备注优先），气泡与引用块共用同一口径
  const displayNameOf = useCallback(
    (m: GroupMessage) => groupMemberDisplayName(groupRemarks?.[m.sender_id], m.sender_nickname),
    [groupRemarks],
  );

  // uuid → 引用预览 索引。数据源是当前已加载的全部消息（含 loadMore 拉回的历史）——
  // 后端不下发被引用消息的内容快照，只能本地反查；查不到时引用块显示「未加载，点击定位」占位。
  const replyPreviewIndex = useMemo(
    () => buildReplyPreviewIndex(messages, displayNameOf),
    [messages, displayNameOf],
  );

  // 相册折叠：同一 media_group_id 的 N 条消息折叠成一个渲染节点。
  // 折叠只压缩不重排，相册占据它在倒序列表里首次出现的位置。
  const renderNodes = useMemo(() => groupMessagesIntoAlbums(sortedMessages), [sortedMessages]);

  // 选中「回复」：把被回复者名字与摘要**当场快照**进草稿，而不是发送时再反查——
  // 用户完全可能在编辑期间翻走历史让原消息离开窗口。
  const handleReply = useCallback((message: GroupMessage) => {
    if (!groupId) { return; }
    setReplyDraft({
      conversationKey: groupConversationKey(groupId),
      messageUuid: message.message_uuid,
      senderName: displayNameOf(message),
      preview: summarizeMessageForReply(message),
    });
  }, [groupId, setReplyDraft, displayNameOf]);

  // 没有 groupId 就建不出草稿 —— 与其给个点了没反应的菜单项，不如让气泡把「回复」整项藏掉
  const onReplyOrUndefined = groupId ? handleReply : undefined;

  // 点击引用块：复用全局搜索那条定位通路（useMainPage 监听 pendingScrollToMessageId，
  // 负责拉历史 + 滚动 + 高亮 + 找不到时给降级提示），不另造一套滚动机制。
  const handleQuoteClick = useCallback((targetUuid: string) => {
    setPendingScrollToMessageId(targetUuid);
  }, [setPendingScrollToMessageId]);

  // 滚动处理：仅检测"接近顶部（最旧）"以触发加载更多。
  // column-reverse 坐标：滚动原点在底部，离底距离 = |scrollTop|；到顶距离 = 总可滚距离 − 离底距离。
  // 用 Math.abs 写成符号无关，兼容不同引擎对 column-reverse scrollTop 的符号约定。
  const handleScroll = useCallback(() => {
    if (!containerRef.current) { return; }
    if (!hasMore || loadingMore || loadLockRef.current || !onLoadMore) { return; }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromTop = scrollHeight - clientHeight - Math.abs(scrollTop);
    const threshold = clientHeight * LOAD_MORE_THRESHOLD_MULTIPLIER;
    if (distanceFromTop < threshold) {
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

  // 打开会话即把键盘焦点落到消息区（桌面），End/Home/PageUp/PageDown 立即可用。
  // 用 rAF 延后，确保压过 ChatInputArea mount 时的 textarea autofocus；
  // 等真正有消息时才聚焦（空首帧不计），按 messages.length 变化重试、聚焦一次即止。
  useEffect(() => {
    if (didFocusRef.current || isMobile() || messages.length === 0) { return; }
    didFocusRef.current = true;
    const raf = requestAnimationFrame(() => {
      containerRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages.length]);

  // 键盘滚动控制：容器可 Tab 聚焦，End 到最新 / Home 到顶 / PageUp·PageDown 翻页
  const { containerProps } = useScrollKeyboardControls(containerRef);

  // 是否显示消息列表
  const isEmpty = messages.length === 0;
  // 仅"加载完成且确为空"才显示占位——加载中（缓存未命中拉 db）不显示，消除"暂无消息"闪烁
  const showPlaceholder = !loading && isEmpty;

  return (
    <motion.div
      ref={containerRef}
      className="chat-messages-container chat-messages-container--reverse"
      // 打开/切换会话时整块淡入（容器按会话 key 重挂 → 每次挂载播一次）；
      // opacity 不影响 column-reverse 布局/滚动，首帧已贴底，淡入期间零布局变化。
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={panelFadeTransition}
      {...containerProps}
    >
      {/* 暂无消息占位符 - 绝对定位，与 flex 方向无关，始终在视觉中部 */}
      <motion.div
        className="message-placeholder message-placeholder-absolute"
        initial={false}
        animate={{
          opacity: showPlaceholder ? 1 : 0,
          pointerEvents: showPlaceholder ? 'auto' : 'none',
        }}
        transition={{
          duration: 0.3,
          ease: 'easeOut',
          delay: showPlaceholder ? 0.25 : 0,
        }}
      >
        <p>暂无消息</p>
        <span>发送一条消息开始群聊吧</span>
      </motion.div>

      {/* 消息列表：按 DESC（新→旧）渲染，index 0 为最新；column-reverse 使其落在视觉底部 */}
      {!isEmpty && (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            {renderNodes.map((node) => {
              // 相册节点取组内最小位次那条作代表（头像/时间/已读/菜单以它为准）
              const message = node.kind === 'album' ? node.items[0] : node.message;
              if (!message) { return null; }
              const album = node.kind === 'album' ? node : null;
              const isOwn = message.sender_id === currentUserId;
              const stableKey = node.kind === 'album' ? `album-${node.groupId}` : getStableKey(message);
              const playEnter = shouldPlayEnter(message.clientId, stableKey, mountedKeysRef.current);
              const isSelected = selectedMessages.has(message.message_uuid);

              // 仅自己发出的已送达消息显示已读态（含文案 + 已读者名单）：已读人数排除发送者，应读 = member_count − 1；
              // 发送中/失败由 bubble 内状态槽按 sendStatus 显示，已撤回不显示
              let readReceipt: { text: string | null; readers: GroupReader[] } | undefined;
              if (isOwn && message.sendStatus !== 'sending' && message.sendStatus !== 'failed' && !message.is_recalled) {
                const text = groupReadReceiptText(message.seq, countReaders(message.seq, message.sender_id), memberCount - 1);
                // D7：已读者显示名套用我设的私有备注（备注→群昵称/原显示名），覆盖头像堆叠 tooltip + 名单弹层
                const readers = readersAt(message.seq, message.sender_id).map((r) => ({
                  ...r,
                  displayName: groupMemberDisplayName(groupRemarks?.[r.userId], r.displayName),
                }));
                readReceipt = { text, readers };
              }

              // 引用块内容：非回复消息为 null（不渲染），原消息不在窗口内则给占位（仍可点）
              const replyQuote = resolveReplyQuote(replyPreviewIndex, message.reply_to);

              return (
                <GroupMessageBubble
                  key={stableKey}
                  message={message}
                  isOwn={isOwn}
                  replyQuote={replyQuote}
                  onQuoteClick={handleQuoteClick}
                  onReply={onReplyOrUndefined}
                  isHighlighted={highlightedMessageId === message.message_uuid}
                  album={album}
                  isMultiSelectMode={isMultiSelectMode}
                  isSelected={isSelected}
                  onToggleSelect={() => onToggleSelect?.(message.message_uuid)}
                  onRecall={() => onRecall?.(message.message_uuid)}
                  onDelete={() => onDelete?.(message.message_uuid)}
                  onEnterMultiSelect={onEnterMultiSelect}
                  isAdmin={isAdmin}
                  readReceipt={readReceipt}
                  onOpenReadList={setOpenReaders}
                  groupId={groupId}
                  playEnter={playEnter}
                />
              );
            })}
          </AnimatePresence>
        </LayoutGroup>
      )}

      {/* 已读名单弹层（桌面居中 modal / 移动底部 sheet；createPortal 到 body，不参与 column-reverse 布局） */}
      <GroupReadListModal
        isOpen={openReaders !== null}
        readers={openReaders ?? []}
        onClose={() => setOpenReaders(null)}
      />

      {/* 顶部指示器：置于 DOM 末尾 → column-reverse 下位于视觉顶部（最旧消息上方） */}
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
    </motion.div>
  );
}
