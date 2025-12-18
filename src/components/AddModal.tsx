/**
 * 统一添加弹窗组件
 *
 * 功能：
 * - 添加好友
 * - 处理好友申请
 * - 创建/加入群聊
 * - 处理群聊邀请
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../contexts/SessionContext';
import {
  sendFriendRequest,
  getPendingRequests,
  approveFriendRequest,
  rejectFriendRequest,
  type PendingRequest,
} from '../api/friends';
import {
  createGroup,
  joinGroupByCode,
  getGroupInvitations,
  acceptGroupInvitation,
  declineGroupInvitation,
  type GroupInvitation,
} from '../api/groups';

// ============================================
// 图标组件
// ============================================

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={20} height={20}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={32} height={32}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const GroupIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={32} height={32}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFriendAdded?: () => void;
  onGroupAdded?: () => void;
}

type TabType = 'add-friend' | 'friend-requests' | 'create-group' | 'join-group' | 'group-invites';

// ============================================
// 主组件
// ============================================

export function AddModal({ isOpen, onClose, onFriendAdded, onGroupAdded }: AddModalProps) {
  const { session } = useSession();
  const api = useApi();

  const [activeTab, setActiveTab] = useState<TabType>('add-friend');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 添加好友表单
  const [friendId, setFriendId] = useState('');
  const [friendReason, setFriendReason] = useState('');

  // 好友申请列表
  const [friendRequests, setFriendRequests] = useState<PendingRequest[]>([]);
  const [loadingFriendRequests, setLoadingFriendRequests] = useState(false);

  // 创建群聊表单
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');

  // 加入群聊
  const [inviteCode, setInviteCode] = useState('');

  // 群聊邀请列表
  const [groupInvites, setGroupInvites] = useState<GroupInvitation[]>([]);
  const [loadingGroupInvites, setLoadingGroupInvites] = useState(false);

  // 加载好友申请
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

  // 加载群聊邀请
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

  // 初始加载
  useEffect(() => {
    if (isOpen) {
      loadFriendRequests();
      loadGroupInvites();
    }
  }, [isOpen, loadFriendRequests, loadGroupInvites]);

  // 清除消息
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // 发送好友请求
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

  // 同意好友申请
  const handleApproveFriend = async (request: PendingRequest) => {
    if (!session) { return; }
    try {
      await approveFriendRequest(api, session.userId, request.applicant_id);
      setFriendRequests((prev) => prev.filter((r) => r.applicant_id !== request.applicant_id));
      onFriendAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 拒绝好友申请
  const handleRejectFriend = async (request: PendingRequest) => {
    if (!session) { return; }
    try {
      await rejectFriendRequest(api, session.userId, request.applicant_id);
      setFriendRequests((prev) => prev.filter((r) => r.applicant_id !== request.applicant_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 创建群聊
  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError('请输入群名称');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await createGroup(api, {
        group_name: groupName.trim(),
        group_description: groupDesc.trim() || undefined,
      });
      setSuccess('群聊创建成功');
      setGroupName('');
      setGroupDesc('');
      onGroupAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  // 通过邀请码加入群聊
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
      onGroupAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败');
    } finally {
      setLoading(false);
    }
  };

  // 接受群聊邀请
  const handleAcceptGroupInvite = async (invite: GroupInvitation) => {
    try {
      await acceptGroupInvitation(api, invite.request_id);
      setGroupInvites((prev) => prev.filter((i) => i.request_id !== invite.request_id));
      onGroupAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 拒绝群聊邀请
  const handleDeclineGroupInvite = async (invite: GroupInvitation) => {
    try {
      await declineGroupInvitation(api, invite.request_id);
      setGroupInvites((prev) => prev.filter((i) => i.request_id !== invite.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const totalPending = friendRequests.length + groupInvites.length;

  const modalVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const contentVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: 'spring', damping: 25, stiffness: 300 },
    },
    exit: { opacity: 0, scale: 0.95, y: 20 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="modal-content add-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <h2>添加好友/群聊</h2>
              <motion.button
                className="close-btn"
                onClick={onClose}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <CloseIcon />
              </motion.button>
            </div>

            {/* 标签切换 */}
            <div className="add-modal-tabs">
              <div className="tab-group">
                <span className="tab-group-label">好友</span>
                <div className="tab-buttons">
                  <button
                    className={`tab-btn ${activeTab === 'add-friend' ? 'active' : ''}`}
                    onClick={() => setActiveTab('add-friend')}
                  >
                    添加
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'friend-requests' ? 'active' : ''}`}
                    onClick={() => setActiveTab('friend-requests')}
                  >
                    申请
                    {friendRequests.length > 0 && (
                      <span className="badge">{friendRequests.length}</span>
                    )}
                  </button>
                </div>
              </div>
              <div className="tab-group">
                <span className="tab-group-label">群聊</span>
                <div className="tab-buttons">
                  <button
                    className={`tab-btn ${activeTab === 'create-group' ? 'active' : ''}`}
                    onClick={() => setActiveTab('create-group')}
                  >
                    创建
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'join-group' ? 'active' : ''}`}
                    onClick={() => setActiveTab('join-group')}
                  >
                    加入
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'group-invites' ? 'active' : ''}`}
                    onClick={() => setActiveTab('group-invites')}
                  >
                    邀请
                    {groupInvites.length > 0 && (
                      <span className="badge">{groupInvites.length}</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 待处理提示 */}
            {totalPending > 0 && (
              <div className="pending-notice">
                您有 {totalPending} 条待处理的申请/邀请
              </div>
            )}

            {/* 内容区域 */}
            <div className="add-modal-content">
              {/* 添加好友 */}
              {activeTab === 'add-friend' && (
                <>
                  <div className="form-group">
                    <label>用户 ID</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={friendId}
                      onChange={(e) => setFriendId(e.target.value)}
                      placeholder="输入对方的用户 ID"
                    />
                  </div>
                  <div className="form-group">
                    <label>验证消息（可选）</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={friendReason}
                      onChange={(e) => setFriendReason(e.target.value)}
                      placeholder="向对方介绍一下自己"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
                    />
                  </div>
                  <motion.button
                    className="glass-button"
                    onClick={handleAddFriend}
                    disabled={loading || !friendId.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '发送中...' : '发送好友请求'}
                  </motion.button>
                </>
              )}

              {/* 好友申请列表 */}
              {activeTab === 'friend-requests' && (
                <div className="pending-list">
                  {loadingFriendRequests && (
                    <div className="loading-state">加载中...</div>
                  )}
                  {!loadingFriendRequests && friendRequests.length === 0 && (
                    <div className="empty-state">
                      <UserIcon />
                      <p>暂无好友申请</p>
                    </div>
                  )}
                  {!loadingFriendRequests && friendRequests.length > 0 && (
                    friendRequests.map((request) => (
                      <motion.div
                        key={request.applicant_id}
                        className="pending-item"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <div className="pending-avatar">
                          {request.applicant_avatar_url ? (
                            <img src={request.applicant_avatar_url} alt={request.applicant_nickname} />
                          ) : (
                            <UserIcon />
                          )}
                        </div>
                        <div className="pending-info">
                          <div className="pending-name">{request.applicant_nickname}</div>
                          <div className="pending-id">@{request.applicant_id}</div>
                          {request.reason && (
                            <div className="pending-reason">{request.reason}</div>
                          )}
                        </div>
                        <div className="pending-actions">
                          <motion.button
                            className="action-btn accept"
                            onClick={() => handleApproveFriend(request)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="同意"
                          >
                            <CheckIcon />
                          </motion.button>
                          <motion.button
                            className="action-btn reject"
                            onClick={() => handleRejectFriend(request)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="拒绝"
                          >
                            <XIcon />
                          </motion.button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              )}

              {/* 创建群聊 */}
              {activeTab === 'create-group' && (
                <>
                  <div className="form-group">
                    <label>群名称</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="输入群名称"
                      maxLength={50}
                    />
                  </div>
                  <div className="form-group">
                    <label>群简介（可选）</label>
                    <textarea
                      className="glass-input"
                      value={groupDesc}
                      onChange={(e) => setGroupDesc(e.target.value)}
                      placeholder="介绍一下这个群..."
                      maxLength={200}
                      rows={3}
                    />
                  </div>
                  <motion.button
                    className="glass-button"
                    onClick={handleCreateGroup}
                    disabled={loading || !groupName.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '创建中...' : '创建群聊'}
                  </motion.button>
                </>
              )}

              {/* 加入群聊 */}
              {activeTab === 'join-group' && (
                <>
                  <div className="form-group">
                    <label>邀请码</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="输入群邀请码"
                      onKeyDown={(e) => e.key === 'Enter' && handleJoinGroup()}
                    />
                  </div>
                  <motion.button
                    className="glass-button"
                    onClick={handleJoinGroup}
                    disabled={loading || !inviteCode.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '加入中...' : '加入群聊'}
                  </motion.button>
                </>
              )}

              {/* 群聊邀请列表 */}
              {activeTab === 'group-invites' && (
                <div className="pending-list">
                  {loadingGroupInvites && (
                    <div className="loading-state">加载中...</div>
                  )}
                  {!loadingGroupInvites && groupInvites.length === 0 && (
                    <div className="empty-state">
                      <GroupIcon />
                      <p>暂无群聊邀请</p>
                    </div>
                  )}
                  {!loadingGroupInvites && groupInvites.length > 0 && (
                    groupInvites.map((invite) => (
                      <motion.div
                        key={invite.request_id}
                        className="pending-item"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <div className="pending-avatar">
                          {invite.group_avatar_url ? (
                            <img src={invite.group_avatar_url} alt={invite.group_name} />
                          ) : (
                            <GroupIcon />
                          )}
                        </div>
                        <div className="pending-info">
                          <div className="pending-name">{invite.group_name}</div>
                          <div className="pending-id">邀请人: {invite.inviter_nickname}</div>
                          {invite.message && (
                            <div className="pending-reason">{invite.message}</div>
                          )}
                        </div>
                        <div className="pending-actions">
                          <motion.button
                            className="action-btn accept"
                            onClick={() => handleAcceptGroupInvite(invite)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="接受"
                          >
                            <CheckIcon />
                          </motion.button>
                          <motion.button
                            className="action-btn reject"
                            onClick={() => handleDeclineGroupInvite(invite)}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            title="拒绝"
                          >
                            <XIcon />
                          </motion.button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              )}

              {/* 错误/成功提示 */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="form-error"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {error}
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    className="form-success"
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
