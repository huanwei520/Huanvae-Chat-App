/**
 * 成员操作菜单组件
 */

import { motion, AnimatePresence } from 'framer-motion';
import { MenuHeader } from './MenuHeader';
import { ShieldIcon, MuteIcon, TrashIcon } from '../../common/Icons';
import { isMuted } from './utils';
import type { GroupMember } from '../../../api/groups';

interface MemberActionsProps {
  member: GroupMember;
  isOwner: boolean;
  loading: boolean;
  onBack: () => void;
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
  onBack,
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
      </div>
    </>
  );
}
