/**
 * 成员操作菜单组件
 */

import { MenuHeader } from './MenuHeader';
import { ShieldIcon, MuteIcon, TrashIcon } from '../../common/Icons';
import { isMuted } from './utils';
import type { GroupMember } from '../../../api/groups';

interface MemberActionsProps {
  member: GroupMember;
  isOwner: boolean;
  loading: boolean;
  onBack: () => void;
  onToggleAdmin: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onKick: () => void;
}

export function MemberActions({
  member,
  isOwner,
  loading,
  onBack,
  onToggleAdmin,
  onMute,
  onUnmute,
  onKick,
}: MemberActionsProps) {
  return (
    <>
      <MenuHeader title={member.user_nickname} onBack={onBack} />
      <div className="menu-actions">
        {isOwner && (
          <button
            className="menu-item"
            onClick={onToggleAdmin}
            disabled={loading}
          >
            <ShieldIcon />
            <span>
              {member.role === 'admin' ? '取消管理员' : '设为管理员'}
            </span>
          </button>
        )}
        {isMuted(member) ? (
          <button
            className="menu-item"
            onClick={onUnmute}
            disabled={loading}
          >
            <MuteIcon />
            <span>解除禁言</span>
          </button>
        ) : (
          <button
            className="menu-item"
            onClick={onMute}
          >
            <MuteIcon />
            <span>禁言</span>
          </button>
        )}
        <button
          className="menu-item danger"
          onClick={onKick}
        >
          <TrashIcon />
          <span>移出群聊</span>
        </button>
      </div>
    </>
  );
}
