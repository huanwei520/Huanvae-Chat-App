/**
 * 状态管理导出
 *
 * 统一导出所有 Zustand stores
 */

// ============================================
// 聊天相关 Store
// ============================================

export {
  useChatStore,
  selectGroupRole,
  selectFriend,
  selectGroup,
  selectIsGroupOwnerOrAdmin,
  selectIsGroupOwner,
  selectCurrentMuteStatus,
  type ChatStore,
} from './chatStore';

// ============================================
// 会话列表 Store
// ============================================

export {
  useConversationsStore,
  selectConversation,
  selectTotalUnread,
  selectFriendConversations,
  selectGroupConversations,
  type ConversationsStore,
} from './conversationsStore';

// ============================================
// 消息缓存 Store
// ============================================

export {
  useMessagesStore,
  messageToCached,
  groupMessageToCached,
  selectMessages,
  selectHasMore,
  selectLoading,
  type CachedMessage,
  type MessagesStore,
} from './messagesStore';

// ============================================
// 用户缓存 Store
// ============================================

export {
  useUserCacheStore,
  selectUser,
  selectNickname,
  selectAvatar,
  selectOnlineStatus,
  type CachedUser,
  type UserCacheStore,
} from './userCacheStore';

// ============================================
// UI 状态 Store
// ============================================

export {
  useUIStore,
  selectTheme,
  selectSidebarCollapsed,
  selectGlobalLoading,
  selectToasts,
  selectActiveModal,
  type Toast,
  type UIStore,
} from './uiStore';
