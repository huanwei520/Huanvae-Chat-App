/**
 * 聊天菜单状态管理 Hook
 *
 * 从 ChatMenu.tsx 中提取的状态和操作逻辑
 * 负责：
 * - 菜单开关状态
 * - 视图切换
 * - 好友/群聊操作（删除、更新、邀请、踢出等）
 * - 群公告管理
 * - 邀请码管理
 * - 上传进度跟踪
 *
 * 权限判断直接订阅 Zustand store 中的角色状态
 * 这样可以在 WebSocket 推送角色变化时实时更新权限
 * 而无需等待 target prop 变化，避免组件重新挂载
 */

import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { removeFriend } from '../api/friends';
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
  disbandGroup,
  transferOwner,
  getGroupNotices,
  createGroupNotice,
  deleteGroupNotice,
  generateInviteCode,
  getInviteCodes,
  revokeInviteCode,
  updateGroupNickname,
  type GroupMember,
  type GroupNotice,
  type InviteCode,
} from '../api/groups';
import { loadAllHistoryMessages } from '../services/historyService';
import type { MenuView } from '../chat/shared/menu/types';
import type { ChatTarget } from '../types/chat';

// ============================================
// 类型定义
// ============================================

export interface UseChatMenuProps {
  target: ChatTarget;
  onFriendRemoved?: () => void;
  onGroupUpdated?: () => void;
  onGroupLeft?: () => void;
  onHistoryLoaded?: () => void;
}

export interface UseChatMenuReturn {
  // 状态
  isOpen: boolean;
  view: MenuView;
  loading: boolean;
  error: string | null;
  success: string | null;

  // 编辑群名称
  newGroupName: string;
  setNewGroupName: (name: string) => void;

  // 邀请成员
  inviteUserId: string;
  setInviteUserId: (id: string) => void;
  inviteMessage: string;
  setInviteMessage: (msg: string) => void;

  // 成员列表
  members: GroupMember[];
  loadingMembers: boolean;
  selectedMember: GroupMember | null;

  // 禁言时长
  muteDuration: number;
  setMuteDuration: (duration: number) => void;

  // 群内昵称
  groupNickname: string;
  setGroupNickname: (nickname: string) => void;

  // 群公告
  notices: GroupNotice[];
  loadingNotices: boolean;

  // 邀请码
  inviteCodes: InviteCode[];
  loadingCodes: boolean;

  // 上传进度
  avatarUploadProgress: number;
  uploadingAvatar: boolean;

  // 加载历史记录
  loadingHistory: boolean;
  historyProgress: string;

  // Refs
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;

  // 权限判断
  isGroupOwnerOrAdmin: boolean;
  isGroupOwner: boolean;

  // 操作方法
  handleToggle: () => void;
  handleSetView: (v: MenuView) => void;
  handleRemoveFriend: () => Promise<void>;
  handleUpdateGroupName: () => Promise<void>;
  handleAvatarUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleInviteMember: () => Promise<void>;
  handleLoadMembers: () => Promise<void>;
  handleLeaveGroup: () => Promise<void>;
  handleKickMember: () => Promise<void>;
  handleToggleAdmin: () => Promise<void>;
  handleMuteMember: () => Promise<void>;
  handleUnmuteMember: () => Promise<void>;
  handleLoadNotices: () => Promise<void>;
  handleCreateNotice: (title: string, content: string, isPinned: boolean) => Promise<void>;
  handleDeleteNotice: (noticeId: string) => Promise<void>;
  handleDisbandGroup: () => Promise<void>;
  handleTransferOwner: (newOwnerId: string) => Promise<void>;
  handleLoadInviteCodes: () => Promise<void>;
  handleGenerateCode: (maxUses: number, expiresInHours: number) => Promise<void>;
  handleRevokeCode: (codeId: string) => Promise<void>;
  handleCopyCode: (code: string) => Promise<void>;
  handleMemberClick: (member: GroupMember) => void;
  handleCloseMenu: () => void;
  handleUpdateGroupNickname: () => Promise<void>;
  handleClearGroupNickname: () => Promise<void>;
  handleLoadAllHistory: () => Promise<void>;
}

// ============================================
// Hook 实现
// ============================================

export function useChatMenu({
  target,
  onFriendRemoved,
  onGroupUpdated,
  onGroupLeft,
  onHistoryLoaded,
}: UseChatMenuProps): UseChatMenuReturn {
  const { session } = useSession();
  const api = useApi();

  // 基础状态
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
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);

  // 禁言时长
  const [muteDuration, setMuteDuration] = useState<number>(60);

  // 群内昵称
  const [groupNickname, setGroupNickname] = useState('');

  // 群公告
  const [notices, setNotices] = useState<GroupNotice[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(false);

  // 邀请码
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);

  // 上传进度
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 加载历史记录
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyProgress, setHistoryProgress] = useState('');

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 从 store 订阅角色状态，避免因 target prop 变化导致组件重新挂载
  // 只在 target 是群聊时从 store 中获取最新角色
  const groupId = target.type === 'group' ? target.data.group_id : null;
  const storeRole = useChatStore((state) =>
    groupId ? state.groups.find((g) => g.group_id === groupId)?.role : undefined,
  );

  // 权限判断：优先使用 store 中的角色（实时更新），回退到 target.data.role
  const currentRole = storeRole ?? (target.type === 'group' ? target.data.role : undefined);
  const isGroupOwnerOrAdmin = target.type === 'group' &&
    (currentRole === 'owner' || currentRole === 'admin');
  const isGroupOwner = target.type === 'group' && currentRole === 'owner';

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

  // 切换菜单
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) {
        setView('main');
        setError(null);
        setSuccess(null);
        setSelectedMember(null);
      }
      return !prev;
    });
  }, []);

  // 关闭菜单
  const handleCloseMenu = useCallback(() => {
    setIsOpen(false);
    setView('main');
  }, []);

  // 加载成员列表
  const handleLoadMembers = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoadingMembers(true);
    try {
      const response = await getGroupMembers(api, target.data.group_id);
      setMembers(response.data?.members || []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [api, target]);

  // 加载群公告
  const handleLoadNotices = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoadingNotices(true);
    setView('notices');
    try {
      const response = await getGroupNotices(api, target.data.group_id);
      setNotices(response.data?.notices || []);
    } catch {
      setNotices([]);
    } finally {
      setLoadingNotices(false);
    }
  }, [api, target]);

  // 加载邀请码列表
  const handleLoadInviteCodes = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoadingCodes(true);
    setView('invite-codes');
    try {
      const response = await getInviteCodes(api, target.data.group_id);
      setInviteCodes(response.data?.codes || []);
    } catch {
      setInviteCodes([]);
    } finally {
      setLoadingCodes(false);
    }
  }, [api, target]);

  // 设置视图（带逻辑处理）
  const handleSetView = useCallback((v: MenuView) => {
    if (v === 'edit-name' && target.type === 'group') {
      setNewGroupName(target.data.group_name);
    }
    if (v === 'notices') {
      handleLoadNotices();
      return;
    }
    if (v === 'transfer-owner') {
      handleLoadMembers();
      setView('transfer-owner');
      return;
    }
    if (v === 'invite-codes') {
      handleLoadInviteCodes();
      return;
    }
    if (v === 'members') {
      handleLoadMembers();
    }
    setView(v);
  }, [target, handleLoadNotices, handleLoadMembers, handleLoadInviteCodes]);

  // 删除好友
  const handleRemoveFriend = useCallback(async () => {
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
  }, [api, session, target, onFriendRemoved]);

  // 更新群名称
  const handleUpdateGroupName = useCallback(async () => {
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
  }, [api, target, newGroupName, onGroupUpdated]);

  // 上传群头像
  const handleAvatarUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
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
  }, [api, target, onGroupUpdated]);

  // 邀请成员
  const handleInviteMember = useCallback(async () => {
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
  }, [api, target, inviteUserId, inviteMessage]);

  // 退出群聊
  const handleLeaveGroup = useCallback(async () => {
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
  }, [api, target, onGroupLeft]);

  // 踢出成员
  const handleKickMember = useCallback(async () => {
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
  }, [api, target, selectedMember, handleLoadMembers]);

  // 设置/取消管理员
  const handleToggleAdmin = useCallback(async () => {
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
  }, [api, target, selectedMember, handleLoadMembers]);

  // 禁言成员
  const handleMuteMember = useCallback(async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      await muteMember(api, target.data.group_id, selectedMember.user_id, muteDuration);
      setSuccess(`已禁言 ${selectedMember.user_nickname} ${muteDuration} 分钟`);
      // 计算禁言结束时间并更新 selectedMember
      const mutedUntil = new Date(Date.now() + muteDuration * 60 * 1000).toISOString();
      setSelectedMember({ ...selectedMember, muted_until: mutedUntil });
      // 返回到成员操作页面而不是主菜单
      setView('member-action');
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, selectedMember, muteDuration, handleLoadMembers]);

  // 解除禁言
  const handleUnmuteMember = useCallback(async () => {
    if (target.type !== 'group' || !selectedMember) { return; }

    setLoading(true);
    try {
      await unmuteMember(api, target.data.group_id, selectedMember.user_id);
      setSuccess(`已解除 ${selectedMember.user_nickname} 的禁言`);
      // 更新 selectedMember 状态以立即反映解除禁言
      setSelectedMember({ ...selectedMember, muted_until: null });
      handleLoadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, selectedMember, handleLoadMembers]);

  // 创建群公告
  const handleCreateNotice = useCallback(async (title: string, content: string, isPinned: boolean) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await createGroupNotice(api, target.data.group_id, { title, content, is_pinned: isPinned });
      setSuccess('公告已发布');
      handleLoadNotices();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, handleLoadNotices]);

  // 删除群公告
  const handleDeleteNotice = useCallback(async (noticeId: string) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await deleteGroupNotice(api, target.data.group_id, noticeId);
      setSuccess('公告已删除');
      setNotices((prev) => prev.filter((n) => n.id !== noticeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setLoading(false);
    }
  }, [api, target]);

  // 解散群聊
  const handleDisbandGroup = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await disbandGroup(api, target.data.group_id);
      setSuccess('群聊已解散');
      onGroupLeft?.();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, onGroupLeft]);

  // 转让群主
  // 转让群主
  // 注意：不调用 onGroupUpdated()，因为：
  // 1. WebSocket 会推送 owner_transferred 事件自动更新角色
  // 2. 调用 onGroupUpdated 会触发 refreshGroups 导致所有卡片重载
  const handleTransferOwner = useCallback(async (newOwnerId: string) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await transferOwner(api, target.data.group_id, newOwnerId);
      setSuccess('群主已转让');
      // 不调用 onGroupUpdated()，角色更新由 WebSocket 推送处理
      setView('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '转让失败');
    } finally {
      setLoading(false);
    }
  }, [api, target]);

  // 生成邀请码
  const handleGenerateCode = useCallback(async (maxUses: number, expiresInHours: number) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      const result = await generateInviteCode(api, target.data.group_id, {
        max_uses: maxUses,
        expires_in_hours: expiresInHours,
      });
      setSuccess(`邀请码已生成: ${result.data.code}`);
      handleLoadInviteCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, handleLoadInviteCodes]);

  // 撤销邀请码
  const handleRevokeCode = useCallback(async (codeId: string) => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await revokeInviteCode(api, target.data.group_id, codeId);
      setSuccess('邀请码已撤销');
      setInviteCodes((prev) => prev.filter((c) => c.id !== codeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setLoading(false);
    }
  }, [api, target]);

  // 复制邀请码
  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setSuccess('已复制到剪贴板');
    } catch {
      setError('复制失败');
    }
  }, []);

  // 点击成员
  const handleMemberClick = useCallback((member: GroupMember) => {
    if (member.user_id === session?.userId) { return; }
    if (member.role === 'owner') { return; }
    if (target.type === 'group' && target.data.role === 'admin' && member.role === 'admin') { return; }

    setSelectedMember(member);
    setView('member-action');
  }, [session?.userId, target]);

  // 更新群内昵称
  const handleUpdateGroupNickname = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await updateGroupNickname(api, target.data.group_id, groupNickname.trim());
      setSuccess('群内昵称已更新');
      setView('main');
      setGroupNickname('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, groupNickname]);

  // 清除群内昵称
  const handleClearGroupNickname = useCallback(async () => {
    if (target.type !== 'group') { return; }

    setLoading(true);
    try {
      await updateGroupNickname(api, target.data.group_id, null);
      setSuccess('群内昵称已清除');
      setView('main');
      setGroupNickname('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失败');
    } finally {
      setLoading(false);
    }
  }, [api, target]);

  // 加载全部聊天记录
  const handleLoadAllHistory = useCallback(async () => {
    if (loadingHistory || !session) { return; }

    setLoadingHistory(true);
    setHistoryProgress('准备加载...');
    setError(null);

    try {
      const targetId = target.type === 'friend'
        ? target.data.friend_id
        : target.data.group_id;
      const targetType = target.type;

      await loadAllHistoryMessages(
        api,
        targetId,
        targetType,
        session.userId, // 传入当前用户 ID
        (progress) => {
          setHistoryProgress(progress);
        },
      );

      setSuccess('聊天记录加载完成');
      setHistoryProgress('');

      // 触发消息列表刷新
      onHistoryLoaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setHistoryProgress('');
    } finally {
      setLoadingHistory(false);
    }
  }, [api, session, target, loadingHistory, onHistoryLoaded]);

  return {
    // 状态
    isOpen,
    view,
    loading,
    error,
    success,

    // 编辑群名称
    newGroupName,
    setNewGroupName,

    // 邀请成员
    inviteUserId,
    setInviteUserId,
    inviteMessage,
    setInviteMessage,

    // 成员列表
    members,
    loadingMembers,
    selectedMember,

    // 禁言时长
    muteDuration,
    setMuteDuration,

    // 群内昵称
    groupNickname,
    setGroupNickname,

    // 群公告
    notices,
    loadingNotices,

    // 邀请码
    inviteCodes,
    loadingCodes,

    // 上传进度
    avatarUploadProgress,
    uploadingAvatar,

    // 加载历史记录
    loadingHistory,
    historyProgress,

    // Refs
    fileInputRef,
    menuRef,

    // 权限判断
    isGroupOwnerOrAdmin,
    isGroupOwner,

    // 操作方法
    handleToggle,
    handleSetView,
    handleRemoveFriend,
    handleUpdateGroupName,
    handleAvatarUpload,
    handleInviteMember,
    handleLoadMembers,
    handleLeaveGroup,
    handleKickMember,
    handleToggleAdmin,
    handleMuteMember,
    handleUnmuteMember,
    handleLoadNotices,
    handleCreateNotice,
    handleDeleteNotice,
    handleDisbandGroup,
    handleTransferOwner,
    handleLoadInviteCodes,
    handleGenerateCode,
    handleRevokeCode,
    handleCopyCode,
    handleMemberClick,
    handleCloseMenu,
    handleUpdateGroupNickname,
    handleClearGroupNickname,
    handleLoadAllHistory,
  };
}
