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
  getBlacklistTimes,
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
  updateGroupNickname,
  addGroupMessageBlock,
  removeGroupMessageBlock,
  addGroupSpecialCare,
  removeGroupSpecialCare,
  setGroupMemberRemark as apiSetGroupMemberRemark,
  removeGroupMemberRemark as apiRemoveGroupMemberRemark,
  type GroupMember,
  type GroupNotice,
  getGroupJoinRequests,
  approveGroupJoinRequest,
  rejectGroupJoinRequest,
  type GroupJoinRequestInfo,
} from '../../api/groups';
import { loadAllHistoryMessages } from '../../services/historyService';
import { isTopLayerActive } from '../../hooks/useTopLayer';
import { isFriendLikeTarget } from '../../utils/chatTarget';
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

  // 邀请成员：只留附言。被邀请的人来自好友选择器（见 handleInviteMembers），
  // 不再有「手输 user ID」这条路 —— 那要求用户先从别处抄到对方的 ID 才能邀请。
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
  /**
   * 邀请一批人入群。
   *
   * 🔴 失败时**向上抛**而不是只 setError —— 调用方（InviteForm 里的 ShareTargetPicker）
   * 是一个盖在面板之上的浮层，面板底部那条 error 条在它下面根本看不见；
   * 抛出去才能让文案落在浮层里、浮层不关、已选不清空可直接重试
   * （与 ShareGroupCardModal 的 onConfirm 同一约定）。
   */
  handleInviteMembers: (userIds: string[]) => Promise<void>;
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

  // 入群申请审批（群主 / 管理员）
  /** 本群待审批的入群申请；普通成员恒为空数组（不发请求，避免刷 403） */
  joinRequests: GroupJoinRequestInfo[];
  /** 正在处理中的 request_id（按钮置灰防重复点） */
  processingRequestId: string | null;
  handleApproveJoinRequest: (requestId: string) => Promise<void>;
  handleRejectJoinRequest: (requestId: string) => Promise<void>;
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
  // 入群申请审批（群主/管理员）：后端三个端点一直都在，客户端此前从未接过 ——
  // 后果是**开了入群审核**的群，申请永久 pending、群主在 App 里根本看不到。
  const [joinRequests, setJoinRequests] = useState<GroupJoinRequestInfo[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [view, setView] = useState<MenuView>('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 编辑群名称
  const [newGroupName, setNewGroupName] = useState('');

  // 邀请成员（只有附言；人选由好友选择器给出）
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
  const friendId = isFriendLikeTarget(target) ? target.data.friend_id : null;
  const friendState = useChatStore((state) =>
    friendId ? state.friends.find((f) => f.friend_id === friendId) : undefined,
  );
  const isFriendSpecialCare = !!friendState?.is_special_care;
  const isFriendBlacklisted = !!friendState?.is_blacklisted;

  // 点击外部关闭
  //
  // 🔴 首行的顶层判定不是兜底，是**这次指针事件归谁所有**的层级判定：
  // 面板（ChatMenuPanel）与全屏媒体预览（MobileMediaPreview）各自 portal 到 document.body，
  // 在 DOM 里是**兄弟**、互不包含 ⇒ 用户在预览里点 ✕ / 点背景 / 点播放键，
  // 对下面这句 `contains` 而言全都是"点在外部" ⇒ 面板被连带关掉，
  // 用户关掉预览后发现整个侧边面板也没了、落回聊天页（真机实测过的现象）。
  // 顶层浮层开着时这次事件属于它，本层根本不该看见，更不该据此推断"用户点到我外面了"。
  // 与 useMobileBackOverlay 的「浮层车道恒先于页面栈」是同一套层级观，见 hooks/useTopLayer.ts。
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isTopLayerActive()) {
        return;
      }
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

    // 入群申请只有群主/管理员看得到（后端 verify_admin_or_owner，普通成员 403）。
    // 这里按角色先行判断再请求，避免给普通成员刷一串 403。
    if (currentRole !== 'owner' && currentRole !== 'admin') {
      setJoinRequests([]);
      return;
    }
    try {
      const res = await getGroupJoinRequests(api, target.data.group_id);
      setJoinRequests(res.requests || []);
    } catch {
      // 拉失败就当没有待审批 —— 成员列表本身已经加载出来了，
      // 不该因为附带的申请列表失败而让整个视图空掉。
      setJoinRequests([]);
    }
  }, [api, target, currentRole]);

  /** 通过一条入群申请：成功后从列表移除 + 重拉成员（新成员应立刻出现在名单里） */
  const handleApproveJoinRequest = useCallback(async (requestId: string) => {
    if (target.type !== 'group') { return; }
    setProcessingRequestId(requestId);
    try {
      await approveGroupJoinRequest(api, target.data.group_id, requestId);
      setJoinRequests((prev) => prev.filter((r) => r.request_id !== requestId));
      const response = await getGroupMembers(api, target.data.group_id);
      setMembers(response.members || []);
      setSuccess('已通过入群申请');
    } catch (err) {
      setError(err instanceof Error ? err.message : '通过申请失败');
    } finally {
      setProcessingRequestId(null);
    }
  }, [api, target]);

  /** 拒绝一条入群申请 */
  const handleRejectJoinRequest = useCallback(async (requestId: string) => {
    if (target.type !== 'group') { return; }
    setProcessingRequestId(requestId);
    try {
      await rejectGroupJoinRequest(api, target.data.group_id, requestId);
      setJoinRequests((prev) => prev.filter((r) => r.request_id !== requestId));
      setSuccess('已拒绝入群申请');
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒绝申请失败');
    } finally {
      setProcessingRequestId(null);
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

  // 设置视图（带逻辑处理）
  const handleSetView = useCallback((v: MenuView) => {
    if (v === 'edit-name' && target.type === 'group') {
      setNewGroupName(target.data.group_name);
    }
    if (v === 'edit-remark' && isFriendLikeTarget(target)) {
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
    if (v === 'members') {
      handleLoadMembers();
    }
    setView(v);
  }, [target, handleLoadNotices, handleLoadMembers]);

  // 删除好友（friend / bot 共用：bot 是真实好友行）
  const handleRemoveFriend = useCallback(async () => {
    if (!isFriendLikeTarget(target) || !session) { return; }

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
    if (!isFriendLikeTarget(target) || loading) { return; }
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
    if (!isFriendLikeTarget(target) || loading) { return; }
    setLoading(true);
    try {
      await addBlacklist(api, target.data.friend_id);
      const store = useChatStore.getState();
      store.setFriendBlacklisted(target.data.friend_id, true);
      // 记录拉黑时间点：群消息只折叠此刻之后发的，拉黑前历史保留原文。
      // 必须用服务器 created_at（getBlacklistTimes）而非客户端 new Date()——客户端时钟漂移
      // 会让折叠边界与消息 send_time（服务器时间）错配。拉取失败不阻断（拉黑已成功），
      // 下次 useFriends 后台同步会补齐时间映射。
      try {
        store.setFriendBlacklistTimes(await getBlacklistTimes(api));
      } catch (err) {
        console.warn('[ChatMenu] 拉黑后刷新拉黑时间失败，待下次好友同步补齐:', err);
      }
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
    if (!isFriendLikeTarget(target) || loading) { return; }
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

  // 邀请成员（一次可邀多人 —— inviteToGroup 第三参本来就是数组）
  //
  // 与本 hook 里其它 handler 的两处刻意不同，都是因为调用方是浮在面板之上的选择器：
  // ① 失败**向上抛**（不 setError）—— 见 UseChatMenuReturn 上该方法的注释；
  // ② 成功后**不** setView('main') —— 选择器要自己播完「已邀请」再退场，
  //    面板此刻切回主菜单会把它连带拆掉、用户看不到任何成功反馈。
  const handleInviteMembers = useCallback(async (userIds: string[]) => {
    if (target.type !== 'group' || userIds.length === 0) { return; }

    setLoading(true);
    try {
      await inviteToGroup(api, target.data.group_id, userIds, inviteMessage.trim() || undefined);
      setSuccess('邀请已发送');
      setInviteMessage('');
    } finally {
      setLoading(false);
    }
  }, [api, target, inviteMessage]);

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
    if (!isFriendLikeTarget(target) || !session || !friendRemark.trim()) { return; }

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
    if (!isFriendLikeTarget(target) || !session) { return; }

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
      // bot 走 friend 数据面通道（历史记录服务只认 'friend' | 'group'）
      const targetId = isFriendLikeTarget(target)
        ? target.data.friend_id
        : target.data.group_id;
      const targetType = isFriendLikeTarget(target) ? 'friend' : 'group';

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

    // 邀请成员（只有附言）
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
    handleInviteMembers,
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
    handleMemberClick,
    handleViewMemberProfile,
    handleToggleMemberBlock,
    handleToggleMemberSpecialCare,
    handleSaveMemberRemark,
    openMemberRemarkModal: () => setMemberRemarkModalOpen(true),
    closeMemberRemarkModal: () => setMemberRemarkModalOpen(false),
    handleCloseMenu,
    // 入群申请审批
    joinRequests,
    processingRequestId,
    handleApproveJoinRequest,
    handleRejectJoinRequest,
    handleUpdateGroupNickname,
    handleClearGroupNickname,
    handleUpdateFriendRemark,
    handleClearFriendRemark,
    handleLoadAllHistory,
  };
}
