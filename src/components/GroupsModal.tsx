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
import { CloseIcon } from './common/Icons';
import {
  type TabType,
  type GroupsModalProps,
  GroupsTabNavigation,
  GroupListContent,
  CreateGroupForm,
  JoinGroupForm,
  InvitationsListContent,
} from './modals/groups';

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
      transition: { type: 'spring' as const, damping: 25, stiffness: 300 },
    },
    exit: { opacity: 0, scale: 0.95, y: 20 },
  };

  // 渲染当前 Tab 内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'list':
        return (
          <GroupListContent
            loading={loadingGroups}
            groups={groups}
            onGroupSelect={onGroupSelect}
            onClose={onClose}
            getRoleText={getRoleText}
          />
        );
      case 'create':
        return (
          <CreateGroupForm
            groupName={newGroupName}
            groupDesc={newGroupDesc}
            loading={loading}
            onNameChange={setNewGroupName}
            onDescChange={setNewGroupDesc}
            onSubmit={handleCreateGroup}
          />
        );
      case 'join':
        return (
          <JoinGroupForm
            inviteCode={inviteCode}
            loading={loading}
            onCodeChange={setInviteCode}
            onSubmit={handleJoinByCode}
          />
        );
      case 'invitations':
        return (
          <InvitationsListContent
            loading={loadingInvitations}
            invitations={invitations}
            onAccept={handleAcceptInvitation}
            onDecline={handleDeclineInvitation}
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
            <GroupsTabNavigation
              activeTab={activeTab}
              invitationsCount={invitations.length}
              onTabChange={setActiveTab}
            />

            {/* 内容区域 */}
            <div className="groups-content">
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
