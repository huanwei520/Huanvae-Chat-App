/**
 * 成员列表组件
 */

import { MenuHeader } from './MenuHeader';
import { isMuted, formatMutedUntil } from './utils';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
import { groupMemberDisplayName } from '../../../utils/groupRemark';
import type { GroupMember } from '../../../api/groups';

interface MembersListProps {
  members: GroupMember[];
  loadingMembers: boolean;
  currentUserId: string | undefined;
  /** D7 群内私有备注：本群「我设的备注」映射（user_id → 备注名）；展示名优先用备注 */
  remarks?: Record<string, string>;
  onBack: () => void;
  onMemberClick: (member: GroupMember) => void;
}

export function MembersList({
  members,
  loadingMembers,
  currentUserId,
  remarks,
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
            // 任何成员（除自己）都可点开操作面板：看资料 + 备注/特别关心/屏蔽（人人可用），
            // 管理操作在面板内单独 gating。
            const canClick = member.user_id !== currentUserId;
            // 显示名：备注优先 → 群昵称 → 用户昵称（头像 alt/占位首字母同步）
            const displayName = groupMemberDisplayName(
              remarks?.[member.user_id],
              member.group_nickname || member.user_nickname,
            );

            return (
              <div
                key={member.user_id}
                className={`member-item ${canClick ? 'clickable' : ''}`}
                onClick={() => canClick && onMemberClick(member)}
              >
                <div className="member-avatar">
                  {member.user_avatar_url ? (
                    <img src={resolveServerAvatarUrl(member.user_avatar_url) || ''} alt={displayName} />
                  ) : (
                    <div className="avatar-placeholder">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="member-info">
                  <span className="member-name">
                    {displayName}
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
