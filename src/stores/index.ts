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

// ============================================
// 个人资料背景（后端持久化图片/纯色 + 主色；本地仅存「主题色跟随背景」开关）
// ============================================

export { useProfileBackground } from './profileBackground';
