/**
 * 主页面 - 登录后的主界面
 *
 * 类似微信的三栏布局：
 * - 左侧：侧边栏（头像 + 导航图标）
 * - 中间：会话列表（好友/群聊切换）
 * - 右侧：聊天窗口
 *
 * WebSocket 实时功能：
 * - 未读消息计数
 * - 新消息实时推送
 * - 标记已读
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useFriends } from '../hooks/useFriends';
import { useGroups } from '../hooks/useGroups';
import { useMessages } from '../hooks/useMessages';
import { useGroupMessages } from '../hooks/useGroupMessages';

// 组件导入
import { Sidebar, type NavTab } from '../components/sidebar/Sidebar';
import { ConversationList } from '../components/conversations/ConversationList';
import { FriendList } from '../components/friends/FriendList';
import { GroupList } from '../components/groups/GroupList';
import { ChatMessages } from '../components/chat/ChatMessages';
import { GroupChatMessages } from '../components/chat/GroupChatMessages';
import { ChatMenuButton } from '../components/chat/ChatMenu';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { SendIcon } from '../components/common/Icons';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';

import type { Friend, Group, ChatTarget } from '../types/chat';

// ============================================
// 主组件
// ============================================

export function Main() {
  const { session, clearSession } = useSession();
  const {
    markRead,
    getFriendUnread,
    getGroupUnread,
    unreadSummary,
    onNewMessage,
    onSystemNotification,
  } = useWebSocket();
  const { friends, loading: friendsLoading, error: friendsError, refresh: refreshFriends } = useFriends();
  const { groups, loading: groupsLoading, error: groupsError, refresh: refreshGroups } = useGroups();

  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // 私聊消息
  const friendId = chatTarget?.type === 'friend' ? chatTarget.data.friend_id : null;
  const {
    messages: friendMessages,
    loading: friendMessagesLoading,
    sending: friendSending,
    sendTextMessage: sendFriendMessage,
    loadMessages: loadFriendMessages,
  } = useMessages(friendId);

  // 群聊消息
  const groupId = chatTarget?.type === 'group' ? chatTarget.data.group_id : null;
  const {
    messages: groupMessages,
    loading: groupMessagesLoading,
    sending: groupSending,
    sendTextMessage: sendGroupMessage,
    loadMessages: loadGroupMessages,
  } = useGroupMessages(groupId);

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
      // 如果正在查看这个会话，自动刷新消息并标记已读
      if (chatTarget) {
        if (
          (chatTarget.type === 'friend' && msg.source_type === 'friend' && msg.source_id === chatTarget.data.friend_id) ||
          (chatTarget.type === 'group' && msg.source_type === 'group' && msg.source_id === chatTarget.data.group_id)
        ) {
          if (msg.source_type === 'friend') {
            loadFriendMessages();
          } else {
            loadGroupMessages();
          }
          markRead(msg.source_type, msg.source_id);
        }
      }
    });
    return unsubscribe;
  }, [chatTarget, loadFriendMessages, loadGroupMessages, markRead, onNewMessage]);

  // 订阅系统通知（好友请求、群邀请等）
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
          // 如果当前正在查看被解散/移除的群
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

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !chatTarget) { return; }

    try {
      if (chatTarget.type === 'friend') {
        await sendFriendMessage(messageInput);
      } else {
        await sendGroupMessage(messageInput);
      }
      setMessageInput('');
    } catch {
      // 错误已在 hook 中处理
    }
  };

  const handleSelectFriend = (friend: Friend) => {
    setChatTarget({ type: 'friend', data: friend });
  };

  const handleSelectGroup = (group: Group) => {
    setChatTarget({ type: 'group', data: group });
  };

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    setSearchQuery(''); // 切换标签时清空搜索
  };

  // 获取当前聊天状态
  const isLoading = chatTarget?.type === 'friend' ? friendMessagesLoading : groupMessagesLoading;
  const isSending = chatTarget?.type === 'friend' ? friendSending : groupSending;

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

      {/* 中间列表 */}
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
          />
        )}
      </AnimatePresence>

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
                  onGroupUpdated={() => {
                    // 刷新群聊列表
                  }}
                  onGroupLeft={() => {
                    setChatTarget(null);
                  }}
                />
              </div>

              <div className="chat-messages">
                {chatTarget.type === 'friend' ? (
                  <ChatMessages
                    loading={isLoading}
                    messages={friendMessages}
                    session={session}
                    friend={chatTarget.data}
                  />
                ) : (
                  <GroupChatMessages
                    loading={isLoading}
                    messages={groupMessages}
                    currentUserId={session.userId}
                  />
                )}
              </div>

              <div className="chat-input-area">
                <div className="input-wrapper">
                  <input
                    type="text"
                    placeholder="输入消息..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    disabled={isSending}
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
              </div>
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
