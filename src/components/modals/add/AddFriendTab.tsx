/**
 * 添加好友 Tab（预览确认流程）
 *
 * 输入用户 ID → 「查找用户」拉取公开资料出确认卡 → 确认后发送好友请求。
 * 查无此人给明确空态。逻辑收口在 useAddFriendFlow（与移动端 MobileAddPage 共用）。
 */

import { MotionAppButton } from '../../common/AppButton';
import { AvatarPlaceholder } from '../../common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
import { useAddFriendFlow } from '../../../hooks/useAddFriendFlow';

interface AddFriendTabProps {
  /** 发送成功回调（父级展示成功提示） */
  onSent?: () => void;
}

export function AddFriendTab({ onSent }: AddFriendTabProps) {
  const {
    friendId,
    reason,
    preview,
    previewLoading,
    notFound,
    error,
    sending,
    sent,
    isFriend,
    setFriendId,
    setReason,
    lookup,
    reset,
    send,
  } = useAddFriendFlow(onSent);

  const previewName = preview?.user_nickname?.trim() || friendId.trim();
  // 预览头像走显示收口点（私有 CA）：user_avatar_url 是原始后端相对路径。
  const previewAvatar = resolveServerAvatarUrl(preview?.user_avatar_url);

  let sendLabel = '发送好友请求';
  if (sent) {
    sendLabel = '已发送';
  } else if (sending) {
    sendLabel = '发送中...';
  }

  return (
    <>
      <div className="form-group">
        <label>用户 ID</label>
        <input
          type="text"
          className="glass-input"
          value={friendId}
          onChange={(e) => setFriendId(e.target.value)}
          placeholder="输入对方的用户 ID"
          onKeyDown={(e) => e.key === 'Enter' && !preview && lookup()}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {!preview && (
        <>
          {notFound && (
            <div className="empty-state">
              <p>查无此人，请检查用户 ID</p>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <MotionAppButton
            variant="primary"
            size="lg"
            block
            onClick={lookup}
            disabled={previewLoading || !friendId.trim()}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {previewLoading ? '查找中...' : '查找用户'}
          </MotionAppButton>
        </>
      )}

      {preview && (
        <>
          <div className="pending-item">
            <div className="pending-avatar">
              {previewAvatar ? (
                <img src={previewAvatar} alt={previewName} />
              ) : (
                <AvatarPlaceholder name={previewName} fontSize={18} />
              )}
            </div>
            <div className="pending-info">
              <div className="pending-name">{previewName}</div>
              <div className="pending-id">@{friendId.trim()}</div>
              {preview.user_signature && (
                <div className="pending-reason">{preview.user_signature}</div>
              )}
              {isFriend && <div className="pending-reason">已是好友</div>}
            </div>
          </div>

          <div className="form-group">
            <label>验证消息（可选）</label>
            <input
              type="text"
              className="glass-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="向对方介绍一下自己"
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div
            className="add-friend-confirm-actions"
            style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}
          >
            <MotionAppButton
              variant="secondary"
              size="lg"
              onClick={reset}
              disabled={sending}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              重新查找
            </MotionAppButton>
            <MotionAppButton
              variant="primary"
              size="lg"
              block
              onClick={send}
              disabled={sending || sent || isFriend}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isFriend ? '已是好友' : sendLabel}
            </MotionAppButton>
          </div>
        </>
      )}
    </>
  );
}
