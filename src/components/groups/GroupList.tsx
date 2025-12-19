/**
 * 群聊列表组件
 *
 * 与 FriendList 保持一致的风格
 */

import { motion } from 'framer-motion';
import { GroupAvatar } from '../common/Avatar';
import { SearchBox } from '../common/SearchBox';
import { ListLoading, ListError, ListEmpty } from '../common/ListStates';
import { formatMessageTime } from '../../utils/time';
import { cardVariants, panelVariants } from '../../constants/listAnimations';
import type { Group } from '../../types/chat';

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
  panelWidth?: number;
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
  panelWidth = 280,
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
        <SearchBox
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          panelWidth={panelWidth}
          placeholder="搜索群聊"
        />
      </div>

      <div className="conversation-list">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError error={error} />
        ) : filteredGroups.length === 0 ? (
          <ListEmpty message={searchQuery ? '未找到匹配的群聊' : '暂无群聊'} />
        ) : (
          filteredGroups.map((group, index) => {
            const unreadCount = getUnreadCount?.(group.group_id) || 0;
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
          })
        )}
      </div>
    </motion.section>
  );
}
