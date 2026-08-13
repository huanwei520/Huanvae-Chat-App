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
 *
 * 弹窗组件：个人资料、添加好友/群聊、文件管理、会议入口、小程序管理
 *
 * 同步状态：
 * - 登录后自动同步所有会话的增量消息
 * - 在消息列表顶部显示同步进度横幅
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMainPage } from '../hooks/useMainPage';
import { useInitialSync } from '../hooks/useInitialSync';
import { useAutoUpdateCheck } from '../update/useSilentUpdate';
// Meeting share event payload (camelCase, from MeetingPage emit)
interface ShareMeetingEvent {
  roomId: string;
  password: string;
  roomName: string;
  creatorName: string;
  creatorAvatar: string;
}

// 组件导入
import { Sidebar } from '../components/sidebar/Sidebar';
import { UnifiedList } from '../components/unified/UnifiedList';
import { GlobalMessageSearchResults } from '../components/search/GlobalMessageSearchResults';
import { useChatStore, useProfileViewStore, useGroupDetailStore } from '../stores';
import { parseFriendIdFromConversationId } from '../utils/conversationId';
import { friendChatTarget } from '../utils/chatTarget';
import type { Friend, Group } from '../types/chat';
import { ChatPanel, EmptyChat } from '../chat';
import { OtherProfileView } from '../chat/shared/OtherProfileView';
import { GroupDetailView } from '../chat/shared/GroupDetailView';
import { FilesModal } from '../components/files/FilesModal';
import { ProfileModal } from '../components/ProfileModal';
import { MeetingEntryModal } from '../meeting';
import { MiniAppsModal } from '../components/miniapps/MiniAppsModal';
import { BotsModal } from '../components/bots/BotsModal';
import { SettingsPanel } from '../components/settings';
import { openLanTransferWindow } from '../lanTransfer';
import { openLowcodeWindow } from '../lowcode';
import { openHuanvaeGuardWindow } from '../huanvaeGuard';
import { openStocksWindow } from '../stocks';
import { VoiceCallFloating } from '../chat/ai/voice/VoiceCallFloating';
import { ShareMeetingModal } from '../meeting/components/ShareMeetingModal';
import '../styles/miniapps.css';
import '../styles/voice-call.css';

export function Main() {
  const page = useMainPage();
  const openProfile = useProfileViewStore((s) => s.open);
  const openGroupDetail = useGroupDetailStore((s) => s.open);
  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showMiniAppsModal, setShowMiniAppsModal] = useState(false);
  const [showBotsModal, setShowBotsModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [shareMeetingData, setShareMeetingData] = useState<ShareMeetingEvent | null>(null);

  // 监听会议窗口的分享事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<ShareMeetingEvent>('share-meeting-to-chat', (event) => {
        setShareMeetingData(event.payload);
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {
      // 非 Tauri 环境（浏览器开发模式）忽略
    });
    return () => { unlisten?.(); };
  }, []);

  const handleShareMeetingClose = useCallback(() => {
    setShareMeetingData(null);
  }, []);

  // 打开局域网传输独立窗口
  const handleLanTransferClick = () => {
    if (page.session) {
      openLanTransferWindow(
        page.session.userId,
        page.session.profile?.user_nickname || page.session.userId,
      );
    }
  };

  // 打开低代码编辑器独立窗口
  const handleLowcodeClick = () => {
    if (page.session) {
      openLowcodeWindow(
        page.session.userId,
        page.session.serverUrl,
        page.session.accessToken,
        page.session.refreshToken,
      );
    }
  };

  // 打开 HuanvaeGuard VPN 窗口
  const handleHuanvaeGuardClick = () => {
    if (page.session) {
      void openHuanvaeGuardWindow(
        page.session.userId,
        page.session.serverUrl,
        page.session.accessToken,
        page.session.refreshToken,
      );
    }
  };

  // 打开股票研究窗口
  const handleStocksClick = () => {
    if (page.session) {
      void openStocksWindow(
        page.session.userId,
        page.session.serverUrl,
        page.session.accessToken,
        page.session.refreshToken,
      );
    }
  };

  // 登录后全量增量同步（等待好友和群聊列表加载完成）
  const { notification: syncNotification, clearNotification, triggerSync } = useInitialSync({
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
        isSettingsOpen={showSettingsPanel}
        onTabChange={(tab) => {
          setShowSettingsPanel(false);
          page.handleTabChange(tab);
        }}
        onAvatarClick={() => page.setShowProfileModal(true)}
        onFilesClick={() => setShowFilesModal(true)}
        onLanTransferClick={handleLanTransferClick}
        onMeetingClick={() => setShowMeetingModal(true)}
        onMiniAppsClick={() => setShowMiniAppsModal(true)}
        onBotsClick={() => setShowBotsModal(true)}
        onLowcodeClick={handleLowcodeClick}
        onHuanvaeGuardClick={handleHuanvaeGuardClick}
        onStocksClick={handleStocksClick}
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
              aiConversationTitle={page.aiConversationTitle}
              syncNotification={syncNotification}
              onSyncDismiss={clearNotification}
              onSyncRetry={triggerSync}
              addGroup={page.addGroup}
              refreshGroups={page.refreshGroups}
              refreshFriends={page.refreshFriends}
              pendingNotificationCount={page.pendingNotificationCount}
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
              totalMessageCount={page.totalMessageCount}
              hasMore={page.hasMore}
              loadingMore={page.loadingMore}
              onLoadMore={page.handleLoadMore}
              onJumpToLatest={page.handleJumpToLatest}
              isWindowed={page.isWindowed}
              onLoadNewer={page.handleLoadNewer}
              hasNewer={page.hasNewer}
              messageInput={page.messageInput}
              onMessageChange={page.setMessageInput}
              onSendMessage={page.handleSendMessage}
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
              aiMessages={page.aiMessages}
              aiStreamingContent={page.aiStreamingContent}
              aiStreamingReasoning={page.aiStreamingReasoning}
              aiIsLoading={page.aiIsLoading}
              aiToolStatus={page.aiToolStatus}
              aiPendingToolCall={page.aiPendingToolCall}
              aiRetryLastMessage={page.aiRetryLastMessage}
              onAIConfirmToolCall={page.aiConfirmToolCall}
              onAIRejectToolCall={page.aiRejectToolCall}
              voiceCallState={page.voiceCallState}
              voiceCallTurns={page.voiceCallTurns}
              onVoiceStartCall={page.voiceStartCall}
              onVoiceDisconnect={page.voiceDisconnect}
              onVoiceToggleMute={page.voiceToggleMute}
              voiceProfiles={page.voiceProfiles}
              voiceProfilesLoading={page.voiceProfilesLoading}
              voiceProfilesUploading={page.voiceProfilesUploading}
              voiceProfilesError={page.voiceProfilesError}
              selectedVoiceProfileId={page.selectedVoiceProfileId}
              onVoiceProfileUpload={page.voiceProfileUpload}
              onVoiceProfileSetDefault={page.voiceProfileSetDefault}
              onVoiceProfileDelete={page.voiceProfileDelete}
              onVoiceProfileSelect={page.voiceProfileSelect}
              onVoiceProfileUpdatePrompt={page.voiceProfileUpdatePrompt}
              aiConversations={page.aiConversations}
              aiConversationsLoading={page.aiConversationsLoading}
              aiConversationId={page.aiConversationId}
              onAILoadConversations={page.aiLoadConversations}
              onAISwitchConversation={page.aiSwitchConversation}
              onAIDeleteConversation={page.aiDeleteConversation}
              onAINewConversation={page.aiNewConversation}
            />
          ) : (
            <EmptyChat
              session={page.session}
              activeTab={page.activeTab}
            />
          )}
        </AnimatePresence>
      </motion.section>

      {/* 全局搜索：backdrop 淡入淡出 + 浮层从搜索框左上角缩放展开/收回 */}
      <AnimatePresence>
        {page.searchQuery.trim() !== '' && (
          <motion.div
            key="search-backdrop"
            className="search-overlay-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => page.setSearchQuery('')}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {page.searchQuery.trim() !== '' && (
          <GlobalMessageSearchResults
            key="search-overlay"
            query={page.searchQuery}
            friends={page.friends}
            groups={page.groups}
            currentUserId={page.session?.userId}
            layout="desktop"
            onSelectDiscoveryPerson={(userId) => openProfile(userId)}
            onSelectDiscoveryBot={(botUserId, username) => openProfile(botUserId, { botUsername: username })}
            onSelectDiscoveryGroup={(groupId) => openGroupDetail(groupId)}
            onSelectConversation={(type, data) => {
              if (type === 'friend') {
                page.handleSelectTarget(friendChatTarget(data as Friend));
              } else {
                page.handleSelectTarget({ type: 'group', data: data as Group });
              }
            }}
            onSelectMessage={(grp, hit) => {
              // 仅在找到目标会话时切换并设置跳转 — 避免残留 pending scroll id
              if (grp.conversationType === 'friend' && page.session) {
                const friendId = parseFriendIdFromConversationId(
                  grp.conversationId,
                  page.session.userId,
                );
                const friendData = friendId
                  ? page.friends.find((f) => f.friend_id === friendId)
                  : undefined;
                if (friendData) {
                  page.handleSelectTarget(friendChatTarget(friendData));
                  setPendingScrollToMessageId(hit.message.message_uuid);
                }
              } else if (grp.conversationType === 'group') {
                const groupData = page.groups.find(
                  (g) => g.group_id === grp.conversationId,
                );
                if (groupData) {
                  page.handleSelectTarget({ type: 'group', data: groupData });
                  setPendingScrollToMessageId(hit.message.message_uuid);
                }
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* AI 语音通话浮窗（桌面端通话条） */}
      <AnimatePresence>
        {page.voiceCallState.isActive && page.voiceCallState.isMinimized && (
          <VoiceCallFloating
            duration={page.voiceCallState.duration}
            onRestore={() => {
              page.voiceRestore();
              page.handleSelectTarget({ type: 'ai' });
            }}
            onDisconnect={page.voiceDisconnect}
          />
        )}
      </AnimatePresence>

      {/* 他人公开资料页（右侧抽屉，点头像打开只读资料） */}
      <OtherProfileView onOpenChat={page.handleSelectTarget} />

      {/* 群详情弹窗（点群名/群头像打开只读群详情） */}
      <GroupDetailView onOpenChat={page.handleSelectTarget} onRefreshGroups={page.refreshGroups} />

      {/* 弹窗组件 */}
      <ProfileModal
        isOpen={page.showProfileModal}
        onClose={() => page.setShowProfileModal(false)}
      />
      <FilesModal
        isOpen={showFilesModal}
        onClose={() => setShowFilesModal(false)}
      />
      <MeetingEntryModal
        isOpen={showMeetingModal}
        onClose={() => setShowMeetingModal(false)}
      />
      <MiniAppsModal
        isOpen={showMiniAppsModal}
        onClose={() => setShowMiniAppsModal(false)}
      />
      <BotsModal
        isOpen={showBotsModal}
        onClose={() => setShowBotsModal(false)}
        onBotAdded={page.refreshFriends}
      />
      {shareMeetingData && (
        <ShareMeetingModal
          isOpen={!!shareMeetingData}
          onClose={handleShareMeetingClose}
          meetingData={shareMeetingData}
        />
      )}
    </div>
  );
}
