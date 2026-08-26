/**
 * 移动端聊天页面
 *
 * 全屏显示，包含：
 * - 顶部：返回按钮 + 居中标题 + 菜单按钮
 * - 中间：消息列表（复用 ChatMessages/GroupChatMessages）
 * - 底部：输入区域（复用 ChatInputArea）
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Session } from '../../types/session';
import type { ChatTarget, Message, AIConversation } from '../../types/chat';
import type { GroupMessage } from '../../api/groupMessages';

import { ChatMessages } from '../../chat/friend/ChatMessages';
import { GroupChatMessages } from '../../chat/group/GroupChatMessages';
import { AIChatMessages } from '../../chat/ai/AIChatMessages';
import { AIHistoryPanel } from '../../chat/ai/AIHistoryPanel';
import { VoiceCallView } from '../../chat/ai/voice/VoiceCallView';
import { VoiceProfileManager } from '../../chat/ai/voice/VoiceProfileManager';
import type { VoiceCallState, VoiceTurn } from '../../chat/ai/voice/useVoiceCall';
import type { VoiceProfile } from '../../api/ai';
import { ChatMenuButton } from '../../chat/shared/ChatMenu';
import { ChatTargetAvatar, hasChatTargetAvatar } from '../../chat/shared/ChatTargetAvatar';
import { ConversationShelf } from '../../chat/shared/ConversationShelf';
import { BotBadge } from '../../components/common/BotBadge';
import { MultiSelectActionBar } from '../../chat/shared/MultiSelectActionBar';
import { ForwardMessageModal } from '../../chat/shared/ForwardMessageModal';
import { useBatchForward } from '../../chat/shared/useBatchForward';
import { ChatInputArea } from '../../chat/shared/ChatInputArea';
import { friendDisplayName } from '../../utils/friendName';
import { isFriendLikeTarget } from '../../utils/chatTarget';
import { useProfileViewStore, useGroupDetailStore } from '../../stores';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import type { AIMessage } from '../../types/chat';
import type { AIToolStatus, AIPendingToolCall } from '../../chat/ai/useAIMessages';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

interface MobileChatViewProps {
  session: Session;
  chatTarget: ChatTarget;

  // 消息数据
  friendMessages: Message[];
  groupMessages: GroupMessage[];
  isLoading: boolean;

  // 加载更多
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** 「回到最新」接管：窗口态下必须重新加载最新一段，纯滚动只能滚到窗口的底 */
  onJumpToLatest?: () => void;
  /** 窗口态下向更新方向续加载 */
  onLoadNewer?: () => void;
  /** 更新方向是否还有更多 */
  hasNewer?: boolean;
  /** 当前是否处于定位窗口态（决定「回到最新」按钮是否恒显） */
  isWindowed?: boolean;

  // 输入
  messageInput: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;

  // 多选模式
  isMultiSelectMode: boolean;
  selectedMessages: Set<string>;
  canBatchRecall: boolean;
  onToggleSelect: (messageUuid: string) => void;
  onEnterMultiSelect: () => void;
  onExitMultiSelect: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchDelete: () => void;
  onBatchRecall: () => void;
  onRecallMessage: (messageUuid: string) => void;
  onDeleteMessage: (messageUuid: string) => void;

  // 菜单回调
  onFriendRemoved: () => void;
  onGroupUpdated: () => void;
  onGroupLeft: () => void;
  onHistoryLoaded?: () => void;

  // 返回回调
  onBack: () => void;

  // AI 消息数据（仅 chatTarget.type === 'ai' 时使用）
  aiMessages?: AIMessage[];
  aiStreamingContent?: string;
  aiStreamingReasoning?: string;
  aiIsLoading?: boolean;
  aiToolStatus?: AIToolStatus | null;
  aiPendingToolCall?: AIPendingToolCall | null;
  aiRetryLastMessage?: () => void;
  onAIConfirmToolCall?: (pendingId: string) => Promise<void>;
  onAIRejectToolCall?: (pendingId: string) => Promise<void>;

  // AI 语音通话
  voiceCallState?: VoiceCallState;
  voiceCallTurns?: VoiceTurn[];
  onVoiceStartCall?: (conversationId?: string, voiceProfileId?: string) => void;
  onVoiceDisconnect?: () => void;
  onVoiceToggleMute?: () => void;

  // 声音配置
  voiceProfiles?: VoiceProfile[];
  voiceProfilesLoading?: boolean;
  voiceProfilesUploading?: boolean;
  voiceProfilesError?: string | null;
  selectedVoiceProfileId?: string | null;
  onVoiceProfileUpload?: (name: string, blob: Blob, fileName: string) => Promise<void>;
  onVoiceProfileSetDefault?: (id: string) => Promise<void>;
  onVoiceProfileDelete?: (id: string) => Promise<void>;
  onVoiceProfileSelect?: (id: string | null) => void;
  onVoiceProfileUpdatePrompt?: (id: string, systemPrompt: string | null) => Promise<void>;

  // AI 历史记录
  aiConversations?: AIConversation[];
  aiConversationsLoading?: boolean;
  aiConversationId?: string | null;
  onAILoadConversations?: () => void;
  onAISwitchConversation?: (convId: string) => void;
  onAIDeleteConversation?: (convId: string) => void;
  onAINewConversation?: () => void;
}

function getChatTitle(chatTarget: ChatTarget): string {
  if (chatTarget.type === 'ai') { return 'AI 助手'; }
  if (isFriendLikeTarget(chatTarget)) {
    return friendDisplayName(chatTarget.data);
  }
  return chatTarget.data.group_name || '群聊';
}

export function MobileChatView({
  session,
  chatTarget,
  friendMessages,
  groupMessages,
  isLoading,
  hasMore,
  loadingMore,
  onLoadMore,
  onJumpToLatest,
  isWindowed,
  onLoadNewer,
  hasNewer,
  messageInput,
  onMessageChange,
  onSendMessage,
  isMultiSelectMode,
  selectedMessages,
  canBatchRecall,
  onToggleSelect,
  onEnterMultiSelect,
  onExitMultiSelect,
  onSelectAll,
  onDeselectAll,
  onBatchDelete,
  onBatchRecall,
  onRecallMessage,
  onDeleteMessage,
  onFriendRemoved,
  onGroupUpdated,
  onGroupLeft,
  onHistoryLoaded,
  onBack,
  aiMessages = [],
  aiStreamingContent = '',
  aiStreamingReasoning = '',
  aiIsLoading = false,
  aiToolStatus = null,
  aiPendingToolCall = null,
  aiRetryLastMessage,
  onAIConfirmToolCall,
  onAIRejectToolCall,
  voiceCallState,
  voiceCallTurns = [],
  onVoiceStartCall,
  onVoiceDisconnect,
  onVoiceToggleMute,
  voiceProfiles = [],
  voiceProfilesLoading = false,
  voiceProfilesUploading = false,
  voiceProfilesError = null,
  selectedVoiceProfileId = null,
  onVoiceProfileUpload,
  onVoiceProfileSetDefault,
  onVoiceProfileDelete,
  onVoiceProfileSelect,
  onVoiceProfileUpdatePrompt,
  aiConversations = [],
  aiConversationsLoading = false,
  aiConversationId = null,
  onAILoadConversations,
  onAISwitchConversation,
  onAIDeleteConversation,
  onAINewConversation,
}: MobileChatViewProps) {
  // eslint-disable-next-line no-nested-ternary
  const chatKey = chatTarget.type === 'ai'
    ? 'ai-assistant'
    : isFriendLikeTarget(chatTarget)
      ? chatTarget.data.friend_id
      : chatTarget.data.group_id;

  // 顶栏点开详情：私聊 → 对方资料；群聊 → 群详情面板（与桌面 ChatPanel 同一条规则，
  // 理由见那边的注释：群详情面板此前只能从发现搜索点进去，「我已经在的群」几乎无路可达）
  const openProfile = useProfileViewStore((s) => s.open);
  const openGroupDetail = useGroupDetailStore((s) => s.open);
  const friendIdForProfile = isFriendLikeTarget(chatTarget) ? chatTarget.data.friend_id : null;
  const groupIdForDetail = chatTarget.type === 'group' ? chatTarget.data.group_id : null;
  const headerDetailAction = (() => {
    if (friendIdForProfile) { return () => openProfile(friendIdForProfile); }
    // 成员入口：不是从任何一条加群路径来的 ⇒ source 显式传 null（不是省略参数）。
    // 这里的 chatTarget 来自本人的会话列表，打开者必然是本群成员，面板走「进入群聊」那一支。
    if (groupIdForDetail) { return () => openGroupDetail(groupIdForDetail, null); }
    return null;
  })();
  // 顶栏点开对方资料的键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const titleKbd = useKbdFocusRing();
  const titleKbdHandlers = titleKbd.handlersFor('title');
  // 顶栏头像（气泡区那两个头像搬来的落点）：放谁的头像与桌面顶栏同一条规则，见 ChatTargetAvatar
  const showHeaderAvatar = hasChatTargetAvatar(chatTarget);

  // 获取实际的 friend/group 对象（bot 的 data 也是 Friend，走 friend 消息链路）
  const friend = isFriendLikeTarget(chatTarget) ? chatTarget.data : undefined;
  const group = chatTarget.type === 'group' ? chatTarget.data : undefined;

  const [showAIHistory, setShowAIHistory] = useState(false);
  const [showVoiceProfiles, setShowVoiceProfiles] = useState(false);

  // 多选批量转发（与桌面 ChatPanel 同一个 hook，两端行为不会漂移）
  const { forwardSources, forwardOpen, openForward, closeForward } = useBatchForward({
    session, chatTarget, friendMessages, groupMessages, selectedMessages,
  });

  const handleAIHistorySelect = useCallback((convId: string) => {
    onAISwitchConversation?.(convId);
    setShowAIHistory(false);
  }, [onAISwitchConversation]);

  return (
    <motion.div
      className="mobile-chat-view"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.3 }}
    >
      {/* 顶部栏。头像 + 标题并排在一条水平中心线上（`.mobile-chat-lead` 的 align-items: center）
          —— huanwei 2026-08-14「我需要这个头像和名称的中心点对齐」。
          标题因此从「居中」改为「左对齐」：居中标题旁边塞头像会把标题挤偏。 */}
      <header className="mobile-chat-header">
        <div className="mobile-chat-back" onClick={onBack}>
          <BackIcon />
        </div>
        <div className="mobile-chat-lead">
          {showHeaderAvatar && (
            <div className="mobile-chat-avatar" aria-hidden="true">
              <ChatTargetAvatar chatTarget={chatTarget} />
            </div>
          )}
          <div
            className={`mobile-chat-title${headerDetailAction && titleKbd.isKbdFocused('title') ? ' a11y-kbd-focus' : ''}`}
            onClick={headerDetailAction ?? undefined}
            onKeyDown={headerDetailAction
              ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  headerDetailAction();
                }
              }
              : undefined}
            role={headerDetailAction ? 'button' : undefined}
            tabIndex={headerDetailAction ? 0 : undefined}
            aria-label={headerDetailAction ? `查看${getChatTitle(chatTarget)}资料` : undefined}
            onPointerDown={headerDetailAction ? titleKbdHandlers.onPointerDown : undefined}
            onFocus={headerDetailAction ? titleKbdHandlers.onFocus : undefined}
            onBlur={headerDetailAction ? titleKbdHandlers.onBlur : undefined}
            style={headerDetailAction ? { cursor: 'pointer' } : undefined}
          >
            {/* ellipsis 下移到内层文字节点：外层已是 flex 行，对 flex 子项直接写
                text-overflow 不生效（见 chat-bubble-meta.css 的 .mobile-chat-title-text） */}
            <span className="mobile-chat-title-text">{getChatTitle(chatTarget)}</span>
            {/* bot 会话：标题旁 Bot 徽章（对齐桌面 ChatPanel 的 bot 标识） */}
            {chatTarget.type === 'bot' && <BotBadge />}
          </div>
        </div>
        {chatTarget.type === 'ai' ? (
          <div className="mobile-chat-menu ai-actions">
            <button className="header-action-btn" onClick={onAINewConversation} title="新对话">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button className={`header-action-btn ${showAIHistory ? 'active' : ''}`} onClick={() => setShowAIHistory(!showAIHistory)} title="历史记录">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {!voiceCallState?.isActive && (
              <>
                {onVoiceProfileSelect && (
                  <button
                    className="ai-voice-profile-btn"
                    onClick={() => setShowVoiceProfiles(true)}
                    title="声音管理"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  </button>
                )}
                {onVoiceStartCall && (
                  <button
                    className="ai-voice-call-btn"
                    onClick={() => onVoiceStartCall(aiConversationId ?? undefined, selectedVoiceProfileId ?? undefined)}
                    title="语音通话"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* 会话内查找**没有**独立入口：它是「更多操作」侧边面板里的一项
                （ChatMenu.tsx 的 search view）。别再往这儿加放大镜按钮。 */}
            <div className="mobile-chat-menu">
              <ChatMenuButton
                target={chatTarget}
                onFriendRemoved={onFriendRemoved}
                onGroupUpdated={onGroupUpdated}
                onGroupLeft={onGroupLeft}
                isMultiSelectMode={isMultiSelectMode}
                onToggleMultiSelect={onEnterMultiSelect}
                onHistoryLoaded={onHistoryLoaded}
              />
            </div>
          </>
        )}
      </header>

      {/* AI 历史记录抽屉 */}
      {chatTarget.type === 'ai' && (
        <AIHistoryPanel
          visible={showAIHistory}
          conversations={aiConversations}
          loading={aiConversationsLoading}
          currentConversationId={aiConversationId}
          onSelect={handleAIHistorySelect}
          onDelete={(id) => onAIDeleteConversation?.(id)}
          onClose={() => setShowAIHistory(false)}
          onLoad={() => onAILoadConversations?.()}
        />
      )}

      {/* 顶置功能区（bot 会话 / 群会话；好友 1:1 与 AI 天然无架，组件自 gate） */}
      <ConversationShelf chatTarget={chatTarget} />

      {/* 消息列表 */}
      <div className="mobile-chat-messages">
        {/* eslint-disable-next-line no-nested-ternary */}
        {chatTarget.type === 'ai' && voiceCallState?.isActive && !voiceCallState.isMinimized ? (
          <VoiceCallView
            key="voice-call"
            state={voiceCallState}
            turns={voiceCallTurns}
            onToggleMute={onVoiceToggleMute ?? (() => {})}
            onDisconnect={onVoiceDisconnect ?? (() => {})}
          />
        ) : chatTarget.type === 'ai' ? (
          <AIChatMessages
            key="ai-messages"
            messages={aiMessages}
            streamingContent={aiStreamingContent}
            streamingReasoning={aiStreamingReasoning}
            isLoading={aiIsLoading}
            toolStatus={aiToolStatus}
            pendingToolCall={aiPendingToolCall}
            onRetry={aiRetryLastMessage}
            onConfirmToolCall={onAIConfirmToolCall}
            onRejectToolCall={onAIRejectToolCall}
          />
        ) : null}
        {isFriendLikeTarget(chatTarget) && friend && (
          <ChatMessages
            key={`friend-${chatKey}`}
            loading={isLoading}
            messages={friendMessages}
            session={session}
            friend={friend}
            conversationType={chatTarget.type}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            onJumpToLatest={onJumpToLatest}
            isWindowed={isWindowed}
            onLoadNewer={onLoadNewer}
            hasNewer={hasNewer}
            isMultiSelectMode={isMultiSelectMode}
            selectedMessages={selectedMessages}
            onToggleSelect={onToggleSelect}
            onEnterMultiSelect={onEnterMultiSelect}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
          />
        )}
        {chatTarget.type === 'group' && group && (
          <GroupChatMessages
            key={`group-${chatKey}`}
            loading={isLoading}
            messages={groupMessages}
            currentUserId={session.userId}
            userRole={group.role}
            groupId={group.group_id}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            onJumpToLatest={onJumpToLatest}
            isWindowed={isWindowed}
            onLoadNewer={onLoadNewer}
            hasNewer={hasNewer}
            isMultiSelectMode={isMultiSelectMode}
            selectedMessages={selectedMessages}
            onToggleSelect={onToggleSelect}
            onEnterMultiSelect={onEnterMultiSelect}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
          />
        )}
      </div>

      {/* 输入区域 / 多选操作栏 */}
      <div className="mobile-chat-input">
        {isMultiSelectMode ? (
          <MultiSelectActionBar
            selectedCount={selectedMessages.size}
            totalCount={isFriendLikeTarget(chatTarget) ? friendMessages.length : groupMessages.length}
            canBatchRecall={canBatchRecall}
            canBatchForward={forwardSources.length > 0}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onBatchDelete={onBatchDelete}
            onBatchRecall={onBatchRecall}
            onBatchForward={openForward}
            onCancel={onExitMultiSelect}
          />
        ) : (
          <ChatInputArea
            messageInput={messageInput}
            onMessageChange={onMessageChange}
            onSendMessage={onSendMessage}
          />
        )}
      </div>

      {/* 批量转发面板：发完退出多选（选中态已消费完，留着只会误导） */}
      {forwardOpen && forwardSources.length > 0 && (
        <ForwardMessageModal
          messages={forwardSources}
          onClose={closeForward}
          onSent={onExitMultiSelect}
        />
      )}

      {chatTarget.type === 'ai' && onVoiceProfileSelect && (
        <VoiceProfileManager
          open={showVoiceProfiles}
          onClose={() => setShowVoiceProfiles(false)}
          profiles={voiceProfiles}
          selectedId={selectedVoiceProfileId}
          loading={voiceProfilesLoading}
          uploading={voiceProfilesUploading}
          error={voiceProfilesError}
          onUpload={onVoiceProfileUpload ?? (async () => {})}
          onSetDefault={onVoiceProfileSetDefault ?? (async () => {})}
          onDelete={onVoiceProfileDelete ?? (async () => {})}
          onSelect={onVoiceProfileSelect}
          onUpdatePrompt={onVoiceProfileUpdatePrompt ?? (async () => {})}
        />
      )}
    </motion.div>
  );
}
