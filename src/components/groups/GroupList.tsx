/**
 * 群聊列表组件
 *
 * 与 FriendList 保持一致的风格
 */

import { motion } from 'framer-motion';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { GroupAvatar } from '../common/Avatar';
import { SearchIcon } from '../common/Icons';
import { formatMessageTime } from '../../utils/time';
import type { Group } from '../../types/chat';

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

// 角色标签
function RoleBadge({ role }: { role: Group['role'] }) {
  const roleText = {
    owner: '群主',
    admin: '管理',
    member: '',
  };

  if (role === 'member') { return null; }

  return (
    <span
      className="role-badge"
      style={{
        fontSize: '10px',
        padding: '1px 4px',
        borderRadius: '3px',
        background: role === 'owner' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(59, 130, 246, 0.2)',
        color: role === 'owner' ? '#ca8a04' : '#2563eb',
        marginLeft: '4px',
      }}
    >
      {roleText[role]}
    </span>
  );
}

interface GroupListProps {
  groups: Group[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedGroupId: string | null;
  onSelectGroup: (group: Group) => void;
  getUnreadCount?: (groupId: string) => number;
}

function GroupListContent({
  loading,
  error,
  groups,
  searchQuery,
  selectedGroupId,
  onSelectGroup,
  getUnreadCount,
}: {
  loading: boolean;
  error: string | null;
  groups: Group[];
  searchQuery: string;
  selectedGroupId: string | null;
  onSelectGroup: (group: Group) => void;
  getUnreadCount?: (groupId: string) => number;
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

  if (groups.length === 0) {
    const message = searchQuery ? '未找到匹配的群聊' : '暂无群聊';
    return (
      <div className="list-empty">
        <span>{message}</span>
      </div>
    );
  }

  return (
    <>
      {groups.map((group, index) => {
        // 优先使用 WebSocket 推送的未读数，否则使用 API 返回的
        const unreadCount = getUnreadCount?.(group.group_id) ?? group.unread_count ?? 0;
        return (
          <motion.div
            key={group.group_id}
            className={`conversation-item ${selectedGroupId === group.group_id ? 'active' : ''}`}
            onClick={() => onSelectGroup(group)}
            custom={index}
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            whileHover={{ backgroundColor: 'rgba(147, 197, 253, 0.15)' }}
          >
            <div className="conv-avatar">
              <GroupAvatar group={group} size={44} />
            </div>
            <div className="conv-info">
              <div className="conv-header">
                <span className="conv-name">
                  {group.group_name}
                  <RoleBadge role={group.role} />
                </span>
                {group.last_message_time && (
                  <span className="conv-time">{formatMessageTime(group.last_message_time)}</span>
                )}
              </div>
              <div className="conv-preview">
                <span className="conv-message">
                  {group.last_message_content || '暂无消息'}
                </span>
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

export function GroupList({
  groups,
  loading,
  error,
  searchQuery,
  onSearchChange,
  selectedGroupId,
  onSelectGroup,
  getUnreadCount,
}: GroupListProps) {
  // 过滤群聊列表
  const filteredGroups = (groups || []).filter((group) =>
    group.group_name.toLowerCase().includes(searchQuery.toLowerCase()),
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
            placeholder="搜索群聊"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="conversation-list">
        <GroupListContent
          loading={loading}
          error={error}
          groups={filteredGroups}
          searchQuery={searchQuery}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          getUnreadCount={getUnreadCount}
        />
      </div>
    </motion.section>
  );
}
