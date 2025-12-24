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
