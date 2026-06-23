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
// 个人主页封面背景（原型，未落库）
// ============================================

export { useProfileCoverPrototype } from './profileCoverPrototype';
