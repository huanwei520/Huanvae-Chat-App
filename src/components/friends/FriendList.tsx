/**
 * 好友列表组件
 */

import { motion } from 'framer-motion';
import { FriendAvatar } from '../common/Avatar';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SearchIcon } from '../common/Icons';
import { formatMessageTime } from '../../utils/time';
import type { Friend } from '../../types/chat';

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

interface FriendListProps {
    friends: Friend[];
    loading: boolean;
    error: string | null;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    selectedFriendId: string | null;
    onSelectFriend: (friend: Friend) => void;
    getUnreadCount?: (friendId: string) => number;
}

function FriendListContent({
  loading,
  error,
  friends,
  searchQuery,
  selectedFriendId,
  onSelectFriend,
  getUnreadCount,
}: {
    loading: boolean;
    error: string | null;
    friends: Friend[];
    searchQuery: string;
    selectedFriendId: string | null;
    onSelectFriend: (friend: Friend) => void;
    getUnreadCount?: (friendId: string) => number;
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

  if (friends.length === 0) {
    const message = searchQuery ? '未找到匹配的好友' : '暂无好友';
    return (
      <div className="list-empty">
        <span>{message}</span>
      </div>
    );
  }

  return (
    <>
      {friends.map((friend, index) => {
        const unreadCount = getUnreadCount?.(friend.friend_id) ?? 0;
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
                <span className="conv-time">{formatMessageTime(friend.add_time)}</span>
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
      })}
    </>
  );
}

// 面板动画变体
const panelVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

export function FriendList({
  friends,
  loading,
  error,
  searchQuery,
  onSearchChange,
  selectedFriendId,
  onSelectFriend,
  getUnreadCount,
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
        <div className="search-box">
          <SearchIcon />
          <input
            type="text"
            placeholder="搜索好友"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="conversation-list">
        <FriendListContent
          loading={loading}
          error={error}
          friends={filteredFriends}
          searchQuery={searchQuery}
          selectedFriendId={selectedFriendId}
          onSelectFriend={onSelectFriend}
          getUnreadCount={getUnreadCount}
        />
      </div>
    </motion.section>
  );
}
