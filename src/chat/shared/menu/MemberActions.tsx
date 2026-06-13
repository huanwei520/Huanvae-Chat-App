/**
 * 成员操作菜单组件
 */

import { motion, AnimatePresence } from 'framer-motion';
import { MenuHeader } from './MenuHeader';
import { ShieldIcon, MuteIcon, TrashIcon, UserIcon, StarIcon, BlockIcon, EditIcon } from '../../../components/common/Icons';
import { isMuted } from './utils';
import type { GroupMember } from '../../../api/groups';

interface MemberActionsProps {
  member: GroupMember;
  isOwner: boolean;
  loading: boolean;
  /** 是否可对该成员行使管理操作（设管理员/禁言/移出）；看资料/备注/特别关心/屏蔽人人可用 */
  canModerate: boolean;
  /** 该成员是否已被我特别关心（M3） */
  isSpecialCared: boolean;
  /** 该成员消息是否已被我屏蔽（D6 群内屏蔽） */
  isBlocked: boolean;
  onBack: () => void;
  /** 看该成员公开资料（只读资料页） */
  onViewProfile: () => void;
  /** 特别关心/取消（M3） */
  onToggleSpecialCare: () => void;
  /** 屏蔽/取消屏蔽该成员在本群的消息（D6） */
  onToggleBlock: () => void;
  /** 打开备注输入弹窗（D7） */
  onSetRemark: () => void;
  onToggleAdmin: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onKick: () => void;
}

/** 禁言按钮动画变体 */
const muteButtonVariants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.15 },
  },
};

/** 图标动画变体 */
const iconVariants = {
  initial: { rotate: -90, opacity: 0 },
  animate: {
    rotate: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 500, damping: 25 },
  },
  exit: {
    rotate: 90,
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

export function MemberActions({
  member,
  isOwner,
  loading,
  canModerate,
  isSpecialCared,
  isBlocked,
  onBack,
  onViewProfile,
  onToggleSpecialCare,
  onToggleBlock,
  onSetRemark,
  onToggleAdmin,
  onMute,
  onUnmute,
  onKick,
}: MemberActionsProps) {
  const memberIsMuted = isMuted(member);

  return (
    <>
      <MenuHeader title={member.user_nickname} onBack={onBack} />
      <div className="menu-actions">
        {/* 人人可用的成员私有操作 */}
        <button className="menu-item" onClick={onViewProfile}>
          <UserIcon />
          <span>看资料</span>
        </button>
        <button className="menu-item" onClick={onToggleSpecialCare} disabled={loading}>
          <StarIcon filled={isSpecialCared} />
          <span>{isSpecialCared ? '取消特别关心' : '特别关心'}</span>
        </button>
        <button className="menu-item" onClick={onToggleBlock} disabled={loading}>
          <BlockIcon />
          <span>{isBlocked ? '取消屏蔽消息' : '屏蔽此人消息'}</span>
        </button>
        <button className="menu-item" onClick={onSetRemark}>
          <EditIcon />
          <span>设置备注</span>
        </button>

        {/* 管理操作：仅群主/管理员、且对该成员有权限时显示 */}
        {canModerate && (
          <>
            {isOwner && (
              <button
                className="menu-item"
                onClick={onToggleAdmin}
                disabled={loading}
              >
                <ShieldIcon />
                <span>
                  {member.role === 'admin' ? '取消管理员' : '设为管理员'}
                </span>
              </button>
            )}
            <AnimatePresence mode="wait" initial={false}>
              {memberIsMuted ? (
                <motion.button
                  key="unmute"
                  className="menu-item"
                  onClick={onUnmute}
                  disabled={loading}
                  variants={muteButtonVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <motion.span
                    variants={iconVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    style={{ display: 'inline-flex' }}
                  >
                    <MuteIcon />
                  </motion.span>
                  <span>解除禁言</span>
                </motion.button>
              ) : (
                <motion.button
                  key="mute"
                  className="menu-item"
                  onClick={onMute}
                  variants={muteButtonVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <motion.span
                    variants={iconVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    style={{ display: 'inline-flex' }}
                  >
                    <MuteIcon />
                  </motion.span>
                  <span>禁言</span>
                </motion.button>
              )}
            </AnimatePresence>
            <button
              className="menu-item danger"
              onClick={onKick}
            >
              <TrashIcon />
              <span>移出群聊</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
