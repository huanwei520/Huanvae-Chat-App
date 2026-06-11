/**
 * 他人完整资料面板（公开字段 + 关系状态 + 快捷操作 + 关系操作区占位）
 *
 * @location src/chat/shared/OtherProfilePanel.tsx
 *
 * 由 OtherProfileView 在桌面右侧抽屉 / 移动整页内渲染。展示某用户的公开资料：
 * - 头像、昵称（好友显示备注名）、@ID（可复制）、签名
 * - 关系状态（好友 / 陌生人）
 * - 快捷操作：好友→发送消息；陌生人→加好友
 * - 关系操作区：M3（拉黑/特别关心/群内屏蔽等）的挂载位，本期占位
 *
 * 数据：进入时拉 GET /api/profile/{id}/public（仅公开字段，零隐私泄露）。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi, useSession } from '../../contexts/SessionContext';
import { getPublicProfile, type PublicProfileResponse } from '../../api/profile';
import { sendFriendRequest } from '../../api/friends';
import { friendDisplayName } from '../../utils/friendName';
import { AddUserIcon, ChatIcon } from '../../components/common/Icons';

interface OtherProfilePanelProps {
  /** 被查看用户 id */
  userId: string;
  /** 关闭资料页 */
  onClose: () => void;
  /** 发送消息（切到与该用户的私聊，由挂载方按平台实现导航） */
  onSendMessage: (userId: string) => void;
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

export function OtherProfilePanel({ userId, onClose, onSendMessage }: OtherProfilePanelProps) {
  const api = useApi();
  const { session } = useSession();
  const friends = useChatStore((s) => s.friends);

  const friendData = friends.find((f) => f.friend_id === userId);
  const isFriend = !!friendData;
  const isSelf = session?.userId === userId;

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setLoadError(false);
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

        {/* 关系操作区（M3 挂载位，本期占位） */}
        {!isSelf && (
          <div className="other-profile-relation-ops">
            <div className="other-profile-section-title">关系操作</div>
            <div className="other-profile-ops-placeholder">更多操作开发中</div>
          </div>
        )}
      </div>
    </div>
  );
}
