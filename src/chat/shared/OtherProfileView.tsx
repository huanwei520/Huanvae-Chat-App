/**
 * 他人完整资料页容器（顶层挂载，订阅 profileViewStore）
 *
 * @location src/chat/shared/OtherProfileView.tsx
 *
 * 按平台选择外壳：桌面=右侧抽屉（从右滑入）/ 移动=整页（从右滑入），内部渲染
 * OtherProfilePanel。通过 Portal 挂到 document.body，点击遮罩 / ESC 关闭。
 * 在 Main（桌面）与 MobileMain（移动）各挂一个，由 isMobile() 决定外壳形态。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { useProfileViewStore } from '../../stores';
import { OtherProfilePanel } from './OtherProfilePanel';

interface OtherProfileViewProps {
  /** 发送消息：切到与该用户的私聊（由挂载方按平台实现导航） */
  onSendMessage: (userId: string) => void;
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const panelVariants = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
};

export function OtherProfileView({ onSendMessage }: OtherProfileViewProps) {
  const userId = useProfileViewStore((s) => s.userId);
  const close = useProfileViewStore((s) => s.close);
  const mobile = isMobile();

  useEffect(() => {
    if (!userId) { return undefined; }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [userId, close]);

  const content = (
    <AnimatePresence>
      {userId && (
        <motion.div
          className="other-profile-overlay"
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={close}
        >
          <motion.div
            className={`other-profile-shell ${mobile ? 'mobile' : 'desktop'}`}
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <OtherProfilePanel userId={userId} onClose={close} onSendMessage={onSendMessage} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
