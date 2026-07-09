/**
 * 群已读名单弹层
 *
 * @module chat/group/GroupReadListModal
 * @location src/chat/group/GroupReadListModal.tsx
 *
 * 展示某条群消息的已读者名单：头像 + 展示名（群昵称优先）+ 精确已读时间。
 * 桌面端为居中 modal，移动端为底部 sheet（由 isMobile() 决定）。
 * 通过 Portal 挂载到 document.body，支持点击遮罩 / ESC 关闭。
 *
 * 动画分工（单一所有权，避免同元素同属性双控）：
 * - 容器层（.group-read-list-overlay 遮罩淡入 + .group-read-list-panel 面板进出场）→ framer-motion。
 * - 列表项（.group-read-list-row）错峰滑入（opacity + translateY，stagger）→ GSAP。
 *   两者作用于**不同 DOM 节点**，互不抢同一元素的 transform/opacity。
 * - GSAP 仅动 transform/opacity；.group-read-list-row 在 CSS 中无 transform/opacity 的 transition。
 * - useGSAP 单 scope（面板）自动 revert；revertOnUpdate 防止 matchMedia 累积；tween 用 overwrite:'auto'。
 * - prefers-reduced-motion 经 gsap.matchMedia() 兜底为瞬时无动。
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { isMobile } from '../../utils/platform';
import { formatMessageTime } from '../../utils/time';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import type { GroupReader } from './useGroupReadReceipt';

gsap.registerPlugin(useGSAP);

interface GroupReadListModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 已读者名单（已排除发送者，按已读时间升序；displayName 已在上游套用群内私有备注 D7） */
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
  /** 面板根节点（GSAP scope）；列表项错峰滑入限定在此范围内 */
  const panelRef = useRef<HTMLDivElement>(null);

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

  // 列表项错峰滑入（GSAP）。容器层动画仍由 framer-motion 负责，二者作用于不同节点。
  useGSAP(
    () => {
      const scope = panelRef.current;
      if (!scope) {
        return;
      }
      // 关闭时(isOpen=false)只走 useGSAP 的 revert 清理,不再对行重放进场动画——
      // 否则退场期间 .group-read-list-row 会重新淡入+上滑(移动端 sheet 下滑时可见)。
      if (!isOpen) {
        return;
      }
      const rows = gsap.utils.toArray<HTMLElement>(scope.querySelectorAll('.group-read-list-row'));
      if (rows.length === 0) {
        return;
      }

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rows, {
          opacity: 0,
          y: 8,
          duration: 0.3,
          ease: 'power2.out',
          stagger: 0.04,
          overwrite: 'auto',
          clearProps: 'opacity,y',
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(rows, { opacity: 1, y: 0, clearProps: 'opacity,y' });
      });
    },
    { scope: panelRef, dependencies: [isOpen, readers], revertOnUpdate: true },
  );

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
            ref={panelRef}
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
                      <AvatarPlaceholder name={reader.displayName} fontSize={13} />
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
