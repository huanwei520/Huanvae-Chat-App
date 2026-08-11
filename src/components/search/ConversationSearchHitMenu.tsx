/**
 * 会话内查找命中项的次级菜单（单项：「定位到聊天消息」）+ 它的触发交互 hook
 *
 * ## 交互契约（桌面 / 移动同一套语义）
 *
 * - **桌面右键**（`contextmenu`）→ 弹菜单
 * - **移动长按 500ms** → 弹同一个菜单（移动端没有右键；位移超 10px 视为在滚列表，取消）
 * - **键盘 Enter / Space** → 弹同一个菜单。键盘没有「右键」，而「定位」是命中项上唯一
 *   必须键盘可达的动作，所以主键位给菜单；打开预览（媒体的主操作）只由左键 / 触摸提供。
 *   ⚠️ 已知取舍：键盘用户无法打开大图预览，只能定位。
 *
 * 左键单击**不**弹菜单 —— 它是媒体的「打开 / 播放」主操作（见 ConversationSearchHit）。
 *
 * ## 为什么不直接复用 components/files/FileContextMenu
 *
 * 那个组件把「文件」语义写死在了接口与文案里：`onDelete` 是**必填** prop 且恒渲染
 * 「删除文件」项，另两项是「在文件夹中显示」/「下载文件」。查找命中项要的是**唯一一项
 * 「定位到聊天消息」**，既不能删文件、也没有下载工作流。要复用就得把 onDelete 改成可选
 * 并塞进一个与文件无关的新项 —— 那是把查找语义污染进文件组件、并弱化它「删除项必然存在」
 * 的契约。它的配套 FileMenuController 更是绑死 `FileItem` + useFileCache 下载态，与此处无关。
 * 故按 components/unified/ConversationContextMenu 的先例（同样是「单项菜单」）另写一个薄组件，
 * **复用既有 CSS 类** `.message-context-menu` / `.context-menu-item` / `.mobile-horizontal`
 * （src/styles/pages/main.css），不新增样式。
 *
 * 入场有动画、退场直接消失：菜单由命中项**条件渲染**（关掉即卸载），而不是每个命中项常驻
 * 一个 `isOpen=false` 的 portal —— 一页最多 50 条结果，常驻 50 个 portal 不划算。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { isMobile } from '../../utils/platform';

/** 长按判定时长（ms）：与「我的文件」卡片、会话卡片长按同口径 */
const LONG_PRESS_MS = 500;
/** 长按期间允许的手指位移（px）：超过即认为在滚列表，取消长按 */
const LONG_PRESS_MOVE_TOLERANCE = 10;
/** 单项菜单的尺寸估算，用于把菜单夹在视口内 */
const MENU_WIDTH = 176;
const MENU_HEIGHT = 48;
/** 视口边缘留白 */
const VIEWPORT_PADDING = 10;

/** 菜单锚点：桌面用光标坐标，移动端用命中项矩形把菜单摆到它上方居中 */
export interface SearchHitMenuAnchor {
  x: number;
  y: number;
  rect: DOMRect | null;
}

/** 挂在命中项根元素上的触发 props（右键 / 长按 / 键盘） */
export interface SearchHitMenuTriggerProps {
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export interface UseSearchHitMenuResult {
  /** 非 null 即菜单打开中 */
  menuAnchor: SearchHitMenuAnchor | null;
  closeMenu: () => void;
  triggerProps: SearchHitMenuTriggerProps;
  /**
   * 包住「左键主操作」：长按刚弹过菜单时，浏览器随后补发的那次合成 click 要吞掉，
   * 否则移动端长按会同时弹菜单 + 打开预览。
   */
  guardPrimaryClick: (run: () => void) => () => void;
}

/** 命中项的次级菜单状态机（每个命中项一份，故必须是 hook 而非全局状态） */
export function useSearchHitMenu(): UseSearchHitMenuResult {
  const [menuAnchor, setMenuAnchor] = useState<SearchHitMenuAnchor | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  // 卸载时清掉未触发的长按定时器（滚动加载会不断换掉列表里的条目）
  useEffect(() => cancelLongPress, [cancelLongPress]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuAnchor({
      x: e.clientX,
      y: e.clientY,
      rect: e.currentTarget.getBoundingClientRect(),
    });
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({ x: rect.left, y: rect.bottom, rect });
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) {
      return;
    }
    // 合成事件的 currentTarget 在回调返回后会被置空，坐标与矩形都必须同步取出来
    const { clientX, clientY } = touch;
    const rect = e.currentTarget.getBoundingClientRect();
    longPressFiredRef.current = false;
    touchStartPosRef.current = { x: clientX, y: clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setMenuAnchor({ x: clientX, y: clientY, rect });
    }, LONG_PRESS_MS);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchStartPosRef.current;
    const touch = e.touches[0];
    if (!longPressTimerRef.current || !start || !touch) {
      return;
    }
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const guardPrimaryClick = useCallback(
    (run: () => void) => () => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      run();
    },
    [],
  );

  return {
    menuAnchor,
    closeMenu,
    triggerProps: {
      onContextMenu,
      onKeyDown,
      onTouchStart,
      onTouchMove,
      onTouchEnd: cancelLongPress,
    },
    guardPrimaryClick,
  };
}

/** 定位图标（与「跳到消息」语义一致的准星） */
function LocateIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width={16}
      height={16}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface ConversationSearchHitMenuProps {
  anchor: SearchHitMenuAnchor;
  /** 「定位到聊天消息」被选中 */
  onLocate: () => void;
  onClose: () => void;
}

export function ConversationSearchHitMenu({
  anchor,
  onLocate,
  onClose,
}: ConversationSearchHitMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const mobile = isMobile();

  // 键盘 Enter 打开菜单后焦点必须进入菜单，否则键盘用户到不了唯一那一项
  useEffect(() => {
    itemRef.current?.focus();
  }, []);

  // 点击 / 触摸外部、滚动、Esc 关闭（同 MessageContextMenu / FileContextMenu 模式）
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleTouchOutside = (e: TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // 延迟注册：否则触发菜单的那次 mousedown / touchstart 自己就把菜单关了
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleTouchOutside, { passive: true });
      document.addEventListener('scroll', handleScroll, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleTouchOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const getMenuStyle = (): React.CSSProperties => {
    // 移动端：贴在命中项上方居中（长按时手指正压着命中项本身）
    if (mobile && anchor.rect) {
      const centerX = anchor.rect.left + anchor.rect.width / 2;
      let x = centerX - MENU_WIDTH / 2;
      if (x + MENU_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
        x = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING;
      }
      if (x < VIEWPORT_PADDING) {
        x = VIEWPORT_PADDING;
      }
      let y = anchor.rect.top - MENU_HEIGHT - 8;
      if (y < VIEWPORT_PADDING) {
        y = anchor.rect.bottom + 8;
      }
      return { position: 'fixed', left: x, top: y, zIndex: 99999 };
    }

    // 桌面端：光标位置，夹在视口内
    let x = anchor.x;
    let y = anchor.y;
    if (x + MENU_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
      x = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING;
    }
    if (y + MENU_HEIGHT > window.innerHeight - VIEWPORT_PADDING) {
      y = window.innerHeight - MENU_HEIGHT - VIEWPORT_PADDING;
    }
    if (x < VIEWPORT_PADDING) {
      x = VIEWPORT_PADDING;
    }
    if (y < VIEWPORT_PADDING) {
      y = VIEWPORT_PADDING;
    }
    return { position: 'fixed', left: x, top: y, zIndex: 99999 };
  };

  return createPortal(
    <motion.div
      ref={menuRef}
      className={`message-context-menu${mobile ? ' mobile-horizontal' : ''}`}
      style={getMenuStyle()}
      role="menu"
      aria-label="命中项操作"
      initial={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
      // 🔴 portal 只搬 DOM，**React 合成事件仍沿 React 树冒泡**到宿主命中项上 ——
      // 不在这里截停，点「定位到聊天消息」会同时触发命中项的左键主操作（打开预览），
      // 在菜单里右键 / 长按 / 敲 Enter 也会再弹一层菜单。故本元素是事件的封闭边界。
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        className="context-menu-item"
        onClick={() => {
          onLocate();
          onClose();
        }}
      >
        <LocateIcon />
        <span>定位到聊天消息</span>
      </button>
    </motion.div>,
    document.body,
  );
}
