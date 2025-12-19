/**
 * 群聊邀请列表 Tab
 */

import { motion } from 'framer-motion';
import { GroupIconLarge, CheckIcon, XIcon } from '../../common/Icons';
import type { GroupInvitation } from '../../../api/groups';

interface GroupInvitesTabProps {
  loading: boolean;
  invites: GroupInvitation[];
  onAccept: (invite: GroupInvitation) => void;
  onDecline: (invite: GroupInvitation) => void;
}

export function GroupInvitesTab({
  loading,
  invites,
  onAccept,
  onDecline,
}: GroupInvitesTabProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (invites.length === 0) {
    return (
      <div className="empty-state">
        <GroupIconLarge />
        <p>暂无群聊邀请</p>
      </div>
    );
  }

  return (
    <div className="pending-list">
      {invites.map((invite) => (
        <motion.div
          key={invite.request_id}
          className="pending-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pending-avatar">
            {invite.group_avatar_url ? (
              <img src={invite.group_avatar_url} alt={invite.group_name} />
            ) : (
              <GroupIconLarge />
            )}
          </div>
          <div className="pending-info">
            <div className="pending-name">{invite.group_name}</div>
            <div className="pending-id">邀请人: {invite.inviter_nickname}</div>
            {invite.message && (
              <div className="pending-reason">{invite.message}</div>
            )}
          </div>
          <div className="pending-actions">
            <motion.button
              className="action-btn accept"
              onClick={() => onAccept(invite)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="接受"
            >
              <CheckIcon />
            </motion.button>
            <motion.button
              className="action-btn reject"
              onClick={() => onDecline(invite)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="拒绝"
            >
              <XIcon />
            </motion.button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

