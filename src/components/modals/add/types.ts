/**
 * AddModal 类型定义
 */

export type TabType = 'add-friend' | 'friend-requests' | 'create-group' | 'join-group' | 'group-invites';

export interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFriendAdded?: () => void;
  onGroupAdded?: () => void;
}
