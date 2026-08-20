/**
 * 主菜单视图组件（侧边滑出面板的「main」视图）
 *
 * 内容按**语义分组**呈现，而不是一条平铺的长列表：每组有组标题，破坏性操作单独成组
 * 且排在最后（`.menu-group--danger`）。面板外壳、标题栏、关闭键在
 * [ChatMenuPanel](../ChatMenuPanel.tsx)，本组件只产出面板 body 里的分组内容
 * （因此不再自带 MenuHeader —— 聊天对象名与「群聊设置/好友设置」由面板标题栏承担）。
 *
 * ## 分组
 *
 * | 目标 | 分组（自上而下） |
 * |------|------------------|
 * | 好友 / bot | 会话 · 好友 · 危险操作 |
 * | 群聊 | **群成员（头像网格）** · 会话 · 群聊 · 群管理（owner/admin） · 危险操作 |
 *
 * 群成员是**第一组**：微信式头像网格直接把人铺出来（见 MemberGrid.tsx），点头像看资料。
 * 「成员管理」（备注 / 屏蔽 / 特别关心 / 设管理员 / 禁言 / 移出）是另一条链路，仍作为
 * 菜单项留在「群聊」组里 —— 网格点击只承载"看资料"，不承载这些操作，两者不重复。
 * 危险组无论如何**恒为最后一组**（有测试断言）。
 *
 * ## 角色变化用「始终渲染 + 状态动画」
 *
 * 群角色会被 WebSocket 实时改写（升管理员 / 转让群主），所以角色相关的项与「群管理」
 * 整组都**常驻 DOM**，靠 animate 在 visible/hidden 间过渡（height/padding/opacity），
 * 而不是条件卸载 —— 条件卸载会让权限变化表现为「突然多一块」。
 *
 * ⚠️ hidden 态必须 `disabled`：只把 height 收成 0 的话按钮仍在 Tab 序里、Enter 仍会触发，
 * 就成了「能聚焦却按了没反应（甚至误触发）」的可达性坑。
 */

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  UserIcon,
  CloudDownloadIcon,
  StarIcon,
  BlockIcon,
  SearchIcon,
  ShieldIcon,
} from '../../../components/common/Icons';
import { CircularProgress } from '../../../components/common/CircularProgress';
import { GroupAvatar } from '../../../components/common/Avatar';
import { MemberGrid } from './MemberGrid';
import type { GroupMember } from '../../../api/groups';
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

/** 整组显隐动画（组标题跟着一起收） */
const groupVariants = {
  visible: {
    opacity: 1,
    height: 'auto' as const,
    transition: { duration: 0.2, ease: 'easeOut' as const },
  },
  hidden: {
    opacity: 0,
    height: 0,
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
 * 隐藏时 height=0 + disabled 确保不影响布局，也不留在 Tab 序 / 不可被 Enter 误触发
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
      disabled={!visible}
      aria-hidden={!visible}
      variants={menuItemVariants}
      animate={visible ? 'visible' : 'hidden'}
      custom={isEnteringRef.current}
      initial={false}
      style={{ overflow: 'hidden' }}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

interface MenuGroupProps {
  title: string;
  /** 破坏性分组：整组走危险配色并排在最后 */
  danger?: boolean;
  children: React.ReactNode;
}

/** 语义分组：组标题 + 组内容 */
function MenuGroup({ title, danger = false, children }: MenuGroupProps) {
  return (
    <section className={`menu-group${danger ? ' menu-group--danger' : ''}`}>
      <h3 className="menu-group-title">{title}</h3>
      {children}
    </section>
  );
}

interface AnimatedMenuGroupProps extends MenuGroupProps {
  visible: boolean;
}

/** 按角色显隐的分组（如「群管理」）：始终渲染，靠 animate 收展 */
function AnimatedMenuGroup({ visible, title, danger = false, children }: AnimatedMenuGroupProps) {
  return (
    <motion.section
      className={`menu-group${danger ? ' menu-group--danger' : ''}`}
      variants={groupVariants}
      animate={visible ? 'visible' : 'hidden'}
      initial={false}
      aria-hidden={!visible}
      style={{ overflow: 'hidden' }}
    >
      <h3 className="menu-group-title">{title}</h3>
      {children}
    </motion.section>
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
  /** 群成员（头像网格用；非群聊时忽略） */
  members?: GroupMember[];
  /** 成员是否加载中 */
  loadingMembers?: boolean;
  /** D7 群内私有备注映射（user_id → 备注名），成员网格展示名优先用它 */
  memberRemarks?: Record<string, string>;
  /** 当前用户 ID（成员网格给自己那格标「我」） */
  currentUserId?: string;
  /** 点成员网格里的某人 → 打开其资料 */
  onSelectMember?: (member: GroupMember) => void;
  /** 打开会话内消息查找（无本地会话时不传 → 不显示入口） */
  onOpenSearch?: () => void;
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
  members = [],
  loadingMembers = false,
  memberRemarks,
  currentUserId,
  onSelectMember,
  onOpenSearch,
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

  return (
    <>
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

      {/* ===== 群成员网格（群聊第一组；微信式，点头像看资料） ===== */}
      {isGroup && onSelectMember && (
        <MemberGrid
          members={members}
          loading={loadingMembers}
          remarks={memberRemarks}
          currentUserId={currentUserId}
          onSelect={onSelectMember}
        />
      )}

      {/* ===== 会话（两种目标共有） ===== */}
      <MenuGroup title="会话">
        {onOpenSearch && (
          <button className="menu-item" onClick={onOpenSearch}>
            <SearchIcon />
            <span>查找聊天记录</span>
          </button>
        )}

        <button
          className={`menu-item ${isMultiSelectMode ? 'active' : ''}`}
          onClick={onToggleMultiSelect}
        >
          <MultiSelectIcon />
          <span>{isMultiSelectMode ? '退出多选' : '多选消息'}</span>
        </button>

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
      </MenuGroup>

      {/* ===== 好友（friend / bot 共用） ===== */}
      {isFriendLike && (
        <>
          <MenuGroup title="好友">
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
            {/* 取消拉黑是恢复性操作，归「好友」组；拉黑是破坏性的，归下方危险组 */}
            {isFriendBlacklisted && (
              <button className="menu-item" onClick={onUnblacklist}>
                <BlockIcon />
                <span>取消拉黑</span>
              </button>
            )}
          </MenuGroup>

          <MenuGroup title="危险操作" danger>
            {!isFriendBlacklisted && (
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
          </MenuGroup>
        </>
      )}

      {/* ===== 群聊 ===== */}
      {isGroup && (
        <>
          <MenuGroup title="群聊">
            {/* 群公告 / 查看成员 / 群内昵称 - 所有成员可用 */}
            <button className="menu-item" onClick={() => onSetView('notices')}>
              <MegaphoneIcon />
              <span>群公告</span>
            </button>
            {/* 「浏览成员」已由上方头像网格承担；这一项留的是网格点击不承载的另一条链路：
                备注 / 屏蔽 / 特别关心（人人可用）+ 设管理员 / 禁言 / 移出（管理员）。
                故改名为「成员管理」，与网格不重复。 */}
            <button className="menu-item" onClick={() => onSetView('members')}>
              <UsersIcon />
              <span>成员管理</span>
            </button>
            <button className="menu-item" onClick={() => onSetView('edit-nickname')}>
              <UserIcon />
              <span>修改群内昵称</span>
            </button>
          </MenuGroup>

          {/* 管理员/群主专属（整组随角色收展） */}
          <AnimatedMenuGroup visible={isOwnerOrAdmin} title="群管理">
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
            {/* 入群与可见性：契约写死 PUT /join-policy 仅群主（管理员也会被后端 403），
                所以这里 gating 用 isOwner 而不是 isOwnerOrAdmin —— 给管理员看一个点了必 403
                的入口，比不给更糟。 */}
            <AnimatedMenuItem
              visible={isOwner}
              onClick={() => onSetView('join-policy')}
              icon={<ShieldIcon />}
              label="入群与可见性"
            />
            {/* 转让群主：群主专属，在管理组内单独 gating */}
            <AnimatedMenuItem
              visible={isOwner}
              onClick={() => onSetView('transfer-owner')}
              icon={<ArrowsRightLeftIcon />}
              label="转让群主"
            />
          </AnimatedMenuGroup>

          <MenuGroup title="危险操作" danger>
            {/* 群主解散 / 非群主退出，二选一（角色变化时靠动画互换） */}
            <AnimatedMenuItem
              visible={isOwner}
              className="danger"
              onClick={() => onSetView('confirm-disband')}
              icon={<XCircleIcon />}
              label="解散群聊"
            />
            <AnimatedMenuItem
              visible={!isOwner}
              className="danger"
              onClick={() => onSetView('confirm-leave')}
              icon={<ExitIcon />}
              label="退出群聊"
            />
          </MenuGroup>
        </>
      )}
    </>
  );
}
