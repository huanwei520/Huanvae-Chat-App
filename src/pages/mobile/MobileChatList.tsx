/**
 * 移动端消息列表页
 *
 * 复用 UnifiedList 的数据逻辑，但使用移动端专属的UI布局
 * 修复：使用正确的 useLocalConversations 返回值和 Friend 类型字段名
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import { formatMessageTime } from '../../utils/time';
import { useLocalConversations } from '../../hooks/useLocalConversations';
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
}: MobileChatListProps) {
  // 使用本地会话预览（与桌面端 UnifiedList 一致的方式）
  const { getFriendPreview, getGroupPreview, initialized } = useLocalConversations();

  // 构建好友卡片
  const friendCards = useMemo((): ConversationCard[] => {
    return (friends || []).map((friend) => {
      // 从 unreadSummary 获取未读数
      const unread = unreadSummary?.friend_unreads?.find(
        (u) => u.friend_id === friend.friend_id,
      );
      // 优先使用 WebSocket 的消息预览，fallback 到本地会话
      const localPreview = getFriendPreview(friend.friend_id);
      return {
        uniqueKey: `friend-${friend.friend_id}`,
        id: friend.friend_id,
        type: 'friend' as const,
        name: friend.friend_nickname,
        avatarUrl: friend.friend_avatar_url,
        lastMessage: unread?.last_message ?? localPreview?.lastMessage ?? null,
        lastMessageTime: unread?.last_message_time ?? localPreview?.lastMessageTime ?? null,
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
      // 优先使用 WebSocket 的消息预览，fallback 到本地
      const localPreview = getGroupPreview(group.group_id);
      return {
        uniqueKey: `group-${group.group_id}`,
        id: group.group_id,
        type: 'group' as const,
        name: group.group_name,
        avatarUrl: group.group_avatar_url,
        lastMessage:
          unread?.last_message ??
          localPreview?.lastMessage ??
          group.last_message_content ??
          null,
        lastMessageTime:
          unread?.last_message_time ??
          localPreview?.lastMessageTime ??
          group.last_message_time ??
          null,
        unreadCount: unread?.unread_count ?? group.unread_count ?? 0,
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

  // 搜索过滤
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) {
      return activeCards;
    }
    const query = searchQuery.toLowerCase();
    return activeCards.filter((card) => card.name.toLowerCase().includes(query));
  }, [activeCards, searchQuery]);

  // 按最后消息时间排序（有未读优先，然后按时间）
  const sortedCards = useMemo(() => {
    return [...filteredCards].sort((a, b) => {
      // 有未读的优先
      if (a.unreadCount > 0 && b.unreadCount === 0) {
        return -1;
      }
      if (a.unreadCount === 0 && b.unreadCount > 0) {
        return 1;
      }
      // 按时间排序
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });
  }, [filteredCards]);

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

  if (sortedCards.length === 0) {
    return (
      <div className="mobile-contacts-empty">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          />
        </svg>
        <span>暂无会话</span>
      </div>
    );
  }

  return (
    <div className="mobile-contacts">
      <AnimatePresence mode="popLayout">
        {sortedCards.map((card) => (
          <motion.div
            key={card.uniqueKey}
            className="mobile-contact-card"
            onClick={() => handleCardClick(card)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* 头像 */}
            <div className="mobile-contact-avatar">
              {card.type === 'friend' ? (
                <FriendAvatar friend={card.data as Friend} size={44} />
              ) : (
                <GroupAvatar group={card.data as Group} size={44} />
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
  );
}
