/**
 * 主菜单视图组件
 */

import { MenuHeader } from './MenuHeader';
import {
  TrashIcon,
  EditIcon,
  CameraIcon,
  UserPlusIcon,
  UsersIcon,
  ExitIcon,
  MultiSelectIcon,
} from '../../common/Icons';
import type { MenuView } from './types';

interface MainMenuProps {
  targetType: 'friend' | 'group';
  isOwnerOrAdmin: boolean;
  isOwner: boolean;
  isMultiSelectMode: boolean;
  onSetView: (view: MenuView) => void;
  onLoadMembers: () => void;
  onUploadAvatar: () => void;
  onToggleMultiSelect: () => void;
}

export function MainMenu({
  targetType,
  isOwnerOrAdmin,
  isOwner,
  isMultiSelectMode,
  onSetView,
  onLoadMembers,
  onUploadAvatar,
  onToggleMultiSelect,
}: MainMenuProps) {
  const title = targetType === 'friend' ? '好友设置' : '群聊设置';

  return (
    <>
      <MenuHeader title={title} />

      {/* 多选消息选项 */}
      <button
        className={`menu-item ${isMultiSelectMode ? 'active' : ''}`}
        onClick={onToggleMultiSelect}
      >
        <MultiSelectIcon />
        <span>{isMultiSelectMode ? '退出多选' : '多选消息'}</span>
      </button>

      <div className="menu-divider" />

      {targetType === 'friend' && (
        <button
          className="menu-item danger"
          onClick={() => onSetView('confirm-delete')}
        >
          <TrashIcon />
          <span>删除好友</span>
        </button>
      )}

      {targetType === 'group' && (
        <>
          {isOwnerOrAdmin && (
            <>
              <button
                className="menu-item"
                onClick={() => onSetView('edit-name')}
              >
                <EditIcon />
                <span>修改群名称</span>
              </button>
              <button className="menu-item" onClick={onUploadAvatar}>
                <CameraIcon />
                <span>更换群头像</span>
              </button>
              <button className="menu-item" onClick={() => onSetView('invite')}>
                <UserPlusIcon />
                <span>邀请成员</span>
              </button>
            </>
          )}
          <button className="menu-item" onClick={onLoadMembers}>
            <UsersIcon />
            <span>查看成员</span>
          </button>
          {!isOwner && (
            <button
              className="menu-item danger"
              onClick={() => onSetView('confirm-leave')}
            >
              <ExitIcon />
              <span>退出群聊</span>
            </button>
          )}
        </>
      )}
    </>
  );
}
