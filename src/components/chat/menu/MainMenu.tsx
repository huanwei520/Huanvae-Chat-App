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
  MegaphoneIcon,
  ArrowsRightLeftIcon,
  XCircleIcon,
  QrCodeIcon,
} from '../../common/Icons';
import { CircularProgress } from '../../common/CircularProgress';
import { GroupAvatar } from '../../common/Avatar';
import type { Group } from '../../../types/chat';
import type { MenuView } from './types';

interface MainMenuProps {
  targetType: 'friend' | 'group';
  isOwnerOrAdmin: boolean;
  isOwner: boolean;
  isMultiSelectMode: boolean;
  /** 群信息（用于显示头像） */
  group?: Group;
  /** 是否正在上传头像 */
  uploadingAvatar?: boolean;
  /** 上传进度 0-100 */
  avatarUploadProgress?: number;
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
  group,
  uploadingAvatar = false,
  avatarUploadProgress = 0,
  onSetView,
  onLoadMembers,
  onUploadAvatar,
  onToggleMultiSelect,
}: MainMenuProps) {
  const title = targetType === 'friend' ? '好友设置' : '群聊设置';

  return (
    <>
      <MenuHeader title={title} />

      {/* 群头像显示区域 */}
      {targetType === 'group' && group && isOwnerOrAdmin && (
        <div className="menu-avatar-section">
          <div
            className="menu-avatar-container"
            onClick={uploadingAvatar ? undefined : onUploadAvatar}
            style={{ cursor: uploadingAvatar ? 'default' : 'pointer' }}
          >
            {uploadingAvatar ? (
              <CircularProgress
                progress={avatarUploadProgress}
                size={64}
                strokeWidth={3}
                progressColor="#3b82f6"
                backgroundColor="rgba(147, 197, 253, 0.3)"
              >
                <div className="menu-avatar-upload-content">
                  <GroupAvatar group={group} />
                  <div className="menu-avatar-progress-overlay">
                    {avatarUploadProgress}%
                  </div>
                </div>
              </CircularProgress>
            ) : (
              <div className="menu-avatar-wrapper">
                <GroupAvatar group={group} />
                <div className="menu-avatar-overlay">
                  <CameraIcon />
                </div>
              </div>
            )}
          </div>
          <span className="menu-avatar-hint">点击更换头像</span>
        </div>
      )}

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
          {/* 群公告 - 所有成员可查看 */}
          <button className="menu-item" onClick={() => onSetView('notices')}>
            <MegaphoneIcon />
            <span>群公告</span>
          </button>

          {isOwnerOrAdmin && (
            <>
              <button
                className="menu-item"
                onClick={() => onSetView('edit-name')}
              >
                <EditIcon />
                <span>修改群名称</span>
              </button>
              <button className="menu-item" onClick={() => onSetView('invite')}>
                <UserPlusIcon />
                <span>邀请成员</span>
              </button>
              <button className="menu-item" onClick={() => onSetView('invite-codes')}>
                <QrCodeIcon />
                <span>邀请码管理</span>
              </button>
            </>
          )}

          <button className="menu-item" onClick={onLoadMembers}>
            <UsersIcon />
            <span>查看成员</span>
          </button>

          {/* 群主专属功能 */}
          {isOwner && (
            <>
              <div className="menu-divider" />
              <button
                className="menu-item"
                onClick={() => onSetView('transfer-owner')}
              >
                <ArrowsRightLeftIcon />
                <span>转让群主</span>
              </button>
              <button
                className="menu-item danger"
                onClick={() => onSetView('confirm-disband')}
              >
                <XCircleIcon />
                <span>解散群聊</span>
              </button>
            </>
          )}

          {/* 非群主可退出 */}
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
