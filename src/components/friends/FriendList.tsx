/**
 * 好友列表组件
 */

import { motion } from 'framer-motion';
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
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError error={error} />
        ) : filteredFriends.length === 0 ? (
          <ListEmpty message={searchQuery ? '未找到匹配的好友' : '暂无好友'} />
        ) : (
          filteredFriends.map((friend, index) => {
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
                  <FriendAvatar friend={friend} size={44} />
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
          })
        )}
      </div>
    </motion.section>
  );
}
