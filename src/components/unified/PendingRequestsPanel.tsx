/**
 * 待通过申请面板（req-23，"+" AddMenu 的第 3 项）
 *
 * 两个分区：
 * - 收到的（需处理）：好友申请 + 群邀请，每行带 [同意/接受] [拒绝] 操作
 * - 我发出的（等待对方）：我主动发出、仍 pending 的好友申请 + 加群申请，
 *   仅展示"待通过"，无任何操作（后端无撤回接口，huanwei 定稿 #4）
 *
 * 复用：modal-overlay / modal-content / modal-header / close-btn / form-error /
 * miniapp-btn 等既有 CSS 类；行样式在 add-menu.css 内的 pending-req-* 类。
 * 经 createPortal 挂到 document.body，避免被 header 的层叠上下文裁剪。
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApi, useSession } from '../../contexts/SessionContext';
import {
  getPendingRequests,
  approveFriendRequest,
  rejectFriendRequest,
  getSentFriendRequests,
  type PendingRequest,
  type SentFriendRequest,
} from '../../api/friends';
import {
  getGroupInvitations,
  acceptGroupInvitation,
  declineGroupInvitation,
  getSentJoinRequests,
  type GroupInvitation,
  type SentJoinRequestInfo,
  type Group,
} from '../../api/groups';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { CloseIcon } from '../common/Icons';
import '../../styles/components/add-menu.css';

interface PendingRequestsPanelProps {
  onClose: () => void;
  /** 通过一条好友申请后刷新好友列表 */
  onFriendAdded?: () => void;
  /** 接受一条群邀请后增量添加群 */
  addGroup?: (group: Group) => void;
}

/** 单行头像：后端资源必经 resolveServerAvatarUrl 收口（webview 私有 CA）；无图回退占位 */
function RequestAvatar({ path, name }: { path: string | null | undefined; name: string | null }) {
  const resolved = resolveServerAvatarUrl(path);
  return (
    <div className="pending-req-avatar">
      {resolved ? <img src={resolved} alt="" /> : <AvatarPlaceholder name={name} fontSize={16} />}
    </div>
  );
}

export function PendingRequestsPanel({ onClose, onFriendAdded, addGroup }: PendingRequestsPanelProps) {
  const api = useApi();
  const { session } = useSession();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [friendRequests, setFriendRequests] = useState<PendingRequest[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvitation[]>([]);
  const [sentFriendReqs, setSentFriendReqs] = useState<SentFriendRequest[]>([]);
  const [sentJoinReqs, setSentJoinReqs] = useState<SentJoinRequestInfo[]>([]);

  // 挂载时并行加载四份列表；每份独立 try/catch 降级为空数组（对齐 AddModal）
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [fr, gi, sfr, sjr] = await Promise.all([
      getPendingRequests(api).catch((): PendingRequest[] => []),
      getGroupInvitations(api).then((r) => r.invitations || []).catch((): GroupInvitation[] => []),
      getSentFriendRequests(api).catch((): SentFriendRequest[] => []),
      getSentJoinRequests(api).then((r) => r.requests || []).catch((): SentJoinRequestInfo[] => []),
    ]);
    setFriendRequests(Array.isArray(fr) ? fr : []);
    setGroupInvites(gi);
    setSentFriendReqs(Array.isArray(sfr) ? sfr : []);
    setSentJoinReqs(sjr);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 操作错误 3s 自动清除
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleApproveFriend = async (r: PendingRequest) => {
    if (!session) {
      return;
    }
    try {
      await approveFriendRequest(api, session.userId, r.request_user_id);
      setFriendRequests((prev) => prev.filter((x) => x.request_id !== r.request_id));
      onFriendAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleRejectFriend = async (r: PendingRequest) => {
    if (!session) {
      return;
    }
    try {
      await rejectFriendRequest(api, session.userId, r.request_user_id);
      setFriendRequests((prev) => prev.filter((x) => x.request_id !== r.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleAcceptInvite = async (inv: GroupInvitation) => {
    try {
      await acceptGroupInvitation(api, inv.request_id);
      setGroupInvites((prev) => prev.filter((x) => x.request_id !== inv.request_id));
      addGroup?.({
        group_id: inv.group_id,
        group_name: inv.group_name,
        group_avatar_url: resolveServerAvatarUrl(inv.group_avatar_url) || '',
        role: 'member',
        unread_count: 0,
        last_message_content: null,
        last_message_time: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDeclineInvite = async (inv: GroupInvitation) => {
    try {
      await declineGroupInvitation(api, inv.request_id);
      setGroupInvites((prev) => prev.filter((x) => x.request_id !== inv.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const receivedEmpty = friendRequests.length === 0 && groupInvites.length === 0;
  const sentEmpty = sentFriendReqs.length === 0 && sentJoinReqs.length === 0;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pending-req-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>待通过申请</h2>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="pending-req-body">
          {loading ? (
            <div className="pending-req-loading">
              <LoadingSpinner />
              <span>加载中...</span>
            </div>
          ) : (
            <>
              {/* 收到的（需处理） */}
              <section className="pending-req-section">
                <div className="pending-req-section-title">收到的（需处理）</div>
                {receivedEmpty ? (
                  <div className="pending-req-empty">没有待处理的申请</div>
                ) : (
                  <>
                    {friendRequests.map((r) => (
                      <div className="pending-req-row" key={`fr-${r.request_id}`}>
                        <RequestAvatar path={r.requester_avatar_url} name={r.requester_nickname ?? r.request_user_id} />
                        <div className="pending-req-info">
                          <div className="pending-req-name">{r.requester_nickname ?? r.request_user_id}</div>
                          {r.request_message && <div className="pending-req-meta">{r.request_message}</div>}
                        </div>
                        <div className="pending-req-actions">
                          <button className="miniapp-btn small primary" onClick={() => handleApproveFriend(r)}>
                            同意
                          </button>
                          <button className="miniapp-btn small" onClick={() => handleRejectFriend(r)}>
                            拒绝
                          </button>
                        </div>
                      </div>
                    ))}
                    {groupInvites.map((inv) => (
                      <div className="pending-req-row" key={`gi-${inv.request_id}`}>
                        <RequestAvatar path={inv.group_avatar_url} name={inv.group_name} />
                        <div className="pending-req-info">
                          <div className="pending-req-name">{inv.group_name}</div>
                          <div className="pending-req-meta">
                            {inv.inviter_nickname} 邀请你加入{inv.message ? ` · ${inv.message}` : ''}
                          </div>
                        </div>
                        <div className="pending-req-actions">
                          <button className="miniapp-btn small primary" onClick={() => handleAcceptInvite(inv)}>
                            接受
                          </button>
                          <button className="miniapp-btn small" onClick={() => handleDeclineInvite(inv)}>
                            拒绝
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </section>

              {/* 我发出的（等待对方）：无操作按钮，后端无撤回接口 */}
              <section className="pending-req-section">
                <div className="pending-req-section-title">我发出的（等待对方）</div>
                {sentEmpty ? (
                  <div className="pending-req-empty">没有发出的申请</div>
                ) : (
                  <>
                    {sentFriendReqs.map((sr) => (
                      <div className="pending-req-row" key={`sfr-${sr.request_id}`}>
                        <RequestAvatar path={sr.sent_to_avatar_url} name={sr.sent_to_nickname ?? sr.sent_to_user_id} />
                        <div className="pending-req-info">
                          <div className="pending-req-name">{sr.sent_to_nickname ?? sr.sent_to_user_id}</div>
                          {sr.sent_message && <div className="pending-req-meta">{sr.sent_message}</div>}
                        </div>
                        <span className="pending-req-sent-tag">好友申请 · 待通过</span>
                      </div>
                    ))}
                    {sentJoinReqs.map((sj) => (
                      <div className="pending-req-row" key={`sjr-${sj.request_id}`}>
                        <RequestAvatar path={sj.group_avatar_url} name={sj.group_name} />
                        <div className="pending-req-info">
                          <div className="pending-req-name">{sj.group_name}</div>
                          {sj.message && <div className="pending-req-meta">{sj.message}</div>}
                        </div>
                        <span className="pending-req-sent-tag">加群申请 · 待通过</span>
                      </div>
                    ))}
                  </>
                )}
              </section>

              {error && <div className="form-error">{error}</div>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default PendingRequestsPanel;
