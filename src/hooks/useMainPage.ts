/**
 * 主页面状态管理 Hook
 *
 * 从 Main.tsx 中提取的状态和逻辑
 * 负责：
 * - 聊天目标管理
 * - 消息发送
 * - 文件上传
 * - 系统通知处理
 * - WebSocket 订阅
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
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
} from '../types/websocket';

// 侧边栏宽度常量
const MIN_PANEL_WIDTH = 88;
const MAX_PANEL_WIDTH = 280;

export function useMainPage() {
  const { session, clearSession } = useSession();
  const api = useApi();
  const {
    markRead,
    getFriendUnread,
    getGroupUnread,
    unreadSummary,
    pendingNotifications,
    initPendingNotifications,
    setActiveChat,
    updateLastMessage,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
  } = useWebSocket();

  const {
    friends,
    loading: friendsLoading,
    error: friendsError,
    refresh: refreshFriends,
    addFriend,
    removeFriend,
  } = useFriends();

  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refresh: refreshGroups,
    addGroup,
    removeGroup,
  } = useGroups();

  // 基础状态
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
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
      if (chatTarget) {
        if (
          chatTarget.type === 'friend' &&
          msg.source_type === 'friend' &&
          msg.source_id === chatTarget.data.friend_id
        ) {
          handleNewFriendMessage(msg);
          markRead('friend', msg.source_id);
        } else if (
          chatTarget.type === 'group' &&
          msg.source_type === 'group' &&
          msg.source_id === chatTarget.data.group_id
        ) {
          handleNewGroupMessage(msg);
          markRead('group', msg.source_id);
        }
      }
    });
    return unsubscribe;
  }, [chatTarget, handleNewFriendMessage, handleNewGroupMessage, markRead, onNewMessage]);

  // ============================================
  // 订阅消息撤回事件
  // ============================================
  useEffect(() => {
    const unsubscribe = onMessageRecalled((msg) => {
      if (chatTarget) {
        if (
          chatTarget.type === 'friend' &&
          msg.source_type === 'friend' &&
          msg.source_id === chatTarget.data.friend_id
        ) {
          handleFriendMessageRecalled(msg);
        } else if (
          chatTarget.type === 'group' &&
          msg.source_type === 'group' &&
          msg.source_id === chatTarget.data.group_id
        ) {
          handleGroupMessageRecalled(msg);
        }
      }
    });
    return unsubscribe;
  }, [chatTarget, handleFriendMessageRecalled, handleGroupMessageRecalled, onMessageRecalled]);

  // ============================================
  // 订阅系统通知
  // ============================================
  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      switch (msg.notification_type) {
        case 'friend_request':
          break;

        case 'friend_request_approved': {
          const friendData = msg.data as FriendApprovedData;
          if (friendData.friend_id) {
            const newFriend: Friend = {
              friend_id: friendData.friend_id,
              friend_nickname: friendData.friend_nickname,
              friend_avatar_url: friendData.friend_avatar_url || null,
              add_time: friendData.add_time,
            };
            addFriend(newFriend);
          }
          break;
        }

        case 'friend_request_rejected':
          break;

        case 'group_invite':
          break;

        case 'group_join_request':
          break;

        case 'group_join_approved': {
          const groupData = msg.data as GroupJoinApprovedData;
          if (groupData.group_id) {
            const newGroup: Group = {
              group_id: groupData.group_id,
              group_name: groupData.group_name,
              group_avatar_url: groupData.group_avatar_url || null,
              role: groupData.role || 'member',
              unread_count: 0,
              last_message_content: null,
              last_message_time: null,
            };
            addGroup(newGroup);
          }
          break;
        }

        case 'group_removed':
        case 'group_disbanded': {
          const removedData = msg.data as GroupRemovedData;
          if (removedData.group_id) {
            removeGroup(removedData.group_id);
            if (chatTarget?.type === 'group' && chatTarget.data.group_id === removedData.group_id) {
              setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        case 'group_notice_updated':
          break;
      }
    });
    return unsubscribe;
  }, [chatTarget, onSystemNotification, addFriend, addGroup, removeGroup, setActiveChat]);

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
  const handleSelectFriend = useCallback((friend: Friend) => {
    setChatTarget({ type: 'friend', data: friend });
    setActiveChat('friend', friend.friend_id);
    markRead('friend', friend.friend_id);
  }, [markRead, setActiveChat]);

  const handleSelectGroup = useCallback((group: Group) => {
    setChatTarget({ type: 'group', data: group });
    setActiveChat('group', group.group_id);
    markRead('group', group.group_id);
  }, [markRead, setActiveChat]);

  const handleSelectTarget = useCallback((target: ChatTarget) => {
    setChatTarget(target);
    if (target.type === 'friend') {
      setActiveChat('friend', target.data.friend_id);
      markRead('friend', target.data.friend_id);
    } else {
      setActiveChat('group', target.data.group_id);
      markRead('group', target.data.group_id);
    }
  }, [markRead, setActiveChat]);

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
  }, [chatTarget, removeFriend, setActiveChat]);

  const handleGroupUpdated = useCallback(async () => {
    const updatedGroups = await refreshGroups();
    if (chatTarget?.type === 'group') {
      const updatedGroup = updatedGroups.find(
        (g) => g.group_id === chatTarget.data.group_id,
      );
      if (updatedGroup) {
        setChatTarget({ type: 'group', data: updatedGroup });
      }
    }
  }, [chatTarget, refreshGroups]);

  const handleGroupLeft = useCallback(() => {
    if (chatTarget?.type === 'group') {
      removeGroup(chatTarget.data.group_id);
    }
    setChatTarget(null);
    setActiveChat(null, null);
  }, [chatTarget, removeGroup, setActiveChat]);

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
    getFriendUnread,
    getGroupUnread,

    // 操作方法
    handleTabChange,
    handleSelectFriend,
    handleSelectGroup,
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
