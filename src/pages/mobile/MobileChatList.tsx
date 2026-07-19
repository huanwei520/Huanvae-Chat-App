/**
 * 移动端消息列表页
 *
 * 复用 UnifiedList 的数据逻辑，但使用移动端专属的UI布局
 * 修复：使用正确的 useLocalConversations 返回值和 Friend 类型字段名
 *
 * 注意：同步状态横幅已移至 MobileMain.tsx 独立渲染，避免页面切换时重新挂载
 */

import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import { AIAvatar } from '../../components/common/AIAvatar';
import { formatMessageTime } from '../../utils/time';
import { friendDisplayName } from '../../utils/friendName';
import { friendChatTarget } from '../../utils/chatTarget';
import { isBotUserId } from '../../api/bots';
import { BotBadge } from '../../components/common/BotBadge';
import { comparePinnedThenTime } from '../../components/unified/conversationSort';
import { ConversationContextMenu, PinFlagIcon } from '../../components/unified/ConversationContextMenu';
import { useLocalConversations } from '../../hooks/useLocalConversations';
import { MobileDownloadCard } from '../../update/components/MobileDownloadCard';
import { GlobalMessageSearchResults } from '../../components/search/GlobalMessageSearchResults';
import { useChatStore, useProfileViewStore } from '../../stores';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import { useSession } from '../../contexts/SessionContext';
import { parseFriendIdFromConversationId, getFriendConversationId } from '../../utils/conversationId';
import { setConversationPinned } from '../../db';
import type { Friend, Group, ChatTarget } from '../../types/chat';
import type { UnreadSummary } from '../../types/websocket';

interface MobileChatListProps {
  /** 好友列表 */
  friends: Friend[];
  /** 群聊列表 */
  groups: Group[];
  /** 搜索关键词 */
  searchQuery: string;
  /** 当前选中的聊天目标（暂未使用，预留） */
  selectedTarget?: ChatTarget | null;
  /** 选中目标回调 */
  onSelectTarget: (target: ChatTarget) => void;
  /** 未读消息摘要 */
  unreadSummary: UnreadSummary | null;
  /** AI 当前会话标题（可选） */
  aiConversationTitle?: string | null;
}

// 列表入场编排：容器只做 stagger 编排（无视觉属性），卡片 opacity+y 进场。
// transform/opacity 由 framer-motion 接管，.mobile-contact-card 的 CSS 不得
// 过渡这两个属性（见 tests/animation-conflict.test.ts 注册表）
const listVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.03, delayChildren: 0.05 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

interface ConversationCard {
  uniqueKey: string;
  id: string;
  /** bot 的 data 仍是 Friend，仅 UI 呈现区分 */
  type: 'friend' | 'bot' | 'group';
  name: string;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  unreadCount: number;
  /** 本地置顶状态（无本地会话行 = 未置顶） */
  isPinned: boolean;
  data: Friend | Group;
}

export function MobileChatList({
  friends,
  groups,
  searchQuery,
  onSelectTarget,
  unreadSummary,
  aiConversationTitle,
}: MobileChatListProps) {
  // 使用本地会话预览（与桌面端 UnifiedList 一致的方式）
  const { getFriendPreview, getGroupPreview, initialized } = useLocalConversations();
  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);
  // 好友在线状态 + 点头像看资料（与桌面 UnifiedList 一致）
  const friendPresence = useChatStore((s) => s.friendPresence);
  const openProfile = useProfileViewStore((s) => s.open);
  // 好友头像键盘焦点环（keyed：每张头像用 card.id 作 key）
  const avatarKbd = useKbdFocusRing();
  const { session } = useSession();

  // 构建好友卡片
  const friendCards = useMemo((): ConversationCard[] => {
    return (friends || []).map((friend) => {
      // 从 unreadSummary 获取未读数
      const unread = unreadSummary?.friend_unreads?.find(
        (u) => u.friend_id === friend.friend_id,
      );
      const localPreview = getFriendPreview(friend.friend_id);
      const isBot = isBotUserId(friend.friend_id);
      return {
        uniqueKey: `${isBot ? 'bot' : 'friend'}-${friend.friend_id}`,
        id: friend.friend_id,
        type: isBot ? ('bot' as const) : ('friend' as const),
        name: friendDisplayName(friend),
        avatarUrl: friend.friend_avatar_url,
        lastMessage: localPreview?.lastMessage ?? null,
        lastMessageTime: localPreview?.lastMessageTime ?? null,
        unreadCount: unread?.unread_count ?? 0,
        // 语义映射：本地无会话行（还没聊过）= 未置顶，非兜底
        isPinned: localPreview?.isPinned ?? false,
        data: friend,
      };
    });
  }, [friends, unreadSummary, getFriendPreview]);

  // 构建群聊卡片
  const groupCards = useMemo((): ConversationCard[] => {
    return (groups || []).map((group) => {
      // 从 unreadSummary 获取未读数
      const unread = unreadSummary?.group_unreads?.find(
        (u) => u.group_id === group.group_id,
      );
      const localPreview = getGroupPreview(group.group_id);
      return {
        uniqueKey: `group-${group.group_id}`,
        id: group.group_id,
        type: 'group' as const,
        name: group.group_name,
        avatarUrl: group.group_avatar_url,
        lastMessage: localPreview?.lastMessage ?? group.last_message_content ?? null,
        lastMessageTime: localPreview?.lastMessageTime ?? group.last_message_time ?? null,
        // 未读数只认 WS unreadSummary（按 last-read-seq 派生口径），不兜底 REST 的
        // group.unread_count（旧计数器列，口径分叉），与桌面端 UnifiedList 归一
        unreadCount: unread?.unread_count ?? 0,
        // 语义映射：本地无会话行（还没聊过）= 未置顶，非兜底
        isPinned: localPreview?.isPinned ?? false,
        data: group,
      };
    });
  }, [groups, unreadSummary, getGroupPreview]);

  // 合并所有卡片
  const allCards = useMemo(() => {
    return [...friendCards, ...groupCards];
  }, [friendCards, groupCards]);

  // 筛选有消息或有未读的卡片（消息tab只显示有会话的）
  const activeCards = useMemo(() => {
    return allCards.filter(
      (card) => card.lastMessage || card.unreadCount > 0,
    );
  }, [allCards]);

  // 卡片列表不再被 searchQuery 过滤（搜索结果在独立下框中渲染）
  // 置顶分层（置顶在前）+ 同层内纯时间降序（新→旧），未读不参与排序：点击带红点的
  // 卡片清未读不会让它下移重排，与微信一致（红点仅作徽标）。
  // 共享比较器含 NaN 硬化与 uniqueKey tie-break
  const sortedCards = useMemo(() => {
    return [...activeCards].sort(comparePinnedThenTime);
  }, [activeCards]);

  // ============================================
  // 长按（500ms）触发会话置顶菜单（参照 GroupMessageBubble 的 longPressTimerRef 模式），
  // 长按触发后抑制本次点击进聊天
  // ============================================
  const [pinMenu, setPinMenu] = useState<{ card: ConversationCard; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const handleCardTouchStart = (card: ConversationCard) => (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const position = { x: touch.clientX, y: touch.clientY };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setPinMenu({ card, ...position });
    }, 500);
  };

  // 手指移动/抬起时取消长按计时（已触发的菜单不受影响）
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTogglePin = async () => {
    if (!pinMenu) { return; }
    const { card } = pinMenu;
    setPinMenu(null);
    // 无 session 无法生成好友会话 ID（fail-fast，不用假 id 写库）
    if (!session) { return; }
    // bot 卡的 data 是 Friend，会话走 friend 链路
    const isGroup = card.type === 'group';
    const convId = isGroup ? card.id : getFriendConversationId(session.userId, card.id);
    await setConversationPinned(convId, isGroup ? 'group' : 'friend', card.name, !card.isPinned);
  };

  // group 直出；friend/bot 卡的 data 都是 Friend，由 friendChatTarget 按 bot_ 前缀分派
  const handleCardClick = (card: ConversationCard) => {
    // 长按已触发菜单：本次 touchend 派生的 click 不进聊天
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (card.type === 'group') {
      onSelectTarget({ type: 'group', data: card.data as Group });
    } else {
      onSelectTarget(friendChatTarget(card.data as Friend));
    }
  };

  // 加载中状态
  if (!initialized) {
    return (
      <div className="mobile-contacts-empty">
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="mobile-chat-list-wrapper">
      <motion.div
        className="mobile-contacts"
        variants={listVariants}
        initial="initial"
        animate="animate"
      >
        {/* 下载进度卡片 - 与消息卡片同级，始终在最顶部 */}
        <MobileDownloadCard />

        {/* AI 助手置顶卡片（始终渲染，不受好友/群聊数据影响） */}
        <div
          className="mobile-contact-card"
          onClick={() => onSelectTarget({ type: 'ai' })}
        >
          <div className="mobile-contact-avatar" style={{ width: 44, height: 44 }}>
            <AIAvatar />
          </div>
          <div className="mobile-contact-info" style={{ flex: 1 }}>
            <div className="mobile-contact-name">AI 助手</div>
            <div
              className="mobile-contact-role"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {aiConversationTitle || '有什么可以帮你的？'}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {sortedCards.map((card) => {
            // friend / bot 卡共享 Friend 数据与私聊交互（头像看资料、在线点）
            const isFriendLike = card.type === 'friend' || card.type === 'bot';
            // 仅好友（含 bot）头像可点看资料；键盘焦点态与 focus handlers 同条件挂载
            const avatarHandlers = isFriendLike ? avatarKbd.handlersFor(card.id) : null;
            const avatarKbdFocused = isFriendLike && avatarKbd.isKbdFocused(card.id);
            return (
              <motion.div
                key={card.uniqueKey}
                className="mobile-contact-card"
                onClick={() => handleCardClick(card)}
                onTouchStart={handleCardTouchStart(card)}
                onTouchMove={cancelLongPress}
                onTouchEnd={cancelLongPress}
                variants={cardVariants}
                exit="exit"
                whileTap={{ scale: 0.97 }}
              >
                {/* 头像 */}
                <div
                  className={`mobile-contact-avatar${avatarKbdFocused ? ' a11y-kbd-focus' : ''}`}
                  style={{ width: 44, height: 44, position: 'relative' }}
                  onClick={isFriendLike
                    ? (e) => { e.stopPropagation(); openProfile(card.id); }
                    : undefined}
                  onKeyDown={isFriendLike
                    ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        // 阻止冒泡到卡片（其 onClick=进聊天），头像键盘=看资料
                        e.preventDefault();
                        e.stopPropagation();
                        openProfile(card.id);
                      }
                    }
                    : undefined}
                  role={isFriendLike ? 'button' : undefined}
                  tabIndex={isFriendLike ? 0 : undefined}
                  aria-label={isFriendLike ? `查看${card.name}资料` : undefined}
                  onPointerDown={avatarHandlers?.onPointerDown}
                  onFocus={avatarHandlers?.onFocus}
                  onBlur={avatarHandlers?.onBlur}
                >
                  {isFriendLike ? (
                    <FriendAvatar friend={card.data as Friend} />
                  ) : (
                    <GroupAvatar group={card.data as Group} />
                  )}
                  {isFriendLike && friendPresence[card.id]?.online && (
                    <span
                      title="在线"
                      style={{
                        position: 'absolute', right: 0, bottom: 0,
                        width: 10, height: 10, borderRadius: '50%',
                        background: 'var(--presence-online)', border: '2px solid var(--presence-dot-ring)', boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>

                {/* 信息 */}
                <div className="mobile-contact-info" style={{ flex: 1 }}>
                  <div className="mobile-contact-name">
                    {card.name}
                    {/* Bot 徽标：静态呈现（无动画），统一走公共 BotBadge 组件 */}
                    {card.type === 'bot' && <BotBadge />}
                  </div>
                  {card.lastMessage && (
                    <div
                      className="mobile-contact-role"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {card.lastMessage}
                    </div>
                  )}
                </div>

                {/* 时间和未读 */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                  }}
                >
                  {/* 置顶图钉标识（与桌面 UnifiedList 同款） */}
                  {card.isPinned && (
                    <span
                      className="conv-pin-flag"
                      title="已置顶"
                      style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
                    >
                      <PinFlagIcon />
                    </span>
                  )}
                  {card.lastMessageTime && (
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {formatMessageTime(card.lastMessageTime)}
                    </span>
                  )}
                  {card.unreadCount > 0 && (
                    <span
                      style={{
                        minWidth: 18,
                        height: 18,
                        padding: '0 5px',
                        background: 'var(--unread-badge-bg)',
                        borderRadius: 9,
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--unread-badge-text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {card.unreadCount > 99 ? '99+' : card.unreadCount}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* 全局搜索浮层 — 从上往下拉出动画；query 清空时反向收回 */}
      <AnimatePresence>
        {searchQuery.trim() !== '' && (
          <GlobalMessageSearchResults
            key="search-overlay"
            query={searchQuery}
            friends={friends}
            groups={groups}
            currentUserId={session?.userId}
            layout="mobile"
            onSelectConversation={(type, data) => {
              if (type === 'friend') {
                onSelectTarget(friendChatTarget(data as Friend));
              } else {
                onSelectTarget({ type: 'group', data: data as Group });
              }
            }}
            onSelectMessage={(grp, hit) => {
              // 仅在找到目标会话时切换并设置跳转 — 避免残留 pending scroll id
              if (grp.conversationType === 'friend' && session) {
                const friendId = parseFriendIdFromConversationId(grp.conversationId, session.userId);
                const friendData = friendId ? friends.find((f) => f.friend_id === friendId) : undefined;
                if (friendData) {
                  onSelectTarget(friendChatTarget(friendData));
                  setPendingScrollToMessageId(hit.message.message_uuid);
                }
              } else if (grp.conversationType === 'group') {
                const groupData = groups.find((g) => g.group_id === grp.conversationId);
                if (groupData) {
                  onSelectTarget({ type: 'group', data: groupData });
                  setPendingScrollToMessageId(hit.message.message_uuid);
                }
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* 会话置顶长按菜单（portal 到 body） */}
      <ConversationContextMenu
        isOpen={pinMenu !== null}
        position={pinMenu ? { x: pinMenu.x, y: pinMenu.y } : { x: 0, y: 0 }}
        isPinned={pinMenu?.card.isPinned ?? false}
        onTogglePin={handleTogglePin}
        onClose={() => setPinMenu(null)}
      />
    </div>
  );
}
