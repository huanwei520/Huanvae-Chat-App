/**
 * 他人公开资料面板（分组信息 + 关系状态 + 操作区）
 *
 * @location src/chat/shared/OtherProfilePanel.tsx
 *
 * 由 OtherProfileView 在桌面右侧抽屉 / 移动整页内渲染。QQ 风格：通栏封面（可为对方背景图）+
 * 上叠圆角淡染卡 + 头像骑卡片左上角。分组展示：
 * - 身份：头像、昵称（好友显示备注名）、@ID（可复制）、签名
 * - 资料：性别 / 生日 / 地区 / 注册时间
 * - 关系：好友/陌生人/自己、成为好友时间、在线状态、特别关心/拉黑徽章、好友备注（可编辑）
 * - 操作：好友「发消息」直达会话 / 非好友「添加好友」
 *
 * 数据：进入时拉 GET /api/profile/{id}/public（仅公开字段）。在线状态读 store 的 presence 快照/增量。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi, useSession } from '../../contexts/SessionContext';
import { getPublicProfile, type PublicProfileResponse } from '../../api/profile';
import { sendFriendRequest, setFriendRemark as apiSetFriendRemark } from '../../api/friends';
import { friendDisplayName } from '../../utils/friendName';
import { AddUserIcon } from '../../components/common/Icons';
import { AppButton } from '../../components/common/AppButton';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { formatDate, formatLastSeen } from '../../utils/time';
import type { Friend } from '../../types/chat';
import '../../styles/components/profile-sections.css';

interface OtherProfilePanelProps {
  /** 被查看用户 id */
  userId: string;
  /** 关闭资料页 */
  onClose: () => void;
  /** 好友「发消息」直达会话（由容器注入 handleSelectTarget） */
  onSendMessage?: (friend: Friend) => void;
}

/** 关系状态文案 */
function relationLabel(isSelf: boolean, isFriend: boolean): string {
  if (isSelf) { return '这是你自己'; }
  return isFriend ? '好友' : '非好友';
}

/** 性别文案 */
function genderLabel(gender: string | null | undefined): string {
  if (gender === 'male') { return '男'; }
  if (gender === 'female') { return '女'; }
  if (gender === 'other') { return '其他'; }
  return '';
}

/** 加好友按钮文案 */
function addButtonText(sent: boolean, sending: boolean): string {
  if (sent) { return '已发送'; }
  return sending ? '发送中...' : '添加好友';
}

/** 一行「标签 : 值」；值空则不渲染 */
function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) { return null; }
  return (
    <div className="profile-info-row">
      <span className="profile-info-label">{label}</span>
      <span className="profile-info-value">{value}</span>
    </div>
  );
}

export function OtherProfilePanel({ userId, onClose, onSendMessage }: OtherProfilePanelProps) {
  const api = useApi();
  const { session } = useSession();
  const friends = useChatStore((s) => s.friends);
  const setFriends = useChatStore((s) => s.setFriends);
  const presence = useChatStore((s) => s.friendPresence[userId]);

  const friendData = friends.find((f) => f.friend_id === userId);
  const isFriend = !!friendData;
  const isSelf = session?.userId === userId;

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 备注编辑
  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkInput, setRemarkInput] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setLoadError(false);
    // 切换查看对象时重置各态，避免串台到新用户。
    setSent(false);
    setActionError(null);
    setEditingRemark(false);
    getPublicProfile(api, userId)
      .then((p) => { if (!cancelled) { setProfile(p); } })
      .catch(() => { if (!cancelled) { setLoadError(true); } });
    return () => { cancelled = true; };
  }, [api, userId]);

  // 显示名：是我好友则用备注/昵称；否则用公开资料昵称（加载/失败期间留空，避免短暂闪现原始 id）
  const displayName = friendData
    ? friendDisplayName(friendData)
    : (profile?.user_nickname ?? '');
  // 头像/背景必须经显示收口点解析（webview 验不过私有 CA 自签证书，裸后端 URL 加载失败）：
  // 好友头像入 store 时已收口；公开资料头像/背景是原始后端值，此处补一层 resolveServerAvatarUrl。
  const avatarUrl = friendData?.friend_avatar_url
    ?? resolveServerAvatarUrl(profile?.user_avatar_url)
    ?? null;
  const backgroundUrl = resolveServerAvatarUrl(profile?.background_url);
  const signature = profile?.user_signature ?? null;

  // 在线状态
  const online = presence?.online ?? false;
  let statusText = '';
  if (isFriend) {
    if (online) {
      statusText = '在线';
    } else if (presence?.last_seen_at) {
      statusText = `最后在线 ${formatLastSeen(presence.last_seen_at)}`;
    } else {
      statusText = '离线';
    }
  }

  // 注册时间(created_at)几乎总有值、单独常显；这里只判可选富字段是否至少填了一项，
  // 用于决定是否显示"未填写"提示（不含 created_at，否则该分支恒不触发=死代码）。
  const hasOptionalProfileFields = !!(profile
    && (genderLabel(profile.gender) || profile.birthday || profile.region));

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

  const handleSendMessage = () => {
    if (!friendData) { return; }
    onSendMessage?.(friendData);
    onClose();
  };

  const startEditRemark = () => {
    setRemarkInput(friendData?.friend_remark ?? '');
    setEditingRemark(true);
  };

  const saveRemark = async () => {
    if (!session || !friendData || savingRemark) { return; }
    const remark = remarkInput.trim();
    setSavingRemark(true);
    setActionError(null);
    try {
      await apiSetFriendRemark(api, session.userId, userId, remark);
      // 更新 store 中该好友备注（列表/资料页即时刷新），与私聊菜单同一套写法
      const current = useChatStore.getState().friends;
      setFriends(current.map((f) =>
        f.friend_id === userId ? { ...f, friend_remark: remark || null } : f,
      ));
      setEditingRemark(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '备注保存失败');
    } finally {
      setSavingRemark(false);
    }
  };

  return (
    <div className="other-profile-panel">
      <div className="qq-hero qq-hero--panel">
        <div
          className="qq-hero-cover"
          style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
        >
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
          {/* 身份 */}
          <div className="qq-hero-headrow">
            <div className="qq-hero-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} />
              ) : (
                <AvatarPlaceholder name={displayName} fontSize="calc(var(--qq-avatar-size) * 0.4)" />
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

          {/* 资料 */}
          <div className="profile-section">
            <div className="profile-section-title">资料</div>
            <InfoRow label="性别" value={genderLabel(profile?.gender)} />
            <InfoRow label="生日" value={profile?.birthday ?? ''} />
            <InfoRow label="地区" value={profile?.region ?? ''} />
            <InfoRow label="注册时间" value={formatDate(profile?.created_at)} />
            {profile && !hasOptionalProfileFields && (
              <div className="profile-info-empty">该用户未填写性别 / 生日 / 地区</div>
            )}
          </div>

          {/* 关系 */}
          <div className="profile-section">
            <div className="profile-section-title">关系</div>
            <InfoRow label="关系" value={relationLabel(isSelf, isFriend)} />
            {isFriend && friendData && (
              <InfoRow label="成为好友" value={formatDate(friendData.add_time)} />
            )}
            {isFriend && statusText && (
              <div className="profile-info-row">
                <span className="profile-info-label">状态</span>
                <span className="profile-info-value">
                  <span className={`profile-online-dot ${online ? '' : 'offline'}`} />
                  {statusText}
                </span>
              </div>
            )}
            {isFriend && friendData && (friendData.is_special_care || friendData.is_blacklisted) && (
              <div className="profile-badges">
                {friendData.is_special_care && (
                  <span className="profile-badge special-care">⭐ 特别关心</span>
                )}
                {friendData.is_blacklisted && (
                  <span className="profile-badge blacklisted">已拉黑</span>
                )}
              </div>
            )}

            {/* 好友备注编辑 */}
            {isFriend && !isSelf && (
              editingRemark ? (
                <div className="profile-remark-row">
                  <input
                    className="profile-remark-input"
                    value={remarkInput}
                    maxLength={30}
                    placeholder="设置备注名（仅自己可见）"
                    onChange={(e) => setRemarkInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveRemark()}
                  />
                  <button
                    type="button"
                    className="subtle-btn subtle-btn--sm subtle-btn--primary"
                    onClick={saveRemark}
                    disabled={savingRemark}
                  >
                    {savingRemark ? '保存中' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="subtle-btn subtle-btn--sm subtle-btn--neutral"
                    onClick={() => setEditingRemark(false)}
                    disabled={savingRemark}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="profile-info-row">
                  <span className="profile-info-label">备注</span>
                  <button
                    type="button"
                    className="subtle-btn subtle-btn--sm subtle-btn--primary"
                    onClick={startEditRemark}
                  >
                    {friendData?.friend_remark ? '修改备注' : '设置备注'}
                  </button>
                </div>
              )
            )}
          </div>

          {/* 操作区 */}
          {!isSelf && (
            <div className="other-profile-actions">
              {actionError && <div className="other-profile-error">{actionError}</div>}
              {isFriend ? (
                <AppButton variant="primary" block onClick={handleSendMessage}>
                  发消息
                </AppButton>
              ) : (
                <AppButton
                  variant="primary"
                  block
                  leftIcon={<AddUserIcon />}
                  onClick={handleAddFriend}
                  disabled={sending || sent}
                >
                  {addButtonText(sent, sending)}
                </AppButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
