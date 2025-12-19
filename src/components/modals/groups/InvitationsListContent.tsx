/**
 * 群邀请列表内容组件
 */

import { motion } from 'framer-motion';
import { GroupIconLarge, CheckIcon, XIcon } from '../../common/Icons';
import type { GroupInvitation } from '../../../api/groups';

interface InvitationsListContentProps {
  loading: boolean;
  invitations: GroupInvitation[];
  onAccept: (invitation: GroupInvitation) => void;
  onDecline: (invitation: GroupInvitation) => void;
}

export function InvitationsListContent({
  loading,
  invitations,
  onAccept,
  onDecline,
}: InvitationsListContentProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (invitations.length === 0) {
    return <div className="empty-state">暂无群邀请</div>;
  }

  return (
    <div className="pending-list">
      {invitations.map((invitation) => (
        <motion.div
          key={invitation.request_id}
          className="pending-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pending-avatar">
            {invitation.group_avatar_url ? (
              <img src={invitation.group_avatar_url} alt={invitation.group_name} />
            ) : (
              <GroupIconLarge />
            )}
          </div>
          <div className="pending-info">
            <div className="pending-name">{invitation.group_name}</div>
            <div className="pending-id">邀请人: {invitation.inviter_nickname}</div>
            {invitation.message && (
              <div className="pending-reason">{invitation.message}</div>
            )}
          </div>
          <div className="pending-actions">
            <motion.button
              className="action-btn accept"
              onClick={() => onAccept(invitation)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="接受"
            >
              <CheckIcon />
            </motion.button>
            <motion.button
              className="action-btn reject"
              onClick={() => onDecline(invitation)}
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

