/**
 * 群聊管理弹窗组件
 *
 * 功能：
 * - 显示我的群聊列表
 * - 创建新群聊
 * - 通过邀请码加入群聊
 * - 查看群邀请
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../contexts/SessionContext';
import {
  getMyGroups,
  createGroup,
  joinGroupByCode,
  getGroupInvitations,
  acceptGroupInvitation,
  declineGroupInvitation,
  type Group,
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

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const GroupIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={40} height={40}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
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

// ============================================
// 类型定义
// ============================================

interface GroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupSelect?: (group: Group) => void;
}

type TabType = 'list' | 'create' | 'join' | 'invitations';

// ============================================
// 子组件
// ============================================

interface GroupListContentProps {
  loading: boolean;
  groups: Group[];
  onGroupSelect?: (group: Group) => void;
  onClose: () => void;
  getRoleText: (role: string) => string;
}

function GroupListContent({ loading, groups, onGroupSelect, onClose, getRoleText }: GroupListContentProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="empty-state">
        <GroupIcon />
        <p>暂无群聊</p>
        <span>创建或加入一个群聊吧</span>
      </div>
    );
  }

  return (
    <div className="groups-list">
      {groups.map((group) => (
        <motion.div
          key={group.group_id}
          className="group-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ backgroundColor: 'rgba(147, 197, 253, 0.15)' }}
          onClick={() => {
            onGroupSelect?.(group);
            onClose();
          }}
        >
          <div className="group-avatar">
            {group.group_avatar_url ? (
              <img src={group.group_avatar_url} alt={group.group_name} />
            ) : (
              <GroupIcon />
            )}
          </div>
          <div className="group-info">
            <div className="group-name">{group.group_name}</div>
            <div className="group-meta">
              <span className="group-role">{getRoleText(group.role)}</span>
              {group.last_message_content && (
                <span className="group-preview">{group.last_message_content}</span>
              )}
            </div>
          </div>
          {group.unread_count && group.unread_count > 0 && (
            <div className="unread-badge">{group.unread_count}</div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

interface InvitationsListContentProps {
  loading: boolean;
  invitations: GroupInvitation[];
  onAccept: (invitation: GroupInvitation) => void;
  onDecline: (invitation: GroupInvitation) => void;
}

function InvitationsListContent({ loading, invitations, onAccept, onDecline }: InvitationsListContentProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (invitations.length === 0) {
    return <div className="empty-state">暂无群邀请</div>;
  }

  return (
    <div className="pending-list">
      {invitations.map((invitation) => (
        <motion.div
          key={invitation.request_id}
          className="pending-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pending-avatar">
            {invitation.group_avatar_url ? (
              <img src={invitation.group_avatar_url} alt={invitation.group_name} />
            ) : (
              <GroupIcon />
            )}
          </div>
          <div className="pending-info">
            <div className="pending-name">{invitation.group_name}</div>
            <div className="pending-id">邀请人: {invitation.inviter_nickname}</div>
            {invitation.message && (
              <div className="pending-reason">{invitation.message}</div>
            )}
          </div>
          <div className="pending-actions">
            <motion.button
              className="action-btn accept"
              onClick={() => onAccept(invitation)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="接受"
            >
              <CheckIcon />
            </motion.button>
            <motion.button
              className="action-btn reject"
              onClick={() => onDecline(invitation)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="拒绝"
            >
              <XIcon />
            </motion.button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function GroupsModal({ isOpen, onClose, onGroupSelect }: GroupsModalProps) {
  const api = useApi();

  const [activeTab, setActiveTab] = useState<TabType>('list');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 群聊列表
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // 创建群聊表单
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // 加入群聊
  const [inviteCode, setInviteCode] = useState('');

  // 群邀请
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // 加载群聊列表
  const loadGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const response = await getMyGroups(api);
      setGroups(response.data || []);
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, [api]);

  // 加载群邀请
  const loadInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      const response = await getGroupInvitations(api);
      setInvitations(response.data?.invitations || []);
    } catch {
      setInvitations([]);
    } finally {
      setLoadingInvitations(false);
    }
  }, [api]);

  // 初始加载
  useEffect(() => {
    if (isOpen) {
      loadGroups();
      loadInvitations();
    }
  }, [isOpen, loadGroups, loadInvitations]);

  // 创建群聊
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      setError('请输入群名称');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await createGroup(api, {
        group_name: newGroupName.trim(),
        group_description: newGroupDesc.trim() || undefined,
      });
      setSuccess('群聊创建成功');
      setNewGroupName('');
      setNewGroupDesc('');
      loadGroups();
      setActiveTab('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  // 通过邀请码加入
  const handleJoinByCode = async () => {
    if (!inviteCode.trim()) {
      setError('请输入邀请码');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await joinGroupByCode(api, inviteCode.trim());
      setSuccess('已成功加入群聊');
      setInviteCode('');
      loadGroups();
      setActiveTab('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败');
    } finally {
      setLoading(false);
    }
  };

  // 接受群邀请
  const handleAcceptInvitation = async (invitation: GroupInvitation) => {
    try {
      await acceptGroupInvitation(api, invitation.request_id);
      setInvitations((prev) => prev.filter((i) => i.request_id !== invitation.request_id));
      loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 拒绝群邀请
  const handleDeclineInvitation = async (invitation: GroupInvitation) => {
    try {
      await declineGroupInvitation(api, invitation.request_id);
      setInvitations((prev) => prev.filter((i) => i.request_id !== invitation.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 获取角色显示文本
  const getRoleText = (role: string) => {
    switch (role) {
      case 'owner': return '群主';
      case 'admin': return '管理员';
      default: return '成员';
    }
  };

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
            className="modal-content groups-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <h2>群聊管理</h2>
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
            <div className="profile-tabs groups-tabs">
              <button
                className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`}
                onClick={() => setActiveTab('list')}
              >
                我的群聊
              </button>
              <button
                className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
                onClick={() => setActiveTab('create')}
              >
                <PlusIcon />
              </button>
              <button
                className={`tab-btn ${activeTab === 'join' ? 'active' : ''}`}
                onClick={() => setActiveTab('join')}
              >
                加入
              </button>
              <button
                className={`tab-btn ${activeTab === 'invitations' ? 'active' : ''}`}
                onClick={() => setActiveTab('invitations')}
              >
                邀请
                {invitations.length > 0 && (
                  <span className="badge">{invitations.length}</span>
                )}
              </button>
            </div>

            {/* 内容区域 */}
            <div className="groups-content">
              {activeTab === 'list' && (
                <GroupListContent
                  loading={loadingGroups}
                  groups={groups}
                  onGroupSelect={onGroupSelect}
                  onClose={onClose}
                  getRoleText={getRoleText}
                />
              )}

              {activeTab === 'create' && (
                <>
                  <div className="form-group">
                    <label>群名称</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="输入群名称"
                      maxLength={50}
                    />
                  </div>
                  <div className="form-group">
                    <label>群简介（可选）</label>
                    <textarea
                      className="glass-input"
                      value={newGroupDesc}
                      onChange={(e) => setNewGroupDesc(e.target.value)}
                      placeholder="介绍一下这个群..."
                      maxLength={200}
                      rows={3}
                    />
                  </div>
                  <motion.button
                    className="glass-button"
                    onClick={handleCreateGroup}
                    disabled={loading || !newGroupName.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '创建中...' : '创建群聊'}
                  </motion.button>
                </>
              )}

              {activeTab === 'join' && (
                <>
                  <div className="form-group">
                    <label>邀请码</label>
                    <input
                      type="text"
                      className="glass-input"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="输入群邀请码"
                      onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
                    />
                  </div>
                  <motion.button
                    className="glass-button"
                    onClick={handleJoinByCode}
                    disabled={loading || !inviteCode.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '加入中...' : '加入群聊'}
                  </motion.button>
                </>
              )}

              {activeTab === 'invitations' && (
                <InvitationsListContent
                  loading={loadingInvitations}
                  invitations={invitations}
                  onAccept={handleAcceptInvitation}
                  onDecline={handleDeclineInvitation}
                />
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
