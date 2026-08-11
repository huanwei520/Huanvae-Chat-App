/**
 * 他人完整资料页容器（顶层挂载，订阅 profileViewStore）
 *
 * @location src/chat/shared/OtherProfileView.tsx
 *
 * 按平台选择外壳：桌面=右侧抽屉（从右滑入）/ 移动=整页（从右滑入），内部渲染
 * 只读的 OtherProfilePanel。通过 Portal 挂到 document.body，点击遮罩 / ESC 关闭。
 * 在 Main（桌面）与 MobileMain（移动）各挂一个，由 isMobile() 决定外壳形态。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { useProfileViewStore } from '../../stores';
import { useEdgeSwipeBack } from '../../hooks/useEdgeSwipeBack';
import { OtherProfilePanel } from './OtherProfilePanel';
import { friendChatTarget } from '../../utils/chatTarget';
import type { ChatTarget, Friend } from '../../types/chat';

interface OtherProfileViewProps {
  /** 「发消息」直达会话（由 Main/MobileMain 注入 handleSelectTarget） */
  onOpenChat?: (target: ChatTarget) => void;
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

export function OtherProfileView({ onOpenChat }: OtherProfileViewProps = {}) {
  const userId = useProfileViewStore((s) => s.userId);
  const botUsername = useProfileViewStore((s) => s.botUsername);
  const close = useProfileViewStore((s) => s.close);
  const mobile = isMobile();

  // 边缘侧滑返回：达标后调用的就是 close —— 与右上角关闭键、Esc、点遮罩同一个返回动作。
  // hook 必须无条件调用（React 规则），是否生效由下方按 mobile 决定挂不挂 style/handlers。
  const { x: swipeX, handlers: swipeHandlers } = useEdgeSwipeBack({ onBack: close });

  const handleSendMessage = (friend: Friend) => {
    onOpenChat?.(friendChatTarget(friend));
  };

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
            {/* 侧滑层：整页视觉在这一层，x 由 useEdgeSwipeBack 的 MotionValue 独占（跟手/回弹）。
                外层 shell 的 transform 归 panelVariants（入退场），两层各有各的 transform、
                互不抢帧（.claude/rules/animation.md 规则一/四），与 MobileProfilePage 同一手法。
                仅移动端挂：桌面是右侧抽屉，鼠标没有「边缘侧滑」这一说。 */}
            <motion.div
              className="other-profile-swipe-layer"
              style={mobile ? { x: swipeX } : undefined}
              {...(mobile ? swipeHandlers : {})}
            >
              <OtherProfilePanel
                userId={userId}
                botUsername={botUsername ?? undefined}
                onClose={close}
                onSendMessage={handleSendMessage}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
