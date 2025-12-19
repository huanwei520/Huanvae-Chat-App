/**
 * 群聊列表内容组件
 */

import { motion } from 'framer-motion';
import { GroupIconLarge } from '../../common/Icons';
import type { Group } from '../../../api/groups';

interface GroupListContentProps {
  loading: boolean;
  groups: Group[];
  onGroupSelect?: (group: Group) => void;
  onClose: () => void;
  getRoleText: (role: string) => string;
}

export function GroupListContent({
  loading,
  groups,
  onGroupSelect,
  onClose,
  getRoleText,
}: GroupListContentProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="empty-state">
        <GroupIconLarge />
        <p>暂无群聊</p>
        <span>创建或加入一个群聊吧</span>
      </div>
    );
  }

  return (
    <div className="groups-list">
      {groups.map((group) => (
        <motion.div
          key={group.group_id}
          className="group-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ backgroundColor: 'rgba(147, 197, 253, 0.15)' }}
          onClick={() => {
            onGroupSelect?.(group);
            onClose();
          }}
        >
          <div className="group-avatar">
            {group.group_avatar_url ? (
              <img src={group.group_avatar_url} alt={group.group_name} />
            ) : (
              <GroupIconLarge />
            )}
          </div>
          <div className="group-info">
            <div className="group-name">{group.group_name}</div>
            <div className="group-meta">
              <span className="group-role">{getRoleText(group.role)}</span>
              {group.last_message_content && (
                <span className="group-preview">{group.last_message_content}</span>
              )}
            </div>
          </div>
          {group.unread_count && group.unread_count > 0 && (
            <div className="unread-badge">{group.unread_count}</div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

