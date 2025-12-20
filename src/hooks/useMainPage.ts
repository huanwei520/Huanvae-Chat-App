/**
 * 主页面状态管理 Hook
 *
 * 基于 Zustand store 重构的主页面状态管理
 *
 * 负责：
 * - 聊天目标管理（通过 Zustand store）
 * - 消息发送
 * - 文件上传
 * - 系统通知处理（好友/群聊相关实时通知）
 * - WebSocket 订阅
 *
 * 重构要点：
 * - chatTarget 状态迁移到 Zustand store
 * - WebSocket 回调中使用 store.getState() 获取最新状态，避免依赖数组问题
 * - 群角色更新使用 store 的 updateGroup 和 updateChatTargetRole 方法
 *
 * 支持的系统通知类型：
 * - friend_request_approved: 好友请求通过，添加好友到列表
 * - friend_deleted: 被好友删除，从列表移除
 * - group_join_approved: 入群申请通过，添加群到列表
 * - group_removed/disbanded: 被移出群/群解散，从列表移除
 * - owner_transferred: 群主转让，更新角色
 * - admin_set/removed: 管理员变更，更新角色
 * - member_muted: 成员被禁言，存储禁言状态
 * - member_unmuted: 成员被解禁，清除禁言状态
 * - group_info_updated: 群名称更新
 * - group_avatar_updated: 群头像更新
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useChatStore } from '../stores';
import { useFriends } from './useFriends';
import { useGroups } from './useGroups';
import { useMessages } from './useMessages';
import { useGroupMessages } from './useGroupMessages';
import { useResizablePanel } from './useResizablePanel';
import { useFileUpload } from './useFileUpload';
import { useChatActions } from './useChatActions';
import { useMultiSelect } from './useMultiSelect';
import { getPendingRequests } from '../api/friends';
import { getGroupInvitations } from '../api/groups';

import type { NavTab } from '../components/sidebar/Sidebar';
import type { AttachmentType } from '../components/chat/FileAttachButton';
import type { Friend, Group, ChatTarget } from '../types/chat';
import type {
  FriendApprovedData,
  GroupJoinApprovedData,
  GroupRemovedData,
  FriendDeletedData,
  OwnerTransferredData,
  AdminChangedData,
  GroupInfoUpdatedData,
  GroupAvatarUpdatedData,
  MemberMutedData,
  MemberUnmutedData,
} from '../types/websocket';

// 侧边栏宽度常量
const MIN_PANEL_WIDTH = 88;
const MAX_PANEL_WIDTH = 280;

export function useMainPage() {
  const { session, clearSession } = useSession();
  const api = useApi();
  const {
    markRead,
    unreadSummary,
    pendingNotifications,
    initPendingNotifications,
    setActiveChat,
    updateLastMessage,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
  } = useWebSocket();

  // ============================================
  // Zustand Store - 聊天目标状态
  // ============================================
  const chatTarget = useChatStore((state) => state.chatTarget);
  const setChatTarget = useChatStore((state) => state.setChatTarget);
  // 注意：updateChatTargetRole 在 WebSocket 回调中通过 store.getState() 使用

  // ============================================
  // 好友/群聊 Hooks（内部使用 Zustand store）
  // ============================================
  const {
    friends,
    loading: friendsLoading,
    error: friendsError,
    refresh: refreshFriends,
    // addFriend 在 WebSocket 回调中通过 store.getState() 使用
    removeFriend,
  } = useFriends();

  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refresh: refreshGroups,
    addGroup,
    removeGroup,
    // updateGroup 在 WebSocket 回调中通过 store.getState() 使用
  } = useGroups();

  // 基础状态
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // 文件上传
  const { uploading, progress, uploadFriendFile, uploadGroupFile, resetUpload } = useFileUpload();
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  // 侧边栏宽度调整
  const { panelWidth, isResizing, handleResizeStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
  });

  // 私聊消息
  const friendId = chatTarget?.type === 'friend' ? chatTarget.data.friend_id : null;
  const {
    messages: friendMessages,
    loading: friendMessagesLoading,
    sending: friendSending,
    sendTextMessage: sendFriendMessage,
    loadMessages: loadFriendMessages,
    handleNewMessage: handleNewFriendMessage,
    handleMessageRecalled: handleFriendMessageRecalled,
    removeMessage: removeFriendMessage,
  } = useMessages(friendId);

  // 群聊消息
  const groupId = chatTarget?.type === 'group' ? chatTarget.data.group_id : null;
  const {
    messages: groupMessages,
    loading: groupMessagesLoading,
    sending: groupSending,
    sendTextMessage: sendGroupMessage,
    loadMessages: loadGroupMessages,
    handleNewMessage: handleNewGroupMessage,
    handleMessageRecalled: handleGroupMessageRecalled,
    removeMessage: removeGroupMessage,
  } = useGroupMessages(groupId);

  // 消息操作 Hook
  const { handleRecallMessage, handleDeleteMessage } = useChatActions({
    chatTarget,
    removeFriendMessage,
    removeGroupMessage,
  });

  // 多选模式 Hook
  const {
    isMultiSelectMode,
    selectedMessages,
    handleToggleSelect,
    handleEnterMultiSelect,
    handleExitMultiSelect,
    handleSelectAll,
    handleDeselectAll,
    handleBatchDelete,
    handleBatchRecall,
  } = useMultiSelect({
    chatTarget,
    friendMessages,
    groupMessages,
    handleRecallMessage,
    handleDeleteMessage,
  });

  // ============================================
  // 初始化待处理通知
  // ============================================
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) { return; }
    initDone.current = true;

    const loadPendingNotifications = async () => {
      try {
        const [friendRequestsRes, groupInvitesRes] = await Promise.all([
          getPendingRequests(api),
          getGroupInvitations(api),
        ]);

        const friendRequestsCount = friendRequestsRes.items?.length || 0;
        const groupInvitesCount = groupInvitesRes.data?.invitations?.length || 0;

        initPendingNotifications({
          friendRequests: friendRequestsCount,
          groupInvites: groupInvitesCount,
        });
      } catch {
        // 初始化失败不影响使用
      }
    };

    loadPendingNotifications();
  }, [api, initPendingNotifications]);

  // ============================================
  // 加载消息并标记已读
  // ============================================
  useEffect(() => {
    if (chatTarget?.type === 'friend') {
      loadFriendMessages();
      markRead('friend', chatTarget.data.friend_id);
    } else if (chatTarget?.type === 'group') {
      loadGroupMessages();
      markRead('group', chatTarget.data.group_id);
    }
  }, [chatTarget, loadFriendMessages, loadGroupMessages, markRead]);

  // ============================================
  // 订阅新消息事件
  // ============================================
  useEffect(() => {
    const unsubscribe = onNewMessage((msg) => {
      // 使用 store.getState() 获取最新的 chatTarget，避免闭包问题
      const currentTarget = useChatStore.getState().chatTarget;
      if (currentTarget) {
        if (
          currentTarget.type === 'friend' &&
          msg.source_type === 'friend' &&
          msg.source_id === currentTarget.data.friend_id
        ) {
          handleNewFriendMessage(msg);
          markRead('friend', msg.source_id);
        } else if (
          currentTarget.type === 'group' &&
          msg.source_type === 'group' &&
          msg.source_id === currentTarget.data.group_id
        ) {
          handleNewGroupMessage(msg);
          markRead('group', msg.source_id);
        }
      }
    });
    return unsubscribe;
  }, [handleNewFriendMessage, handleNewGroupMessage, markRead, onNewMessage]);

  // ============================================
  // 订阅消息撤回事件
  // ============================================
  useEffect(() => {
    const unsubscribe = onMessageRecalled((msg) => {
      const currentTarget = useChatStore.getState().chatTarget;
      if (currentTarget) {
        if (
          currentTarget.type === 'friend' &&
          msg.source_type === 'friend' &&
          msg.source_id === currentTarget.data.friend_id
        ) {
          handleFriendMessageRecalled(msg);
        } else if (
          currentTarget.type === 'group' &&
          msg.source_type === 'group' &&
          msg.source_id === currentTarget.data.group_id
        ) {
          handleGroupMessageRecalled(msg);
        }
      }
    });
    return unsubscribe;
  }, [handleFriendMessageRecalled, handleGroupMessageRecalled, onMessageRecalled]);

  // ============================================
  // 订阅系统通知（关键重构：移除 groups 依赖）
  // ============================================
  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      // 使用 store.getState() 获取最新状态，避免依赖数组问题
      const store = useChatStore.getState();
      const currentTarget = store.chatTarget;

      switch (msg.notification_type) {
        // ==================== 好友相关通知 ====================
        case 'friend_request':
          break;

        case 'friend_request_approved': {
          const friendData = msg.data as unknown as FriendApprovedData;
          if (friendData.friend_id) {
            const newFriend: Friend = {
              friend_id: friendData.friend_id,
              friend_nickname: friendData.friend_nickname,
              friend_avatar_url: friendData.friend_avatar_url || null,
              add_time: friendData.add_time,
              approve_reason: null,
            };
            // 直接调用 store 方法
            store.addFriend(newFriend);
          }
          break;
        }

        case 'friend_request_rejected':
          break;

        case 'friend_deleted': {
          const deletedData = msg.data as unknown as FriendDeletedData;
          if (deletedData.friend_id) {
            store.removeFriend(deletedData.friend_id);
            if (currentTarget?.type === 'friend' && currentTarget.data.friend_id === deletedData.friend_id) {
              store.setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        // ==================== 群聊邀请和加入通知 ====================
        case 'group_invite':
          break;

        case 'group_join_request':
          break;

        case 'group_join_approved': {
          const groupData = msg.data as unknown as GroupJoinApprovedData;
          if (groupData.group_id) {
            const newGroup: Group = {
              group_id: groupData.group_id,
              group_name: groupData.group_name,
              group_avatar_url: groupData.group_avatar_url ?? null,
              role: groupData.role || 'member',
              unread_count: 0,
              last_message_content: null,
              last_message_time: null,
            };
            store.addGroup(newGroup);
          }
          break;
        }

        // ==================== 群聊移除/解散通知 ====================
        case 'group_removed':
        case 'group_disbanded': {
          const removedData = msg.data as unknown as GroupRemovedData;
          if (removedData.group_id) {
            store.removeGroup(removedData.group_id);
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === removedData.group_id) {
              store.setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        // ==================== 群主转让通知（关键修复） ====================
        case 'owner_transferred': {
          const transferData = msg.data as unknown as OwnerTransferredData;
          if (transferData.group_id && session) {
            // 判断当前用户的新角色
            let newRole: 'owner' | 'admin' | 'member' | null = null;
            if (transferData.new_owner_id === session.userId) {
              newRole = 'owner';
            } else if (transferData.old_owner_id === session.userId) {
              newRole = 'member';
            }

            if (newRole) {
              // 使用 store 方法更新群角色（不触发整个列表重渲染）
              store.updateGroup(transferData.group_id, { role: newRole });
              // 同时更新 chatTarget（如果当前正在查看该群）
              store.updateChatTargetRole(transferData.group_id, newRole);
            }
          }
          break;
        }

        // ==================== 管理员变更通知 ====================
        case 'admin_set': {
          const adminData = msg.data as unknown as AdminChangedData;
          if (adminData.group_id && session && adminData.target_user_id === session.userId) {
            store.updateGroup(adminData.group_id, { role: 'admin' });
            store.updateChatTargetRole(adminData.group_id, 'admin');
          }
          break;
        }

        case 'admin_removed': {
          const adminData = msg.data as unknown as AdminChangedData;
          if (adminData.group_id && session && adminData.target_user_id === session.userId) {
            store.updateGroup(adminData.group_id, { role: 'member' });
            store.updateChatTargetRole(adminData.group_id, 'member');
          }
          break;
        }

        // ==================== 禁言通知 ====================
        case 'member_muted': {
          const muteData = msg.data as unknown as MemberMutedData;
          // 只处理当前用户被禁言的情况
          if (muteData.group_id && session && muteData.target_user_id === session.userId) {
            store.setMuteStatus(muteData.group_id, muteData.mute_until, muteData.reason);
          }
          break;
        }

        case 'member_unmuted': {
          const unmuteData = msg.data as unknown as MemberUnmutedData;
          // 只处理当前用户被解除禁言的情况
          if (unmuteData.group_id && session && unmuteData.target_user_id === session.userId) {
            store.clearMuteStatus(unmuteData.group_id);
          }
          break;
        }

        // ==================== 群信息更新通知 ====================
        case 'group_info_updated': {
          const infoData = msg.data as unknown as GroupInfoUpdatedData;
          if (infoData.group_id && infoData.new_name) {
            store.updateGroup(infoData.group_id, { group_name: infoData.new_name });
            // 更新 chatTarget
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === infoData.group_id) {
              store.setChatTarget({
                type: 'group',
                data: { ...currentTarget.data, group_name: infoData.new_name },
              });
            }
          }
          break;
        }

        case 'group_avatar_updated': {
          const avatarData = msg.data as unknown as GroupAvatarUpdatedData;
          if (avatarData.group_id) {
            store.updateGroup(avatarData.group_id, { group_avatar_url: avatarData.new_avatar_url });
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === avatarData.group_id) {
              store.setChatTarget({
                type: 'group',
                data: { ...currentTarget.data, group_avatar_url: avatarData.new_avatar_url },
              });
            }
          }
          break;
        }

        // ==================== 新成员加入通知 ====================
        case 'group_member_joined':
          // 成员列表的实时更新可以在 ChatMenu 组件中实现
          break;

        // ==================== 群公告更新通知 ====================
        case 'group_notice_updated':
          break;
      }
    });
    return unsubscribe;
  }, [session, onSystemNotification, setActiveChat]);
  // 注意：依赖数组中移除了 groups、chatTarget、addFriend 等
  // 因为我们在回调中使用 store.getState() 获取最新值

  // ============================================
  // 消息发送
  // ============================================
  const handleSendMessage = useCallback(async () => {
    if (!messageInput.trim() || !chatTarget) { return; }

    const content = messageInput.trim();
    setMessageInput('');

    const timestamp = new Date().toISOString();

    if (chatTarget.type === 'friend') {
      await sendFriendMessage(content);
      updateLastMessage('friend', chatTarget.data.friend_id, content, 'text', timestamp);
    } else {
      await sendGroupMessage(content);
      updateLastMessage('group', chatTarget.data.group_id, content, 'text', timestamp);
    }
  }, [messageInput, chatTarget, sendFriendMessage, sendGroupMessage, updateLastMessage]);

  // ============================================
  // 文件上传
  // ============================================
  const handleFileSelect = useCallback(async (file: File, type: AttachmentType) => {
    if (!chatTarget) { return; }

    setUploadingFile(file);

    const messageTypeMap: Record<AttachmentType, 'image' | 'video' | 'file'> = {
      image: 'image',
      video: 'video',
      file: 'file',
    };
    const messageType = messageTypeMap[type];
    const timestamp = new Date().toISOString();

    try {
      if (chatTarget.type === 'friend') {
        const result = await uploadFriendFile(file, chatTarget.data.friend_id);
        if (result.success) {
          loadFriendMessages();
          updateLastMessage('friend', chatTarget.data.friend_id, file.name, messageType, timestamp);
        } else {
          console.error('文件上传失败:', result.error);
        }
      } else {
        const result = await uploadGroupFile(file, chatTarget.data.group_id);
        if (result.success) {
          loadGroupMessages();
          updateLastMessage('group', chatTarget.data.group_id, file.name, messageType, timestamp);
        } else {
          console.error('文件上传失败:', result.error);
        }
      }
    } catch (err) {
      console.error('文件上传失败:', err);
    } finally {
      setTimeout(() => {
        setUploadingFile(null);
        resetUpload();
      }, 1500);
    }
  }, [chatTarget, uploadFriendFile, uploadGroupFile, loadFriendMessages, loadGroupMessages, resetUpload, updateLastMessage]);

  // ============================================
  // 选择处理
  // ============================================
  const handleSelectTarget = useCallback((target: ChatTarget) => {
    setChatTarget(target);
    if (target.type === 'friend') {
      setActiveChat('friend', target.data.friend_id);
      markRead('friend', target.data.friend_id);
    } else {
      setActiveChat('group', target.data.group_id);
      markRead('group', target.data.group_id);
    }
  }, [markRead, setActiveChat, setChatTarget]);

  const handleTabChange = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    setSearchQuery('');
  }, []);

  // ============================================
  // 聊天菜单回调
  // ============================================
  const handleFriendRemoved = useCallback(() => {
    if (chatTarget?.type === 'friend') {
      removeFriend(chatTarget.data.friend_id);
    }
    setChatTarget(null);
    setActiveChat(null, null);
  }, [chatTarget, removeFriend, setActiveChat, setChatTarget]);

  const handleGroupUpdated = useCallback(async () => {
    const updatedGroups = await refreshGroups();
    const currentTarget = useChatStore.getState().chatTarget;
    if (currentTarget?.type === 'group') {
      const updatedGroup = updatedGroups.find(
        (g) => g.group_id === currentTarget.data.group_id,
      );
      if (updatedGroup) {
        setChatTarget({ type: 'group', data: updatedGroup });
      }
    }
  }, [refreshGroups, setChatTarget]);

  const handleGroupLeft = useCallback(() => {
    if (chatTarget?.type === 'group') {
      removeGroup(chatTarget.data.group_id);
    }
    setChatTarget(null);
    setActiveChat(null, null);
  }, [chatTarget, removeGroup, setActiveChat, setChatTarget]);

  const handleLogout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const handleCancelUpload = useCallback(() => {
    setUploadingFile(null);
    resetUpload();
  }, [resetUpload]);

  // ============================================
  // 计算属性
  // ============================================
  const isLoading = chatTarget?.type === 'friend' ? friendMessagesLoading : groupMessagesLoading;
  const isSending = chatTarget?.type === 'friend' ? friendSending : groupSending;
  const currentMessages = chatTarget?.type === 'friend' ? friendMessages : groupMessages;
  const totalMessageCount = currentMessages.length;

  const canBatchRecall = chatTarget?.type === 'group' &&
    (chatTarget.data.role === 'owner' || chatTarget.data.role === 'admin');

  const pendingNotificationCount =
    pendingNotifications.friendRequests +
    pendingNotifications.groupInvites +
    pendingNotifications.groupJoinRequests;

  return {
    // Session
    session,

    // 基础状态
    activeTab,
    chatTarget,
    messageInput,
    setMessageInput,
    searchQuery,
    setSearchQuery,

    // 弹窗状态
    showProfileModal,
    setShowProfileModal,
    showAddModal,
    setShowAddModal,

    // 好友/群聊数据
    friends,
    friendsLoading,
    friendsError,
    groups,
    groupsLoading,
    groupsError,
    refreshFriends,
    addGroup,
    refreshGroups,

    // 消息数据
    friendMessages,
    groupMessages,
    isLoading,
    isSending,
    currentMessages,
    totalMessageCount,

    // 文件上传
    uploading,
    progress,
    uploadingFile,

    // 多选模式
    isMultiSelectMode,
    selectedMessages,
    canBatchRecall,

    // 面板
    panelWidth,
    isResizing,

    // WebSocket
    unreadSummary,
    pendingNotificationCount,

    // 操作方法
    handleTabChange,
    handleSelectTarget,
    handleSendMessage,
    handleFileSelect,
    handleCancelUpload,
    handleResizeStart,

    // 消息操作
    handleToggleSelect,
    handleEnterMultiSelect,
    handleExitMultiSelect,
    handleSelectAll,
    handleDeselectAll,
    handleBatchDelete,
    handleBatchRecall,
    handleRecallMessage,
    handleDeleteMessage,

    // 聊天菜单回调
    handleFriendRemoved,
    handleGroupUpdated,
    handleGroupLeft,
    handleLogout,
  };
}
