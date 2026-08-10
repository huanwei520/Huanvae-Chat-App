/**
 * 聊天设置侧边滑出面板（side sheet）
 *
 * @location src/chat/shared/ChatMenuPanel.tsx
 *
 * 取代原「右上角下拉菜单」（`.chat-menu-dropdown`）的承载外壳：从**屏幕右侧**滑入的面板。
 * 桌面与移动共用同一个组件、同一套交互语义（两端对齐）。外壳只管「开合 / 定位 / 焦点 /
 * 无障碍」，具体内容由 children 决定（ChatMenu 的各视图）。
 *
 * ## 非模态：没有遮罩，背景照常可用
 *
 * 面板**不铺**任何变暗遮罩层，也**不带** `aria-modal` —— 打开期间聊天区仍可正常操作
 * （点一下就顺带把面板关掉，关闭动作由 useChatMenu 的「点击外部」通道承担）。
 * 这是产品口径：侧边栏是常驻式侧板，不是拦住整屏的对话框。
 *
 * ## 只盖消息区 + 输入框，不盖聊天标题栏
 *
 * 面板顶边对齐到聊天标题栏（`.chat-header` / `.mobile-chat-header`）的**下沿**：
 * 打开时用 `triggerRef` 往上 `closest()` 找到那个标题栏，量它的 `bottom` 写进内联
 * `top`（配合 CSS 的 `bottom: 0` 铺到底）。标题栏高度两端不同、移动端还含安全区，
 * 没有可写死的常量，只能实测；window resize 与标题栏自身尺寸变化（ResizeObserver）
 * 都会重量一次。量不到标题栏时退化为贴视口顶（0），不至于把面板整个顶飞。
 *
 * ## 为什么必须 Portal 到 body（而不是原地 position: fixed）
 *
 * 移动端 `.mobile-chat-header` 声明了 `backdrop-filter: blur(20px)`——按规范，
 * `backdrop-filter` 非 none 会**为后代的 fixed 定位建立包含块**，面板若留在触发按钮
 * 所在的 DOM 位置，fixed 定位会退化成相对顶栏，而不是相对视口。所以必须 portal。
 *
 * ## 与 useChatMenu 的「点击外部关闭」协作
 *
 * useChatMenu（src/chat/group/useChatMenu.ts）持有 `menuRef`，在打开期间监听 document
 * mousedown、点到 ref 之外就关菜单。本组件把该 ref 挂到 sheet 上：点面板内在 ref 之内、
 * 不误关；点面板外（含聊天区）在 ref 之外 → 关闭。
 * ⚠️ 没有遮罩挡着，触发按钮在面板打开时是**可点的**，于是「mousedown 关 + click 再开」
 * 会自锁；ChatMenu 因此在触发按钮上 stopPropagation 掉 mousedown（见该文件注释）。
 *
 * ## 动画所有权（见 .claude/rules/animation.md 规则一/四）
 *
 * 面板的 transform(x) 由 framer-motion 逐帧接管，`.chat-menu-sheet` **不得**声明
 * transform/opacity/all 的 transition（已登记 tests/animation-conflict.test.ts）。
 * 内联 `top` 是 React 受控的静态定位值、不参与动画，与 motion 写的 transform 不冲突。
 * 选 framer-motion 而非 GSAP：退场需要「先播动画再卸载」，AnimatePresence 是现成能力，
 * 且本文件所处的 ChatMenu 子树本就全用 framer-motion。
 *
 * ## 与移动端「边缘侧滑返回」的分工
 *
 * 边缘侧滑返回（src/utils/edgeSwipe.ts）只认**左边缘 24px 起手的右滑**；本面板宽度恒为
 * `min(400px, 100vw - 56px)`，左边缘至少距屏幕左侧 56px，面板内的拖拽起手点在几何上
 * 不可能落进边缘带；关闭手势是**向右**拖，与返回手势方向一致但触发区不重叠。
 * （去掉遮罩后左边缘带露出来了 —— 落在那里的触摸本就该交给返回手势，属于非模态的应有之义。）
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, type PanInfo } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { CloseIcon } from '../../components/common/Icons';

/**
 * 顶边锚点：面板顶边贴齐这个祖先元素的下沿（= 聊天标题栏，两端各一个类名）。
 * 面板是聊天专用外壳，认这两个类名不算越界耦合。
 */
const HEADER_ANCHOR_SELECTOR = '.chat-header, .mobile-chat-header';

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
  /** 关闭（Esc / 关闭键 / 右滑甩关 / 点面板外 共用同一个动作） */
  onClose: () => void;
  /**
   * 面板根节点 ref —— 交给 useChatMenu 的 `menuRef` 做「点击外部关闭」的 contains 判定。
   * 见文件头「与 useChatMenu 的协作」。
   */
  sheetRef?: RefObject<HTMLDivElement | null>;
  /**
   * 触发按钮所在节点的 ref —— 面板据此往上找聊天标题栏，把顶边贴在它下沿
   * （不遮住标题栏，见文件头）。不传 = 贴视口顶。
   */
  triggerRef?: RefObject<HTMLElement | null>;
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
  triggerRef,
  footer,
  children,
}: ChatMenuPanelProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  /** 面板顶边距视口顶的距离（px）= 聊天标题栏的下沿 */
  const [topOffset, setTopOffset] = useState(0);
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

  // 顶边贴齐聊天标题栏下沿：标题栏高度两端不同、移动端还含安全区，只能实测
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const header = triggerRef?.current?.closest<HTMLElement>(HEADER_ANCHOR_SELECTOR) ?? null;
    if (!header) {
      // 量不到（未挂在聊天顶栏里）→ 贴视口顶，不做别的猜测
      setTopOffset(0);
      return undefined;
    }
    const measure = () => setTopOffset(Math.max(0, header.getBoundingClientRect().bottom));
    measure();
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [open, triggerRef]);

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

  /**
   * Tab 焦点循环。
   *
   * 面板已不是模态（背景可点、无遮罩、无 aria-modal），这里留住 Tab 不是为了「拦住用户」，
   * 而是因为面板被 portal 到 `document.body` 的**末尾** —— 不成环的话，从最后一项再 Tab
   * 会直接掉出文档、落到浏览器 UI 上，回不来。鼠标与读屏对背景的访问不受影响。
   */
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
          ref={attachSheet}
          className="chat-menu-sheet"
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={{ top: topOffset }}
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
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
