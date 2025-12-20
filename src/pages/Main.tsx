/**
 * 主页面 - 登录后的主界面
 *
 * 类似微信的三栏布局：
 * - 左侧：侧边栏（头像 + 导航图标）
 * - 中间：会话列表（好友/群聊切换）
 * - 右侧：聊天窗口
 *
 * 状态管理已提取到 useMainPage Hook
 * 本组件仅负责组合布局和渲染 UI
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useMainPage } from '../hooks/useMainPage';

// 组件导入
import { Sidebar } from '../components/sidebar/Sidebar';
import { ConversationList } from '../components/conversations/ConversationList';
import { FriendList } from '../components/friends/FriendList';
import { GroupList } from '../components/groups/GroupList';
import { ChatPanel, EmptyChat } from '../components/chat/ChatPanel';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';

export function Main() {
  const page = useMainPage();

  // Early return 检查
  if (!page.session) {
    return null;
  }

  return (
    <div className="chat-app">
      <div className="chat-bg-orb orb-1" />
      <div className="chat-bg-orb orb-2" />

      {/* 左侧边栏 */}
      <Sidebar
        session={page.session}
        activeTab={page.activeTab}
        pendingNotificationCount={page.pendingNotificationCount}
        onTabChange={page.handleTabChange}
        onAvatarClick={() => page.setShowProfileModal(true)}
        onAddClick={() => page.setShowAddModal(true)}
        onLogout={page.handleLogout}
      />

      {/* 中间列表 + 分割线 */}
      <div
        className={`chat-list-container ${page.isResizing ? 'resizing' : ''}`}
        style={{ width: page.panelWidth }}
      >
        <AnimatePresence mode="wait">
          {page.activeTab === 'chat' && (
            <ConversationList
              key="conversation-list"
              friends={page.friends}
              groups={page.groups}
              friendsLoading={page.friendsLoading}
              groupsLoading={page.groupsLoading}
              friendsError={page.friendsError}
              groupsError={page.groupsError}
              searchQuery={page.searchQuery}
              onSearchChange={page.setSearchQuery}
              selectedTarget={page.chatTarget}
              onSelectTarget={page.handleSelectTarget}
              unreadSummary={page.unreadSummary}
              panelWidth={page.panelWidth}
            />
          )}
          {page.activeTab === 'friends' && (
            <FriendList
              key="friend-list"
              friends={page.friends}
              loading={page.friendsLoading}
              error={page.friendsError}
              searchQuery={page.searchQuery}
              onSearchChange={page.setSearchQuery}
              selectedFriendId={page.chatTarget?.type === 'friend' ? page.chatTarget.data.friend_id : null}
              onSelectFriend={page.handleSelectFriend}
              getUnreadCount={page.getFriendUnread}
              panelWidth={page.panelWidth}
            />
          )}
          {page.activeTab === 'group' && (
            <GroupList
              key="group-list"
              groups={page.groups}
              loading={page.groupsLoading}
              error={page.groupsError}
              searchQuery={page.searchQuery}
              onSearchChange={page.setSearchQuery}
              selectedGroupId={page.chatTarget?.type === 'group' ? page.chatTarget.data.group_id : null}
              onSelectGroup={page.handleSelectGroup}
              getUnreadCount={page.getGroupUnread}
              panelWidth={page.panelWidth}
            />
          )}
        </AnimatePresence>

        {/* 可拖拽分割线 */}
        <div
          className="panel-resizer"
          onMouseDown={page.handleResizeStart}
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
          {page.chatTarget ? (
            <ChatPanel
              session={page.session}
              chatTarget={page.chatTarget}
              friendMessages={page.friendMessages}
              groupMessages={page.groupMessages}
              isLoading={page.isLoading}
              isSending={page.isSending}
              totalMessageCount={page.totalMessageCount}
              messageInput={page.messageInput}
              onMessageChange={page.setMessageInput}
              onSendMessage={page.handleSendMessage}
              onFileSelect={page.handleFileSelect}
              uploading={page.uploading}
              uploadingFile={page.uploadingFile}
              uploadProgress={page.progress}
              onCancelUpload={page.handleCancelUpload}
              isMultiSelectMode={page.isMultiSelectMode}
              selectedMessages={page.selectedMessages}
              canBatchRecall={page.canBatchRecall}
              onToggleSelect={page.handleToggleSelect}
              onEnterMultiSelect={page.handleEnterMultiSelect}
              onExitMultiSelect={page.handleExitMultiSelect}
              onSelectAll={page.handleSelectAll}
              onDeselectAll={page.handleDeselectAll}
              onBatchDelete={page.handleBatchDelete}
              onBatchRecall={page.handleBatchRecall}
              onRecallMessage={page.handleRecallMessage}
              onDeleteMessage={page.handleDeleteMessage}
              onFriendRemoved={page.handleFriendRemoved}
              onGroupUpdated={page.handleGroupUpdated}
              onGroupLeft={page.handleGroupLeft}
            />
          ) : (
            <EmptyChat
              session={page.session}
              activeTab={page.activeTab}
            />
          )}
        </AnimatePresence>
      </motion.section>

      {/* 弹窗组件 */}
      <ProfileModal
        isOpen={page.showProfileModal}
        onClose={() => page.setShowProfileModal(false)}
      />
      <AddModal
        isOpen={page.showAddModal}
        onClose={() => page.setShowAddModal(false)}
        onFriendAdded={page.refreshFriends}
        addGroup={page.addGroup}
        refreshGroups={page.refreshGroups}
      />
    </div>
  );
}
