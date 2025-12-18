/**
 * 会话列表组件
 *
 * 混合显示好友和群聊，按未读数和最后消息时间排序
 * 类似微信的消息列表
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../common/Avatar';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SearchIcon } from '../common/Icons';
import { formatMessageTime } from '../../utils/time';
import type { Friend, Group, ChatTarget } from '../../types/chat';
import type { UnreadSummary } from '../../types/websocket';

// 卡片动画变体：从左飞入，向右飞出（流畅舒缓版）
const cardVariants = {
  initial: { opacity: 0, x: -60, scale: 0.96 },
  animate: (index: number) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      delay: index * 0.04,
      ease: [0.16, 1, 0.3, 1], // 自然的缓入缓出
    },
  }),
  exit: (index: number) => ({
    opacity: 0,
    x: 60,
    scale: 0.96,
    transition: {
      duration: 0.35,
      delay: index * 0.02,
      ease: [0.4, 0, 0.2, 1], // Material Design 标准缓动
    },
  }),
};

// 面板动画变体
const panelVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

// 统一的会话项类型
interface ConversationItem {
  id: string;
  type: 'friend' | 'group';
  name: string;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  unreadCount: number;
  data: Friend | Group;
}

interface ConversationListProps {
  friends: Friend[];
  groups: Group[];
  friendsLoading: boolean;
  groupsLoading: boolean;
  friendsError: string | null;
  groupsError: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTarget: ChatTarget | null;
  onSelectTarget: (target: ChatTarget) => void;
  unreadSummary: UnreadSummary | null;
}

// 会话项组件
function ConversationItemComponent({
  item,
  isSelected,
  index,
  onSelect,
}: {
  item: ConversationItem;
  isSelected: boolean;
  index: number;
  onSelect: () => void;
}) {
  return (
    <motion.div
      className={`conversation-item ${isSelected ? 'active' : ''}`}
      onClick={onSelect}
      custom={index}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={{ backgroundColor: 'rgba(147, 197, 253, 0.15)' }}
    >
      <div className="conv-avatar">
        {item.type === 'friend' ? (
          <FriendAvatar friend={item.data as Friend} size={44} />
        ) : (
          <GroupAvatar group={item.data as Group} size={44} />
        )}
      </div>
      <div className="conv-info">
        <div className="conv-header">
          <span className="conv-name">
            {item.type === 'group' && <span className="conv-type-badge">[群]</span>}
            {item.name}
          </span>
          {item.lastMessageTime && (
            <span className="conv-time">{formatMessageTime(item.lastMessageTime)}</span>
          )}
        </div>
        <div className="conv-preview">
          <span className="conv-message">
            {item.lastMessage || (item.type === 'friend' ? `@${item.id}` : '暂无消息')}
          </span>
        </div>
      </div>
      {item.unreadCount > 0 && (
        <div className="unread-badge">
          {item.unreadCount > 99 ? '99+' : item.unreadCount}
        </div>
      )}
    </motion.div>
  );
}

function ConversationListContent({
  loading,
  error,
  conversations,
  searchQuery,
  selectedTarget,
  onSelectTarget,
}: {
  loading: boolean;
  error: string | null;
  conversations: ConversationItem[];
  searchQuery: string;
  selectedTarget: ChatTarget | null;
  onSelectTarget: (target: ChatTarget) => void;
}) {
  if (loading) {
    return (
      <div className="list-loading">
        <LoadingSpinner />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="list-error">
        <span>加载失败: {error}</span>
      </div>
    );
  }

  if (conversations.length === 0) {
    const message = searchQuery ? '未找到匹配的会话' : '暂无会话';
    return (
      <div className="list-empty">
        <span>{message}</span>
      </div>
    );
  }

  const isSelected = (item: ConversationItem) => {
    if (!selectedTarget) { return false; }
    if (selectedTarget.type === 'friend' && item.type === 'friend') {
      return selectedTarget.data.friend_id === item.id;
    }
    if (selectedTarget.type === 'group' && item.type === 'group') {
      return selectedTarget.data.group_id === item.id;
    }
    return false;
  };

  return (
    <>
      {conversations.map((item, index) => (
        <ConversationItemComponent
          key={`${item.type}-${item.id}`}
          item={item}
          isSelected={isSelected(item)}
          index={index}
          onSelect={() => {
            if (item.type === 'friend') {
              onSelectTarget({ type: 'friend', data: item.data as Friend });
            } else {
              onSelectTarget({ type: 'group', data: item.data as Group });
            }
          }}
        />
      ))}
    </>
  );
}

export function ConversationList({
  friends,
  groups,
  friendsLoading,
  groupsLoading,
  friendsError,
  groupsError,
  searchQuery,
  onSearchChange,
  selectedTarget,
  onSelectTarget,
  unreadSummary,
}: ConversationListProps) {
  // 构建并排序会话列表
  const conversations = useMemo(() => {
    const items: ConversationItem[] = [];

    // 添加好友会话
    (friends || []).forEach((friend) => {
      const unread = unreadSummary?.friend_unreads.find(u => u.friend_id === friend.friend_id);
      items.push({
        id: friend.friend_id,
        type: 'friend',
        name: friend.friend_nickname,
        avatarUrl: friend.friend_avatar_url,
        lastMessage: unread?.last_message_preview || null,
        lastMessageTime: unread?.last_message_time || friend.add_time,
        unreadCount: unread?.unread_count || 0,
        data: friend,
      });
    });

    // 添加群聊会话
    (groups || []).forEach((group) => {
      const unread = unreadSummary?.group_unreads.find(u => u.group_id === group.group_id);
      items.push({
        id: group.group_id,
        type: 'group',
        name: group.group_name,
        avatarUrl: group.group_avatar_url,
        lastMessage: unread?.last_message_preview || group.last_message_content,
        lastMessageTime: unread?.last_message_time || group.last_message_time,
        unreadCount: unread?.unread_count || group.unread_count || 0,
        data: group,
      });
    });

    // 排序：有未读的在前，然后按最后消息时间
    items.sort((a, b) => {
      // 有未读的排前面
      if (a.unreadCount > 0 && b.unreadCount === 0) { return -1; }
      if (a.unreadCount === 0 && b.unreadCount > 0) { return 1; }

      // 按最后消息时间排序
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });

    return items;
  }, [friends, groups, unreadSummary]);

  // 过滤会话
  const filteredConversations = useMemo(() => {
    if (!searchQuery) { return conversations; }
    const query = searchQuery.toLowerCase();
    return conversations.filter((item) =>
      item.name.toLowerCase().includes(query) ||
      item.id.toLowerCase().includes(query),
    );
  }, [conversations, searchQuery]);

  const loading = friendsLoading || groupsLoading;
  const error = friendsError || groupsError;

  return (
    <motion.section
      className="chat-list-panel"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="chat-list-header">
        <div className="search-box">
          <SearchIcon />
          <input
            type="text"
            placeholder="搜索会话"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="conversation-list">
        <ConversationListContent
          loading={loading}
          error={error}
          conversations={filteredConversations}
          searchQuery={searchQuery}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
        />
      </div>
    </motion.section>
  );
}
