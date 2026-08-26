/**
 * 群详情弹窗容器（顶层挂载，订阅 groupDetailStore）
 *
 * @location src/chat/shared/GroupDetailView.tsx
 *
 * 按平台选择外壳：桌面=右侧抽屉（从右滑入）/ 移动=整页（从右滑入），内部渲染
 * GroupDetailPanel。复用 OtherProfileView 的通用抽屉外壳（.other-profile-overlay /
 * .other-profile-shell，已在 animation-conflict 测试注册）。通过 Portal 挂到 document.body，
 * 点击遮罩 / ESC 关闭。在 Main（桌面）与 MobileMain（移动）各挂一个，由 isMobile() 决定外壳形态。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { useGroupDetailStore } from '../../stores';
import { useMobileBackOverlay } from '../../hooks/useMobileBackHandler';
import { GroupDetailPanel } from './GroupDetailPanel';
import type { ChatTarget, Group } from '../../types/chat';

interface GroupDetailViewProps {
  /** 「进入群聊」直达会话（由 Main/MobileMain 注入 handleSelectTarget） */
  onOpenChat?: (target: ChatTarget) => void;
  /** 加入/申请成功后刷新群列表（由 Main/MobileMain 注入 refreshGroups） */
  onRefreshGroups?: () => void;
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

export function GroupDetailView({ onOpenChat, onRefreshGroups }: GroupDetailViewProps = {}) {
  const groupId = useGroupDetailStore((s) => s.groupId);
  // 本次是从哪条加群路径打开的（扫码/搜索/好友推荐）—— 面板发起 apply 时要原样带给服务端
  const source = useGroupDetailStore((s) => s.source);
  const close = useGroupDetailStore((s) => s.close);
  const mobile = isMobile();

  // Android 系统返回：与他人资料页同族的洞 —— 手势导航下最左边缘归系统，
  // 返回事件走 Android back 过来；不认领就一路落到默认行为 = **退出 App**。
  useMobileBackOverlay(() => {
    if (!groupId) {
      return false;
    }
    close();
    return true;
  });

  const handleEnter = (group: Group) => {
    onOpenChat?.({ type: 'group', data: group });
  };

  useEffect(() => {
    if (!groupId) { return undefined; }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [groupId, close]);

  const content = (
    <AnimatePresence>
      {groupId && (
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
            <GroupDetailPanel
              groupId={groupId}
              source={source}
              onClose={close}
              onEnterGroup={handleEnter}
              onRefreshGroups={onRefreshGroups}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
