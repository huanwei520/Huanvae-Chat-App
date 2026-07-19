/**
 * 移动端通讯录页
 *
 * 使用折叠面板展示好友和群聊
 *
 * 展开状态由父组件（MobileMain）持有 + 通过 props 注入，避免本组件因
 * AnimatePresence 切换 tab/进入聊天页时被 unmount 而丢失展开状态。
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import { useChatStore, useProfileViewStore } from '../../stores';
import { friendDisplayName } from '../../utils/friendName';
import { friendChatTarget } from '../../utils/chatTarget';
import { isBotUserId } from '../../api/bots';
import { BotBadge } from '../../components/common/BotBadge';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
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

// 折叠列表展开编排：容器 height/opacity 展开 + 子行 stagger；行 opacity+y 进场。
// transform/opacity 由 framer-motion 接管，.mobile-contact-card / .mobile-contacts-list
// 的 CSS 不得过渡这两个属性（见 tests/animation-conflict.test.ts 注册表）
const listVariants = {
  initial: { height: 0, opacity: 0 },
  animate: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.2, staggerChildren: 0.03, delayChildren: 0.05 },
  },
  exit: { height: 0, opacity: 0, transition: { duration: 0.2 } },
};

const rowVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

interface MobileContactsProps {
  /** 好友列表 */
  friends: Friend[];
  /** 群聊列表 */
  groups: Group[];
  /** 搜索关键词 */
  searchQuery: string;
  /** 选中目标回调 */
  onSelectTarget: (target: ChatTarget) => void;
  /** 好友分组是否展开（由父组件持有） */
  friendsExpanded: boolean;
  /** 群聊分组是否展开（由父组件持有） */
  groupsExpanded: boolean;
  /** 切换好友分组展开 */
  onToggleFriends: () => void;
  /** 切换群聊分组展开 */
  onToggleGroups: () => void;
}

export function MobileContacts({
  friends,
  groups,
  searchQuery,
  onSelectTarget,
  friendsExpanded,
  groupsExpanded,
  onToggleFriends,
  onToggleGroups,
}: MobileContactsProps) {
  // 好友在线状态 + 点头像看资料（与桌面 UnifiedList 一致）
  const friendPresence = useChatStore((s) => s.friendPresence);
  const openProfile = useProfileViewStore((s) => s.open);
  // 好友头像键盘焦点环（keyed：每张头像用 friend_id 作 key）
  const contactAvatarKbd = useKbdFocusRing();

  // 搜索过滤
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) {
      return friends;
    }
    const query = searchQuery.toLowerCase();
    return friends.filter((f) =>
      friendDisplayName(f).toLowerCase().includes(query),
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
    onSelectTarget(friendChatTarget(friend));
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
          onClick={onToggleFriends}
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
              variants={listVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {filteredFriends.length === 0 ? (
                <div className="mobile-contacts-empty" style={{ padding: '24px' }}>
                  <span>暂无好友</span>
                </div>
              ) : (
                filteredFriends.map((friend) => {
                  const avatarHandlers = contactAvatarKbd.handlersFor(friend.friend_id);
                  const avatarKbdFocused = contactAvatarKbd.isKbdFocused(friend.friend_id);
                  return (
                    <motion.div
                      key={friend.friend_id}
                      className="mobile-contact-card"
                      onClick={() => handleFriendClick(friend)}
                      variants={rowVariants}
                      whileTap={{ scale: 0.97 }}
                    >
                      <div
                        className={`mobile-contact-avatar${avatarKbdFocused ? ' a11y-kbd-focus' : ''}`}
                        style={{ width: 44, height: 44, position: 'relative' }}
                        onClick={(e) => { e.stopPropagation(); openProfile(friend.friend_id); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            // 阻止冒泡到卡片（其 onClick=进聊天），头像键盘=看资料
                            e.preventDefault();
                            e.stopPropagation();
                            openProfile(friend.friend_id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`查看${friendDisplayName(friend)}资料`}
                        onPointerDown={avatarHandlers.onPointerDown}
                        onFocus={avatarHandlers.onFocus}
                        onBlur={avatarHandlers.onBlur}
                      >
                        <FriendAvatar friend={friend} />
                        {friendPresence[friend.friend_id]?.online && (
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
                      <div className="mobile-contact-info">
                        <div className="mobile-contact-name">
                          {friendDisplayName(friend)}
                          {isBotUserId(friend.friend_id) && <BotBadge />}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 群聊分组 */}
      <div className="mobile-contacts-group">
        <div
          className="mobile-contacts-header"
          onClick={onToggleGroups}
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
              variants={listVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {filteredGroups.length === 0 ? (
                <div className="mobile-contacts-empty" style={{ padding: '24px' }}>
                  <span>暂无群聊</span>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <motion.div
                    key={group.group_id}
                    className="mobile-contact-card"
                    onClick={() => handleGroupClick(group)}
                    variants={rowVariants}
                    whileTap={{ scale: 0.97 }}
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
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
