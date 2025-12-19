/**
 * 聊天菜单组件
 *
 * 显示当前聊天对象（好友/群聊）的操作菜单
 * 支持：删除好友、群名称修改、群头像上传、邀请成员、查看成员、
 *       设置/取消管理员、禁言/解除禁言、踢出成员、退出群聊
 */

import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../../contexts/SessionContext';
import { removeFriend } from '../../api/friends';
import {
  updateGroup,
  inviteToGroup,
  leaveGroup,
  getGroupMembers,
  uploadGroupAvatar,
  removeMember,
  setAdmin,
  removeAdmin,
  muteMember,
  unmuteMember,
  type GroupMember,
} from '../../api/groups';
import { MenuIcon } from '../common/Icons';
import {
  type ChatMenuProps,
  type MenuView,
  MainMenu,
  EditNameForm,
  InviteForm,
  MembersList,
  MemberActions,
  MuteSettings,
  ConfirmDialog,
} from './menu';

export function ChatMenuButton({
  target,
  onFriendRemoved,
  onGroupUpdated,
  onGroupLeft,
  isMultiSelectMode = false,
  onToggleMultiSelect,
}: ChatMenuProps) {
  const { session } = useSession();
  const api = useApi();

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<MenuView>('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 编辑群名称
  const [newGroupName, setNewGroupName] = useState('');

  // 邀请成员
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');

  // 成员列表
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // 选中的成员（用于操作）
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);

  // 禁言时长
  const [muteDuration, setMuteDuration] = useState<number>(60);

  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 群头像上传进度
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setView('main');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

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

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setView('main');
      setError(null);
      setSuccess(null);
      setSelectedMember(null);
    }
  };

  // 删除好友
  const handleRemoveFriend = async () => {
    if (target.type !== 'friend' || !session) { return; }

    setLoading(true);
    try {
      await removeFriend(api, session.userId, target.data.friend_id);
      setSuccess('已删除好友');
      onFriendRemoved?.();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 更新群名称
  const handleUpdateGroupName = async () => {
    if (target.type !== 'group' || !newGroupName.trim()) { return; }

    setLoading(true);
    try {
      await updateGroup(api, target.data.group_id, { group_name: newGroupName.trim() });
      setSuccess('群名称已更新');
      onGroupUpdated?.();
      setView('main');
      setNewGroupName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 上传群头像
  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (target.type !== 'group' || !e.target.files?.[0]) { return; }

    const file = e.target.files[0];
    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB');
      return;
    }

    setUploadingAvatar(true);
    setAvatarUploadProgress(0);
    setLoading(true);
    try {
      await uploadGroupAvatar(
        api,
        target.data.group_id,
        file,
        (progress) => setAvatarUploadProgress(progress),
      );
      setSuccess('群头像已更新');
      onGroupUpdated?.();
      setView('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
      setUploadingAvatar(false);
      setAvatarUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 邀请成员
  const handleInviteMember = async () => {
    if (target.type !== 'group' || !inviteUserId.trim()) { return; }

    setLoading(true);
    try {
      await inviteToGroup(api, target.data.group_id, [inviteUserId.trim()], inviteMessage.trim() || undefined);
      setSuccess('邀请已发送');
      setInviteUserId('');
      setInviteMessage('');
      setView('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载成员列表
  const handleLoadMembers = async () => {
    if (target.type !== 'group') { return; }

    setLoadingMembers(true);
    setView('members');
    try {
      const response = await getGroupMembers(api, target.data.group_id);
      setMembers(response.data?.members || []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  // 退出群聊
  const handleLeaveGroup = async () => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await leaveGroup(api, target.data.group_id);
      setSuccess('已退出群聊');
      onGroupLeft?.();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 踢出成员
  const handleKickMember = async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      await removeMember(api, target.data.group_id, selectedMember.user_id);
      setSuccess(`已移除 ${selectedMember.user_nickname}`);
      setSelectedMember(null);
      setView('main');
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 设置/取消管理员
  const handleToggleAdmin = async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      if (selectedMember.role === 'admin') {
        await removeAdmin(api, target.data.group_id, selectedMember.user_id);
        setSuccess(`已取消 ${selectedMember.user_nickname} 的管理员`);
      } else {
        await setAdmin(api, target.data.group_id, selectedMember.user_id);
        setSuccess(`已设置 ${selectedMember.user_nickname} 为管理员`);
      }
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 禁言成员
  const handleMuteMember = async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      await muteMember(api, target.data.group_id, selectedMember.user_id, muteDuration);
      setSuccess(`已禁言 ${selectedMember.user_nickname} ${muteDuration} 分钟`);
      setSelectedMember(null);
      setView('main');
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 解除禁言
  const handleUnmuteMember = async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      await unmuteMember(api, target.data.group_id, selectedMember.user_id);
      setSuccess(`已解除 ${selectedMember.user_nickname} 的禁言`);
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 点击成员
  const handleMemberClick = (member: GroupMember) => {
    if (member.user_id === session?.userId) { return; }
    if (member.role === 'owner') { return; }
    if (target.type === 'group' && target.data.role === 'admin' && member.role === 'admin') { return; }

    setSelectedMember(member);
    setView('member-action');
  };

  const isGroupOwnerOrAdmin = target.type === 'group' &&
    (target.data.role === 'owner' || target.data.role === 'admin');

  const isGroupOwner = target.type === 'group' && target.data.role === 'owner';

  // 渲染视图内容
  const renderViewContent = () => {
    switch (view) {
      case 'main':
        return (
          <MainMenu
            targetType={target.type}
            isOwnerOrAdmin={isGroupOwnerOrAdmin}
            isOwner={isGroupOwner}
            isMultiSelectMode={isMultiSelectMode}
            group={target.type === 'group' ? target.data : undefined}
            uploadingAvatar={uploadingAvatar}
            avatarUploadProgress={avatarUploadProgress}
            onSetView={(v) => {
              if (v === 'edit-name' && target.type === 'group') {
                setNewGroupName(target.data.group_name);
              }
              setView(v);
            }}
            onLoadMembers={handleLoadMembers}
            onUploadAvatar={() => fileInputRef.current?.click()}
            onToggleMultiSelect={() => {
              onToggleMultiSelect?.();
              setIsOpen(false);
            }}
          />
        );

      case 'edit-name':
        return (
          <EditNameForm
            value={newGroupName}
            loading={loading}
            onChange={setNewGroupName}
            onSubmit={handleUpdateGroupName}
            onBack={() => setView('main')}
          />
        );

      case 'invite':
        return (
          <InviteForm
            userId={inviteUserId}
            message={inviteMessage}
            loading={loading}
            onUserIdChange={setInviteUserId}
            onMessageChange={setInviteMessage}
            onSubmit={handleInviteMember}
            onBack={() => setView('main')}
          />
        );

      case 'members':
        return (
          <MembersList
            members={members}
            loadingMembers={loadingMembers}
            currentUserId={session?.userId}
            isOwnerOrAdmin={isGroupOwnerOrAdmin}
            onBack={() => setView('main')}
            onMemberClick={handleMemberClick}
          />
        );

      case 'member-action':
        return selectedMember && (
          <MemberActions
            member={selectedMember}
            isOwner={isGroupOwner}
            loading={loading}
            onBack={() => setView('members')}
            onToggleAdmin={handleToggleAdmin}
            onMute={() => setView('mute-member')}
            onUnmute={handleUnmuteMember}
            onKick={() => setView('confirm-kick')}
          />
        );

      case 'mute-member':
        return selectedMember && (
          <MuteSettings
            member={selectedMember}
            duration={muteDuration}
            loading={loading}
            onBack={() => setView('member-action')}
            onDurationChange={setMuteDuration}
            onConfirm={handleMuteMember}
          />
        );

      case 'confirm-delete':
        return (
          <ConfirmDialog
            title="确认删除"
            message={<>确定要删除好友 <strong>{target.type === 'friend' ? target.data.friend_nickname : ''}</strong> 吗？</>}
            warning="此操作无法撤销"
            confirmText="确认删除"
            loadingText="删除中..."
            loading={loading}
            onConfirm={handleRemoveFriend}
            onCancel={() => setView('main')}
          />
        );

      case 'confirm-leave':
        return (
          <ConfirmDialog
            title="确认退出"
            message={<>确定要退出群聊 <strong>{target.type === 'group' ? target.data.group_name : ''}</strong> 吗？</>}
            confirmText="确认退出"
            loadingText="退出中..."
            loading={loading}
            onConfirm={handleLeaveGroup}
            onCancel={() => setView('main')}
          />
        );

      case 'confirm-kick':
        return selectedMember && (
          <ConfirmDialog
            title="确认移除"
            message={<>确定要将 <strong>{selectedMember.user_nickname}</strong> 移出群聊吗？</>}
            confirmText="确认移除"
            loadingText="处理中..."
            loading={loading}
            onConfirm={handleKickMember}
            onCancel={() => setView('member-action')}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="chat-menu-container" ref={menuRef}>
      <motion.button
        className="chat-menu-btn"
        onClick={handleToggle}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title="更多操作"
      >
        <MenuIcon />
      </motion.button>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={handleAvatarUpload}
      />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="chat-menu-dropdown"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {renderViewContent()}

            {/* 错误/成功提示 */}
            {(error || success) && (
              <div className={`menu-message ${error ? 'error' : 'success'}`}>
                {error || success}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
