/**
 * 转让群主组件
 */

import { useState } from 'react';
import { MenuHeader } from './MenuHeader';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
import { groupMemberDisplayName } from '../../../utils/groupRemark';
import { AvatarPlaceholder } from '../../../components/common/AvatarPlaceholder';
import type { GroupMember } from '../../../api/groups';

interface TransferOwnerProps {
  members: GroupMember[];
  loading: boolean;
  loadingMembers: boolean;
  currentUserId?: string;
  /** D7 群内私有备注（user_id → 备注名）；展示名优先用备注，与成员列表一致 */
  remarks?: Record<string, string>;
  onBack: () => void;
  onTransfer: (newOwnerId: string) => void;
}

/** 成员展示名：备注 → 群昵称 → 用户昵称 */
function memberName(member: GroupMember, remarks?: Record<string, string>): string {
  return groupMemberDisplayName(
    remarks?.[member.user_id],
    member.group_nickname || member.user_nickname,
  );
}

export function TransferOwner({
  members,
  loading,
  loadingMembers,
  currentUserId,
  remarks,
  onBack,
  onTransfer,
}: TransferOwnerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  // 过滤掉群主自己
  const transferableMembers = members.filter(
    (m) => m.user_id !== currentUserId && m.role !== 'owner',
  );

  const selectedMember = transferableMembers.find((m) => m.user_id === selectedId);

  const handleConfirm = () => {
    if (selectedId) {
      onTransfer(selectedId);
    }
  };

  if (confirmStep && selectedMember) {
    return (
      <>
        <MenuHeader title="确认转让" onBack={() => setConfirmStep(false)} />
        <div className="menu-confirm">
          <p>
            确定要将群主转让给 <strong>{memberName(selectedMember, remarks)}</strong> 吗？
          </p>
          <p className="confirm-warning">
            转让后您将变为普通成员，此操作无法撤销
          </p>
          <div className="confirm-actions">
            <button className="cancel-btn" onClick={() => setConfirmStep(false)}>
              取消
            </button>
            <button
              className="danger-btn"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? '转让中...' : '确认转让'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <MenuHeader title="转让群主" onBack={onBack} />
      <div className="menu-transfer-list">
        {loadingMembers && <div className="menu-loading">加载成员中...</div>}
        {!loadingMembers && transferableMembers.length === 0 && (
          <div className="menu-empty">暂无可转让的成员</div>
        )}
        {!loadingMembers && transferableMembers.length > 0 && (
          <>
            <p className="menu-hint">选择要转让群主的成员：</p>
            {transferableMembers.map((member) => {
              const displayName = memberName(member, remarks);
              return (
                <div
                  key={member.user_id}
                  className={`transfer-member-item ${selectedId === member.user_id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(member.user_id)}
                >
                  <div className="member-avatar">
                    {member.user_avatar_url ? (
                      <img src={resolveServerAvatarUrl(member.user_avatar_url) || ''} alt={displayName} />
                    ) : (
                      <AvatarPlaceholder name={displayName} fontSize={16} />
                    )}
                  </div>
                  <div className="member-info">
                    <span className="member-name">{displayName}</span>
                    {member.role === 'admin' && (
                      <span className="member-role admin">管理员</span>
                    )}
                  </div>
                  {selectedId === member.user_id && (
                    <span className="selected-mark">✓</span>
                  )}
                </div>
              );
            })}
            <button
              className="submit-btn"
              onClick={() => setConfirmStep(true)}
              disabled={!selectedId}
            >
              下一步
            </button>
          </>
        )}
      </div>
    </>
  );
}
