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
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useFriends } from '../hooks/useFriends';
import { useGroups } from '../hooks/useGroups';
import { useMessages } from '../hooks/useMessages';
import { useGroupMessages } from '../hooks/useGroupMessages';
import { useResizablePanel } from '../hooks/useResizablePanel';

// API
import { deleteMessage, recallMessage } from '../api/messages';
import { deleteGroupMessage, recallGroupMessage } from '../api/groupMessages';

// 组件导入
import { Sidebar, type NavTab } from '../components/sidebar/Sidebar';
import { ConversationList } from '../components/conversations/ConversationList';
import { FriendList } from '../components/friends/FriendList';
import { GroupList } from '../components/groups/GroupList';
import { ChatMessages } from '../components/chat/ChatMessages';
import { GroupChatMessages } from '../components/chat/GroupChatMessages';
import { ChatMenuButton } from '../components/chat/ChatMenu';
import { MultiSelectActionBar } from '../components/chat/MultiSelectActionBar';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { SendIcon } from '../components/common/Icons';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';

import type { Friend, Group, ChatTarget } from '../types/chat';

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
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
  } = useWebSocket();
  const { friends, loading: friendsLoading, error: friendsError, refresh: refreshFriends } = useFriends();
  const { groups, loading: groupsLoading, error: groupsError, refresh: refreshGroups } = useGroups();

  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 多选模式状态
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

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

  // 退出多选模式时清空选中
  useEffect(() => {
    if (!isMultiSelectMode) {
      setSelectedMessages(new Set());
    }
  }, [isMultiSelectMode]);

  // 切换聊天对象时退出多选模式
  useEffect(() => {
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, [chatTarget]);

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

  // 订阅系统通知
  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      switch (msg.notification_type) {
        case 'friend_request_approved':
          refreshFriends();
          break;
        case 'group_join_approved':
          refreshGroups();
          break;
        case 'group_removed':
        case 'group_disbanded':
          refreshGroups();
          if (chatTarget?.type === 'group') {
            setChatTarget(null);
          }
          break;
      }
    });
    return unsubscribe;
  }, [chatTarget, onSystemNotification, refreshFriends, refreshGroups]);

  if (!session) {
    return null;
  }

  const handleLogout = () => {
    clearSession();
  };

  // 输入框引用
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整输入框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight / 5;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // 发送消息
  const handleSendMessage = useCallback(async () => {
    if (!messageInput.trim() || !chatTarget) return;

    const content = messageInput.trim();
    setMessageInput('');
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    if (chatTarget.type === 'friend') {
      await sendFriendMessage(content);
    } else {
      await sendGroupMessage(content);
    }
  }, [messageInput, chatTarget, sendFriendMessage, sendGroupMessage]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // ============================================
  // 消息操作回调
  // ============================================

  // 切换消息选中状态
  const handleToggleSelect = useCallback((messageUuid: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageUuid)) {
        next.delete(messageUuid);
      } else {
        next.add(messageUuid);
      }
      return next;
    });
  }, []);

  // 进入多选模式
  const handleEnterMultiSelect = useCallback(() => {
    setIsMultiSelectMode(true);
  }, []);

  // 退出多选模式
  const handleExitMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, []);

  // 全选
  const handleSelectAll = useCallback(() => {
    if (chatTarget?.type === 'friend') {
      setSelectedMessages(new Set(friendMessages.map((m) => m.message_uuid)));
    } else if (chatTarget?.type === 'group') {
      setSelectedMessages(new Set(groupMessages.map((m) => m.message_uuid)));
    }
  }, [chatTarget, friendMessages, groupMessages]);

  // 取消全选
  const handleDeselectAll = useCallback(() => {
    setSelectedMessages(new Set());
  }, []);

  // 撤回单条消息
  const handleRecallMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget) return;

    try {
      if (chatTarget.type === 'friend') {
        await recallMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await recallGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
    } catch (err) {
      console.error('撤回失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage]);

  // 删除单条消息
  const handleDeleteMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget) return;

    try {
      if (chatTarget.type === 'friend') {
        await deleteMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await deleteGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage]);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedMessages.size === 0) return;

    const uuids = Array.from(selectedMessages);
    
    for (const uuid of uuids) {
      await handleDeleteMessage(uuid);
    }
    
    handleExitMultiSelect();
  }, [selectedMessages, handleDeleteMessage, handleExitMultiSelect]);

  // 批量撤回
  const handleBatchRecall = useCallback(async () => {
    if (selectedMessages.size === 0) return;

    const uuids = Array.from(selectedMessages);
    
    for (const uuid of uuids) {
      await handleRecallMessage(uuid);
    }
    
    handleExitMultiSelect();
  }, [selectedMessages, handleRecallMessage, handleExitMultiSelect]);

  // ============================================
  // 选择处理
  // ============================================

  const handleSelectFriend = (friend: Friend) => {
    setChatTarget({ type: 'friend', data: friend });
  };

  const handleSelectGroup = (group: Group) => {
    setChatTarget({ type: 'group', data: group });
  };

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    setSearchQuery('');
  };

  // 获取当前聊天状态
  const isLoading = chatTarget?.type === 'friend' ? friendMessagesLoading : groupMessagesLoading;
  const isSending = chatTarget?.type === 'friend' ? friendSending : groupSending;

  // 当发送状态结束时，重新聚焦输入框
  useEffect(() => {
    if (!isSending && chatTarget && !isMultiSelectMode) {
      textareaRef.current?.focus();
    }
  }, [isSending, chatTarget, isMultiSelectMode]);

  // 获取聊天标题
  const getChatTitle = () => {
    if (!chatTarget) return '';
    return chatTarget.type === 'friend'
      ? chatTarget.data.friend_nickname
      : chatTarget.data.group_name;
  };

  const getChatSubtitle = () => {
    if (!chatTarget) return '';
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

  // 判断是否可以批量撤回（群主/管理员可以撤回任意消息）
  const canBatchRecall = chatTarget?.type === 'group' && 
    (chatTarget.data.role === 'owner' || chatTarget.data.role === 'admin');

  // 当前消息总数
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
              onSelectTarget={setChatTarget}
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
                    setChatTarget(null);
                    refreshFriends();
                  }}
                  onGroupUpdated={() => {}}
                  onGroupLeft={() => {
                    setChatTarget(null);
                  }}
                  isMultiSelectMode={isMultiSelectMode}
                  onToggleMultiSelect={() => setIsMultiSelectMode(!isMultiSelectMode)}
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
                  <motion.div
                    key="input-area"
                    className="chat-input-area"
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.8 }}
                  >
                    <div className="input-wrapper multiline">
                      <textarea
                        ref={textareaRef}
                        placeholder="输入消息... (Shift+Enter 换行)"
                        value={messageInput}
                        onChange={(e) => {
                          setMessageInput(e.target.value);
                          adjustTextareaHeight();
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={isSending}
                        rows={1}
                      />
                      <motion.button
                        className="send-btn"
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim() || isSending}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {isSending ? <LoadingSpinner /> : <SendIcon />}
                      </motion.button>
                    </div>
                  </motion.div>
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
      />
    </div>
  );
}
