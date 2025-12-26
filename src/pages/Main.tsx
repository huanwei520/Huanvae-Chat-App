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

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMainPage } from '../hooks/useMainPage';
import { useInitialSync } from '../hooks/useInitialSync';
import {
  checkForUpdates,
  downloadAndInstall,
  restartApp,
  formatSize,
  type UpdateInfo,
  type DownloadProgress,
} from '../services/updateService';

// 组件导入
import { Sidebar } from '../components/sidebar/Sidebar';
import { UnifiedList } from '../components/unified/UnifiedList';
import { ChatPanel, EmptyChat } from '../chat';
import { FilesModal } from '../components/files/FilesModal';
import { ProfileModal } from '../components/ProfileModal';
import { AddModal } from '../components/AddModal';
import { MeetingEntryModal } from '../meeting';

export function Main() {
  const page = useMainPage();
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);

  // 登录后全量增量同步（等待好友和群聊列表加载完成）
  const { status: syncStatus } = useInitialSync({
    friendsLoaded: !page.friendsLoading && page.friends.length >= 0,
    groupsLoaded: !page.groupsLoading && page.groups.length >= 0,
  });

  // 同步状态日志（开发时查看）
  useEffect(() => {
    if (syncStatus.syncing) {
      console.log('[Main] 正在同步消息...', {
        进度: `${syncStatus.progress}%`,
        总会话: syncStatus.totalConversations,
      });
    } else if (syncStatus.lastSyncTime) {
      console.log('[Main] 消息同步完成', {
        更新会话数: syncStatus.syncedConversations,
        新消息数: syncStatus.newMessagesCount,
      });
    }
  }, [syncStatus]);

  // 更新相关状态
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<DownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // 应用启动时检查更新
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const info = await checkForUpdates();
        if (info.available) {
          setUpdateInfo(info);
          setShowUpdateModal(true);
        }
      } catch (err) {
        console.error('[更新] 检查更新失败:', err);
      }
    };

    // 延迟 2 秒检查更新，避免影响启动体验
    const timer = setTimeout(checkUpdate, 2000);
    return () => clearTimeout(timer);
  }, []);

  // 处理更新
  const handleUpdate = async () => {
    if (!updateInfo?.update) {
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);

    try {
      await downloadAndInstall(updateInfo.update, (progress) => {
        setUpdateProgress(progress);
      });

      // 下载完成，重启应用
      await restartApp();
    } catch (err) {
      console.error('[更新] 更新失败:', err);
      setUpdateError(err instanceof Error ? err.message : String(err));
      setIsUpdating(false);
    }
  };

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
        onFilesClick={() => setShowFilesModal(true)}
        onMeetingClick={() => setShowMeetingModal(true)}
        onLogout={page.handleLogout}
      />

      {/* 中间列表 + 分割线 */}
      <div
        className={`chat-list-container ${page.isResizing ? 'resizing' : ''}`}
        style={{ width: page.panelWidth }}
      >
        {/* 统一列表：通过 activeTab 切换数据，单卡片级别动画 */}
        <UnifiedList
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

      {/* 更新提示模态框 */}
      <AnimatePresence>
        {showUpdateModal && updateInfo && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isUpdating && setShowUpdateModal(false)}
          >
            <motion.div
              className="glass-card update-modal"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="update-modal-header">
                <span className="update-icon">🎉</span>
                <h3>发现新版本</h3>
              </div>

              <div className="update-modal-body">
                <p className="update-version">
                  v{updateInfo.version} 可用
                </p>
                {updateInfo.notes && (
                  <p className="update-notes">{updateInfo.notes}</p>
                )}

                {/* 下载进度 */}
                {isUpdating && updateProgress && (
                  <div className="update-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${updateProgress.percent || 0}%` }}
                      />
                    </div>
                    <p className="progress-text">
                      {updateProgress.event === 'Started' && '准备下载...'}
                      {updateProgress.event === 'Progress' && (
                        <>
                          下载中 {updateProgress.percent}%
                          {updateProgress.downloaded && updateProgress.contentLength && (
                            <span className="progress-size">
                              {' '}({formatSize(updateProgress.downloaded)} / {formatSize(updateProgress.contentLength)})
                            </span>
                          )}
                        </>
                      )}
                      {updateProgress.event === 'Finished' && '下载完成，正在安装...'}
                    </p>
                  </div>
                )}

                {/* 错误提示 */}
                {updateError && (
                  <p className="update-error">更新失败: {updateError}</p>
                )}
              </div>

              <div className="update-modal-footer">
                {!isUpdating && (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowUpdateModal(false)}
                    >
                      稍后提醒
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleUpdate}
                    >
                      立即更新
                    </button>
                  </>
                )}
                {isUpdating && !updateError && (
                  <p className="updating-hint">更新中，请勿关闭应用...</p>
                )}
                {updateError && (
                  <button
                    className="btn-primary"
                    onClick={handleUpdate}
                  >
                    重试
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
