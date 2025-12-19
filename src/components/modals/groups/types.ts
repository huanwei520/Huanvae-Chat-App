/**
 * GroupsModal 类型定义
 */

import type { Group } from '../../../api/groups';

export type TabType = 'list' | 'create' | 'join' | 'invitations';

export interface GroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupSelect?: (group: Group) => void;
}
