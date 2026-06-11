/**
 * 他人完整资料面板（公开字段 + 关系状态 + 快捷操作 + 关系操作区）
 *
 * @location src/chat/shared/OtherProfilePanel.tsx
 *
 * 由 OtherProfileView 在桌面右侧抽屉 / 移动整页内渲染。展示某用户的公开资料：
 * - 头像、昵称（好友显示备注名）、@ID（可复制）、签名
 * - 关系状态（好友 / 陌生人）
 * - 快捷操作：好友→发送消息；陌生人→加好友
 * - 关系操作区：好友可拉黑/取消拉黑（拉黑含内联二次确认）、删除（含内联二次确认）；
 *   特别关心/群内屏蔽等更多操作后续接入
 *
 * 数据：进入时拉 GET /api/profile/{id}/public（仅公开字段，零隐私泄露）。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi, useSession } from '../../contexts/SessionContext';
import { getPublicProfile, type PublicProfileResponse } from '../../api/profile';
import { sendFriendRequest, removeFriend, addBlacklist, removeBlacklist } from '../../api/friends';
import { friendDisplayName } from '../../utils/friendName';
import { AddUserIcon, ChatIcon } from '../../components/common/Icons';

interface OtherProfilePanelProps {
  /** 被查看用户 id */
  userId: string;
  /** 关闭资料页 */
  onClose: () => void;
  /** 发送消息（切到与该用户的私聊，由挂载方按平台实现导航） */
  onSendMessage: (userId: string) => void;
  /** 删除好友成功后回调（由挂载方刷新好友列表） */
  onFriendRemoved?: () => void;
}

/** 取展示名首字母（占位头像用） */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

/** 关系状态文案 */
function relationLabel(isSelf: boolean, isFriend: boolean): string {
  if (isSelf) { return '这是你自己'; }
  return isFriend ? '已是好友' : '非好友';
}

/** 加好友按钮文案 */
function addButtonText(sent: boolean, sending: boolean): string {
  if (sent) { return '已发送'; }
  return sending ? '发送中...' : '添加好友';
}

export function OtherProfilePanel({ userId, onClose, onSendMessage, onFriendRemoved }: OtherProfilePanelProps) {
  const api = useApi();
  const { session } = useSession();
  const friends = useChatStore((s) => s.friends);
  const setFriendBlacklisted = useChatStore((s) => s.setFriendBlacklisted);

  const friendData = friends.find((f) => f.friend_id === userId);
  const isFriend = !!friendData;
  const isBlacklisted = !!friendData?.is_blacklisted;
  const isSelf = session?.userId === userId;

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingBlacklist, setConfirmingBlacklist] = useState(false);
  const [blacklisting, setBlacklisting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setLoadError(false);
    // 切换查看对象时重置全部交互态，避免确认条/错误信息串台到新用户（误操作风险）
    setConfirmingDelete(false);
    setConfirmingBlacklist(false);
    setSent(false);
    setActionError(null);
    getPublicProfile(api, userId)
      .then((p) => { if (!cancelled) { setProfile(p); } })
      .catch(() => { if (!cancelled) { setLoadError(true); } });
    return () => { cancelled = true; };
  }, [api, userId]);

  // 显示名：是我好友则用备注/昵称；否则用公开资料昵称（加载/失败期间留空，避免短暂闪现原始 id）
  const displayName = friendData
    ? friendDisplayName(friendData)
    : (profile?.user_nickname ?? '');
  const avatarUrl = friendData?.friend_avatar_url ?? profile?.user_avatar_url ?? null;
  const signature = profile?.user_signature ?? null;

  const handleCopyId = () => {
    navigator.clipboard?.writeText(userId).catch(() => { /* 复制失败忽略 */ });
  };

  const handleAddFriend = async () => {
    if (!session || sending || sent) { return; }
    setSending(true);
    setActionError(null);
    try {
      await sendFriendRequest(api, session.userId, userId);
      setSent(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!session || removing) { return; }
    setRemoving(true);
    setActionError(null);
    try {
      await removeFriend(api, session.userId, userId);
      onFriendRemoved?.();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除失败');
      setRemoving(false);
      setConfirmingDelete(false);
    }
  };

  const handleBlacklist = async () => {
    if (blacklisting) { return; }
    setBlacklisting(true);
    setActionError(null);
    try {
      await addBlacklist(api, userId);
      setFriendBlacklisted(userId, true);
      setConfirmingBlacklist(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '拉黑失败');
    } finally {
      setBlacklisting(false);
    }
  };

  const handleUnblacklist = async () => {
    if (blacklisting) { return; }
    setBlacklisting(true);
    setActionError(null);
    try {
      await removeBlacklist(api, userId);
      setFriendBlacklisted(userId, false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '取消拉黑失败');
    } finally {
      setBlacklisting(false);
    }
  };

  // 拉黑/取消拉黑操作（拉黑需二次确认；取消拉黑直接执行）
  function renderBlacklistOp() {
    if (isBlacklisted) {
      return (
        <button
          type="button"
          className="other-profile-op"
          onClick={handleUnblacklist}
          disabled={blacklisting}
        >
          {blacklisting ? '处理中...' : '取消拉黑'}
        </button>
      );
    }
    if (confirmingBlacklist) {
      return (
        <div className="other-profile-confirm">
          <span className="other-profile-confirm-text">拉黑后对方将收不到你发送的消息，确定？</span>
          <div className="other-profile-confirm-actions">
            <button
              type="button"
              className="other-profile-confirm-cancel"
              onClick={() => setConfirmingBlacklist(false)}
              disabled={blacklisting}
            >
              取消
            </button>
            <button
              type="button"
              className="other-profile-confirm-danger"
              onClick={handleBlacklist}
              disabled={blacklisting}
            >
              {blacklisting ? '拉黑中...' : '确认拉黑'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="other-profile-op danger"
        onClick={() => setConfirmingBlacklist(true)}
      >
        拉黑
      </button>
    );
  }

  // 删除好友操作（含内联二次确认）
  function renderDeleteOp() {
    if (confirmingDelete) {
      return (
        <div className="other-profile-confirm">
          <span className="other-profile-confirm-text">删除后将解除好友关系，确定？</span>
          <div className="other-profile-confirm-actions">
            <button
              type="button"
              className="other-profile-confirm-cancel"
              onClick={() => setConfirmingDelete(false)}
              disabled={removing}
            >
              取消
            </button>
            <button
              type="button"
              className="other-profile-confirm-danger"
              onClick={handleRemoveFriend}
              disabled={removing}
            >
              {removing ? '删除中...' : '确认删除'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="other-profile-op danger"
        onClick={() => setConfirmingDelete(true)}
      >
        删除好友
      </button>
    );
  }

  // 关系操作区内容（非好友=占位；好友=拉黑/取消拉黑 + 删除）
  function renderRelationOps() {
    if (!isFriend) {
      return <div className="other-profile-ops-placeholder">更多操作开发中</div>;
    }
    return (
      <div className="other-profile-ops-list">
        {renderBlacklistOp()}
        {renderDeleteOp()}
      </div>
    );
  }

  return (
    <div className="other-profile-panel">
      <header className="other-profile-header">
        <span className="other-profile-title">个人资料</span>
        <button type="button" className="other-profile-close" onClick={onClose} aria-label="关闭">×</button>
      </header>

      <div className="other-profile-body">
        <div className="other-profile-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} />
          ) : (
            <span className="other-profile-avatar-placeholder">{initialOf(displayName)}</span>
          )}
        </div>

        <div className="other-profile-name">{displayName}</div>
        <button type="button" className="other-profile-id" onClick={handleCopyId} title="点击复制 ID">
          @{userId}
        </button>

        {loadError && <div className="other-profile-hint">资料加载失败</div>}
        {signature && <div className="other-profile-signature">{signature}</div>}

        <div className="other-profile-relation">{relationLabel(isSelf, isFriend)}</div>

        {/* 快捷操作（自己不显示） */}
        {!isSelf && (
          <div className="other-profile-actions">
            {actionError && <div className="other-profile-error">{actionError}</div>}
            {isFriend ? (
              <button
                type="button"
                className="other-profile-action message"
                onClick={() => { onSendMessage(userId); onClose(); }}
              >
                <ChatIcon />
                <span>发送消息</span>
              </button>
            ) : (
              <button
                type="button"
                className={`other-profile-action add ${sent ? 'sent' : ''}`}
                onClick={handleAddFriend}
                disabled={sending || sent}
              >
                <AddUserIcon />
                <span>{addButtonText(sent, sending)}</span>
              </button>
            )}
          </div>
        )}

        {/* 关系操作区（好友可拉黑/取消拉黑 + 删除；特别关心等更多操作后续接入） */}
        {!isSelf && (
          <div className="other-profile-relation-ops">
            <div className="other-profile-section-title">关系操作</div>
            {renderRelationOps()}
          </div>
        )}
      </div>
    </div>
  );
}
