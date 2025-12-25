/**
 * 转让群主组件
 */

import { useState } from 'react';
import { MenuHeader } from './MenuHeader';
import type { GroupMember } from '../../../api/groups';

interface TransferOwnerProps {
  members: GroupMember[];
  loading: boolean;
  loadingMembers: boolean;
  currentUserId?: string;
  onBack: () => void;
  onTransfer: (newOwnerId: string) => void;
}

export function TransferOwner({
  members,
  loading,
  loadingMembers,
  currentUserId,
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
            确定要将群主转让给 <strong>{selectedMember.user_nickname}</strong> 吗？
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
            {transferableMembers.map((member) => (
              <div
                key={member.user_id}
                className={`transfer-member-item ${selectedId === member.user_id ? 'selected' : ''}`}
                onClick={() => setSelectedId(member.user_id)}
              >
                <div className="member-avatar">
                  {member.user_avatar_url ? (
                    <img src={member.user_avatar_url} alt={member.user_nickname} />
                  ) : (
                    <div className="default-avatar" />
                  )}
                </div>
                <div className="member-info">
                  <span className="member-name">{member.user_nickname}</span>
                  {member.role === 'admin' && (
                    <span className="member-role admin">管理员</span>
                  )}
                </div>
                {selectedId === member.user_id && (
                  <span className="selected-mark">✓</span>
                )}
              </div>
            ))}
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
