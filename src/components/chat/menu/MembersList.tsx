/**
 * 成员列表组件
 */

import { MenuHeader } from './MenuHeader';
import { isMuted, formatMutedUntil } from './utils';
import type { GroupMember } from '../../../api/groups';

interface MembersListProps {
  members: GroupMember[];
  loadingMembers: boolean;
  currentUserId: string | undefined;
  isOwnerOrAdmin: boolean;
  onBack: () => void;
  onMemberClick: (member: GroupMember) => void;
}

export function MembersList({
  members,
  loadingMembers,
  currentUserId,
  isOwnerOrAdmin,
  onBack,
  onMemberClick,
}: MembersListProps) {
  return (
    <>
      <MenuHeader title={`群成员 (${members.length})`} onBack={onBack} />
      <div className="members-list">
        {loadingMembers && (
          <div className="menu-loading">加载中...</div>
        )}
        {!loadingMembers && members.length === 0 && (
          <div className="menu-empty">暂无成员</div>
        )}
        {!loadingMembers && members.length > 0 && (
          members.map((member) => {
            const canClick = isOwnerOrAdmin && 
              member.user_id !== currentUserId && 
              member.role !== 'owner';

            return (
              <div
                key={member.user_id}
                className={`member-item ${canClick ? 'clickable' : ''}`}
                onClick={() => canClick && onMemberClick(member)}
              >
                <div className="member-avatar">
                  {member.user_avatar_url ? (
                    <img src={member.user_avatar_url} alt={member.user_nickname} />
                  ) : (
                    <div className="avatar-placeholder">
                      {member.user_nickname.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="member-info">
                  <span className="member-name">
                    {member.user_nickname}
                    {member.user_id === currentUserId && ' (我)'}
                  </span>
                  <div className="member-badges">
                    {member.role !== 'member' && (
                      <span className={`member-role ${member.role}`}>
                        {member.role === 'owner' ? '群主' : '管理员'}
                      </span>
                    )}
                    {isMuted(member) && member.muted_until && (
                      <span className="member-muted">
                        禁言至 {formatMutedUntil(member.muted_until)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

