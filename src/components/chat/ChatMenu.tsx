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
import type { Friend, Group } from '../../types/chat';

// ============================================
// 图标组件
// ============================================

const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={20} height={20}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const UserPlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
  </svg>
);

const UsersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

const ExitIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
  </svg>
);

const CameraIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
  </svg>
);

const MuteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>
);

const ShieldIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface ChatMenuProps {
  target: { type: 'friend'; data: Friend } | { type: 'group'; data: Group };
  onFriendRemoved?: () => void;
  onGroupUpdated?: () => void;
  onGroupLeft?: () => void;
}

type MenuView =
  | 'main'
  | 'edit-name'
  | 'edit-avatar'
  | 'invite'
  | 'members'
  | 'member-action'
  | 'mute-member'
  | 'confirm-delete'
  | 'confirm-leave'
  | 'confirm-kick';

// ============================================
// 主组件
// ============================================

export function ChatMenuButton({ target, onFriendRemoved, onGroupUpdated, onGroupLeft }: ChatMenuProps) {
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

    setLoading(true);
    try {
      await uploadGroupAvatar(api, target.data.group_id, file);
      setSuccess('群头像已更新');
      onGroupUpdated?.();
      setView('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
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
      // 刷新成员列表
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 设置/取消管理员
  const handleToggleAdmin = async (member: GroupMember) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      if (member.role === 'admin') {
        await removeAdmin(api, target.data.group_id, member.user_id);
        setSuccess(`已取消 ${member.user_nickname} 的管理员`);
      } else {
        await setAdmin(api, target.data.group_id, member.user_id);
        setSuccess(`已设置 ${member.user_nickname} 为管理员`);
      }
      // 刷新成员列表
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
  const handleUnmuteMember = async (member: GroupMember) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await unmuteMember(api, target.data.group_id, member.user_id);
      setSuccess(`已解除 ${member.user_nickname} 的禁言`);
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // 点击成员
  const handleMemberClick = (member: GroupMember) => {
    // 不能操作自己
    if (member.user_id === session?.userId) { return; }
    // 不能操作群主
    if (member.role === 'owner') { return; }
    // 管理员不能操作其他管理员
    if (target.type === 'group' && target.data.role === 'admin' && member.role === 'admin') { return; }

    setSelectedMember(member);
    setView('member-action');
  };

  const isGroupOwnerOrAdmin = target.type === 'group' &&
    (target.data.role === 'owner' || target.data.role === 'admin');

  const isGroupOwner = target.type === 'group' && target.data.role === 'owner';

  // 检查成员是否被禁言
  const isMuted = (member: GroupMember) => {
    if (!member.muted_until) { return false; }
    return new Date(member.muted_until) > new Date();
  };

  // 格式化禁言时间
  const formatMutedUntil = (mutedUntil: string) => {
    const date = new Date(mutedUntil);
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 格式化禁言时长
  const formatMuteDuration = (mins: number) => {
    if (mins < 60) {
      return `${mins}分钟`;
    }
    if (mins < 1440) {
      return `${mins / 60}小时`;
    }
    return `${mins / 1440}天`;
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
            {/* 主菜单 */}
            {view === 'main' && (
              <>
                <div className="menu-header">
                  {target.type === 'friend' ? '好友设置' : '群聊设置'}
                </div>

                {target.type === 'friend' && (
                  <button
                    className="menu-item danger"
                    onClick={() => setView('confirm-delete')}
                  >
                    <TrashIcon />
                    <span>删除好友</span>
                  </button>
                )}

                {target.type === 'group' && (
                  <>
                    {isGroupOwnerOrAdmin && (
                      <>
                        <button
                          className="menu-item"
                          onClick={() => {
                            setNewGroupName(target.data.group_name);
                            setView('edit-name');
                          }}
                        >
                          <EditIcon />
                          <span>修改群名称</span>
                        </button>
                        <button
                          className="menu-item"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <CameraIcon />
                          <span>更换群头像</span>
                        </button>
                        <button className="menu-item" onClick={() => setView('invite')}>
                          <UserPlusIcon />
                          <span>邀请成员</span>
                        </button>
                      </>
                    )}
                    <button className="menu-item" onClick={handleLoadMembers}>
                      <UsersIcon />
                      <span>查看成员</span>
                    </button>
                    {!isGroupOwner && (
                      <button
                        className="menu-item danger"
                        onClick={() => setView('confirm-leave')}
                      >
                        <ExitIcon />
                        <span>退出群聊</span>
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* 编辑群名称 */}
            {view === 'edit-name' && (
              <>
                <div className="menu-header">
                  <button className="back-btn" onClick={() => setView('main')}>←</button>
                  修改群名称
                </div>
                <div className="menu-form">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="输入新群名称"
                    className="menu-input"
                    maxLength={50}
                  />
                  <button
                    className="menu-submit"
                    onClick={handleUpdateGroupName}
                    disabled={loading || !newGroupName.trim()}
                  >
                    {loading ? '保存中...' : '保存'}
                  </button>
                </div>
              </>
            )}

            {/* 邀请成员 */}
            {view === 'invite' && (
              <>
                <div className="menu-header">
                  <button className="back-btn" onClick={() => setView('main')}>←</button>
                  邀请成员
                </div>
                <div className="menu-form">
                  <input
                    type="text"
                    value={inviteUserId}
                    onChange={(e) => setInviteUserId(e.target.value)}
                    placeholder="输入用户 ID"
                    className="menu-input"
                  />
                  <input
                    type="text"
                    value={inviteMessage}
                    onChange={(e) => setInviteMessage(e.target.value)}
                    placeholder="邀请消息（可选）"
                    className="menu-input"
                  />
                  <button
                    className="menu-submit"
                    onClick={handleInviteMember}
                    disabled={loading || !inviteUserId.trim()}
                  >
                    {loading ? '发送中...' : '发送邀请'}
                  </button>
                </div>
              </>
            )}

            {/* 成员列表 */}
            {view === 'members' && (
              <>
                <div className="menu-header">
                  <button className="back-btn" onClick={() => setView('main')}>←</button>
                  群成员 ({members.length})
                </div>
                <div className="members-list">
                  {loadingMembers && (
                    <div className="menu-loading">加载中...</div>
                  )}
                  {!loadingMembers && members.length === 0 && (
                    <div className="menu-empty">暂无成员</div>
                  )}
                  {!loadingMembers && members.length > 0 && (
                    members.map((member) => (
                      <div
                        key={member.user_id}
                        className={`member-item ${isGroupOwnerOrAdmin && member.user_id !== session?.userId && member.role !== 'owner' ? 'clickable' : ''}`}
                        onClick={() => isGroupOwnerOrAdmin && handleMemberClick(member)}
                      >
                        <div className="member-avatar">
                          {member.user_avatar_url ? (
                            <img src={member.user_avatar_url} alt={member.user_nickname} />
                          ) : (
                            <div className="avatar-placeholder">
                              {member.user_nickname.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="member-info">
                          <span className="member-name">
                            {member.user_nickname}
                            {member.user_id === session?.userId && ' (我)'}
                          </span>
                          <div className="member-badges">
                            {member.role !== 'member' && (
                              <span className={`member-role ${member.role}`}>
                                {member.role === 'owner' ? '群主' : '管理员'}
                              </span>
                            )}
                            {isMuted(member) && member.muted_until && (
                              <span className="member-muted">
                                禁言至 {formatMutedUntil(member.muted_until)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* 成员操作菜单 */}
            {view === 'member-action' && selectedMember && (
              <>
                <div className="menu-header">
                  <button className="back-btn" onClick={() => setView('members')}>←</button>
                  {selectedMember.user_nickname}
                </div>
                <div className="menu-actions">
                  {isGroupOwner && (
                    <button
                      className="menu-item"
                      onClick={() => handleToggleAdmin(selectedMember)}
                      disabled={loading}
                    >
                      <ShieldIcon />
                      <span>
                        {selectedMember.role === 'admin' ? '取消管理员' : '设为管理员'}
                      </span>
                    </button>
                  )}
                  {isMuted(selectedMember) ? (
                    <button
                      className="menu-item"
                      onClick={() => handleUnmuteMember(selectedMember)}
                      disabled={loading}
                    >
                      <MuteIcon />
                      <span>解除禁言</span>
                    </button>
                  ) : (
                    <button
                      className="menu-item"
                      onClick={() => setView('mute-member')}
                    >
                      <MuteIcon />
                      <span>禁言</span>
                    </button>
                  )}
                  <button
                    className="menu-item danger"
                    onClick={() => setView('confirm-kick')}
                  >
                    <TrashIcon />
                    <span>移出群聊</span>
                  </button>
                </div>
              </>
            )}

            {/* 禁言设置 */}
            {view === 'mute-member' && selectedMember && (
              <>
                <div className="menu-header">
                  <button className="back-btn" onClick={() => setView('member-action')}>←</button>
                  禁言 {selectedMember.user_nickname}
                </div>
                <div className="menu-form">
                  <div className="mute-options">
                    {[10, 30, 60, 1440, 10080].map((mins) => (
                      <button
                        key={mins}
                        className={`mute-option ${muteDuration === mins ? 'active' : ''}`}
                        onClick={() => setMuteDuration(mins)}
                      >
                        {formatMuteDuration(mins)}
                      </button>
                    ))}
                  </div>
                  <button
                    className="menu-submit"
                    onClick={handleMuteMember}
                    disabled={loading}
                  >
                    {loading ? '处理中...' : '确认禁言'}
                  </button>
                </div>
              </>
            )}

            {/* 确认删除好友 */}
            {view === 'confirm-delete' && (
              <>
                <div className="menu-header">确认删除</div>
                <div className="menu-confirm">
                  <p>确定要删除好友 <strong>{target.type === 'friend' ? target.data.friend_nickname : ''}</strong> 吗？</p>
                  <p className="confirm-warning">此操作无法撤销</p>
                  <div className="confirm-actions">
                    <button className="cancel-btn" onClick={() => setView('main')}>取消</button>
                    <button
                      className="danger-btn"
                      onClick={handleRemoveFriend}
                      disabled={loading}
                    >
                      {loading ? '删除中...' : '确认删除'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 确认退出群聊 */}
            {view === 'confirm-leave' && (
              <>
                <div className="menu-header">确认退出</div>
                <div className="menu-confirm">
                  <p>确定要退出群聊 <strong>{target.type === 'group' ? target.data.group_name : ''}</strong> 吗？</p>
                  <div className="confirm-actions">
                    <button className="cancel-btn" onClick={() => setView('main')}>取消</button>
                    <button
                      className="danger-btn"
                      onClick={handleLeaveGroup}
                      disabled={loading}
                    >
                      {loading ? '退出中...' : '确认退出'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 确认踢出成员 */}
            {view === 'confirm-kick' && selectedMember && (
              <>
                <div className="menu-header">确认移除</div>
                <div className="menu-confirm">
                  <p>确定要将 <strong>{selectedMember.user_nickname}</strong> 移出群聊吗？</p>
                  <div className="confirm-actions">
                    <button className="cancel-btn" onClick={() => setView('member-action')}>取消</button>
                    <button
                      className="danger-btn"
                      onClick={handleKickMember}
                      disabled={loading}
                    >
                      {loading ? '处理中...' : '确认移除'}
                    </button>
                  </div>
                </div>
              </>
            )}

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
