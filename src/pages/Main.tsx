/**
 * 主页面 - 登录后的主界面
 *
 * 类似微信的三栏布局：
 * - 左侧：侧边栏（头像 + 导航图标）
 * - 中间：统一列表（通过 tab 切换显示不同数据）
 * - 右侧：聊天窗口
 *
 * 使用 UnifiedList 组件实现单卡片级别的动画效果
 * 切换 tab 时旧卡片飞出、新卡片飞入
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMainPage } from '../hooks/useMainPage';
import { useInitialSync } from '../hooks/useInitialSync';
import { useAutoUpdateCheck } from '../update/useSilentUpdate';

// 组件导入
import { Sidebar } from '../components/sidebar/Sidebar';
import { UnifiedList } from '../components/unified/UnifiedList';
import { ChatPanel, EmptyChat } from '../chat';
import { FilesModal } from '../components/files/FilesModal';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';
import { MeetingEntryModal } from '../meeting';
import { SettingsPanel } from '../components/settings';
import { openLanTransferWindow } from '../lanTransfer';

export function Main() {
  const page = useMainPage();
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  // 打开局域网传输独立窗口
  const handleLanTransferClick = () => {
    if (page.session) {
      openLanTransferWindow(
        page.session.userId,
        page.session.profile?.user_nickname || page.session.userId,
      );
    }
  };

  // 登录后全量增量同步（等待好友和群聊列表加载完成）
  useInitialSync({
    friendsLoaded: !page.friendsLoading && page.friends.length >= 0,
    groupsLoaded: !page.groupsLoading && page.groups.length >= 0,
  });

  // 应用启动时静默检查更新（弹窗在 App.tsx 统一渲染）
  useAutoUpdateCheck();

  // Early return 检查
  if (!page.session) {
    return null;
  }

  return (
    <div className="chat-app">
      <div className="chat-bg-orb orb-1" />
      <div className="chat-bg-orb orb-2" />

      {/* 更新提示弹窗已移至 App.tsx 统一渲染 */}

      {/* 左侧边栏 */}
      <Sidebar
        session={page.session}
        activeTab={page.activeTab}
        pendingNotificationCount={page.pendingNotificationCount}
        isSettingsOpen={showSettingsPanel}
        onTabChange={(tab) => {
          setShowSettingsPanel(false);
          page.handleTabChange(tab);
        }}
        onAvatarClick={() => page.setShowProfileModal(true)}
        onAddClick={() => page.setShowAddModal(true)}
        onFilesClick={() => setShowFilesModal(true)}
        onLanTransferClick={handleLanTransferClick}
        onMeetingClick={() => setShowMeetingModal(true)}
        onSettingsClick={() => setShowSettingsPanel(true)}
        onLogout={page.handleLogout}
      />

      {/* 中间列表 / 设置面板 + 分割线 */}
      <div
        className={`chat-list-container ${page.isResizing ? 'resizing' : ''}`}
        style={{ width: page.panelWidth }}
      >
        <AnimatePresence mode="wait">
          {showSettingsPanel ? (
            <SettingsPanel
              key="settings"
              onClose={() => setShowSettingsPanel(false)}
            />
          ) : (
            <UnifiedList
              key="list"
              activeTab={page.activeTab}
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
              hasMore={page.hasMore}
              loadingMore={page.loadingMore}
              onLoadMore={page.handleLoadMore}
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
              onHistoryLoaded={page.handleHistoryLoaded}
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
      <FilesModal
        isOpen={showFilesModal}
        onClose={() => setShowFilesModal(false)}
      />
      <MeetingEntryModal
        isOpen={showMeetingModal}
        onClose={() => setShowMeetingModal(false)}
      />
    </div>
  );
}
