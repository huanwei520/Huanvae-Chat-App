/**
 * 聊天设置侧边滑出面板（side sheet）
 *
 * @location src/chat/shared/ChatMenuPanel.tsx
 *
 * 取代原「右上角下拉菜单」（`.chat-menu-dropdown`）的承载外壳：从**屏幕右侧**滑入的
 * 整高面板 + 全屏遮罩。桌面与移动共用同一个组件、同一套交互语义（两端对齐）。
 * 外壳只管「开合 / 遮罩 / 焦点 / 无障碍」，具体内容由 children 决定（ChatMenu 的各视图）。
 *
 * ## 为什么必须 Portal 到 body（而不是原地 position: fixed）
 *
 * 移动端 `.mobile-chat-header` 声明了 `backdrop-filter: blur(20px)`——按规范，
 * `backdrop-filter` 非 none 会**为后代的 fixed 定位建立包含块**，面板若留在触发按钮
 * 所在的 DOM 位置，`inset: 0` 会退化成「铺满顶栏」而不是铺满视口。所以必须 portal。
 * 形态与 [OtherProfileView](./OtherProfileView.tsx) 的右侧抽屉保持一致（遮罩包面板、
 * 点遮罩关闭、面板 stopPropagation、Portal 到 body）。
 *
 * ## 与 useChatMenu 的「点击外部关闭」协作
 *
 * useChatMenu（src/chat/group/useChatMenu.ts）持有 `menuRef`，在打开期间监听 document
 * mousedown、点到 ref 之外就关菜单。本组件把该 ref 挂到 **sheet（内层面板）** 上：
 * - 点遮罩 → 在 sheet 之外 → useChatMenu 关闭并 setView('main')（与本组件 onClose 同向，幂等）
 * - 点面板内 → 在 sheet 之内 → 不误关
 * - 触发按钮被遮罩盖住 → 面板打开时按钮收不到 click → 不会出现「mousedown 关 + click 再开」的自锁
 *
 * ## 动画所有权（见 .claude/rules/animation.md 规则一/四）
 *
 * 遮罩的 opacity、面板的 transform(x) 全部由 framer-motion 逐帧接管；
 * 对应 CSS（`.chat-menu-scrim` / `.chat-menu-sheet`）**不得**声明 transform/opacity/all
 * 的 transition，两个 selector 均已登记 tests/animation-conflict.test.ts。
 * 选 framer-motion 而非 GSAP：退场需要「先播动画再卸载」，AnimatePresence 是现成能力，
 * 且本文件所处的 ChatMenu 子树本就全用 framer-motion。
 *
 * ## 与移动端「边缘侧滑返回」的分工
 *
 * 边缘侧滑返回（src/utils/edgeSwipe.ts）只认**左边缘 24px 起手的右滑**；本面板：
 * ① 宽度恒为 `min(400px, 100vw - 56px)`，左边缘至少距屏幕左侧 56px，面板内的拖拽起手点
 *    在几何上不可能落进边缘带；② 遮罩吞掉 touchstart 冒泡，落在左边缘带的触摸不会被
 *    祖先的返回手势看到；③ 关闭手势是**向右**拖，与返回手势方向一致但触发区不重叠。
 */

import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, type PanInfo } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { CloseIcon } from '../../components/common/Icons';

/** 焦点循环用的可聚焦元素选择器（disabled 项被排除 → 隐藏的菜单项不会进 Tab 序） */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** 向右拖多远算「甩关」（px） */
const DRAG_CLOSE_DISTANCE = 96;
/** 向右甩多快算「甩关」（px/s） */
const DRAG_CLOSE_VELOCITY = 500;

const scrimVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const sheetVariants = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
};

export interface ChatMenuPanelProps {
  /** 是否展开 */
  open: boolean;
  /** 面板主标题（聊天对象名） */
  title: string;
  /** 面板副标题（「群聊设置」/「好友设置」） */
  subtitle?: string;
  /** 关闭（点遮罩 / Esc / 关闭键 / 右滑甩关 共用同一个动作） */
  onClose: () => void;
  /**
   * 面板根节点 ref —— 交给 useChatMenu 的 `menuRef` 做「点击外部关闭」的 contains 判定。
   * 见文件头「与 useChatMenu 的协作」。
   */
  sheetRef?: RefObject<HTMLDivElement | null>;
  /** 底部固定区（错误/成功提示） */
  footer?: ReactNode;
  children: ReactNode;
}

export function ChatMenuPanel({
  open,
  title,
  subtitle,
  onClose,
  sheetRef,
  footer,
  children,
}: ChatMenuPanelProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  // 拖拽关闭只给移动端：桌面用鼠标拖抽屉既不符合直觉，也会跟列表内的文本选择抢手势
  const dragEnabled = isMobile();

  /** 面板根节点同时喂给内部逻辑与外部 menuRef */
  const attachSheet = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (sheetRef) {
        sheetRef.current = node;
      }
    },
    [sheetRef],
  );

  // Esc 关闭
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 焦点管理：打开时把焦点移进面板，关闭时还给触发它的元素
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    innerRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open]);

  /** Tab 焦点循环：面板是 aria-modal，焦点不应跑到被遮罩挡住的背景里去 */
  const handleSheetKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') {
      return;
    }
    const root = innerRef.current;
    if (!root) {
      return;
    }
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === root) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const handleDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      if (info.offset.x > DRAG_CLOSE_DISTANCE || info.velocity.x > DRAG_CLOSE_VELOCITY) {
        onClose();
      }
    },
    [onClose],
  );

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="chat-menu-scrim"
          variants={scrimVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onClick={onClose}
          // 遮罩吞掉 touchstart：落在屏幕左边缘带的触摸不会冒泡给祖先的边缘侧滑返回手势
          onTouchStart={(e) => e.stopPropagation()}
        >
          <motion.div
            ref={attachSheet}
            className="chat-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={sheetVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 360, damping: 34 }
            }
            drag={dragEnabled ? 'x' : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.6 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleSheetKeyDown}
          >
            <header className="chat-menu-sheet-header">
              <div className="chat-menu-sheet-heading">
                <h2 className="chat-menu-sheet-title" id={titleId}>{title}</h2>
                {subtitle && <p className="chat-menu-sheet-subtitle">{subtitle}</p>}
              </div>
              <button
                type="button"
                className="chat-menu-sheet-close"
                onClick={onClose}
                aria-label="关闭设置面板"
              >
                <CloseIcon />
              </button>
            </header>

            <div className="chat-menu-sheet-body">{children}</div>

            {footer && <div className="chat-menu-sheet-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
