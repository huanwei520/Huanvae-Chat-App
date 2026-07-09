/**
 * 群聊邀请列表 Tab
 */

import { motion } from 'framer-motion';
import { GroupIconLarge, CheckIcon, XIcon } from '../../common/Icons';
import { AvatarPlaceholder } from '../../common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
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
      {invites.map((invite) => {
        // 邀请人头像走显示收口点（私有 CA）：inviter_avatar_url 是原始后端相对路径。
        const inviterAvatar = resolveServerAvatarUrl(invite.inviter_avatar_url);
        const inviterName = invite.inviter_nickname || invite.inviter_id;
        return (
          <motion.div
            key={invite.request_id}
            className="pending-item"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="pending-avatar">
              {invite.group_avatar_url ? (
                <img src={resolveServerAvatarUrl(invite.group_avatar_url) || ''} alt={invite.group_name} />
              ) : (
                <GroupIconLarge />
              )}
            </div>
            <div className="pending-info">
              <div className="pending-name">{invite.group_name}</div>
              <div className="pending-id" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '16px', height: '16px', borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', flexShrink: 0 }}>
                  {inviterAvatar ? (
                    <img src={inviterAvatar} alt={inviterName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <AvatarPlaceholder name={inviterName} fontSize={9} />
                  )}
                </span>
              邀请人: {inviterName}
              </div>
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
        );
      })}
    </div>
  );
}
