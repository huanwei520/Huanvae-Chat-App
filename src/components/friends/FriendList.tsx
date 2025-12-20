/**
 * 好友列表组件
 *
 * 功能：
 * - 使用 AnimatePresence 支持好友增删时的入场/退出动画
 * - 新好友插入时从左侧淡入
 * - 删除好友时向右滑出
 */

import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar } from '../common/Avatar';
import { SearchBox } from '../common/SearchBox';
import { ListLoading, ListError, ListEmpty } from '../common/ListStates';
import { formatMessageTime } from '../../utils/time';
import { cardVariants, panelVariants } from '../../constants/listAnimations';
import type { Friend } from '../../types/chat';

interface FriendListProps {
  friends: Friend[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedFriendId: string | null;
  onSelectFriend: (friend: Friend) => void;
  getUnreadCount?: (friendId: string) => number;
  panelWidth?: number;
}

export function FriendList({
  friends,
  loading,
  error,
  searchQuery,
  onSearchChange,
  selectedFriendId,
  onSelectFriend,
  getUnreadCount,
  panelWidth = 280,
}: FriendListProps) {
  // 过滤好友列表
  const filteredFriends = (friends || []).filter((friend) =>
    friend.friend_nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.friend_id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // 渲染列表内容（避免嵌套三元表达式）
  const renderListContent = () => {
    if (loading) {
      return <ListLoading />;
    }
    if (error) {
      return <ListError error={error} />;
    }
    if (filteredFriends.length === 0) {
      return <ListEmpty message={searchQuery ? '未找到匹配的好友' : '暂无好友'} />;
    }
    return filteredFriends.map((friend, index) => {
      const unreadCount = getUnreadCount?.(friend.friend_id) || 0;
      return (
        <motion.div
          key={friend.friend_id}
          className={`conversation-item ${selectedFriendId === friend.friend_id ? 'active' : ''}`}
          onClick={() => onSelectFriend(friend)}
          custom={index}
          variants={cardVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          whileHover={{ backgroundColor: 'rgba(147, 197, 253, 0.15)' }}
        >
          <div className="conv-avatar">
            <FriendAvatar friend={friend} />
          </div>
          <div className="conv-info">
            <div className="conv-header">
              <span className="conv-name">{friend.friend_nickname}</span>
              {friend.add_time && (
                <span className="conv-time">{formatMessageTime(friend.add_time)}</span>
              )}
            </div>
            <div className="conv-preview">
              <span className="conv-message">@{friend.friend_id}</span>
            </div>
          </div>
          {unreadCount > 0 && (
            <div className="unread-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </div>
          )}
        </motion.div>
      );
    });
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
          placeholder="搜索好友"
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
