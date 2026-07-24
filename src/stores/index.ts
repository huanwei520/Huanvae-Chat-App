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
// 他人资料页查看 Store
// ============================================

export { useProfileViewStore } from './profileViewStore';
export { useGroupDetailStore } from './groupDetailStore';

// ============================================
// 顶置架 / Bot 指令 Store
// ============================================

export { useShelfStore, shelfKey, isShelfItem, type ShelfStore } from './shelfStore';
export { useBotCommandsStore, type BotCommandsStore } from './botCommandsStore';
