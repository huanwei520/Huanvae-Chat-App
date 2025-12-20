/**
 * ChatMenu 类型定义
 */

import type { Friend, Group } from '../../../types/chat';
import type { GroupMember } from '../../../api/groups';

export interface ChatMenuProps {
  target: { type: 'friend'; data: Friend } | { type: 'group'; data: Group };
  onFriendRemoved?: () => void;
  onGroupUpdated?: () => void;
  onGroupLeft?: () => void;
  /** 是否处于多选模式 */
  isMultiSelectMode?: boolean;
  /** 切换多选模式 */
  onToggleMultiSelect?: () => void;
}

export type MenuView =
  | 'main'
  | 'edit-name'
  | 'edit-avatar'
  | 'invite'
  | 'members'
  | 'member-action'
  | 'mute-member'
  | 'confirm-delete'
  | 'confirm-leave'
  | 'confirm-kick'
  | 'notices'
  | 'create-notice'
  | 'transfer-owner'
  | 'confirm-disband'
  | 'invite-codes'
  | 'generate-code';

export interface MenuState {
  isOpen: boolean;
  view: MenuView;
  loading: boolean;
  error: string | null;
  success: string | null;
  newGroupName: string;
  inviteUserId: string;
  inviteMessage: string;
  members: GroupMember[];
  loadingMembers: boolean;
  selectedMember: GroupMember | null;
  muteDuration: number;
}

export interface MenuActions {
  setIsOpen: (isOpen: boolean) => void;
  setView: (view: MenuView) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setNewGroupName: (name: string) => void;
  setInviteUserId: (id: string) => void;
  setInviteMessage: (message: string) => void;
  setMembers: (members: GroupMember[]) => void;
  setLoadingMembers: (loading: boolean) => void;
  setSelectedMember: (member: GroupMember | null) => void;
  setMuteDuration: (duration: number) => void;
}
