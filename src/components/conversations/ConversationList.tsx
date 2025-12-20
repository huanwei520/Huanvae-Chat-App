/**
 * 会话列表组件
 *
 * 混合显示好友和群聊，按未读数和最后消息时间排序
 * 类似微信的消息列表
 *
 * 功能：
 * - 群聊卡片显示 [群聊] 标记以区分好友会话
 * - 按未读消息数和最后消息时间排序
 * - 搜索过滤
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../common/Avatar';
import { SearchBox } from '../common/SearchBox';
import { ListLoading, ListError, ListEmpty } from '../common/ListStates';
import { formatMessageTime } from '../../utils/time';
import { cardVariants, panelVariants } from '../../constants/listAnimations';
import type { Friend, Group, ChatTarget } from '../../types/chat';
import type { UnreadSummary } from '../../types/websocket';

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
  panelWidth?: number;
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
  panelWidth = 280,
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

  // 渲染列表内容（避免嵌套三元表达式）
  const renderListContent = () => {
    if (loading) {
      return <ListLoading />;
    }
    if (error) {
      return <ListError error={error} />;
    }
    if (filteredConversations.length === 0) {
      return <ListEmpty message={searchQuery ? '未找到匹配的会话' : '暂无会话'} />;
    }
    return filteredConversations.map((item, index) => (
      <motion.div
        key={`${item.type}-${item.id}`}
        className={`conversation-item ${isSelected(item) ? 'active' : ''}`}
        onClick={() => {
          if (item.type === 'friend') {
            onSelectTarget({ type: 'friend', data: item.data as Friend });
          } else {
            onSelectTarget({ type: 'group', data: item.data as Group });
          }
        }}
        variants={cardVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        custom={index}
      >
        <div className="conv-avatar">
          {item.type === 'friend' ? (
            <FriendAvatar friend={item.data as Friend} />
          ) : (
            <GroupAvatar group={item.data as Group} />
          )}
        </div>
        <div className="conv-info">
          <div className="conv-header">
            <span className="conv-name">
              {item.type === 'group' && <span className="conv-tag">[群聊]</span>}
              {item.name}
            </span>
            {item.lastMessageTime && (
              <span className="conv-time">{formatMessageTime(item.lastMessageTime)}</span>
            )}
          </div>
          <div className="conv-footer">
            <span className="conv-preview">
              {item.lastMessage || '暂无消息'}
            </span>
            {item.unreadCount > 0 && (
              <span className="conv-unread">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>
            )}
          </div>
        </div>
      </motion.div>
    ));
  };

  return (
    <motion.section
      className="chat-list-panel"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="chat-list-header">
        <SearchBox
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          panelWidth={panelWidth}
          placeholder="搜索会话"
        />
      </div>

      <div className="conversation-list">
        <AnimatePresence mode="popLayout">
          {renderListContent()}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
