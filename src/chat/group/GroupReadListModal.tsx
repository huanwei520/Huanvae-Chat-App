/**
 * 群已读名单弹层
 *
 * @module chat/group/GroupReadListModal
 * @location src/chat/group/GroupReadListModal.tsx
 *
 * 展示某条群消息的已读者名单：头像 + 展示名（群昵称优先）+ 精确已读时间。
 * 桌面端为居中 modal，移动端为底部 sheet（由 isMobile() 决定）。
 * 通过 Portal 挂载到 document.body，支持点击遮罩 / ESC 关闭。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { formatMessageTime } from '../../utils/time';
import { avatarInitial } from '../shared/ReaderAvatarStack';
import type { GroupReader } from './useGroupReadReceipt';

interface GroupReadListModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 已读者名单（已排除发送者，按已读时间升序） */
  readers: GroupReader[];
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const panelVariantsDesktop = {
  initial: { opacity: 0, scale: 0.92, y: -8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: -8 },
};

const panelVariantsMobile = {
  initial: { y: '100%' },
  animate: { y: 0 },
  exit: { y: '100%' },
};

export function GroupReadListModal({ isOpen, onClose, readers }: GroupReadListModalProps) {
  const mobile = isMobile();

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="group-read-list-overlay"
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className={`group-read-list-panel ${mobile ? 'mobile' : 'desktop'}`}
            variants={mobile ? panelVariantsMobile : panelVariantsDesktop}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="group-read-list-header">
              <span className="group-read-list-title">已读 {readers.length}</span>
              <button type="button" className="group-read-list-close" onClick={onClose} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="group-read-list-body">
              {readers.map((reader) => (
                <div key={reader.userId} className="group-read-list-row">
                  <span className="group-read-list-avatar">
                    {reader.avatarUrl ? (
                      <img src={reader.avatarUrl} alt={reader.displayName} />
                    ) : (
                      <span className="group-read-list-avatar-placeholder">
                        {avatarInitial(reader.displayName)}
                      </span>
                    )}
                  </span>
                  <span className="group-read-list-name">{reader.displayName}</span>
                  <span className="group-read-list-time">
                    {reader.lastReadAt ? formatMessageTime(reader.lastReadAt) : ''}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
