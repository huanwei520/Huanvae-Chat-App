/**
 * 移动端消息列表页
 *
 * 复用 UnifiedList 的数据逻辑，但使用移动端专属的UI布局
 * 修复：使用正确的 useLocalConversations 返回值和 Friend 类型字段名
 *
 * 注意：同步状态横幅已移至 MobileMain.tsx 独立渲染，避免页面切换时重新挂载
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import { AIAvatar } from '../../components/common/AIAvatar';
import { formatMessageTime } from '../../utils/time';
import { compareByTimeDesc } from '../../components/unified/conversationSort';
import { useLocalConversations } from '../../hooks/useLocalConversations';
import { MobileDownloadCard } from '../../update/components/MobileDownloadCard';
import { GlobalMessageSearchResults } from '../../components/search/GlobalMessageSearchResults';
import { useChatStore } from '../../stores';
import { useSession } from '../../contexts/SessionContext';
import { parseFriendIdFromConversationId } from '../../utils/conversationId';
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

interface ConversationCard {
  uniqueKey: string;
  id: string;
  type: 'friend' | 'group';
  name: string;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  unreadCount: number;
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
  const { session } = useSession();

  // 构建好友卡片
  const friendCards = useMemo((): ConversationCard[] => {
    return (friends || []).map((friend) => {
      // 从 unreadSummary 获取未读数
      const unread = unreadSummary?.friend_unreads?.find(
        (u) => u.friend_id === friend.friend_id,
      );
      const localPreview = getFriendPreview(friend.friend_id);
      return {
        uniqueKey: `friend-${friend.friend_id}`,
        id: friend.friend_id,
        type: 'friend' as const,
        name: friend.friend_nickname,
        avatarUrl: friend.friend_avatar_url,
        lastMessage: localPreview?.lastMessage ?? null,
        lastMessageTime: localPreview?.lastMessageTime ?? null,
        unreadCount: unread?.unread_count ?? 0,
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
  // 纯时间降序（新→旧），未读不再优先分层：点击带红点的卡片清未读不会让它下移重排，
  // 与微信一致（红点仅作徽标）。共享比较器含 NaN 硬化与 uniqueKey tie-break
  const sortedCards = useMemo(() => {
    return [...activeCards].sort(compareByTimeDesc);
  }, [activeCards]);

  const handleCardClick = (card: ConversationCard) => {
    if (card.type === 'friend') {
      onSelectTarget({ type: 'friend', data: card.data as Friend });
    } else {
      onSelectTarget({ type: 'group', data: card.data as Group });
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
      <div className="mobile-contacts">
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

        <AnimatePresence initial={false}>
          {sortedCards.map((card) => (
            <motion.div
              key={card.uniqueKey}
              className="mobile-contact-card"
              onClick={() => handleCardClick(card)}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {/* 头像 */}
              <div className="mobile-contact-avatar" style={{ width: 44, height: 44 }}>
                {card.type === 'friend' ? (
                  <FriendAvatar friend={card.data as Friend} />
                ) : (
                  <GroupAvatar group={card.data as Group} />
                )}
              </div>

              {/* 信息 */}
              <div className="mobile-contact-info" style={{ flex: 1 }}>
                <div className="mobile-contact-name">{card.name}</div>
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
                      background: '#ff3b30',
                      borderRadius: 9,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'white',
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
          ))}
        </AnimatePresence>
      </div>

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
                onSelectTarget({ type: 'friend', data: data as Friend });
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
                  onSelectTarget({ type: 'friend', data: friendData });
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
    </div>
  );
}
