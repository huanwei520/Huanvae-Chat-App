/**
 * 聊天菜单状态管理 Hook
 *
 * @module chat/group
 * @location src/chat/group/useChatMenu.ts
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

import { useState, useRef, useEffect, useCallback, type ChangeEvent, type ReactNode } from 'react';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useAvatarCrop } from '../../components/common/AvatarCropModal';
import { useChatStore, useProfileViewStore } from '../../stores';
import {
  removeFriend,
  setFriendRemark as apiSetFriendRemark,
  addBlacklist,
  removeBlacklist,
  addSpecialCare,
  removeSpecialCare,
} from '../../api/friends';
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
  addGroupMessageBlock,
  removeGroupMessageBlock,
  addGroupSpecialCare,
  removeGroupSpecialCare,
  setGroupMemberRemark as apiSetGroupMemberRemark,
  removeGroupMemberRemark as apiRemoveGroupMemberRemark,
  type GroupMember,
  type GroupNotice,
  type InviteCode,
} from '../../api/groups';
import { loadAllHistoryMessages } from '../../services/historyService';
import type { MenuView } from '../shared/menu/types';
import type { ChatTarget } from '../../types/chat';

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
  /** 当前用户 ID（成员列表自我排除用） */
  currentUserId: string | undefined;

  // 成员操作面板：选中成员的群内私有状态 + 管理权限 + 备注弹窗开关
  isSelectedMemberBlocked: boolean;
  isSelectedMemberSpecialCared: boolean;
  selectedMemberRemark: string;
  canModerateSelectedMember: boolean;
  memberRemarkModalOpen: boolean;

  // 禁言时长
  muteDuration: number;
  setMuteDuration: (duration: number) => void;

  // 群内昵称
  groupNickname: string;
  setGroupNickname: (nickname: string) => void;

  // 好友备注
  friendRemark: string;
  setFriendRemark: (remark: string) => void;

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

  // 好友关系状态（用于三条杠菜单的特别关心 / 拉黑 切换文案）
  isFriendSpecialCare: boolean;
  isFriendBlacklisted: boolean;

  // 操作方法
  handleToggle: () => void;
  handleSetView: (v: MenuView) => void;
  handleRemoveFriend: () => Promise<void>;
  handleToggleSpecialCare: () => Promise<void>;
  handleBlacklist: () => Promise<void>;
  handleUnblacklist: () => Promise<void>;
  handleUpdateGroupName: () => Promise<void>;
  handleAvatarUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  /** 头像裁剪弹窗（需在使用方渲染） */
  avatarCropModal: ReactNode;
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
  /** 看选中成员的公开资料（只读资料页）并关闭菜单 */
  handleViewMemberProfile: () => void;
  /** D6 屏蔽/取消屏蔽选中成员在本群的消息（await-first） */
  handleToggleMemberBlock: () => Promise<void>;
  /** M3 特别关心/取消选中成员（await-first） */
  handleToggleMemberSpecialCare: () => Promise<void>;
  /** D7 保存/清除选中成员的私有备注（await-first；空串=清除） */
  handleSaveMemberRemark: (value: string) => Promise<void>;
  /** 打开/关闭成员备注输入弹窗 */
  openMemberRemarkModal: () => void;
  closeMemberRemarkModal: () => void;
  handleCloseMenu: () => void;
  handleUpdateGroupNickname: () => Promise<void>;
  handleClearGroupNickname: () => Promise<void>;
  handleUpdateFriendRemark: () => Promise<void>;
  handleClearFriendRemark: () => Promise<void>;
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
  // 成员备注输入弹窗开关（成员操作面板「设置备注」触发）
  const [memberRemarkModalOpen, setMemberRemarkModalOpen] = useState(false);

  // 禁言时长
  const [muteDuration, setMuteDuration] = useState<number>(60);

  // 群内昵称
  const [groupNickname, setGroupNickname] = useState('');

  // 好友备注
  const [friendRemark, setFriendRemark] = useState('');

  // 群公告
  const [notices, setNotices] = useState<GroupNotice[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(false);

  // 邀请码
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);

  // 上传进度
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { requestCrop, cropModal } = useAvatarCrop();

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

  // 成员操作面板：选中成员的群内私有状态（D6 屏蔽 / M3 特别关心 / D7 备注），
  // 订阅本群对应 map，按 selectedMember.user_id 派生
  const openProfileView = useProfileViewStore((s) => s.open);
  const groupBlocks = useChatStore((s) => (groupId ? s.groupMessageBlocks[groupId] : undefined));
  const groupCares = useChatStore((s) => (groupId ? s.groupSpecialCares[groupId] : undefined));
  const groupRemarksMap = useChatStore((s) => (groupId ? s.groupMemberRemarks[groupId] : undefined));
  const setGroupMemberBlocked = useChatStore((s) => s.setGroupMemberBlocked);
  const setGroupMemberSpecialCare = useChatStore((s) => s.setGroupMemberSpecialCare);
  const setGroupMemberRemarkAction = useChatStore((s) => s.setGroupMemberRemark);
  const selectedMemberId = selectedMember?.user_id;
  const isSelectedMemberBlocked = !!selectedMemberId && (groupBlocks ?? []).includes(selectedMemberId);
  const isSelectedMemberSpecialCared = !!selectedMemberId && (groupCares ?? []).includes(selectedMemberId);
  const selectedMemberRemark = selectedMemberId ? (groupRemarksMap?.[selectedMemberId] ?? '') : '';
  // 是否可对选中成员行使管理操作（设管理员/禁言/移出）：自己是群主/管理员，且对象非群主，
  // 且非「管理员对管理员」。看资料/备注/特别关心/屏蔽是人人可用的私有操作，不受此限。
  const canModerateSelectedMember = isGroupOwnerOrAdmin && !!selectedMember
    && selectedMember.role !== 'owner'
    && !(currentRole === 'admin' && selectedMember.role === 'admin');

  // 好友关系状态：订阅 store 中该好友的实时 is_special_care / is_blacklisted
  // （三条杠菜单据此显示「特别关心 / 取消特别关心」「拉黑 / 取消拉黑」文案）
  const friendId = target.type === 'friend' ? target.data.friend_id : null;
  const friendState = useChatStore((state) =>
    friendId ? state.friends.find((f) => f.friend_id === friendId) : undefined,
  );
  const isFriendSpecialCare = !!friendState?.is_special_care;
  const isFriendBlacklisted = !!friendState?.is_blacklisted;

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
      setMembers(response.members || []);
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
      setNotices(response.notices || []);
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
      setInviteCodes(response.codes || []);
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
    if (v === 'edit-remark' && target.type === 'friend') {
      setFriendRemark(target.data.friend_remark ?? '');
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

  // 特别关心切换（非破坏性，直接执行无需二次确认）
  const handleToggleSpecialCare = useCallback(async () => {
    if (target.type !== 'friend' || loading) { return; }
    const next = !isFriendSpecialCare;
    setLoading(true);
    try {
      if (next) {
        await addSpecialCare(api, target.data.friend_id);
      } else {
        await removeSpecialCare(api, target.data.friend_id);
      }
      useChatStore.getState().setFriendSpecialCare(target.data.friend_id, next);
      setSuccess(next ? '已设为特别关心' : '已取消特别关心');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, loading, isFriendSpecialCare]);

  // 拉黑（破坏性，经 confirm-blacklist 视图二次确认后调用）
  const handleBlacklist = useCallback(async () => {
    if (target.type !== 'friend' || loading) { return; }
    setLoading(true);
    try {
      await addBlacklist(api, target.data.friend_id);
      const store = useChatStore.getState();
      store.setFriendBlacklisted(target.data.friend_id, true);
      // 记录拉黑时间点：群消息只折叠此刻之后发的，拉黑前历史保留原文
      store.setFriendBlacklistTime(target.data.friend_id, new Date().toISOString());
      setSuccess('已拉黑');
      setView('main');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, loading]);

  // 取消拉黑（直接执行）
  const handleUnblacklist = useCallback(async () => {
    if (target.type !== 'friend' || loading) { return; }
    setLoading(true);
    try {
      await removeBlacklist(api, target.data.friend_id);
      useChatStore.getState().setFriendBlacklisted(target.data.friend_id, false);
      setSuccess('已取消拉黑');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }, [api, target, loading]);

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
    if (fileInputRef.current) { fileInputRef.current.value = ''; }
    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB');
      return;
    }

    // 选图后先裁剪（1:1）；取消则不上传
    const cropped = await requestCrop(file);
    if (!cropped) { return; }

    setUploadingAvatar(true);
    setAvatarUploadProgress(0);
    setLoading(true);
    try {
      await uploadGroupAvatar(
        api,
        target.data.group_id,
        cropped,
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
  }, [api, target, onGroupUpdated, requestCrop]);

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
      setSuccess(`邀请码已生成: ${result.code}`);
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
    // 任何成员（除自己）都可打开操作面板：面板含人人可用的看资料/备注/特别关心/屏蔽，
    // 管理操作（设管理员/禁言/移出）在面板内按 canModerateSelectedMember 单独 gating。
    if (member.user_id === session?.userId) { return; }
    setSelectedMember(member);
    setView('member-action');
  }, [session?.userId]);

  // 看该成员的公开资料（只读资料页），并关闭菜单
  const handleViewMemberProfile = useCallback(() => {
    if (!selectedMember) { return; }
    openProfileView(selectedMember.user_id);
    handleCloseMenu();
  }, [selectedMember, openProfileView, handleCloseMenu]);

  // D6 群内屏蔽/取消屏蔽该成员：先 await API 成功再写 store（与好友关系操作 handleBlacklist
  // 等一致：成功才写、失败仅提示不写入），消除「乐观写+回滚」在并发下落旧值的风险
  const handleToggleMemberBlock = useCallback(async () => {
    if (!groupId || !selectedMember) { return; }
    const uid = selectedMember.user_id;
    const next = !isSelectedMemberBlocked;
    try {
      if (next) {
        await addGroupMessageBlock(api, groupId, uid);
      } else {
        await removeGroupMessageBlock(api, groupId, uid);
      }
      setGroupMemberBlocked(groupId, uid, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [api, groupId, selectedMember, isSelectedMemberBlocked, setGroupMemberBlocked]);

  // M3 群内特别关心/取消该成员：先 await 再写 store
  const handleToggleMemberSpecialCare = useCallback(async () => {
    if (!groupId || !selectedMember) { return; }
    const uid = selectedMember.user_id;
    const next = !isSelectedMemberSpecialCared;
    try {
      if (next) {
        await addGroupSpecialCare(api, groupId, uid);
      } else {
        await removeGroupSpecialCare(api, groupId, uid);
      }
      setGroupMemberSpecialCare(groupId, uid, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [api, groupId, selectedMember, isSelectedMemberSpecialCared, setGroupMemberSpecialCare]);

  // D7 设置/清除该成员私有备注：先 await 再写 store。空串 = 清除。
  // 弹窗的关闭由 GroupRemarkInputModal 在点击保存时自行 onClose，无需此处再关。
  const handleSaveMemberRemark = useCallback(async (value: string) => {
    if (!groupId || !selectedMember) { return; }
    const uid = selectedMember.user_id;
    const trimmed = value.trim();
    try {
      if (trimmed) {
        await apiSetGroupMemberRemark(api, groupId, uid, trimmed);
      } else {
        await apiRemoveGroupMemberRemark(api, groupId, uid);
      }
      setGroupMemberRemarkAction(groupId, uid, trimmed || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [api, groupId, selectedMember, setGroupMemberRemarkAction]);

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

  // 设置好友备注
  const handleUpdateFriendRemark = useCallback(async () => {
    if (target.type !== 'friend' || !session || !friendRemark.trim()) { return; }

    const remark = friendRemark.trim();
    setLoading(true);
    try {
      await apiSetFriendRemark(api, session.userId, target.data.friend_id, remark);
      // 更新 store 中该好友的备注，列表/标题立即刷新
      const { friends, setFriends } = useChatStore.getState();
      setFriends(friends.map((f) =>
        f.friend_id === target.data.friend_id ? { ...f, friend_remark: remark } : f,
      ));
      setSuccess('备注已设置');
      setView('main');
      setFriendRemark('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置失败');
    } finally {
      setLoading(false);
    }
  }, [api, session, target, friendRemark]);

  // 清除好友备注
  const handleClearFriendRemark = useCallback(async () => {
    if (target.type !== 'friend' || !session) { return; }

    setLoading(true);
    try {
      await apiSetFriendRemark(api, session.userId, target.data.friend_id, '');
      // 更新 store 中该好友的备注，列表/标题立即刷新
      const { friends, setFriends } = useChatStore.getState();
      setFriends(friends.map((f) =>
        f.friend_id === target.data.friend_id ? { ...f, friend_remark: null } : f,
      ));
      setSuccess('备注已清除');
      setView('main');
      setFriendRemark('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失败');
    } finally {
      setLoading(false);
    }
  }, [api, session, target]);

  // 加载全部聊天记录
  const handleLoadAllHistory = useCallback(async () => {
    if (loadingHistory || !session) { return; }

    setLoadingHistory(true);
    setHistoryProgress('准备加载...');
    setError(null);

    try {
      if (target.type === 'ai') { return; }
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
    currentUserId: session?.userId,

    // 成员操作面板：选中成员的群内私有状态 + 管理权限 + 备注弹窗
    isSelectedMemberBlocked,
    isSelectedMemberSpecialCared,
    selectedMemberRemark,
    canModerateSelectedMember,
    memberRemarkModalOpen,

    // 禁言时长
    muteDuration,
    setMuteDuration,

    // 群内昵称
    groupNickname,
    setGroupNickname,

    // 好友备注
    friendRemark,
    setFriendRemark,

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

    // 好友关系状态
    isFriendSpecialCare,
    isFriendBlacklisted,

    // 操作方法
    handleToggle,
    handleSetView,
    handleRemoveFriend,
    handleToggleSpecialCare,
    handleBlacklist,
    handleUnblacklist,
    handleUpdateGroupName,
    handleAvatarUpload,
    avatarCropModal: cropModal,
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
    handleViewMemberProfile,
    handleToggleMemberBlock,
    handleToggleMemberSpecialCare,
    handleSaveMemberRemark,
    openMemberRemarkModal: () => setMemberRemarkModalOpen(true),
    closeMemberRemarkModal: () => setMemberRemarkModalOpen(false),
    handleCloseMenu,
    handleUpdateGroupNickname,
    handleClearGroupNickname,
    handleUpdateFriendRemark,
    handleClearFriendRemark,
    handleLoadAllHistory,
  };
}
