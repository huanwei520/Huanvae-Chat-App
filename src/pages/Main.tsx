/**
 * 主页面 - 登录后的主界面
 *
 * 类似微信的三栏布局：
 * - 左侧：侧边栏（头像 + 导航图标）
 * - 中间：会话列表（好友/群聊切换）
 * - 右侧：聊天窗口
 *
 * 功能：
 * - WebSocket 实时消息推送
 * - 消息右键菜单（撤回/删除）
 * - 多选模式批量操作
 * - 增量列表更新（好友/群聊）：
 *   - friend_request_approved: 增量插入新好友（带入场动画）
 *   - group_join_approved: 增量插入新群聊（带入场动画）
 *   - group_removed/group_disbanded: 增量移除群聊（带退出动画）
 *   - 删除好友: 增量移除好友（带退出动画）
 * - 初始化待处理通知：
 *   - 主页面加载时主动获取好友申请和群聊邀请数量
 *   - 确保离线期间的通知能够正确显示徽章
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useFriends } from '../hooks/useFriends';
import { useGroups } from '../hooks/useGroups';
import { useMessages } from '../hooks/useMessages';
import { useGroupMessages } from '../hooks/useGroupMessages';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { useFileUpload } from '../hooks/useFileUpload';
import { useChatActions } from '../hooks/useChatActions';
import { useMultiSelect } from '../hooks/useMultiSelect';

// 组件导入
import { Sidebar, type NavTab } from '../components/sidebar/Sidebar';
import { ConversationList } from '../components/conversations/ConversationList';
import { FriendList } from '../components/friends/FriendList';
import { GroupList } from '../components/groups/GroupList';
import { ChatMessages } from '../components/chat/ChatMessages';
import { GroupChatMessages } from '../components/chat/GroupChatMessages';
import { ChatMenuButton } from '../components/chat/ChatMenu';
import { MultiSelectActionBar } from '../components/chat/MultiSelectActionBar';
import { ChatInputArea } from '../components/chat/ChatInputArea';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';
import type { AttachmentType } from '../components/chat/FileAttachButton';

import type { Friend, Group, ChatTarget } from '../types/chat';
import type {
  FriendApprovedData,
  GroupJoinApprovedData,
  GroupRemovedData,
} from '../types/websocket';
import { getPendingRequests } from '../api/friends';
import { getGroupInvitations } from '../api/groups';

// 侧边栏宽度常量
const MIN_PANEL_WIDTH = 88;
const MAX_PANEL_WIDTH = 280;

// ============================================
// 主组件
// ============================================

export function Main() {
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

  // 主页面加载时初始化待处理通知（获取离线期间的好友申请/群聊邀请）
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

  // 加载消息并标记已读
  useEffect(() => {
    if (chatTarget?.type === 'friend') {
      loadFriendMessages();
      markRead('friend', chatTarget.data.friend_id);
    } else if (chatTarget?.type === 'group') {
      loadGroupMessages();
      markRead('group', chatTarget.data.group_id);
    }
  }, [chatTarget, loadFriendMessages, loadGroupMessages, markRead]);

  // 订阅新消息事件
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
          // 直接插入新消息，不刷新整个列表
          handleNewGroupMessage(msg);
          markRead('group', msg.source_id);
        }
      }
    });
    return unsubscribe;
  }, [chatTarget, handleNewFriendMessage, handleNewGroupMessage, markRead, onNewMessage]);

  // 订阅消息撤回事件
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

  // 订阅系统通知（使用增量操作替代全量刷新）
  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      switch (msg.notification_type) {
        case 'friend_request':
          // 收到好友请求（可在此显示通知提示）
          break;

        case 'friend_request_approved': {
          // 好友请求被通过 - 增量插入新好友
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
          // 好友请求被拒绝（可在此显示通知提示）
          break;

        case 'group_invite':
          // 收到群邀请（可在此显示通知提示）
          break;

        case 'group_join_request':
          // 群管理员收到入群申请（可在此显示通知提示）
          break;

        case 'group_join_approved': {
          // 入群申请被通过 - 增量插入新群聊
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
          // 被移出群聊或群解散 - 增量移除群聊
          const removedData = msg.data as GroupRemovedData;
          if (removedData.group_id) {
            removeGroup(removedData.group_id);
            // 如果当前正在查看该群，清除聊天目标
            if (chatTarget?.type === 'group' && chatTarget.data.group_id === removedData.group_id) {
              setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        case 'group_notice_updated':
          // 群公告更新（如果当前正在查看该群，可刷新公告）
          break;
      }
    });
    return unsubscribe;
  }, [chatTarget, onSystemNotification, addFriend, addGroup, removeGroup, setActiveChat]);

  // 发送消息
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

  // 处理文件选择
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

  const handleSelectFriend = (friend: Friend) => {
    setChatTarget({ type: 'friend', data: friend });
    setActiveChat('friend', friend.friend_id);
    markRead('friend', friend.friend_id);
  };

  const handleSelectGroup = (group: Group) => {
    setChatTarget({ type: 'group', data: group });
    setActiveChat('group', group.group_id);
    markRead('group', group.group_id);
  };

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

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    setSearchQuery('');
  };

  // 获取当前聊天状态
  const isLoading = chatTarget?.type === 'friend' ? friendMessagesLoading : groupMessagesLoading;
  const isSending = chatTarget?.type === 'friend' ? friendSending : groupSending;

  // ============================================
  // Early return 检查（必须在所有 hooks 之后）
  // ============================================
  if (!session) {
    return null;
  }

  const handleLogout = () => {
    clearSession();
  };

  // 获取聊天标题
  const getChatTitle = () => {
    if (!chatTarget) { return ''; }
    return chatTarget.type === 'friend'
      ? chatTarget.data.friend_nickname
      : chatTarget.data.group_name;
  };

  const getChatSubtitle = () => {
    if (!chatTarget) { return ''; }
    if (chatTarget.type === 'friend') {
      return `@${chatTarget.data.friend_id}`;
    }
    const roleText = {
      owner: '群主',
      admin: '管理员',
      member: '成员',
    };
    return roleText[chatTarget.data.role];
  };

  const getEmptyHint = () => {
    const hints: Record<NavTab, string> = {
      chat: '会话',
      friends: '好友',
      group: '群聊',
      settings: '设置',
    };
    return hints[activeTab];
  };

  // 判断是否可以批量撤回
  const canBatchRecall = chatTarget?.type === 'group' &&
    (chatTarget.data.role === 'owner' || chatTarget.data.role === 'admin');

  const currentMessages = chatTarget?.type === 'friend' ? friendMessages : groupMessages;
  const totalMessageCount = currentMessages.length;

  return (
    <div className="chat-app">
      <div className="chat-bg-orb orb-1" />
      <div className="chat-bg-orb orb-2" />

      {/* 左侧边栏 */}
      <Sidebar
        session={session}
        activeTab={activeTab}
        pendingNotificationCount={
          pendingNotifications.friendRequests +
          pendingNotifications.groupInvites +
          pendingNotifications.groupJoinRequests
        }
        onTabChange={handleTabChange}
        onAvatarClick={() => setShowProfileModal(true)}
        onAddClick={() => setShowAddModal(true)}
        onLogout={handleLogout}
      />

      {/* 中间列表 + 分割线 */}
      <div
        className={`chat-list-container ${isResizing ? 'resizing' : ''}`}
        style={{ width: panelWidth }}
      >
        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
            <ConversationList
              key="conversation-list"
              friends={friends}
              groups={groups}
              friendsLoading={friendsLoading}
              groupsLoading={groupsLoading}
              friendsError={friendsError}
              groupsError={groupsError}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedTarget={chatTarget}
              onSelectTarget={handleSelectTarget}
              unreadSummary={unreadSummary}
              panelWidth={panelWidth}
            />
          )}
          {activeTab === 'friends' && (
            <FriendList
              key="friend-list"
              friends={friends}
              loading={friendsLoading}
              error={friendsError}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedFriendId={chatTarget?.type === 'friend' ? chatTarget.data.friend_id : null}
              onSelectFriend={handleSelectFriend}
              getUnreadCount={getFriendUnread}
              panelWidth={panelWidth}
            />
          )}
          {activeTab === 'group' && (
            <GroupList
              key="group-list"
              groups={groups}
              loading={groupsLoading}
              error={groupsError}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedGroupId={chatTarget?.type === 'group' ? chatTarget.data.group_id : null}
              onSelectGroup={handleSelectGroup}
              getUnreadCount={getGroupUnread}
              panelWidth={panelWidth}
            />
          )}
        </AnimatePresence>

        {/* 可拖拽分割线 */}
        <div
          className="panel-resizer"
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* 右侧聊天窗口 */}
      <motion.section
        className="chat-window"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <AnimatePresence mode="wait">
          {chatTarget ? (
            <motion.div
              key={chatTarget.type === 'friend' ? chatTarget.data.friend_id : chatTarget.data.group_id}
              className="chat-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="chat-header">
                <div className="chat-header-info">
                  <h2>{getChatTitle()}</h2>
                  <span className="chat-subtitle">{getChatSubtitle()}</span>
                </div>
                <ChatMenuButton
                  target={chatTarget}
                  onFriendRemoved={() => {
                    // 使用增量移除替代全量刷新
                    if (chatTarget?.type === 'friend') {
                      removeFriend(chatTarget.data.friend_id);
                    }
                    setChatTarget(null);
                    setActiveChat(null, null);
                  }}
                  onGroupUpdated={async () => {
                    const updatedGroups = await refreshGroups();
                    if (chatTarget?.type === 'group') {
                      const updatedGroup = updatedGroups.find(
                        (g) => g.group_id === chatTarget.data.group_id,
                      );
                      if (updatedGroup) {
                        setChatTarget({ type: 'group', data: updatedGroup });
                      }
                    }
                  }}
                  onGroupLeft={() => {
                    // 使用增量移除替代全量刷新，触发退出动画
                    if (chatTarget?.type === 'group') {
                      removeGroup(chatTarget.data.group_id);
                    }
                    setChatTarget(null);
                    setActiveChat(null, null);
                  }}
                  isMultiSelectMode={isMultiSelectMode}
                  onToggleMultiSelect={handleEnterMultiSelect}
                />
              </div>

              <div className="chat-messages">
                {chatTarget.type === 'friend' ? (
                  <ChatMessages
                    loading={isLoading}
                    messages={friendMessages}
                    session={session}
                    friend={chatTarget.data}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedMessages={selectedMessages}
                    onToggleSelect={handleToggleSelect}
                    onRecall={handleRecallMessage}
                    onDelete={handleDeleteMessage}
                    onEnterMultiSelect={handleEnterMultiSelect}
                  />
                ) : (
                  <GroupChatMessages
                    loading={isLoading}
                    messages={groupMessages}
                    currentUserId={session.userId}
                    userRole={chatTarget.data.role}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedMessages={selectedMessages}
                    onToggleSelect={handleToggleSelect}
                    onRecall={handleRecallMessage}
                    onDelete={handleDeleteMessage}
                    onEnterMultiSelect={handleEnterMultiSelect}
                  />
                )}
              </div>

              {/* 输入区域 / 多选操作栏 */}
              <AnimatePresence mode="wait">
                {isMultiSelectMode ? (
                  <MultiSelectActionBar
                    key="multi-select-bar"
                    selectedCount={selectedMessages.size}
                    totalCount={totalMessageCount}
                    canBatchRecall={canBatchRecall}
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                    onBatchDelete={handleBatchDelete}
                    onBatchRecall={handleBatchRecall}
                    onCancel={handleExitMultiSelect}
                  />
                ) : (
                  <ChatInputArea
                    key="input-area"
                    messageInput={messageInput}
                    onMessageChange={setMessageInput}
                    onSendMessage={handleSendMessage}
                    onFileSelect={handleFileSelect}
                    isSending={isSending}
                    uploading={uploading}
                    uploadingFile={uploadingFile}
                    uploadProgress={progress}
                    onCancelUpload={() => {
                      setUploadingFile(null);
                      resetUpload();
                    }}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="chat-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="empty-content">
                <div className="empty-icon">💬</div>
                <h3>欢迎使用 Huanvae Chat</h3>
                <p>选择一个{getEmptyHint()}开始聊天</p>
                <div className="user-badge">
                  <span>{session.profile.user_nickname}</span>
                  <span className="divider">·</span>
                  <span className="server">{session.serverUrl}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* 弹窗组件 */}
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
      <AddModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onFriendAdded={refreshFriends}
        addGroup={addGroup}
        refreshGroups={refreshGroups}
      />
    </div>
  );
}
