/**
 * 聊天面板组件
 *
 * @module chat/shared
 * @location src/chat/shared/ChatPanel.tsx
 *
 * 主页面右侧的聊天窗口，好友聊天和群聊共用
 * 包含：
 * - 聊天头部（标题、副标题、菜单按钮；AI 模式下显示新建/历史按钮）
 * - 消息列表（私聊/群聊/AI，根据 chatTarget.type 自动切换）
 * - AI 历史记录抽屉面板（右侧滑入）
 * - 输入区域 / 多选操作栏
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { Session } from '../../types/session';
import type { Friend, Group, ChatTarget, Message } from '../../types/chat';
import type { GroupMessage } from '../../api/groupMessages';
import type { AttachmentType } from './FileAttachButton';
import type { UploadProgress } from '../../hooks/useFileUpload';

import { useState, useCallback } from 'react';
import { ChatMessages } from '../friend/ChatMessages';
import { GroupChatMessages } from '../group/GroupChatMessages';
import { AIChatMessages } from '../ai/AIChatMessages';
import { AIHistoryPanel } from '../ai/AIHistoryPanel';
import { VoiceCallView } from '../ai/voice/VoiceCallView';
import { VoiceProfileManager } from '../ai/voice/VoiceProfileManager';
import type { VoiceCallState, VoiceTurn } from '../ai/voice/useVoiceCall';
import type { VoiceProfile } from '../../api/ai';
import { ChatMenuButton } from './ChatMenu';
import { ConversationShelf } from './ConversationShelf';
import { MultiSelectActionBar } from './MultiSelectActionBar';
import { ChatInputArea } from './ChatInputArea';
import { friendDisplayName } from '../../utils/friendName';
import { isFriendLikeTarget } from '../../utils/chatTarget';
import { useChatStore, useProfileViewStore } from '../../stores';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import type { AIMessage, AIConversation } from '../../types/chat';
import type { AIToolStatus, AIPendingToolCall } from '../ai/useAIMessages';

// ============================================
// 类型定义
// ============================================

interface ChatPanelProps {
  session: Session;
  chatTarget: ChatTarget;

  // 消息数据
  friendMessages: Message[];
  groupMessages: GroupMessage[];
  isLoading: boolean;
  isSending: boolean;
  totalMessageCount: number;

  // 加载更多
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;

  // 输入
  messageInput: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
  onFileSelect: (file: File, type: AttachmentType, localPath?: string) => void;

  // 文件上传
  uploading: boolean;
  uploadingFile: File | null;
  uploadProgress: UploadProgress | null;
  onCancelUpload: () => void;

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

// ============================================
// 辅助函数
// ============================================

function getChatTitle(chatTarget: ChatTarget): string {
  if (chatTarget.type === 'ai') { return 'AI 助手'; }
  return isFriendLikeTarget(chatTarget)
    ? friendDisplayName(chatTarget.data)
    : chatTarget.data.group_name;
}

function getChatSubtitle(chatTarget: ChatTarget): string {
  if (chatTarget.type === 'ai') { return 'GLM-5 模型'; }
  if (chatTarget.type === 'bot') { return 'Bot'; }
  if (chatTarget.type === 'friend') {
    return `@${chatTarget.data.friend_id}`;
  }
  const roleText = {
    owner: '群主',
    admin: '管理员',
    member: '成员',
  };
  return roleText[chatTarget.data.role];
}

// ============================================
// 组件
// ============================================

export function ChatPanel({
  session,
  chatTarget,
  friendMessages,
  groupMessages,
  isLoading,
  isSending,
  totalMessageCount,
  hasMore,
  loadingMore,
  onLoadMore,
  messageInput,
  onMessageChange,
  onSendMessage,
  onFileSelect,
  uploading,
  uploadingFile,
  uploadProgress,
  onCancelUpload,
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
}: ChatPanelProps) {
  // eslint-disable-next-line no-nested-ternary
  const chatKey = chatTarget.type === 'ai'
    ? 'ai-assistant'
    : isFriendLikeTarget(chatTarget)
      ? chatTarget.data.friend_id
      : chatTarget.data.group_id;

  const [showAIHistory, setShowAIHistory] = useState(false);
  const [showVoiceProfiles, setShowVoiceProfiles] = useState(false);

  // 私聊顶栏点开对方资料（群/AI 不适用；bot 同好友可看资料）
  const openProfile = useProfileViewStore((s) => s.open);
  const friendIdForProfile = isFriendLikeTarget(chatTarget) ? chatTarget.data.friend_id : null;
  // 顶栏点开对方资料的键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const headerKbd = useKbdFocusRing();
  const headerKbdHandlers = headerKbd.handlersFor('header');
  // 好友在线态：在线时顶栏副标题显示「在线」，否则回退 @ID
  const friendOnline = useChatStore((s) =>
    (friendIdForProfile ? s.friendPresence[friendIdForProfile]?.online : false) ?? false,
  );
  const subtitle = friendOnline ? '在线' : getChatSubtitle(chatTarget);

  // 私聊拉黑提示：从 store 读实时拉黑态（资料页拉黑后即时反映，不依赖 chatTarget 快照）
  const friendBlacklisted = useChatStore((s) =>
    isFriendLikeTarget(chatTarget)
      ? (s.friends.find((f) => f.friend_id === chatTarget.data.friend_id)?.is_blacklisted
          ?? chatTarget.data.is_blacklisted)
      : false,
  );

  const handleAIHistorySelect = useCallback((convId: string) => {
    onAISwitchConversation?.(convId);
    setShowAIHistory(false);
  }, [onAISwitchConversation]);

  return (
    <motion.div
      key={chatKey}
      className="chat-content"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* 聊天头部 */}
      <div className="chat-header">
        <div
          className={`chat-header-info${friendIdForProfile && headerKbd.isKbdFocused('header') ? ' a11y-kbd-focus' : ''}`}
          onClick={friendIdForProfile ? () => openProfile(friendIdForProfile) : undefined}
          onKeyDown={friendIdForProfile
            ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openProfile(friendIdForProfile);
              }
            }
            : undefined}
          role={friendIdForProfile ? 'button' : undefined}
          tabIndex={friendIdForProfile ? 0 : undefined}
          aria-label={friendIdForProfile ? `查看${getChatTitle(chatTarget)}资料` : undefined}
          onPointerDown={friendIdForProfile ? headerKbdHandlers.onPointerDown : undefined}
          onFocus={friendIdForProfile ? headerKbdHandlers.onFocus : undefined}
          onBlur={friendIdForProfile ? headerKbdHandlers.onBlur : undefined}
          style={friendIdForProfile ? { cursor: 'pointer' } : undefined}
          title={friendIdForProfile ? '查看资料' : undefined}
        >
          <h2>{getChatTitle(chatTarget)}</h2>
          <span className="chat-subtitle">{subtitle}</span>
        </div>
        {chatTarget.type === 'ai' ? (
          <div className="chat-header-actions">
            <button
              className="header-action-btn"
              onClick={onAINewConversation}
              title="新对话"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              className={`header-action-btn ${showAIHistory ? 'active' : ''}`}
              onClick={() => setShowAIHistory(!showAIHistory)}
              title="历史记录"
            >
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
          <div className="chat-header-actions">
            {/* 会话内查找**没有**独立入口：它是「更多操作」侧边面板里的一项
                （ChatMenu.tsx 的 search view）。别再往这儿加放大镜按钮。 */}
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
        )}
      </div>

      {/* 拉黑提示条（私聊且已拉黑对方，friend/bot 同链路） */}
      {isFriendLikeTarget(chatTarget) && friendBlacklisted && (
        <div className="chat-blacklist-banner">已拉黑，对方收不到你发送的消息</div>
      )}

      {/* 顶置功能区（bot 会话 / 群会话；好友 1:1 与 AI 天然无架，组件自 gate） */}
      <ConversationShelf chatTarget={chatTarget} />

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

      {/* 消息列表 */}
      <div className="chat-messages">
        {/* eslint-disable no-nested-ternary */}
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
        ) : isFriendLikeTarget(chatTarget) ? (
          <ChatMessages
            key={`friend-${chatKey}`}
            loading={isLoading}
            messages={friendMessages}
            session={session}
            friend={chatTarget.data as Friend}
            conversationType={chatTarget.type}
            isMultiSelectMode={isMultiSelectMode}
            selectedMessages={selectedMessages}
            onToggleSelect={onToggleSelect}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
            onEnterMultiSelect={onEnterMultiSelect}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
          />
        ) : (
          <GroupChatMessages
            key={`group-${chatKey}`}
            loading={isLoading}
            messages={groupMessages}
            currentUserId={session.userId}
            userRole={(chatTarget.data as Group).role}
            isMultiSelectMode={isMultiSelectMode}
            selectedMessages={selectedMessages}
            onToggleSelect={onToggleSelect}
            onRecall={onRecallMessage}
            onDelete={onDeleteMessage}
            onEnterMultiSelect={onEnterMultiSelect}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            groupId={(chatTarget.data as Group).group_id}
          />
        )}
        {/* eslint-enable no-nested-ternary */}
      </div>

      {/* 输入区域 / 多选操作栏 */}
      <AnimatePresence mode="wait">
        {isMultiSelectMode ? (
          <MultiSelectActionBar
            key="multi-select-bar"
            selectedCount={selectedMessages.size}
            totalCount={totalMessageCount}
            canBatchRecall={canBatchRecall}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onBatchDelete={onBatchDelete}
            onBatchRecall={onBatchRecall}
            onCancel={onExitMultiSelect}
          />
        ) : (
          <ChatInputArea
            key="input-area"
            messageInput={messageInput}
            onMessageChange={onMessageChange}
            onSendMessage={onSendMessage}
            onFileSelect={onFileSelect}
            isSending={isSending}
            uploading={uploading}
            uploadingFile={uploadingFile}
            uploadProgress={uploadProgress}
            onCancelUpload={onCancelUpload}
          />
        )}
      </AnimatePresence>

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

// ============================================
// 空状态组件
// ============================================

interface EmptyChatProps {
  session: Session;
  activeTab: 'chat' | 'friends' | 'group';
}

export function EmptyChat({ session, activeTab }: EmptyChatProps) {
  const hints: Record<string, string> = {
    chat: '会话',
    friends: '好友',
    group: '群聊',
  };

  return (
    <motion.div
      key="empty"
      className="chat-empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // 退场瞬时：选中会话时（AnimatePresence mode="wait"）欢迎页的「自己昵称」徽章
      // 若慢速淡出会被 ChatPanel 等待、在顶部残留一瞬 →「切会话闪自己昵称」。
      // 顶栏标题本身只取对方（getChatTitle 从不返回自己），故只需让空态即时退场。
      exit={{ opacity: 0, transition: { duration: 0 } }}
    >
      <div className="empty-content">
        <div className="empty-icon">💬</div>
        <h3>欢迎使用 Huanvae Chat</h3>
        <p>选择一个{hints[activeTab]}开始聊天</p>
        <div className="user-badge">
          <span>{session.profile.user_nickname}</span>
          <span className="divider">·</span>
          <span className="server">{session.serverUrl}</span>
        </div>
      </div>
    </motion.div>
  );
}
