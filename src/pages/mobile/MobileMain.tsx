/**
 * 移动端主页面入口
 *
 * 复用 useMainPage Hook，实现移动端专属的UI布局：
 * - 底部Tab栏（消息/通讯录）
 * - 顶部栏（头像+搜索）
 * - 抽屉侧边栏
 * - 聊天页面（右滑进入）
 *
 * 注意：移动端不支持以下桌面端功能（使用 WebviewWindow 多窗口）：
 * - 视频会议（MeetingEntryModal）
 * - 局域网传输（openLanTransferWindow）
 * 这些功能在抽屉菜单中已隐藏
 */

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMainPage } from '../../hooks/useMainPage';
import { useInitialSync } from '../../hooks/useInitialSync';
import { useMobileNavigation } from '../../hooks/useMobileNavigation';

// 组件导入
import { MobileHeader } from './MobileHeader';
import { MobileTabBar } from './MobileTabBar';
import { MobileDrawer } from './MobileDrawer';
import { MobileChatList } from './MobileChatList';
import { MobileContacts } from './MobileContacts';
import { MobileChatView } from './MobileChatView';
import { ProfileModal } from '../../components/ProfileModal';
import { SettingsPanel } from '../../components/settings';
// 注意：以下模块使用 WebviewWindow API，在移动端不可用，已移除导入
// import { FilesModal } from '../../components/files/FilesModal';
// import { MeetingEntryModal } from '../../meeting';
// import { openLanTransferWindow } from '../../lanTransfer';

// 导入移动端样式
import '../../styles/mobile/index.css';

import type { ChatTarget } from '../../types/chat';

export function MobileMain() {
  const page = useMainPage();
  const nav = useMobileNavigation();

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 注意：FilesModal 和 MeetingEntryModal 在移动端不可用（使用 WebviewWindow）

  // 登录后全量增量同步
  useInitialSync({
    friendsLoaded: !page.friendsLoading && page.friends.length >= 0,
    groupsLoaded: !page.groupsLoading && page.groups.length >= 0,
  });

  // 选中聊天目标时进入聊天页面
  const handleSelectTarget = (target: ChatTarget) => {
    page.handleSelectTarget(target);
    nav.enterChat();
  };

  // 返回列表页
  const handleBack = () => {
    nav.exitChat();
  };

  // 计算未读消息总数
  const totalUnread =
    (page.unreadSummary?.friends?.reduce((sum, f) => sum + f.unread_count, 0) || 0) +
    (page.unreadSummary?.groups?.reduce((sum, g) => sum + g.unread_count, 0) || 0);

  // Early return 检查
  if (!page.session) {
    return null;
  }

  return (
    <div className="mobile-main">
      {/* 抽屉侧边栏 */}
      <MobileDrawer
        isOpen={nav.isDrawerOpen}
        session={page.session}
        onClose={nav.closeDrawer}
        onProfileClick={() => {
          setShowProfileModal(true);
          nav.closeDrawer();
        }}
        onSettingsClick={() => setShowSettings(true)}
        onLogout={page.handleLogout}
      />

      {/* 主内容区域 */}
      {nav.currentView === 'list' ? (
        <>
          {/* 顶部栏 */}
          <MobileHeader
            session={page.session}
            searchQuery={page.searchQuery}
            onSearchChange={page.setSearchQuery}
            onAvatarClick={nav.openDrawer}
          />

          {/* 内容区域 */}
          <div className="mobile-content">
            <AnimatePresence mode="wait">
              {nav.activeTab === 'chat' ? (
                <MobileChatList
                  key="chat-list"
                  friends={page.friends}
                  groups={page.groups}
                  searchQuery={page.searchQuery}
                  selectedTarget={page.chatTarget}
                  onSelectTarget={handleSelectTarget}
                  unreadSummary={page.unreadSummary}
                />
              ) : (
                <MobileContacts
                  key="contacts"
                  friends={page.friends}
                  groups={page.groups}
                  searchQuery={page.searchQuery}
                  onSelectTarget={handleSelectTarget}
                />
              )}
            </AnimatePresence>
          </div>

          {/* 底部Tab栏 */}
          <MobileTabBar
            activeTab={nav.activeTab}
            onTabChange={nav.setActiveTab}
            unreadCount={totalUnread}
          />
        </>
      ) : (
        /* 聊天页面 */
        <AnimatePresence mode="wait">
          {page.chatTarget && (
            <MobileChatView
              key="chat-view"
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
              onBack={handleBack}
            />
          )}
        </AnimatePresence>
      )}

      {/* 弹窗组件 */}
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
      {/* 注意：FilesModal 和 MeetingEntryModal 使用 WebviewWindow，在移动端不可用 */}

      {/* 设置面板（全屏显示） */}
      <AnimatePresence>
        {showSettings && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 200,
              background: 'var(--bg-primary)',
            }}
          >
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
