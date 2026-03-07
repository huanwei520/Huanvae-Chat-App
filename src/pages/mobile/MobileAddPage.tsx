/**
 * 移动端添加好友/群聊页面
 *
 * 全屏覆盖页面，复用桌面端 AddModal 的业务逻辑和子组件，
 * 适配移动端交互（全屏布局、分段切换、滑动动画）。
 *
 * 功能：
 * - 添加好友（输入用户 ID + 验证消息）
 * - 处理好友申请（同意/拒绝）
 * - 创建群聊（群名称 + 描述）
 * - 加入群聊（邀请码）
 * - 处理群聊邀请（接受/拒绝）
 *
 * 样式：
 * - 毛玻璃效果，使用 CSS 变量统一管理颜色
 * - 与 MobileProfilePage 一致的页面过渡动画
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import {
  sendFriendRequest,
  getPendingRequests,
  approveFriendRequest,
  rejectFriendRequest,
  type PendingRequest,
} from '../../api/friends';
import {
  createGroup,
  joinGroupByCode,
  getGroupInvitations,
  acceptGroupInvitation,
  declineGroupInvitation,
  type GroupInvitation,
} from '../../api/groups';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import type { Group } from '../../types/chat';

const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={28} height={28}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const GroupIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={28} height={28}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

type PrimaryTab = 'friend' | 'group';
type FriendSubTab = 'add' | 'requests';
type GroupSubTab = 'create' | 'join' | 'invites';

interface MobileAddPageProps {
  onClose: () => void;
  onFriendAdded?: () => void;
  addGroup?: (group: Group) => void;
  refreshGroups?: () => void;
}

export function MobileAddPage({ onClose, onFriendAdded, addGroup, refreshGroups }: MobileAddPageProps) {
  const { session } = useSession();
  const api = useApi();
  const { onSystemNotification, clearPendingNotification } = useWebSocket();

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('friend');
  const [friendSubTab, setFriendSubTab] = useState<FriendSubTab>('add');
  const [groupSubTab, setGroupSubTab] = useState<GroupSubTab>('create');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 添加好友
  const [friendId, setFriendId] = useState('');
  const [friendReason, setFriendReason] = useState('');

  // 好友申请
  const [friendRequests, setFriendRequests] = useState<PendingRequest[]>([]);
  const [loadingFriendRequests, setLoadingFriendRequests] = useState(false);

  // 创建群聊
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');

  // 加入群聊
  const [inviteCode, setInviteCode] = useState('');

  // 群聊邀请
  const [groupInvites, setGroupInvites] = useState<GroupInvitation[]>([]);
  const [loadingGroupInvites, setLoadingGroupInvites] = useState(false);

  const loadFriendRequests = useCallback(async () => {
    setLoadingFriendRequests(true);
    try {
      const response = await getPendingRequests(api);
      setFriendRequests(response.items || []);
    } catch {
      setFriendRequests([]);
    } finally {
      setLoadingFriendRequests(false);
    }
  }, [api]);

  const loadGroupInvites = useCallback(async () => {
    setLoadingGroupInvites(true);
    try {
      const response = await getGroupInvitations(api);
      setGroupInvites(response.data?.invitations || []);
    } catch {
      setGroupInvites([]);
    } finally {
      setLoadingGroupInvites(false);
    }
  }, [api]);

  useEffect(() => {
    loadFriendRequests();
    loadGroupInvites();
    clearPendingNotification('friendRequests');
    clearPendingNotification('groupInvites');
    clearPendingNotification('groupJoinRequests');
  }, [loadFriendRequests, loadGroupInvites, clearPendingNotification]);

  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      switch (msg.notification_type) {
        case 'friend_request':
          loadFriendRequests();
          break;
        case 'friend_request_approved':
          onFriendAdded?.();
          break;
        case 'group_invite':
          loadGroupInvites();
          break;
        case 'group_join_approved':
          refreshGroups?.();
          break;
      }
    });
    return unsubscribe;
  }, [onSystemNotification, loadFriendRequests, loadGroupInvites, onFriendAdded, refreshGroups]);

  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const handleAddFriend = async () => {
    if (!friendId.trim() || !session) { return; }
    setLoading(true);
    setError(null);
    try {
      await sendFriendRequest(api, session.userId, friendId.trim(), friendReason.trim() || undefined);
      setSuccess('好友请求已发送');
      setFriendId('');
      setFriendReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveFriend = async (request: PendingRequest) => {
    if (!session) { return; }
    try {
      await approveFriendRequest(api, session.userId, request.request_user_id);
      setFriendRequests((prev) => prev.filter((r) => r.request_id !== request.request_id));
      onFriendAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleRejectFriend = async (request: PendingRequest) => {
    if (!session) { return; }
    try {
      await rejectFriendRequest(api, session.userId, request.request_user_id);
      setFriendRequests((prev) => prev.filter((r) => r.request_id !== request.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError('请输入群名称');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await createGroup(api, {
        group_name: groupName.trim(),
        group_description: groupDesc.trim() || undefined,
      });
      setSuccess('群聊创建成功');
      setGroupName('');
      setGroupDesc('');
      addGroup?.({
        group_id: result.data.group_id,
        group_name: result.data.group_name,
        group_avatar_url: '',
        role: 'owner',
        unread_count: 0,
        last_message_content: null,
        last_message_time: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!inviteCode.trim()) {
      setError('请输入邀请码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await joinGroupByCode(api, inviteCode.trim());
      setSuccess('已成功加入群聊');
      setInviteCode('');
      refreshGroups?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptGroupInvite = async (invite: GroupInvitation) => {
    try {
      await acceptGroupInvitation(api, invite.request_id);
      setGroupInvites((prev) => prev.filter((i) => i.request_id !== invite.request_id));
      addGroup?.({
        group_id: invite.group_id,
        group_name: invite.group_name,
        group_avatar_url: resolveServerAvatarUrl(invite.group_avatar_url) || '',
        role: 'member',
        unread_count: 0,
        last_message_content: null,
        last_message_time: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDeclineGroupInvite = async (invite: GroupInvitation) => {
    try {
      await declineGroupInvitation(api, invite.request_id);
      setGroupInvites((prev) => prev.filter((i) => i.request_id !== invite.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  const contentVariants = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
  };

  const renderFriendContent = () => {
    if (friendSubTab === 'add') {
      return (
        <motion.div key="add-friend" variants={contentVariants} initial="initial" animate="animate" exit="exit" className="mobile-add-form-card">
          <div className="mobile-add-form-group">
            <label className="mobile-add-label">用户 ID</label>
            <input
              type="text"
              className="mobile-add-input"
              value={friendId}
              onChange={(e) => setFriendId(e.target.value)}
              placeholder="输入对方的用户 ID"
            />
          </div>
          <div className="mobile-add-form-group">
            <label className="mobile-add-label">验证消息（可选）</label>
            <input
              type="text"
              className="mobile-add-input"
              value={friendReason}
              onChange={(e) => setFriendReason(e.target.value)}
              placeholder="向对方介绍一下自己"
              onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
            />
          </div>
          <motion.button
            className="mobile-add-submit"
            onClick={handleAddFriend}
            disabled={loading || !friendId.trim()}
            whileTap={{ scale: 0.97 }}
          >
            {loading ? '发送中...' : '发送好友请求'}
          </motion.button>
        </motion.div>
      );
    }

    const renderRequestList = () => {
      if (loadingFriendRequests) {
        return <div className="mobile-add-loading">加载中...</div>;
      }
      if (friendRequests.length === 0) {
        return (
          <div className="mobile-add-empty">
            <UserIcon />
            <p>暂无好友申请</p>
          </div>
        );
      }
      return (
        <div className="mobile-add-list">
          {friendRequests.map((request) => (
            <motion.div
              key={request.request_id}
              className="mobile-add-item"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="mobile-add-item-avatar">
                <UserIcon />
              </div>
              <div className="mobile-add-item-info">
                <div className="mobile-add-item-name">{request.request_user_id}</div>
                {request.request_message && (
                  <div className="mobile-add-item-reason">{request.request_message}</div>
                )}
              </div>
              <div className="mobile-add-item-actions">
                <motion.button className="mobile-add-action-btn accept" onClick={() => handleApproveFriend(request)} whileTap={{ scale: 0.9 }} aria-label="同意">
                  <CheckIcon />
                </motion.button>
                <motion.button className="mobile-add-action-btn reject" onClick={() => handleRejectFriend(request)} whileTap={{ scale: 0.9 }} aria-label="拒绝">
                  <XIcon />
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      );
    };

    return (
      <motion.div key="friend-requests" variants={contentVariants} initial="initial" animate="animate" exit="exit">
        {renderRequestList()}
      </motion.div>
    );
  };

  const renderGroupContent = () => {
    if (groupSubTab === 'create') {
      return (
        <motion.div key="create-group" variants={contentVariants} initial="initial" animate="animate" exit="exit" className="mobile-add-form-card">
          <div className="mobile-add-form-group">
            <label className="mobile-add-label">群名称</label>
            <input
              type="text"
              className="mobile-add-input"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="输入群名称"
              maxLength={50}
            />
          </div>
          <div className="mobile-add-form-group">
            <label className="mobile-add-label">群简介（可选）</label>
            <textarea
              className="mobile-add-input mobile-add-textarea"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="介绍一下这个群..."
              maxLength={200}
              rows={3}
            />
          </div>
          <motion.button
            className="mobile-add-submit"
            onClick={handleCreateGroup}
            disabled={loading || !groupName.trim()}
            whileTap={{ scale: 0.97 }}
          >
            {loading ? '创建中...' : '创建群聊'}
          </motion.button>
        </motion.div>
      );
    }

    if (groupSubTab === 'join') {
      return (
        <motion.div key="join-group" variants={contentVariants} initial="initial" animate="animate" exit="exit" className="mobile-add-form-card">
          <div className="mobile-add-form-group">
            <label className="mobile-add-label">邀请码</label>
            <input
              type="text"
              className="mobile-add-input"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="输入群邀请码"
              onKeyDown={(e) => e.key === 'Enter' && handleJoinGroup()}
            />
          </div>
          <motion.button
            className="mobile-add-submit"
            onClick={handleJoinGroup}
            disabled={loading || !inviteCode.trim()}
            whileTap={{ scale: 0.97 }}
          >
            {loading ? '加入中...' : '加入群聊'}
          </motion.button>
        </motion.div>
      );
    }

    const renderInviteList = () => {
      if (loadingGroupInvites) {
        return <div className="mobile-add-loading">加载中...</div>;
      }
      if (groupInvites.length === 0) {
        return (
          <div className="mobile-add-empty">
            <GroupIcon />
            <p>暂无群聊邀请</p>
          </div>
        );
      }
      return (
        <div className="mobile-add-list">
          {groupInvites.map((invite) => (
            <motion.div
              key={invite.request_id}
              className="mobile-add-item"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="mobile-add-item-avatar">
                {invite.group_avatar_url ? (
                  <img src={resolveServerAvatarUrl(invite.group_avatar_url) || ''} alt={invite.group_name} />
                ) : (
                  <GroupIcon />
                )}
              </div>
              <div className="mobile-add-item-info">
                <div className="mobile-add-item-name">{invite.group_name}</div>
                <div className="mobile-add-item-sub">邀请人: {invite.inviter_nickname}</div>
                {invite.message && (
                  <div className="mobile-add-item-reason">{invite.message}</div>
                )}
              </div>
              <div className="mobile-add-item-actions">
                <motion.button className="mobile-add-action-btn accept" onClick={() => handleAcceptGroupInvite(invite)} whileTap={{ scale: 0.9 }} aria-label="接受">
                  <CheckIcon />
                </motion.button>
                <motion.button className="mobile-add-action-btn reject" onClick={() => handleDeclineGroupInvite(invite)} whileTap={{ scale: 0.9 }} aria-label="拒绝">
                  <XIcon />
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      );
    };

    return (
      <motion.div key="group-invites" variants={contentVariants} initial="initial" animate="animate" exit="exit">
        {renderInviteList()}
      </motion.div>
    );
  };

  return (
    <motion.div
      className="mobile-add-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-add-header">
        <button className="mobile-add-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-add-title">添加好友/群聊</h1>
        <div className="mobile-add-placeholder" />
      </header>

      {/* 内容区域 */}
      <div className="mobile-add-content">
        {/* 一级分段切换：好友 / 群聊 */}
        <div className="mobile-add-segment">
          <button
            className={`mobile-add-segment-btn ${primaryTab === 'friend' ? 'active' : ''}`}
            onClick={() => setPrimaryTab('friend')}
          >
            好友
            {friendRequests.length > 0 && (
              <span className="mobile-add-badge">{friendRequests.length}</span>
            )}
          </button>
          <button
            className={`mobile-add-segment-btn ${primaryTab === 'group' ? 'active' : ''}`}
            onClick={() => setPrimaryTab('group')}
          >
            群聊
            {groupInvites.length > 0 && (
              <span className="mobile-add-badge">{groupInvites.length}</span>
            )}
          </button>
        </div>

        {/* 二级子标签 */}
        <AnimatePresence mode="wait">
          {primaryTab === 'friend' ? (
            <motion.div key="friend-tabs" variants={contentVariants} initial="initial" animate="animate" exit="exit">
              <div className="mobile-add-sub-tabs">
                <button
                  className={`mobile-add-sub-tab ${friendSubTab === 'add' ? 'active' : ''}`}
                  onClick={() => setFriendSubTab('add')}
                >
                  添加
                </button>
                <button
                  className={`mobile-add-sub-tab ${friendSubTab === 'requests' ? 'active' : ''}`}
                  onClick={() => setFriendSubTab('requests')}
                >
                  申请
                  {friendRequests.length > 0 && (
                    <span className="mobile-add-badge">{friendRequests.length}</span>
                  )}
                </button>
              </div>
              <AnimatePresence mode="wait">
                {renderFriendContent()}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="group-tabs" variants={contentVariants} initial="initial" animate="animate" exit="exit">
              <div className="mobile-add-sub-tabs">
                <button
                  className={`mobile-add-sub-tab ${groupSubTab === 'create' ? 'active' : ''}`}
                  onClick={() => setGroupSubTab('create')}
                >
                  创建
                </button>
                <button
                  className={`mobile-add-sub-tab ${groupSubTab === 'join' ? 'active' : ''}`}
                  onClick={() => setGroupSubTab('join')}
                >
                  加入
                </button>
                <button
                  className={`mobile-add-sub-tab ${groupSubTab === 'invites' ? 'active' : ''}`}
                  onClick={() => setGroupSubTab('invites')}
                >
                  邀请
                  {groupInvites.length > 0 && (
                    <span className="mobile-add-badge">{groupInvites.length}</span>
                  )}
                </button>
              </div>
              <AnimatePresence mode="wait">
                {renderGroupContent()}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 错误/成功提示 */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="mobile-add-toast error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              className="mobile-add-toast success"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {success}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
