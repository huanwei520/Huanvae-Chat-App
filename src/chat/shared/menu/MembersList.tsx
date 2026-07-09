/**
 * 成员列表组件
 */

import { MenuHeader } from './MenuHeader';
import { isMuted, formatMutedUntil } from './utils';
import { useKbdFocusRing } from '../../../hooks/useKbdFocusRing';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
import { AvatarPlaceholder } from '../../../components/common/AvatarPlaceholder';
import { groupMemberDisplayName } from '../../../utils/groupRemark';
import { formatDate } from '../../../utils/time';
import type { GroupMember } from '../../../api/groups';

/** 入群方式中文文案 */
const JOIN_METHOD_LABELS: Record<string, string> = {
  create: '创建群聊',
  search_direct: '搜索加入',
  search_approved: '搜索申请通过',
  owner_invite: '群主邀请',
  admin_invite: '管理员邀请',
  member_invite: '成员邀请',
  direct_invite_code: '邀请码加入',
  normal_invite_code: '邀请码申请通过',
};

function joinMethodLabel(method: string): string {
  return JOIN_METHOD_LABELS[method] ?? '';
}

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
  // 成员头像键盘焦点环（keyed：可点成员用 user_id 作 key）
  const memberKbd = useKbdFocusRing();
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
            // 入群时间 + 方式（joined_at / join_method）
            const joinDate = formatDate(member.joined_at);
            const joinWay = joinMethodLabel(member.join_method);
            const joinInfo = [joinDate, joinWay].filter(Boolean).join(' · ');

            // 仅可点成员（非自己）挂载键盘可达 + 焦点环
            const memberHandlers = canClick ? memberKbd.handlersFor(member.user_id) : null;
            const memberKbdFocused = canClick && memberKbd.isKbdFocused(member.user_id);

            return (
              <div
                key={member.user_id}
                className={`member-item ${canClick ? 'clickable' : ''}${memberKbdFocused ? ' a11y-kbd-focus' : ''}`}
                onClick={() => canClick && onMemberClick(member)}
                onKeyDown={canClick
                  ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onMemberClick(member);
                    }
                  }
                  : undefined}
                role={canClick ? 'button' : undefined}
                tabIndex={canClick ? 0 : undefined}
                aria-label={canClick ? `查看${displayName}资料` : undefined}
                onPointerDown={memberHandlers?.onPointerDown}
                onFocus={memberHandlers?.onFocus}
                onBlur={memberHandlers?.onBlur}
              >
                <div className="member-avatar">
                  {member.user_avatar_url ? (
                    <img src={resolveServerAvatarUrl(member.user_avatar_url) || ''} alt={displayName} />
                  ) : (
                    <AvatarPlaceholder name={displayName} fontSize={14} />
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
                  {joinInfo && (
                    <span
                      className="member-join-info"
                      style={{ fontSize: '11px', color: 'var(--text-secondary, rgba(255, 255, 255, 0.45))' }}
                    >
                      {joinInfo}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
