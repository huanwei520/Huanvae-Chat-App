/**
 * 聊天面板组件
 *
 * @module chat/shared
 * @location src/chat/shared/ChatPanel.tsx
 *
 * 主页面右侧的聊天窗口，好友聊天和群聊共用
 * 包含：
 * - 聊天头部（标题、副标题、菜单按钮）
 * - 消息列表（私聊/群聊，根据 chatTarget.type 自动切换）
 * - 输入区域 / 多选操作栏
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { Session } from '../../types/session';
import type { Friend, Group, ChatTarget, Message } from '../../types/chat';
import type { GroupMessage } from '../../api/groupMessages';
import type { AttachmentType } from './FileAttachButton';
import type { UploadProgress } from '../../hooks/useFileUpload';

import { ChatMessages } from '../friend/ChatMessages';
import { GroupChatMessages } from '../group/GroupChatMessages';
import { ChatMenuButton } from './ChatMenu';
import { MultiSelectActionBar } from './MultiSelectActionBar';
import { ChatInputArea } from './ChatInputArea';

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
}

// ============================================
// 辅助函数
// ============================================

function getChatTitle(chatTarget: ChatTarget): string {
  return chatTarget.type === 'friend'
    ? chatTarget.data.friend_nickname
    : chatTarget.data.group_name;
}

function getChatSubtitle(chatTarget: ChatTarget): string {
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
}: ChatPanelProps) {
  const chatKey = chatTarget.type === 'friend'
    ? chatTarget.data.friend_id
    : chatTarget.data.group_id;

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
        <div className="chat-header-info">
          <h2>{getChatTitle(chatTarget)}</h2>
          <span className="chat-subtitle">{getChatSubtitle(chatTarget)}</span>
        </div>
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

      {/* 消息列表 */}
      <div className="chat-messages">
        {chatTarget.type === 'friend' ? (
          <ChatMessages
            key={`friend-${chatKey}`}
            loading={isLoading}
            messages={friendMessages}
            session={session}
            friend={chatTarget.data as Friend}
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
      exit={{ opacity: 0 }}
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
