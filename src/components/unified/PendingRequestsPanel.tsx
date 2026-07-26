/**
 * 待通过申请面板（req-23 "+" AddMenu 第 3 项；req-24 合并为单一列表）
 *
 * 四类合并成一个统一列表（像历史记录一样按时间倒序排在一起）：
 *   ① 收到的好友申请 ② 收到的群邀请 ③ 我发出的好友申请 ④ 我发出的加群申请
 * 每行小字标注「方向 + 类型」（如「向你发起的好友申请」「你发出的群聊申请」）：
 *   - 收到的 → 右侧 [同意/接受] [拒绝] 操作
 *   - 发出的 → 右侧「待通过」小字标签，无操作（后端无撤回接口，huanwei 定稿 #4）
 * 加载 / 合并 / 动作逻辑统一收在 usePendingRequests（与移动端 MobileAddPage 共用）。
 *
 * 复用 modal-overlay / modal-content / modal-header / close-btn / form-error / miniapp-btn
 * 等既有 CSS；行样式在 add-menu.css 内的 pending-req-* 类。经 createPortal 挂 body。
 */

import { createPortal } from 'react-dom';
import { type PendingRequest } from '../../api/friends';
import { type Group, type GroupInvitation } from '../../api/groups';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { CloseIcon } from '../common/Icons';
import { usePendingRequests } from '../../hooks/usePendingRequests';
import { type PendingItem } from './pendingRequests';
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
  const { items, loading, error, approveFriend, rejectFriend, acceptInvite, declineInvite } =
    usePendingRequests({ onFriendAdded, addGroup });

  // 收到的 → 同意/接受 + 拒绝；发出的 → 「待通过」标签（无操作，后端无撤回接口）
  const renderActions = (item: PendingItem) => {
    switch (item.kind) {
      case 'received-friend': {
        const r = item.raw as PendingRequest;
        return (
          <div className="pending-req-actions">
            <button className="miniapp-btn small primary" onClick={() => approveFriend(r)}>
              同意
            </button>
            <button className="miniapp-btn small" onClick={() => rejectFriend(r)}>
              拒绝
            </button>
          </div>
        );
      }
      case 'received-group': {
        const inv = item.raw as GroupInvitation;
        return (
          <div className="pending-req-actions">
            <button className="miniapp-btn small primary" onClick={() => acceptInvite(inv)}>
              接受
            </button>
            <button className="miniapp-btn small" onClick={() => declineInvite(inv)}>
              拒绝
            </button>
          </div>
        );
      }
      default:
        return <span className="pending-req-sent-tag">待通过</span>;
    }
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="pending-req-loading">
          <LoadingSpinner />
          <span>加载中...</span>
        </div>
      );
    }
    if (items.length === 0) {
      return <div className="pending-req-empty">没有待通过的申请</div>;
    }
    return (
      <div className="pending-req-list">
        {items.map((item) => (
          <div className="pending-req-row" key={item.key}>
            <RequestAvatar path={item.avatarPath} name={item.name} />
            <div className="pending-req-info">
              <div className="pending-req-name">{item.name}</div>
              <div className="pending-req-meta">{item.label}</div>
              {item.message && <div className="pending-req-meta">{item.message}</div>}
            </div>
            {renderActions(item)}
          </div>
        ))}
      </div>
    );
  };

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
          {renderBody()}
          {error && <div className="form-error">{error}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default PendingRequestsPanel;
