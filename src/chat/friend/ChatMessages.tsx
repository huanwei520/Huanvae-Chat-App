/**
 * 私聊消息列表组件
 *
 * @module chat/friend
 * @location src/chat/friend/ChatMessages.tsx
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
 * 滚动机制（骨架由 column-reverse 原生保证；只有「新消息到达」那一条需要 JS 判一次）：
 * - 打开会话：scrollTop=0 即底部，首帧即停在最新
 * - 新消息到达：prepend 到 index 0（视觉底）。原生行为是「贴底时跟随、上滑时保持视位」，
 *   这对**别人发来的**消息是对的（读历史不该被拽走），但对「我刚按了发送」是错的 ——
 *   由 useStickToBottom 补一条判据：自己发的无条件滚底；别人发的只在「最新那条插入前
 *   还看得见（露出任何一部分）」时才跟。判据与实现全在那个 hook，群聊侧调同一个。
 * - 内容增高：滚动锚定在底部，上方增高不推走最新一条
 * - 加载历史：older 追加到 DOM 末尾（视觉顶），底部原生不动，无需补偿
 *
 * 出现动画：打开/切换会话（组件按会话 key 重挂）时，容器整块 opacity 淡入
 * （panelFadeTransition，~200ms）；历史消息不逐条入场（shouldPlayEnter→initial=false），
 * 实时新消息仍滑入。三者合起来 = 无「从上向下逐条插入」的撑开/推挤/滚动跳变，只有柔和整体淡入。
 */

import { useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { useScrollKeyboardControls } from '../shared/useScrollKeyboardControls';
import { JumpToLatestButton } from '../shared/JumpToLatestButton';
import { MessageBubble } from './MessageBubble';
import { useFriendReadReceipt, isReadBySeq } from './useFriendReadReceipt';
import { latestOwnReceiptUuid } from '../shared/readReceiptGate';
import { shouldPlayEnter, panelFadeTransition } from '../shared/animations';
import type { SessionInfo } from '../../components/common/Avatar';
import type { Friend, Message } from '../../types/chat';
import { useChatStore } from '../../stores';
import { friendDisplayName } from '../../utils/friendName';
import {
  buildReplyPreviewIndex,
  resolveReplyQuote,
  summarizeMessageForReply,
} from '../shared/replyPreview';
import { friendConversationKey } from '../shared/conversationKey';
import { groupMessagesIntoAlbums } from '../shared/mediaGroup';
import { runTightKeys, type SenderRunNode } from '../shared/senderRunGate';
import { isLocateScrollSettling } from '../shared/scrollMessageIntoView';
import { useStickToBottom } from '../shared/useStickToBottom';

/** 滚动到顶部触发加载的阈值（可视高度的两倍） */
const LOAD_MORE_THRESHOLD_MULTIPLIER = 2;

interface ChatMessagesProps {
  /** 消息是否加载中：用于占位门控——仅 !loading && 列表为空 才显示"暂无消息"，避免缓存未命中加载期占位闪烁 */
  loading?: boolean;
  messages: Message[];
  session: SessionInfo & { userId: string };
  friend: Friend;
  /**
   * 会话类型。bot 与 friend 的数据形态一致，但会话 key 前缀不同
   * （`bot:` vs `friend:`）—— 回复草稿的归属校验按 key 比对，
   * 这里传错会让 bot 会话的「正在回复」条永远显示不出来。
   */
  conversationType: 'friend' | 'bot';
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
  /**
   * 「回到最新」按钮的接管回调。传了就由上层负责回到最新（可先重新加载最新一段再定位），
   * 不传则按钮退回纯滚动（把消息列表容器滚回 scrollTop=0）。见 shared/JumpToLatestButton。
   */
  onJumpToLatest?: () => void;
  /**
   * 当前是否处于「定位窗口态」（列表是一段历史窗口，最新消息不在其中）。
   * 传 true 时「回到最新」按钮恒显 —— 窗口态下滚到容器底只是窗口的底，
   * 位置判据会误判成"已贴底"而把唯一的回程入口藏掉。
   */
  isWindowed?: boolean;
  /** 窗口态下向**更新**方向续加载（滚到窗口底部时触发）。非窗口态不传 */
  onLoadNewer?: () => void;
  /** 更新方向是否还有更多（窗口态才可能为 true） */
  hasNewer?: boolean;
}

export function ChatMessages({
  loading = false,
  messages,
  session,
  friend,
  conversationType,
  isMultiSelectMode = false,
  selectedMessages = new Set(),
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onJumpToLatest,
  isWindowed = false,
  onLoadNewer,
  hasNewer = false,
}: ChatMessagesProps) {
  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载锁（防止连续加载）
  const loadLockRef = useRef(false);

  // 是否已把键盘焦点落到消息区（按会话 key 重挂后每次打开从 false 开始）
  const didFocusRef = useRef(false);

  // 入场动画基准：列表首帧非空时的 key 快照。在快照内 = 挂载时已有的历史（切换/打开不演入场）；
  // 不在 = 挂载后新增的实时新消息（演滑入）。组件按会话 key 重挂，故每个会话各自捕获一次。
  const mountedKeysRef = useRef<Set<string> | null>(null);

  // 获取消息的稳定 key（优先使用 clientId）
  const getStableKey = (msg: Message) => msg.clientId || msg.message_uuid;

  // ==================== 回复（引用）接线 ====================
  // 这层是「回复」功能在私聊消息列表侧的唯一接线点：气泡本身保持纯 props 驱动，
  // 不直接碰 store —— 这样既让气泡好测，也不会让既有气泡测试的 store mock 被打穿
  // （见 .claude/rules/frontend-test.md「改完 src/ 先 grep 谁 mock 了我」）。
  const setReplyDraft = useChatStore((s) => s.setReplyDraft);
  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);

  // 私聊只有两个人，显示名不需要备注映射：自己的消息显示「我」，对方用好友显示名（含备注）。
  // 这正是 buildReplyPreviewIndex 要求调用方注入 resolveSenderName 的原因 ——
  // 私聊消息上根本没有 sender_nickname 字段可供默认。
  const displayNameOf = useCallback(
    (m: Message) => (m.sender_id === session.userId ? '我' : friendDisplayName(friend)),
    [session.userId, friend],
  );

  // uuid → 引用预览 索引。数据源是当前已加载的全部消息（含 loadMore 拉回的历史）——
  // 后端不下发被引用消息的内容快照，只能本地反查；查不到时引用块显示「未加载，点击定位」占位。
  const replyPreviewIndex = useMemo(
    () => buildReplyPreviewIndex(messages, displayNameOf),
    [messages, displayNameOf],
  );

  // 选中「回复」：把被回复者名字与摘要**当场快照**进草稿，而不是发送时再反查——
  // 用户完全可能在编辑期间翻走历史让原消息离开窗口。
  const handleReply = useCallback((message: Message) => {
    setReplyDraft({
      conversationKey: friendConversationKey(conversationType, friend.friend_id),
      messageUuid: message.message_uuid,
      senderName: displayNameOf(message),
      preview: summarizeMessageForReply(message),
    });
  }, [setReplyDraft, conversationType, friend.friend_id, displayNameOf]);

  // 点击引用块：复用全局搜索那条定位通路（useMainPage 监听 pendingScrollToMessageId，
  // 负责拉历史 + 滚动 + 高亮 + 找不到时给降级提示），不另造一套滚动机制。
  const handleQuoteClick = useCallback((targetUuid: string) => {
    setPendingScrollToMessageId(targetUuid);
  }, [setPendingScrollToMessageId]);

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

  // 相册折叠：把同一 media_group_id 的 N 条消息折叠成一个渲染节点。
  // 放在排序之后 —— 折叠只压缩不重排，相册占据它在倒序列表里首次出现的位置。
  const renderNodes = useMemo(() => groupMessagesIntoAlbums(sortedMessages), [sortedMessages]);

  // 捕获挂载入场基准：首帧非空时记下当前 key 快照（缓存未命中首帧为空，待 db 加载到的首批再捕获，
  // 它们都属"挂载时已有"→ 不演入场；此后真正新增的实时消息不在快照内 → 演滑入）。
  if (mountedKeysRef.current === null && sortedMessages.length > 0) {
    mountedKeysRef.current = new Set(sortedMessages.map((m) => getStableKey(m)));
  }

  // 收窄间距的行：视觉上紧挨在**下面**的那条与本条是同一个人连发的
  //（huanwei 2026-08-14 12:16「相连的气泡中间间隙将其缩小」）。
  //
  // 1:1 的气泡区已经没有头像了（17e1c5a 把双方头像整块搬去顶栏），所以这里只借
  // senderRunGate 的**分组**语义、不涉及头像锚点；分组键仍用 sender_id ——「同一人连发」
  // 在 1:1 里就是「连着几条都是我」或「连着几条都是对方」。撤回态照旧断组（senderKey=null）。
  const runNodes = useMemo<Array<SenderRunNode | undefined>>(
    () => renderNodes.map((node) => {
      const m = node.kind === 'album' ? node.items[0] : node.message;
      if (!m) { return undefined; }
      return {
        key: node.kind === 'album' ? `album-${node.groupId}` : getStableKey(m),
        senderKey: m.is_recalled ? null : m.sender_id,
      };
    }),
    [renderNodes],
  );
  const tightKeys = useMemo(() => runTightKeys(runNodes), [runNodes]);

  // 私聊已读回执：按 seq 判定对方是否已读到我发的消息（Telegram 风单向，只显示自己消息）
  const { peerLastReadSeq } = useFriendReadReceipt(friend.friend_id);

  // 已读标记的锚点：我发出的最新一条（更早的自己消息不挂标记，理由见 shared/readReceiptGate）。
  // 在 map **之外**算一次 O(n)，锚点取渲染代表消息（相册取组内代表），与下面 map 里的 message 同源。
  const latestOwnReceiptId = useMemo(
    () => latestOwnReceiptUuid(
      renderNodes.map((node) => (node.kind === 'album' ? node.items[0] : node.message)),
      session.userId,
    ),
    [renderNodes, session.userId],
  );

  // 滚动处理：仅检测"接近顶部（最旧）"以触发加载更多。
  // column-reverse 坐标：滚动原点在底部，离底距离 = |scrollTop|；到顶距离 = 总可滚距离 − 离底距离。
  // 用 Math.abs 写成符号无关，兼容不同引擎对 column-reverse scrollTop 的符号约定。
  const handleScroll = useCallback(() => {
    if (!containerRef.current) { return; }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const threshold = clientHeight * LOAD_MORE_THRESHOLD_MULTIPLIER;

    // 向**更新**方向续加载：仅定位窗口态下需要 —— 非窗口态的列表本就顶到最新，
    // 底部之下没有东西可加载。column-reverse 下"接近底部" = |scrollTop| 很小。
    //
    // 🔴 定位滚动刚落定的那一小段不触发：定位常把目标停在离窗口最新端很近的位置，
    // `Math.abs(scrollTop) < threshold` 当场成立 ⇒ 程序化滚动自己派发的 scroll 事件
    // 就会触发 onLoadNewer ⇒ 一次接 50 条到视觉底部 ⇒ 下面那个 prepend 保位
    // useLayoutEffect 直接改写 scrollTop，与刚落定的定位位置抢同一个属性。
    // 判据由 scrollMessageIntoView 自己持有（它才知道定位何时发生），见 isLocateScrollSettling。
    if (onLoadNewer && hasNewer && !loadingMore && Math.abs(scrollTop) < threshold) {
      if (isLocateScrollSettling()) { return; }
      onLoadNewer();
      return;
    }

    if (!hasMore || loadingMore || loadLockRef.current || !onLoadMore) { return; }

    const distanceFromTop = scrollHeight - clientHeight - Math.abs(scrollTop);
    if (distanceFromTop < threshold) {
      loadLockRef.current = true;
      onLoadMore();
    }
  }, [hasMore, hasNewer, loadingMore, onLoadMore, onLoadNewer]);

  // 向更新方向 prepend 后保持视觉位置（不跳版）
  //
  // column-reverse 下新加载的"更新"消息进入 DOM 开头 = 视觉底部，容器可滚总量随之变大。
  // 浏览器不会替我们补偿：本容器 CSS 显式 `overflow-anchor: none`（main.css:1741），
  // 滚动锚定被关掉了。不补偿的话，用户脚下的内容会整体上移一段 —— 就是"跳版"。
  // 做法是经典的 prepend 保位：记下增长量，把 scrollTop 同向推回去。
  //
  // ⚠️ jsdom 无布局（scrollHeight 恒 0），这段的**数值正确性无法在 vitest 里验证**，
  // 只能靠真机/真浏览器复核；这里能被测试守住的只有"触发时机"那一半。
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevFirstKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }

    const first = sortedMessages.length > 0 ? sortedMessages[0] : undefined;
    const firstKey = first ? getStableKey(first) : null;
    const prevHeight = prevScrollHeightRef.current;
    const prevFirstKey = prevFirstKeyRef.current;

    // 判定「底部（更新方向）长出了内容」需要三个条件同时成立：
    //   1. 上一次的首条**仍在**列表里 —— 这是区分「在它之前插入了更新的消息」（prepend，要补偿）
    //      与「整段被换掉」（jumpToLatest / 切会话 / 进定位窗口，**不能**补偿）的唯一可靠判据。
    //      🔴 真机实测踩过：漏了这条，从定位窗口点「回到最新」时整段替换被误判成 prepend，
    //      补偿把用户推离底部 —— 数据是最新 50 条了，画面却停在第 375 条附近。
    //   2. 首条确实换了人（同一批里可能进来多条）
    //   3. 总高确实变大（只看总高会把"图片加载完撑高"也算进来）
    const prevFirstStillPresent =
      prevFirstKey !== null && sortedMessages.some((m) => getStableKey(m) === prevFirstKey);
    const grewAtNewEnd =
      prevFirstStillPresent &&
      firstKey !== null &&
      firstKey !== prevFirstKey &&
      prevHeight !== null &&
      container.scrollHeight > prevHeight;

    if (grewAtNewEnd && prevHeight !== null) {
      const delta = container.scrollHeight - prevHeight;
      // scrollTop 在 column-reverse 下是「离底距离」（多数引擎为负）。底部长出 delta，
      // 要让原内容停在原处，离底距离就得同向增大 delta。写成符号保持，兼容两种约定。
      container.scrollTop += container.scrollTop <= 0 ? -delta : delta;
    }

    prevScrollHeightRef.current = container.scrollHeight;
    prevFirstKeyRef.current = firstKey;
  }, [sortedMessages]);

  // 新消息到达时是否贴回最新一条：自己发的无条件滚底，别人发的只在「最新那条原本看得见」时跟。
  // 判据与实现全在 useStickToBottom（群聊侧调同一个），此处只接线 —— 全仓不该有第二处判贴底。
  useStickToBottom(containerRef, sortedMessages);

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
    <>
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
          <span>发送一条消息开始聊天吧</span>
        </motion.div>

        {/* 消息列表：按 DESC（新→旧）渲染，index 0 为最新；column-reverse 使其落在视觉底部 */}
        {!isEmpty && (
          <LayoutGroup>
            <AnimatePresence mode="popLayout">
              {renderNodes.map((node) => {
                // 相册节点取组内最小位次那条作代表：头像 / 时间 / 已读回执 / 右键菜单都以它为准。
                // 后端保证整组同时撤回，故 is_recalled 用代表消息的即可。
                const message = node.kind === 'album' ? node.items[0] : node.message;
                if (!message) { return null; }
                const album = node.kind === 'album' ? node : null;
                const isOwn = message.sender_id === session.userId;
                const stableKey = node.kind === 'album' ? `album-${node.groupId}` : getStableKey(message);
                const playEnter = shouldPlayEnter(message.clientId, stableKey, mountedKeysRef.current);
                const isSelected = selectedMessages.has(message.message_uuid);

                // 已读态只挂「我发出的最新一条」：资格判定（自己发的 / 未撤回 / 已送达）已在
                // latestOwnReceiptUuid 内做过，这里只比对锚点。更早的自己消息不传 readReceipt ⇒
                // 气泡不渲染已读态；发送中/失败仍由 bubble 内状态槽按 sendStatus 显示，不受此门控影响。
                const readReceipt = message.message_uuid === latestOwnReceiptId
                  ? { isRead: isReadBySeq(message.seq, peerLastReadSeq) }
                  : undefined;

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
                    readReceipt={readReceipt}
                    replyQuote={resolveReplyQuote(replyPreviewIndex, message.reply_to)}
                    onQuoteClick={handleQuoteClick}
                    onReply={handleReply}
                    isHighlighted={highlightedMessageId === message.message_uuid}
                    album={album}
                    playEnter={playEnter}
                    // 下面紧挨着的那条也是同一人连发 ⇒ 收窄本行下边距（换人 / 撤回行断开时不收窄）
                    tightBelow={tightKeys.has(stableKey)}
                  />
                );
              })}
            </AnimatePresence>
          </LayoutGroup>
        )}

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

      {/* 「回到最新」浮动按钮：容器的**兄弟**，锚到外层 .chat-messages / .mobile-chat-messages
          （position:relative + overflow:hidden，不参与滚动）——放进滚动容器内部会随内容滚走。 */}
      <JumpToLatestButton
        containerRef={containerRef}
        onJumpToLatest={onJumpToLatest}
        forceVisible={isWindowed}
      />
    </>
  );
}
