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
import { useWebSocket } from '../contexts/WebSocketContext';
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
import { CloseIcon } from './common/Icons';
import {
  type TabType,
  type AddModalProps,
  TabNavigation,
  AddFriendTab,
  FriendRequestsTab,
  CreateGroupTab,
  JoinGroupTab,
  GroupInvitesTab,
} from './modals/add';

export function AddModal({ isOpen, onClose, onFriendAdded, onGroupAdded }: AddModalProps) {
  const { session } = useSession();
  const api = useApi();
  const { onSystemNotification, clearPendingNotification } = useWebSocket();

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

  // 初始加载 & 清除待处理通知计数
  useEffect(() => {
    if (isOpen) {
      loadFriendRequests();
      loadGroupInvites();
      // 清除通知徽章计数
      clearPendingNotification('friendRequests');
      clearPendingNotification('groupInvites');
      clearPendingNotification('groupJoinRequests');
    }
  }, [isOpen, loadFriendRequests, loadGroupInvites, clearPendingNotification]);

  // 监听 WebSocket 系统通知，实时刷新申请/邀请列表
  useEffect(() => {
    if (!isOpen) { return; }

    const unsubscribe = onSystemNotification((msg) => {
      switch (msg.notification_type) {
        case 'friend_request':
          // 收到新的好友申请，刷新列表
          loadFriendRequests();
          break;
        case 'friend_request_approved':
          // 好友申请被对方通过，刷新好友列表
          onFriendAdded?.();
          break;
        case 'group_invite':
          // 收到新的群聊邀请，刷新列表
          loadGroupInvites();
          break;
        case 'group_join_approved':
          // 群聊加入申请被通过，刷新群列表
          onGroupAdded?.();
          break;
      }
    });

    return unsubscribe;
  }, [isOpen, onSystemNotification, loadFriendRequests, loadGroupInvites, onFriendAdded, onGroupAdded]);

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
      await approveFriendRequest(api, session.userId, request.request_user_id);
      setFriendRequests((prev) => prev.filter((r) => r.request_id !== request.request_id));
      onFriendAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 拒绝好友申请
  const handleRejectFriend = async (request: PendingRequest) => {
    if (!session) { return; }
    try {
      await rejectFriendRequest(api, session.userId, request.request_user_id);
      setFriendRequests((prev) => prev.filter((r) => r.request_id !== request.request_id));
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

  // 渲染当前 Tab 内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'add-friend':
        return (
          <AddFriendTab
            friendId={friendId}
            friendReason={friendReason}
            loading={loading}
            onFriendIdChange={setFriendId}
            onReasonChange={setFriendReason}
            onSubmit={handleAddFriend}
          />
        );
      case 'friend-requests':
        return (
          <FriendRequestsTab
            loading={loadingFriendRequests}
            requests={friendRequests}
            onApprove={handleApproveFriend}
            onReject={handleRejectFriend}
          />
        );
      case 'create-group':
        return (
          <CreateGroupTab
            groupName={groupName}
            groupDesc={groupDesc}
            loading={loading}
            onNameChange={setGroupName}
            onDescChange={setGroupDesc}
            onSubmit={handleCreateGroup}
          />
        );
      case 'join-group':
        return (
          <JoinGroupTab
            inviteCode={inviteCode}
            loading={loading}
            onCodeChange={setInviteCode}
            onSubmit={handleJoinGroup}
          />
        );
      case 'group-invites':
        return (
          <GroupInvitesTab
            loading={loadingGroupInvites}
            invites={groupInvites}
            onAccept={handleAcceptGroupInvite}
            onDecline={handleDeclineGroupInvite}
          />
        );
      default:
        return null;
    }
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
            <TabNavigation
              activeTab={activeTab}
              friendRequestsCount={friendRequests.length}
              groupInvitesCount={groupInvites.length}
              onTabChange={setActiveTab}
            />

            {/* 待处理提示 */}
            {totalPending > 0 && (
              <div className="pending-notice">
                您有 {totalPending} 条待处理的申请/邀请
              </div>
            )}

            {/* 内容区域 */}
            <div className="add-modal-content">
              {renderTabContent()}

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
