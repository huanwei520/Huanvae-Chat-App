/**
 * 主菜单视图组件
 *
 * 根据用户角色（群主/管理员/普通成员）动态显示菜单项
 * 使用"始终渲染 + 状态动画"方式：所有菜单项始终存在于 DOM 中
 * 通过 animate prop 控制显示/隐藏状态，确保动画 100% 可靠
 */

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  UserIcon,
  CloudDownloadIcon,
  StarIcon,
  BlockIcon,
} from '../../../components/common/Icons';
import { CircularProgress } from '../../../components/common/CircularProgress';
import { GroupAvatar } from '../../../components/common/Avatar';
import type { Group } from '../../../types/chat';
import type { MenuView } from './types';

// ============================================
// 动画配置
// ============================================

/**
 * 菜单项动画变体
 * 使用 custom 参数实现不同方向的进入/退出动画
 * custom = true (visible) 时：从左滑入
 * custom = false (hidden) 时：向右滑出
 */
const menuItemVariants = {
  visible: {
    opacity: 1,
    x: 0,
    height: 'auto' as const,
    paddingTop: 12,
    paddingBottom: 12,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  hidden: (isEntering: boolean) => ({
    opacity: 0,
    x: isEntering ? -30 : 30, // 进入时从左边开始，退出时向右边结束
    height: 0,
    paddingTop: 0,
    paddingBottom: 0,
    transition: { duration: 0.15, ease: [0.55, 0.06, 0.68, 0.19] as const },
  }),
};

/** 分割线动画变体 - 从左展开 */
const dividerVariants = {
  visible: {
    opacity: 1,
    scaleX: 1,
    height: 1,
    marginTop: 6,
    marginBottom: 6,
    transition: { duration: 0.2, ease: 'easeOut' as const },
  },
  hidden: {
    opacity: 0,
    scaleX: 0,
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    transition: { duration: 0.15, ease: 'easeIn' as const },
  },
};

// ============================================
// 子组件
// ============================================

interface AnimatedMenuItemProps {
  visible: boolean;
  className?: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

/**
 * 动画菜单项组件
 *
 * 始终渲染在 DOM 中，通过 visible prop 控制显示/隐藏动画
 * 动画效果：从左滑入（x: -30 → 0），向右滑出（x: 0 → 30）
 * 使用 useRef 追踪上一个状态，通过 custom prop 传递方向信息
 * 隐藏时 height=0 + pointerEvents='none' 确保不影响布局和交互
 */
function AnimatedMenuItem({
  visible,
  className,
  onClick,
  icon,
  label,
}: AnimatedMenuItemProps) {
  // 追踪上一个 visible 状态，用于判断是进入还是退出
  const prevVisibleRef = useRef(visible);
  const isEnteringRef = useRef(true);

  useEffect(() => {
    if (prevVisibleRef.current !== visible) {
      // visible 变化时，记录是进入还是退出
      isEnteringRef.current = visible;
      prevVisibleRef.current = visible;
    }
  }, [visible]);

  return (
    <motion.button
      className={`menu-item ${className || ''}`}
      onClick={onClick}
      variants={menuItemVariants}
      animate={visible ? 'visible' : 'hidden'}
      custom={isEnteringRef.current}
      initial={false}
      style={{
        overflow: 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

interface AnimatedDividerProps {
  visible: boolean;
}

/**
 * 动画分割线组件
 *
 * 始终渲染，通过 visible 控制显示/隐藏
 */
function AnimatedDivider({ visible }: AnimatedDividerProps) {
  return (
    <motion.div
      className="menu-divider"
      variants={dividerVariants}
      animate={visible ? 'visible' : 'hidden'}
      initial={false}
      style={{
        overflow: 'hidden',
        transformOrigin: 'left',
      }}
    />
  );
}

// ============================================
// 主组件
// ============================================

interface MainMenuProps {
  /** bot 与 friend 的菜单项完全一致（备注/特别关心/拉黑/删除均作用于好友关系） */
  targetType: 'friend' | 'bot' | 'group';
  isOwnerOrAdmin: boolean;
  isOwner: boolean;
  isMultiSelectMode: boolean;
  /** 群信息（用于显示头像） */
  group?: Group;
  /** 是否正在上传头像 */
  uploadingAvatar?: boolean;
  /** 上传进度 0-100 */
  avatarUploadProgress?: number;
  /** 是否正在加载历史记录 */
  loadingHistory?: boolean;
  /** 加载历史记录进度信息 */
  historyProgress?: string;
  /** 好友：是否已特别关心（决定按钮文案/图标） */
  isFriendSpecialCare?: boolean;
  /** 好友：是否已拉黑（决定显示「拉黑」还是「取消拉黑」） */
  isFriendBlacklisted?: boolean;
  onSetView: (view: MenuView) => void;
  onUploadAvatar: () => void;
  onToggleMultiSelect: () => void;
  /** 加载全部聊天记录 */
  onLoadAllHistory?: () => void;
  /** 好友：切换特别关心（直接执行） */
  onToggleSpecialCare?: () => void;
  /** 好友：取消拉黑（直接执行） */
  onUnblacklist?: () => void;
}

export function MainMenu({
  targetType,
  isOwnerOrAdmin,
  isOwner,
  isMultiSelectMode,
  group,
  uploadingAvatar = false,
  avatarUploadProgress = 0,
  loadingHistory = false,
  historyProgress = '',
  isFriendSpecialCare = false,
  isFriendBlacklisted = false,
  onSetView,
  onUploadAvatar,
  onToggleMultiSelect,
  onLoadAllHistory,
  onToggleSpecialCare,
  onUnblacklist,
}: MainMenuProps) {
  const isGroup = targetType === 'group';
  // friend / bot 共用好友菜单（好友关系操作对 bot 好友同样有效）
  const isFriendLike = targetType === 'friend' || targetType === 'bot';
  const title = isGroup ? '群聊设置' : '好友设置';

  return (
    <>
      <MenuHeader title={title} />

      {/* 群头像显示区域 - 仅群主/管理员可见 */}
      {isGroup && group && isOwnerOrAdmin && (
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
                progressColor="var(--upload-ring-fill)"
                backgroundColor="var(--upload-ring-track)"
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

      {/* 多选消息选项 - 始终显示 */}
      <button
        className={`menu-item ${isMultiSelectMode ? 'active' : ''}`}
        onClick={onToggleMultiSelect}
      >
        <MultiSelectIcon />
        <span>{isMultiSelectMode ? '退出多选' : '多选消息'}</span>
      </button>

      {/* 加载全部聊天记录 */}
      {onLoadAllHistory && (
        <button
          className={`menu-item ${loadingHistory ? 'loading' : ''}`}
          onClick={onLoadAllHistory}
          disabled={loadingHistory}
        >
          <CloudDownloadIcon />
          <span>
            {loadingHistory
              ? historyProgress || '加载中...'
              : '加载全部记录'}
          </span>
        </button>
      )}

      <div className="menu-divider" />

      {/* 好友菜单（friend / bot 共用） */}
      {isFriendLike && (
        <>
          <button
            className="menu-item"
            onClick={() => onSetView('edit-remark')}
          >
            <EditIcon />
            <span>设置备注</span>
          </button>
          {/* 特别关心（直接切换） */}
          <button
            className={`menu-item ${isFriendSpecialCare ? 'active' : ''}`}
            onClick={onToggleSpecialCare}
          >
            <StarIcon filled={isFriendSpecialCare} />
            <span>{isFriendSpecialCare ? '取消特别关心' : '特别关心'}</span>
          </button>
          {/* 拉黑 / 取消拉黑（拉黑经二次确认，取消拉黑直接执行） */}
          {isFriendBlacklisted ? (
            <button className="menu-item" onClick={onUnblacklist}>
              <BlockIcon />
              <span>取消拉黑</span>
            </button>
          ) : (
            <button
              className="menu-item danger"
              onClick={() => onSetView('confirm-blacklist')}
            >
              <BlockIcon />
              <span>拉黑</span>
            </button>
          )}
          <button
            className="menu-item danger"
            onClick={() => onSetView('confirm-delete')}
          >
            <TrashIcon />
            <span>删除好友</span>
          </button>
        </>
      )}

      {/* 群聊菜单 */}
      {isGroup && (
        <>
          {/* 群公告 - 所有成员可查看 */}
          <button className="menu-item" onClick={() => onSetView('notices')}>
            <MegaphoneIcon />
            <span>群公告</span>
          </button>

          {/* 管理员/群主专属功能（动画控制） */}
          <AnimatedMenuItem
            visible={isOwnerOrAdmin}
            onClick={() => onSetView('edit-name')}
            icon={<EditIcon />}
            label="修改群名称"
          />
          <AnimatedMenuItem
            visible={isOwnerOrAdmin}
            onClick={() => onSetView('invite')}
            icon={<UserPlusIcon />}
            label="邀请成员"
          />
          <AnimatedMenuItem
            visible={isOwnerOrAdmin}
            onClick={() => onSetView('invite-codes')}
            icon={<QrCodeIcon />}
            label="邀请码管理"
          />

          {/* 查看成员 - 所有成员可用 */}
          <button className="menu-item" onClick={() => onSetView('members')}>
            <UsersIcon />
            <span>查看成员</span>
          </button>

          {/* 修改群内昵称 - 所有成员可用 */}
          <button className="menu-item" onClick={() => onSetView('edit-nickname')}>
            <UserIcon />
            <span>修改群内昵称</span>
          </button>

          {/* 群主专属分割线 */}
          <AnimatedDivider visible={isOwner} />

          {/* 群主专属功能（动画控制） */}
          <AnimatedMenuItem
            visible={isOwner}
            onClick={() => onSetView('transfer-owner')}
            icon={<ArrowsRightLeftIcon />}
            label="转让群主"
          />
          <AnimatedMenuItem
            visible={isOwner}
            className="danger"
            onClick={() => onSetView('confirm-disband')}
            icon={<XCircleIcon />}
            label="解散群聊"
          />

          {/* 非群主可退出（动画控制） */}
          <AnimatedMenuItem
            visible={!isOwner}
            className="danger"
            onClick={() => onSetView('confirm-leave')}
            icon={<ExitIcon />}
            label="退出群聊"
          />
        </>
      )}
    </>
  );
}
