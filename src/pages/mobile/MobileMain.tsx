/**
 * 移动端主页面入口
 *
 * 复用 useMainPage Hook，实现移动端专属的UI布局：
 * - 底部Tab栏（消息/通讯录）
 * - 顶部栏（头像+搜索）
 * - 抽屉侧边栏
 * - 聊天页面（右滑进入）
 * - 全屏页面（个人资料、我的文件、局域网传输、小程序、机器人、视频会议、设置）
 *
 * 移动端功能说明：
 * - 视频会议：使用全屏页面替代桌面端的多窗口，不支持屏幕共享
 *   - 支持最小化为悬浮窗，可在会议进行中查看其他页面和聊天
 * - 局域网传输：使用全屏页面，文件直接保存到公共 Download 目录
 *
 * 同步状态：
 * - 登录后自动同步所有会话的增量消息
 * - 在消息列表顶部显示同步进度横幅
 */

import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { useMainPage } from '../../hooks/useMainPage';
import { useInitialSync } from '../../hooks/useInitialSync';
import { useMobileNavigation } from '../../hooks/useMobileNavigation';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useChatStore } from '../../stores/chatStore';
import { requestNotificationPermission, initNotificationChannels } from '../../services/notificationService';
import { useAutoUpdateCheckAndroid } from '../../update/useSilentUpdate.android';

// 组件导入
import { MobileHeader } from './MobileHeader';
import { MobileTabBar } from './MobileTabBar';
import { MobileDrawer } from './MobileDrawer';
import { MobileChatList } from './MobileChatList';
import { MobileContacts } from './MobileContacts';
import { MobileChatView } from './MobileChatView';
import { MobileProfilePage } from './MobileProfilePage';
import { OtherProfileView } from '../../chat/shared/OtherProfileView';
import { GroupDetailView } from '../../chat/shared/GroupDetailView';
import { MobileFilesPage } from './MobileFilesPage';
import { MobileSettingsPage } from './MobileSettingsPage';
import { MobileLanTransferPage } from './MobileLanTransferPage';
import { MobileMiniAppsPage } from './MobileMiniAppsPage';
import { MobileBotsPage } from './MobileBotsPage';
import { MobileThemePage } from './MobileThemePage';
import { MobileAddPage } from './MobileAddPage';
import { SyncStatusBanner } from '../../components/common/SyncStatusBanner';
import { MobileMeetingEntryPage } from './MobileMeetingEntryPage';
import { MobileMeetingPage } from './MobileMeetingPage';
import { MeetingFloatingWindow } from './MeetingFloatingWindow';
import { MobileNfcTrustedCardsPage } from './MobileNfcTrustedCardsPage';
import { NfcTrustConfirmModal } from '../../nfc/NfcTrustConfirmModal';
import { NfcFeedbackToast } from '../../nfc/NfcFeedbackToast';
import { summarizeAction } from '../../nfc/parser';
import { useNfcGlobalScan } from '../../hooks/useNfcGlobalScan';
import { VoiceCallFloating } from '../../chat/ai/voice/VoiceCallFloating';
import '../../styles/voice-call.css';
import { useWebRTC } from '../../meeting/useWebRTC';
import { loadMeetingData, clearMeetingData, type IceServer } from '../../meeting/api';
import { useApi } from '../../contexts/SessionContext';
import { listPublishedMiniApps, listMyMiniApps, type MiniApp } from '../../api/miniapps';

// 导入移动端样式
import '../../styles/mobile/index.css';

import type { ChatTarget } from '../../types/chat';

export function MobileMain() {
  const page = useMainPage();
  const nav = useMobileNavigation();
  const { setActiveChat } = useWebSocket();
  const setChatTarget = useChatStore((state) => state.setChatTarget);

  // 页面状态（用独立页面替代弹窗）
  const [showProfilePage, setShowProfilePage] = useState(false);
  const [showFilesPage, setShowFilesPage] = useState(false);
  const [showLanTransferPage, setShowLanTransferPage] = useState(false);
  const [showMiniAppsPage, setShowMiniAppsPage] = useState(false);
  const [miniAppLaunching, setMiniAppLaunching] = useState<MiniApp | null>(null);
  const [showBotsPage, setShowBotsPage] = useState(false);
  const [showMeetingEntryPage, setShowMeetingEntryPage] = useState(false);
  const [showMeetingPage, setShowMeetingPage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showThemePage, setShowThemePage] = useState(false);
  const [showAddPage, setShowAddPage] = useState(false);
  const [showNfcTrustedCards, setShowNfcTrustedCards] = useState(false);

  // NFC executor 用：按 id 查找小程序（published 优先，fallback 到 mine）
  const api = useApi();
  const getMiniAppById = useCallback(
    async (id: string): Promise<MiniApp | null> => {
      try {
        const published = await listPublishedMiniApps(api);
        const hit = published.find((m) => m.miniapp_id === id);
        if (hit) { return hit; }
      } catch {
        // ignore 列表加载失败，继续 fallback
      }
      try {
        const mine = await listMyMiniApps(api);
        return mine.find((m) => m.miniapp_id === id) ?? null;
      } catch {
        return null;
      }
    },
    [api],
  );

  // 全局 NFC 监听 hook（仅 Android 启动 scan loop；桌面端零开销）
  // 任何页面贴卡都会触发：陌生卡弹 modal 二次确认，信任卡直接执行 + toast 反馈
  const nfc = useNfcGlobalScan({
    setMiniAppLaunching: (app) => {
      // 与 v1 同：打开 iframe 容器需要先 mount MobileMiniAppsPage
      setShowMiniAppsPage(true);
      setMiniAppLaunching(app);
    },
    getMiniAppById,
  });

  // 通讯录展开状态（上抬到此处，避免 MobileContacts 被 AnimatePresence 切换 unmount 时丢失）
  const [contactsFriendsExpanded, setContactsFriendsExpanded] = useState(false);
  const [contactsGroupsExpanded, setContactsGroupsExpanded] = useState(false);

  // 会议状态（提升到此层级以支持最小化时保持连接）
  const [meetingMinimized, setMeetingMinimized] = useState(false);
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingRoomName, setMeetingRoomName] = useState<string | undefined>();

  // WebRTC 实例（提升到 MobileMain 层级，最小化时保持连接）
  const webrtc = useWebRTC();

  // 登录后全量增量同步
  const { notification: syncNotification, clearNotification: _clearNotification, triggerSync } = useInitialSync({
    friendsLoaded: !page.friendsLoading && page.friends.length >= 0,
    groupsLoaded: !page.groupsLoading && page.groups.length >= 0,
  });

  // Android 应用启动时静默检查更新（弹窗在 App.tsx 统一渲染）
  useAutoUpdateCheckAndroid();

  // Android 启动时请求通知权限并初始化通知渠道
  useEffect(() => {
    async function initNotifications() {
      const granted = await requestNotificationPermission();
      console.warn('[MobileMain] 通知权限:', granted ? '已授权' : '未授权');

      // 权限获取后初始化通知渠道（设置自定义声音等）
      if (granted) {
        await initNotificationChannels();
      }
    }
    initNotifications();
  }, []);

  // 选中聊天目标时进入聊天页面
  const handleSelectTarget = (target: ChatTarget) => {
    page.handleSelectTarget(target);
    nav.enterChat();
  };

  // 返回列表页（通话中自动最小化而非退出）
  const handleBack = useCallback(() => {
    if (page.voiceCallState.isActive && page.chatTarget?.type === 'ai') {
      page.voiceMinimize();
    }
    setActiveChat(null, null);
    setChatTarget(null);
    nav.exitChat();
  }, [setActiveChat, setChatTarget, nav, page]);

  // 进入会议（初始化 WebRTC 连接）
  const handleEnterMeeting = useCallback(async () => {
    console.warn('[MobileMain] handleEnterMeeting 开始');
    const data = loadMeetingData();
    if (!data) {
      console.error('[MobileMain] 无法加载会议数据');
      return;
    }
    console.warn('[MobileMain] 会议数据:', data.roomId, data.roomName);

    setMeetingRoomName(data.roomName);
    setMeetingActive(true);
    setShowMeetingEntryPage(false);
    setShowMeetingPage(true);

    try {
      // 初始化本地媒体流
      console.warn('[MobileMain] 初始化本地媒体流...');
      const initResult = await webrtc.initLocalStream();
      console.warn('[MobileMain] 初始化结果:', initResult);

      // 获取 ICE 服务器配置
      const iceServers: IceServer[] = data.iceServers?.length
        ? data.iceServers
        : [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun1.l.google.com:19302'] },
        ];

      // 连接信令服务器
      console.warn('[MobileMain] 连接信令服务器:', data.serverUrl);
      webrtc.connect(data.roomId, data.token, iceServers, data.serverUrl);
      console.warn('[MobileMain] connect 调用完成');
    } catch (err) {
      console.error('[MobileMain] 会议初始化失败:', err);
    }
  }, [webrtc]);

  // 离开会议（断开连接并清理）
  const handleLeaveMeeting = useCallback(() => {
    webrtc.disconnect();
    webrtc.stopLocalStream();
    clearMeetingData();
    setMeetingActive(false);
    setMeetingMinimized(false);
    setShowMeetingPage(false);
    setMeetingRoomName(undefined);
  }, [webrtc]);

  // 监听会议邀请卡片触发的加入请求（移动端）
  const pendingMeetingJoin = useChatStore((s) => s.pendingMeetingJoin);
  useEffect(() => {
    if (pendingMeetingJoin) {
      useChatStore.getState().setPendingMeetingJoin(false);
      handleEnterMeeting();
    }
  }, [pendingMeetingJoin, handleEnterMeeting]);

  // 处理移动端手势返回
  const handleMobileBack = useCallback(() => {
    // 优先级 -1：全局搜索浮层打开（searchQuery 非空）→ 清空 query 关闭浮层
    // 优先级最高 — 搜索浮层是当前最显眼的临时状态，返回手势应优先关闭它
    if (page.searchQuery.trim() !== '') {
      page.setSearchQuery('');
      return true;
    }

    // 优先级 0：小程序 iframe 打开 → 关闭 iframe
    // （小程序与 Theme/Meeting 不会同时打开，无需视觉栈对比；仅保证 iframe 关闭优先于 list 关闭）
    if (miniAppLaunching) {
      setMiniAppLaunching(null);
      return true;
    }

    // 优先级 1：主题设置页面打开 → 关闭主题页面
    if (showThemePage) {
      setShowThemePage(false);
      return true;
    }

    // 优先级 2：设置面板打开 → 关闭设置
    if (showSettings) {
      setShowSettings(false);
      return true;
    }

    // 优先级 3：个人资料页面打开 → 关闭页面
    if (showProfilePage) {
      setShowProfilePage(false);
      return true;
    }

    // 优先级 4：我的文件页面打开 → 关闭页面
    if (showFilesPage) {
      setShowFilesPage(false);
      return true;
    }

    // 优先级 5：局域网互传页面打开 → 关闭页面
    if (showLanTransferPage) {
      setShowLanTransferPage(false);
      return true;
    }

    // 优先级 5b：小程序列表页打开 → 关闭页面
    if (showMiniAppsPage) {
      setShowMiniAppsPage(false);
      return true;
    }

    // 优先级 5c：机器人管理页打开 → 关闭页面
    if (showBotsPage) {
      setShowBotsPage(false);
      return true;
    }

    // 优先级 6：视频会议页面打开 → 最小化（而不是直接关闭）
    if (showMeetingPage && !meetingMinimized) {
      setMeetingMinimized(true);
      setShowMeetingPage(false);
      return true;
    }

    // 优先级 6b：已信任 NFC 卡列表 → 关闭
    // 注意：NFC 信任 modal 不在此处拦截 — modal 上有"取消"按钮，系统返回键不应误关
    if (showNfcTrustedCards) {
      setShowNfcTrustedCards(false);
      return true;
    }

    // 优先级 7：添加好友/群聊页面打开 → 关闭页面
    if (showAddPage) {
      setShowAddPage(false);
      return true;
    }

    // 优先级 8：会议入口页面打开 → 关闭页面
    if (showMeetingEntryPage) {
      setShowMeetingEntryPage(false);
      return true;
    }

    // 优先级 8：抽屉打开 → 关闭抽屉
    if (nav.isDrawerOpen) {
      nav.closeDrawer();
      return true;
    }

    // 优先级 9：在聊天页面 → 返回列表
    if (nav.currentView === 'chat') {
      // 使用 handleBack 来正确清除活跃聊天状态
      handleBack();
      return true;
    }

    // 未处理 → 执行默认行为（退出应用）
    return false;
  }, [page, miniAppLaunching, showThemePage, showSettings, showProfilePage, showFilesPage, showLanTransferPage, showMiniAppsPage, showBotsPage, showAddPage, showMeetingPage, showMeetingEntryPage, showNfcTrustedCards, meetingMinimized, nav, handleBack]);

  // 注册返回按钮处理
  useMobileBackHandler(handleMobileBack);

  // 计算未读消息总数
  const totalUnread =
    (page.unreadSummary?.friend_unreads?.reduce((sum: number, f) => sum + f.unread_count, 0) || 0) +
    (page.unreadSummary?.group_unreads?.reduce((sum: number, g) => sum + g.unread_count, 0) || 0);

  // Early return 检查
  if (!page.session) {
    return null;
  }

  return (
    <div className="mobile-main">
      {/* 更新提示弹窗已移至 App.tsx 统一渲染 */}

      {/* 抽屉侧边栏 */}
      <MobileDrawer
        isOpen={nav.isDrawerOpen}
        session={page.session}
        onClose={nav.closeDrawer}
        onProfileClick={() => {
          setShowProfilePage(true);
          nav.closeDrawer();
        }}
        onFilesClick={() => {
          setShowFilesPage(true);
          nav.closeDrawer();
        }}
        onLanTransferClick={() => {
          setShowLanTransferPage(true);
          nav.closeDrawer();
        }}
        onMiniAppsClick={() => {
          setShowMiniAppsPage(true);
          nav.closeDrawer();
        }}
        onBotsClick={() => {
          setShowBotsPage(true);
          nav.closeDrawer();
        }}
        onMeetingClick={() => {
          setShowMeetingEntryPage(true);
          nav.closeDrawer();
        }}
        onSettingsClick={() => setShowSettings(true)}
        onLogout={page.handleLogout}
      />

      {/* 主内容区域 - 使用 AnimatePresence 实现列表和聊天页面的滑动过渡 */}
      {/* 不使用 mode="wait"，让退出和进入动画同时进行，避免中间空白 */}
      <AnimatePresence initial={false}>
        {nav.currentView === 'list' ? (
          <motion.div
            key="list-view"
            className="mobile-list-container"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* 顶部栏 */}
            <MobileHeader
              session={page.session}
              searchQuery={page.searchQuery}
              onSearchChange={page.setSearchQuery}
              onAvatarClick={nav.openDrawer}
              onAddClick={() => setShowAddPage(true)}
              pendingCount={page.pendingNotificationCount}
            />

            {/* 同步状态横幅 */}
            {nav.activeTab === 'chat' && (
              <SyncStatusBanner
                notification={syncNotification}
                onRetry={triggerSync}
              />
            )}

            {/* 内容区域 - 支持左右滑动切换 */}
            <motion.div
              className="mobile-content"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
                const threshold = 50; // 滑动阈值
                const velocity = info.velocity.x;
                const offset = info.offset.x;

                // 快速滑动或滑动距离足够
                if (velocity < -300 || offset < -threshold) {
                  // 向左滑动 → 切换到通讯录
                  if (nav.activeTab === 'chat') {
                    nav.setActiveTab('contacts');
                  }
                } else if (velocity > 300 || offset > threshold) {
                  // 向右滑动 → 切换到消息
                  if (nav.activeTab === 'contacts') {
                    nav.setActiveTab('chat');
                  }
                }
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {nav.activeTab === 'chat' ? (
                  <motion.div
                    key="chat-list"
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -20, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ height: '100%' }}
                  >
                    <MobileChatList
                      friends={page.friends}
                      groups={page.groups}
                      searchQuery={page.searchQuery}
                      selectedTarget={page.chatTarget}
                      onSelectTarget={handleSelectTarget}
                      unreadSummary={page.unreadSummary}
                      aiConversationTitle={page.aiConversationTitle}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="contacts"
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 20, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ height: '100%' }}
                  >
                    <MobileContacts
                      friends={page.friends}
                      groups={page.groups}
                      searchQuery={page.searchQuery}
                      onSelectTarget={handleSelectTarget}
                      friendsExpanded={contactsFriendsExpanded}
                      groupsExpanded={contactsGroupsExpanded}
                      onToggleFriends={() => setContactsFriendsExpanded((v) => !v)}
                      onToggleGroups={() => setContactsGroupsExpanded((v) => !v)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* 底部Tab栏 */}
            <MobileTabBar
              activeTab={nav.activeTab}
              onTabChange={nav.setActiveTab}
              unreadCount={totalUnread}
            />
          </motion.div>
        ) : (
          /* 聊天页面 */
          page.chatTarget && (
            <MobileChatView
              key="chat-view"
              session={page.session}
              chatTarget={page.chatTarget}
              friendMessages={page.friendMessages}
              groupMessages={page.groupMessages}
              isLoading={page.isLoading}
              isSending={page.isSending}
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
          )
        )}
      </AnimatePresence>

      {/* 全屏页面组件 */}
      <AnimatePresence>
        {showProfilePage && (
          <MobileProfilePage onClose={() => setShowProfilePage(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFilesPage && (
          <MobileFilesPage onClose={() => setShowFilesPage(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLanTransferPage && (
          <MobileLanTransferPage onClose={() => setShowLanTransferPage(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMiniAppsPage && (
          <MobileMiniAppsPage
            launchingApp={miniAppLaunching}
            onLaunch={setMiniAppLaunching}
            onLaunchEnd={() => setMiniAppLaunching(null)}
            onClose={() => {
              setMiniAppLaunching(null);
              setShowMiniAppsPage(false);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBotsPage && (
          <MobileBotsPage
            onClose={() => setShowBotsPage(false)}
            onBotAdded={page.refreshFriends}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddPage && (
          <MobileAddPage
            onClose={() => setShowAddPage(false)}
            onFriendAdded={page.refreshFriends}
            addGroup={page.addGroup}
            pendingNotificationCount={page.pendingNotificationCount}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMeetingEntryPage && (
          <MobileMeetingEntryPage
            onClose={() => setShowMeetingEntryPage(false)}
            onEnterMeeting={handleEnterMeeting}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMeetingPage && !meetingMinimized && meetingActive && (
          <MobileMeetingPage
            webrtc={webrtc}
            roomName={meetingRoomName}
            onClose={handleLeaveMeeting}
            onMinimize={() => {
              setMeetingMinimized(true);
              setShowMeetingPage(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* 会议悬浮图标（最小化时显示） */}
      <AnimatePresence>
        {meetingMinimized && meetingActive && (
          <MeetingFloatingWindow
            roomName={meetingRoomName}
            participantCount={webrtc.participants.length + 1}
            onExpand={() => {
              setMeetingMinimized(false);
              setShowMeetingPage(true);
            }}
            onEnd={handleLeaveMeeting}
          />
        )}
      </AnimatePresence>

      {/* AI 语音通话浮窗（移动端圆形浮窗） */}
      <AnimatePresence>
        {page.voiceCallState.isActive && page.voiceCallState.isMinimized && (
          <VoiceCallFloating
            duration={page.voiceCallState.duration}
            onRestore={() => {
              page.voiceRestore();
              page.handleSelectTarget({ type: 'ai' });
              nav.enterChat();
            }}
            onDisconnect={page.voiceDisconnect}
          />
        )}
      </AnimatePresence>

      {/* 设置页面 */}
      <AnimatePresence>
        {showSettings && (
          <MobileSettingsPage
            onClose={() => setShowSettings(false)}
            onThemeClick={() => setShowThemePage(true)}
            onNfcTrustedCardsClick={() => {
              setShowSettings(false);
              setShowNfcTrustedCards(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* 主题设置页面 */}
      <AnimatePresence>
        {showThemePage && (
          <MobileThemePage onClose={() => setShowThemePage(false)} />
        )}
      </AnimatePresence>

      {/* 全局 NFC 信任确认 modal（任何页面贴陌生卡都会触发）
          AnimatePresence 触发 modal 内部 overlay/panel 的 exit 动画 */}
      <AnimatePresence>
        {nfc.pendingConfirm && (
          <NfcTrustConfirmModal
            uid={nfc.pendingConfirm.uid}
            payloadHash={nfc.pendingConfirm.payloadHash}
            actionSummary={summarizeAction(nfc.pendingConfirm.action)}
            onConfirm={nfc.onConfirmTrust}
            onCancel={nfc.onCancelTrust}
          />
        )}
      </AnimatePresence>

      {/* 全局 NFC 反馈 toast（成功/失败） */}
      <AnimatePresence>
        {nfc.feedback && (
          <NfcFeedbackToast
            variant={nfc.feedback.variant}
            message={nfc.feedback.message}
            toastKey={nfc.feedback.key}
            onDismiss={nfc.onDismissFeedback}
          />
        )}
      </AnimatePresence>

      {/* 已信任的 NFC 卡列表 */}
      <AnimatePresence>
        {showNfcTrustedCards && (
          <MobileNfcTrustedCardsPage onBack={() => setShowNfcTrustedCards(false)} />
        )}
      </AnimatePresence>

      {/* 他人公开资料页（移动整页，点头像进入只读资料） */}
      <OtherProfileView onOpenChat={handleSelectTarget} />

      {/* 群详情弹窗（点群名/群头像打开只读群详情） */}
      <GroupDetailView onOpenChat={handleSelectTarget} onRefreshGroups={page.refreshGroups} />
    </div>
  );
}
