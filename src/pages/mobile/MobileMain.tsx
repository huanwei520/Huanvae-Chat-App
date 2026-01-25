/**
 * 移动端主页面入口
 *
 * 复用 useMainPage Hook，实现移动端专属的UI布局：
 * - 底部Tab栏（消息/通讯录）
 * - 顶部栏（头像+搜索）
 * - 抽屉侧边栏
 * - 聊天页面（右滑进入）
 * - 全屏页面（个人资料、我的文件、局域网传输、视频会议、设置）
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
import { requestNotificationPermission } from '../../services/notificationService';
import { useAutoUpdateCheckAndroid } from '../../update/useSilentUpdate.android';

// 组件导入
import { MobileHeader } from './MobileHeader';
import { MobileTabBar } from './MobileTabBar';
import { MobileDrawer } from './MobileDrawer';
import { MobileChatList } from './MobileChatList';
import { MobileContacts } from './MobileContacts';
import { MobileChatView } from './MobileChatView';
import { MobileProfilePage } from './MobileProfilePage';
import { MobileFilesPage } from './MobileFilesPage';
import { MobileSettingsPage } from './MobileSettingsPage';
import { MobileLanTransferPage } from './MobileLanTransferPage';
import { MobileMeetingEntryPage } from './MobileMeetingEntryPage';
import { MobileMeetingPage } from './MobileMeetingPage';
import { MeetingFloatingWindow } from './MeetingFloatingWindow';
import { useWebRTC } from '../../meeting/useWebRTC';
import { loadMeetingData, clearMeetingData, type IceServer } from '../../meeting/api';
// 注意：以下模块使用 WebviewWindow API，在移动端不可用，已移除导入
// import { ProfileModal } from '../../components/ProfileModal';
// import { FilesModal } from '../../components/files/FilesModal';
// import { MeetingEntryModal } from '../../meeting';
// import { openLanTransferWindow } from '../../lanTransfer';

// 导入移动端样式
import '../../styles/mobile/index.css';

import type { ChatTarget } from '../../types/chat';

export function MobileMain() {
  const page = useMainPage();
  const nav = useMobileNavigation();

  // 页面状态（用独立页面替代弹窗）
  const [showProfilePage, setShowProfilePage] = useState(false);
  const [showFilesPage, setShowFilesPage] = useState(false);
  const [showLanTransferPage, setShowLanTransferPage] = useState(false);
  const [showMeetingEntryPage, setShowMeetingEntryPage] = useState(false);
  const [showMeetingPage, setShowMeetingPage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // 会议状态（提升到此层级以支持最小化时保持连接）
  const [meetingMinimized, setMeetingMinimized] = useState(false);
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingRoomName, setMeetingRoomName] = useState<string | undefined>();

  // WebRTC 实例（提升到 MobileMain 层级，最小化时保持连接）
  const webrtc = useWebRTC();

  // 登录后全量增量同步
  const { status: syncStatus, triggerSync } = useInitialSync({
    friendsLoaded: !page.friendsLoading && page.friends.length >= 0,
    groupsLoaded: !page.groupsLoading && page.groups.length >= 0,
  });

  // Android 应用启动时静默检查更新（弹窗在 App.tsx 统一渲染）
  useAutoUpdateCheckAndroid();

  // Android 启动时请求通知权限
  useEffect(() => {
    requestNotificationPermission().then((granted) => {
      console.warn('[MobileMain] 通知权限:', granted ? '已授权' : '未授权');
    });
  }, []);

  // 选中聊天目标时进入聊天页面
  const handleSelectTarget = (target: ChatTarget) => {
    page.handleSelectTarget(target);
    nav.enterChat();
  };

  // 返回列表页
  const handleBack = () => {
    nav.exitChat();
  };

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

  // 处理移动端手势返回
  const handleMobileBack = useCallback(() => {
    // 优先级 1：设置面板打开 → 关闭设置
    if (showSettings) {
      setShowSettings(false);
      return true;
    }

    // 优先级 2：个人资料页面打开 → 关闭页面
    if (showProfilePage) {
      setShowProfilePage(false);
      return true;
    }

    // 优先级 3：我的文件页面打开 → 关闭页面
    if (showFilesPage) {
      setShowFilesPage(false);
      return true;
    }

    // 优先级 4：局域网互传页面打开 → 关闭页面
    if (showLanTransferPage) {
      setShowLanTransferPage(false);
      return true;
    }

    // 优先级 5：视频会议页面打开 → 最小化（而不是直接关闭）
    if (showMeetingPage && !meetingMinimized) {
      setMeetingMinimized(true);
      setShowMeetingPage(false);
      return true;
    }

    // 优先级 6：会议入口页面打开 → 关闭页面
    if (showMeetingEntryPage) {
      setShowMeetingEntryPage(false);
      return true;
    }

    // 优先级 7：抽屉打开 → 关闭抽屉
    if (nav.isDrawerOpen) {
      nav.closeDrawer();
      return true;
    }

    // 优先级 8：在聊天页面 → 返回列表
    if (nav.currentView === 'chat') {
      nav.exitChat();
      return true;
    }

    // 未处理 → 执行默认行为（退出应用）
    return false;
  }, [showSettings, showProfilePage, showFilesPage, showLanTransferPage, showMeetingPage, showMeetingEntryPage, meetingMinimized, nav]);

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
            />

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
                      syncStatus={syncStatus}
                      onSyncRetry={triggerSync}
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

      {/* 设置页面 */}
      <AnimatePresence>
        {showSettings && (
          <MobileSettingsPage onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
