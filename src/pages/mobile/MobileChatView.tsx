/**
 * 移动端聊天页面
 *
 * 全屏显示，包含：
 * - 顶部：返回按钮 + 居中标题 + 菜单按钮
 * - 中间：消息列表（复用 ChatMessages/GroupChatMessages）
 * - 底部：输入区域（复用 ChatInputArea）
 */

import { motion } from 'framer-motion';
import type { Session } from '../../types/session';
import type { ChatTarget, Message } from '../../types/chat';
import type { GroupMessage } from '../../api/groupMessages';
import type { AttachmentType } from '../../chat/shared/FileAttachButton';
import type { UploadProgress } from '../../hooks/useFileUpload';

import { ChatMessages } from '../../chat/friend/ChatMessages';
import { GroupChatMessages } from '../../chat/group/GroupChatMessages';
import { ChatMenuButton } from '../../chat/shared/ChatMenu';
import { MultiSelectActionBar } from '../../chat/shared/MultiSelectActionBar';
import { ChatInputArea } from '../../chat/shared/ChatInputArea';

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
  isSending: boolean;

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

  // 返回回调
  onBack: () => void;
}

function getChatTitle(chatTarget: ChatTarget): string {
  if (chatTarget.type === 'friend') {
    return chatTarget.data.friend_nickname || '好友';
  }
  return chatTarget.data.group_name || '群聊';
}

export function MobileChatView({
  session,
  chatTarget,
  friendMessages,
  groupMessages,
  isLoading,
  isSending: _isSending,
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
  onBack,
}: MobileChatViewProps) {
  const chatKey =
    chatTarget.type === 'friend'
      ? chatTarget.data.friend_id
      : chatTarget.data.group_id;

  // 获取实际的 friend/group 对象
  const friend = chatTarget.type === 'friend' ? chatTarget.data : undefined;
  const group = chatTarget.type === 'group' ? chatTarget.data : undefined;

  return (
    <motion.div
      className="mobile-chat-view"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.3 }}
    >
      {/* 顶部栏 */}
      <header className="mobile-chat-header">
        <div className="mobile-chat-back" onClick={onBack}>
          <BackIcon />
        </div>
        <div className="mobile-chat-title">{getChatTitle(chatTarget)}</div>
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
      </header>

      {/* 消息列表 */}
      <div className="mobile-chat-messages">
        {chatTarget.type === 'friend' && friend && (
          <ChatMessages
            key={`friend-${chatKey}`}
            loading={isLoading}
            messages={friendMessages}
            session={session}
            friend={friend}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
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
            totalCount={chatTarget.type === 'friend' ? friendMessages.length : groupMessages.length}
            canBatchRecall={canBatchRecall}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onBatchDelete={onBatchDelete}
            onBatchRecall={onBatchRecall}
            onCancel={onExitMultiSelect}
          />
        ) : (
          <ChatInputArea
            messageInput={messageInput}
            onMessageChange={onMessageChange}
            onSendMessage={onSendMessage}
            onFileSelect={onFileSelect}
            uploading={uploading}
            uploadingFile={uploadingFile}
            uploadProgress={uploadProgress}
            onCancelUpload={onCancelUpload}
          />
        )}
      </div>
    </motion.div>
  );
}
