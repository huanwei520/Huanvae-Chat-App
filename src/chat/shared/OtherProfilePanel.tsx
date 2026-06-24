/**
 * 他人公开资料面板（只读公开字段 + 关系状态；非好友可加好友）
 *
 * @location src/chat/shared/OtherProfilePanel.tsx
 *
 * 由 OtherProfileView 在桌面右侧抽屉 / 移动整页内渲染。QQ 风格只读版式：通栏封面 +
 * 上叠圆角淡染卡 + 头像骑卡片左上角。展示某用户的公开资料：
 * - 头像、昵称（好友显示备注名）、@ID（可复制）、签名
 * - 关系状态（好友 / 陌生人 / 自己）
 * - 非好友可发起加好友请求（好友关系操作已统一移到私聊三条杠菜单）
 *
 * 数据：进入时拉 GET /api/profile/{id}/public（仅公开字段，零隐私泄露）。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi, useSession } from '../../contexts/SessionContext';
import { getPublicProfile, type PublicProfileResponse } from '../../api/profile';
import { sendFriendRequest } from '../../api/friends';
import { friendDisplayName } from '../../utils/friendName';
import { AddUserIcon } from '../../components/common/Icons';
import { resolveServerAvatarUrl } from '../../utils/avatar';

interface OtherProfilePanelProps {
  /** 被查看用户 id */
  userId: string;
  /** 关闭资料页 */
  onClose: () => void;
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

export function OtherProfilePanel({ userId, onClose }: OtherProfilePanelProps) {
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
    // 切换查看对象时重置加好友的已发送/错误提示，避免串台到新用户。
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
  // 头像必须经显示收口点解析（webview 验不过私有 CA 自签证书，裸后端 URL 加载失败）：
  // 好友头像入 store 时已收口；公开资料头像是原始后端值，此处补一层 resolveServerAvatarUrl。
  const avatarUrl = friendData?.friend_avatar_url
    ?? resolveServerAvatarUrl(profile?.user_avatar_url)
    ?? null;
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
      <div className="qq-hero qq-hero--panel">
        <div className="qq-hero-cover">
          <div className="qq-hero-actions">
            <button
              type="button"
              className="qq-hero-btn qq-hero-btn--icon"
              onClick={onClose}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        <div className="qq-hero-card">
          <div className="qq-hero-headrow">
            <div className="qq-hero-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} />
              ) : (
                <span className="qq-hero-avatar-placeholder">{initialOf(displayName)}</span>
              )}
            </div>
            <div className="qq-hero-namecol">
              <span className="qq-hero-name">{displayName}</span>
              <div>
                <button
                  type="button"
                  className="qq-hero-id"
                  onClick={handleCopyId}
                  title="点击复制 ID"
                >
                  @{userId}
                </button>
              </div>
            </div>
          </div>

          {loadError && <div className="other-profile-hint">资料加载失败</div>}
          {signature && <div className="qq-hero-signature">{signature}</div>}

          <div className="qq-hero-relation">{relationLabel(isSelf, isFriend)}</div>

          {/* 非好友可加好友（好友的关系操作统一在私聊三条杠菜单） */}
          {!isSelf && !isFriend && (
            <div className="other-profile-actions">
              {actionError && <div className="other-profile-error">{actionError}</div>}
              <button
                type="button"
                className={`other-profile-action add ${sent ? 'sent' : ''}`}
                onClick={handleAddFriend}
                disabled={sending || sent}
              >
                <AddUserIcon />
                <span>{addButtonText(sent, sending)}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
