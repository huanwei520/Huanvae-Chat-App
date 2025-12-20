/**
 * AddModal 类型定义
 */

import type { Group } from '../../../types/chat';

export type TabType = 'add-friend' | 'friend-requests' | 'create-group' | 'join-group' | 'group-invites';

export interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFriendAdded?: () => void;
  /** 增量添加群聊回调 - 传入 Group 对象直接插入卡片 */
  addGroup?: (group: Group) => void;
  /** 全量刷新群聊列表回调 - 用于无法获取完整 Group 信息的场景 */
  refreshGroups?: () => void;
}
