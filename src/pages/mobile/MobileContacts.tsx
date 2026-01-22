/**
 * 移动端通讯录页
 *
 * 使用折叠面板展示好友和群聊
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import type { Friend, Group, ChatTarget } from '../../types/chat';

// 箭头图标
const ArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 4.5l7.5 7.5-7.5 7.5"
    />
  </svg>
);

interface MobileContactsProps {
  /** 好友列表 */
  friends: Friend[];
  /** 群聊列表 */
  groups: Group[];
  /** 搜索关键词 */
  searchQuery: string;
  /** 选中目标回调 */
  onSelectTarget: (target: ChatTarget) => void;
}

export function MobileContacts({
  friends,
  groups,
  searchQuery,
  onSelectTarget,
}: MobileContactsProps) {
  // 折叠状态
  const [friendsExpanded, setFriendsExpanded] = useState(true);
  const [groupsExpanded, setGroupsExpanded] = useState(true);

  // 搜索过滤
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) {
      return friends;
    }
    const query = searchQuery.toLowerCase();
    return friends.filter((f) =>
      f.friend_nickname.toLowerCase().includes(query),
    );
  }, [friends, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return groups;
    }
    const query = searchQuery.toLowerCase();
    return groups.filter((g) => g.group_name.toLowerCase().includes(query));
  }, [groups, searchQuery]);

  // 获取群聊角色标签
  const getRoleLabel = (role?: 'owner' | 'admin' | 'member') => {
    switch (role) {
      case 'owner':
        return '群主';
      case 'admin':
        return '管理员';
      default:
        return null;
    }
  };

  const handleFriendClick = (friend: Friend) => {
    onSelectTarget({ type: 'friend', data: friend });
  };

  const handleGroupClick = (group: Group) => {
    onSelectTarget({ type: 'group', data: group });
  };

  return (
    <div className="mobile-contacts">
      {/* 好友分组 */}
      <div className="mobile-contacts-group">
        <div
          className="mobile-contacts-header"
          onClick={() => setFriendsExpanded(!friendsExpanded)}
        >
          <div className="mobile-contacts-header-left">
            <div
              className={`mobile-contacts-arrow ${friendsExpanded ? 'expanded' : ''}`}
            >
              <ArrowIcon />
            </div>
            <span className="mobile-contacts-title">好友</span>
            <span className="mobile-contacts-count">
              ({filteredFriends.length})
            </span>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {friendsExpanded && (
            <motion.div
              className="mobile-contacts-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {filteredFriends.length === 0 ? (
                <div className="mobile-contacts-empty" style={{ padding: '24px' }}>
                  <span>暂无好友</span>
                </div>
              ) : (
                filteredFriends.map((friend) => (
                  <div
                    key={friend.friend_id}
                    className="mobile-contact-card"
                    onClick={() => handleFriendClick(friend)}
                  >
                    <div className="mobile-contact-avatar" style={{ width: 44, height: 44 }}>
                      <FriendAvatar friend={friend} />
                    </div>
                    <div className="mobile-contact-info">
                      <div className="mobile-contact-name">
                        {friend.friend_nickname}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 群聊分组 */}
      <div className="mobile-contacts-group">
        <div
          className="mobile-contacts-header"
          onClick={() => setGroupsExpanded(!groupsExpanded)}
        >
          <div className="mobile-contacts-header-left">
            <div
              className={`mobile-contacts-arrow ${groupsExpanded ? 'expanded' : ''}`}
            >
              <ArrowIcon />
            </div>
            <span className="mobile-contacts-title">群聊</span>
            <span className="mobile-contacts-count">
              ({filteredGroups.length})
            </span>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {groupsExpanded && (
            <motion.div
              className="mobile-contacts-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {filteredGroups.length === 0 ? (
                <div className="mobile-contacts-empty" style={{ padding: '24px' }}>
                  <span>暂无群聊</span>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div
                    key={group.group_id}
                    className="mobile-contact-card"
                    onClick={() => handleGroupClick(group)}
                  >
                    <div className="mobile-contact-avatar" style={{ width: 44, height: 44 }}>
                      <GroupAvatar group={group} />
                    </div>
                    <div className="mobile-contact-info">
                      <div className="mobile-contact-name">{group.group_name}</div>
                      {getRoleLabel(group.role) && (
                        <div className="mobile-contact-role">
                          {getRoleLabel(group.role)}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
