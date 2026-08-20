/**
 * 侧边栏组件
 *
 * 采用"核心固定 + 可钉工具 + 更多收纳"三层布局：
 * - 固定区：消息、好友、群聊（高频核心操作，不可拖动）
 * - 钉住区（SidebarPinZone）：用户从"更多"面板拖出的工具项，图标常驻侧边栏
 * - 更多浮层（SidebarMorePanel）：未钉住的低频工具（文件/局域网互传/会议/小程序/
 *   机器人/低代码/VPN/股票），点击"更多"展开
 * - 底部区：设置、退出
 *
 * 双区拖放（dnd-kit）：
 * - DndContext 包裹整个侧边栏 + Portal 浮层；useDroppable 两个容器（'pinned'/'more'）
 *   + 各自 SortableContext 垂直排序；跨容器移动在 onDragOver 编排，onDragEnd 同区
 *   arrayMove 并持久化（localStorage key: sidebar_layout，schema 见 sidebarLayout.ts）
 * - DragOverlay 渲染拖拽幽灵卡（icon + label）
 *
 * 动画所有权划分（见 .claude/rules/animation.md 规则一）：
 * - framer-motion：面板进出场、固定区按钮 whileHover/whileTap
 * - dnd-kit：钉住项 / 面板行的拖拽 transform + transition（inline style）
 * → .sidebar-pinned-btn / .more-panel-row 的 CSS 不得写 transform/opacity/all
 *   transition，均已登记 tests/animation-conflict.test.ts
 *
 * WebSocket 连接状态指示器：
 * - 绿色：已连接
 * - 黄色闪烁：连接中
 * - 红色：断开连接
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  MeasuringStrategy,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import { UserAvatar, type SessionInfo } from '../common/Avatar';
import { SidebarMorePanel } from './SidebarMorePanel';
import {
  loadLayout,
  saveLayout,
  type SidebarItemKey,
  type SidebarItemConfig,
  type SidebarLayout,
} from './sidebarLayout';
import {
  ChatIcon,
  SettingsIcon,
  LogoutIcon,
  GroupIcon,
  VideoMeetingIcon,
} from '../common/Icons';

// 好友图标（单人 + 小人 = 通讯录风格）
const FriendsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

// 文件夹图标
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

// 局域网传输图标（双向箭头 + 设备）
const LanTransferIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
  </svg>
);

// VPN 盾牌图标
const GuardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

// 小程序图标（火箭 / 应用商店风格）
const MiniAppsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
  </svg>
);

// 机器人图标（头部 + 天线 + 双眼，stroke 风格与同级图标一致）
const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 0a6.75 6.75 0 016.75 6.75v3A3.25 3.25 0 0115.5 19h-7a3.25 3.25 0 01-3.25-3.25v-3A6.75 6.75 0 0112 6zm-9 6.75h1.5m15 0H21" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 12.5v1m5-1v1m-5.25 3h5.5" />
  </svg>
);

// 股票研究图标（K 线柱状 + 趋势线风格）
const StockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l3-4 3 3 4-6" />
  </svg>
);

// "更多"按钮图标（三个圆点 · · ·）
const MoreIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
  </svg>
);

export type NavTab = 'chat' | 'group' | 'friends';

interface SidebarProps {
    session: SessionInfo;
    activeTab: NavTab;
    isSettingsOpen?: boolean;
    onTabChange: (tab: NavTab) => void;
    onAvatarClick: () => void;
    onFilesClick: () => void;
    onLanTransferClick: () => void;
    onMeetingClick: () => void;
    onMiniAppsClick: () => void;
    onBotsClick: () => void;
    onHuanvaeGuardClick: () => void;
    onStocksClick: () => void;
    onSettingsClick: () => void;
    onLogout: () => void;
}

/** 查某 key 当前所在区（不在任一区返回 null） */
function zoneOf(key: SidebarItemKey, layout: SidebarLayout): 'pinned' | 'more' | null {
  if (layout.pinned.includes(key)) {
    return 'pinned';
  }
  if (layout.more.includes(key)) {
    return 'more';
  }
  return null;
}

interface SidebarPinnedItemProps {
  itemKey: SidebarItemKey;
  item: SidebarItemConfig;
  onPinnedClick: (action: () => void) => void;
}

/**
 * 钉住区单项（dnd-kit useSortable：transform/transition 由 dnd-kit inline style 提供；
 * 不用 motion.button / whileHover / whileTap —— 会与 dnd-kit 抢 transform）
 */
function SidebarPinnedItem({ itemKey, item, onPinnedClick }: SidebarPinnedItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemKey });

  return (
    <button
      ref={setNodeRef}
      className={`sidebar-pinned-btn${isDragging ? ' sidebar-pinned-btn--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      title={item.label}
      onClick={() => onPinnedClick(item.onClick)}
      {...attributes}
      {...listeners}
    >
      {item.icon}
    </button>
  );
}

interface SidebarPinZoneProps {
  pinned: SidebarItemKey[];
  items: Record<SidebarItemKey, SidebarItemConfig>;
  dragActive: boolean;
  zoneRef: RefObject<HTMLDivElement | null>;
  onPinnedClick: (action: () => void) => void;
}

/** 钉住区容器（useDroppable id 'pinned' + 垂直 SortableContext） */
function SidebarPinZone({ pinned, items, dragActive, zoneRef, onPinnedClick }: SidebarPinZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pinned' });
  const className = [
    'sidebar-pin-zone',
    dragActive ? 'sidebar-pin-zone--active' : '',
    dragActive && isOver ? 'sidebar-pin-zone--over' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        zoneRef.current = node;
      }}
      className={className}
    >
      <SortableContext items={pinned} strategy={verticalListSortingStrategy}>
        {pinned.map((key) => (
          <SidebarPinnedItem
            key={key}
            itemKey={key}
            item={items[key]}
            onPinnedClick={onPinnedClick}
          />
        ))}
      </SortableContext>
    </div>
  );
}

export function Sidebar({
  session,
  activeTab,
  isSettingsOpen = false,
  onTabChange,
  onAvatarClick,
  onFilesClick,
  onLanTransferClick,
  onMeetingClick,
  onMiniAppsClick,
  onBotsClick,
  onHuanvaeGuardClick,
  onStocksClick,
  onSettingsClick,
  onLogout,
}: SidebarProps) {
  const { connected, connecting } = useWebSocket();
  // 本人头像键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const avatarKbd = useKbdFocusRing();
  const avatarKbdHandlers = avatarKbd.handlersFor('avatar');
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const morePanelRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const pinZoneRef = useRef<HTMLDivElement>(null);

  // 双区布局状态（pinned + more），持久化 localStorage 'sidebar_layout'
  const [layout, setLayout] = useState<SidebarLayout>(loadLayout);
  // 拖拽中的项 key（DragOverlay 幽灵卡 + 钉住区高亮用）
  const [activeKey, setActiveKey] = useState<SidebarItemKey | null>(null);
  // 拖拽开始时的布局快照（onDragCancel 恢复用）
  const dragSnapshotRef = useRef<SidebarLayout | null>(null);

  // 仅 PointerSensor，distance 6px：区分点击与拖拽（点击不触发 drag，无需拖拽标记 hack）。
  // 不加键盘 sensor：useSortable 的 attributes 让聚焦条目按 Enter/Space 会同时触发
  // "键盘拖拽启动"与原生 button click（面板行上 onItemClick 关面板 + 拖拽启动并发）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const getStatusClass = () => {
    if (connected) {
      return 'connected';
    }
    if (connecting) {
      return 'connecting';
    }
    return 'disconnected';
  };

  // 打开浮层时根据按钮位置计算 fixed 坐标
  const toggleMorePanel = useCallback(() => {
    setShowMorePanel((prev) => {
      if (!prev && moreBtnRef.current) {
        const rect = moreBtnRef.current.getBoundingClientRect();
        setPanelPos({
          top: rect.top,
          left: rect.right + 10,
        });
      }
      return !prev;
    });
  }, []);

  // 点击浮层外部时关闭（钉住区例外：拖动钉住项的 mousedown 不能关掉拖放目标面板）
  useEffect(() => {
    if (!showMorePanel) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        morePanelRef.current && !morePanelRef.current.contains(target) &&
        moreBtnRef.current && !moreBtnRef.current.contains(target) &&
        !(pinZoneRef.current && pinZoneRef.current.contains(target))
      ) {
        setShowMorePanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMorePanel]);

  // 浮层内按钮点击：执行回调 + 关闭浮层
  const handleMoreItemClick = useCallback((action: () => void) => {
    action();
    setShowMorePanel(false);
  }, []);

  // 钉住项点击：执行回调 + 关闭浮层（若开着）
  const handlePinnedClick = useCallback((action: () => void) => {
    action();
    setShowMorePanel(false);
  }, []);

  // 全部工具项定义（分区与顺序由 layout 状态决定）
  const moreItems: Record<SidebarItemKey, SidebarItemConfig> = {
    files: { icon: <FolderIcon />, label: '我的文件', onClick: onFilesClick },
    lan: { icon: <LanTransferIcon />, label: '局域网互传', onClick: onLanTransferClick },
    meeting: { icon: <VideoMeetingIcon />, label: '视频会议', onClick: onMeetingClick },
    miniapps: { icon: <MiniAppsIcon />, label: '小程序', onClick: onMiniAppsClick },
    bots: { icon: <BotIcon />, label: '机器人', onClick: onBotsClick },
    guard: { icon: <GuardIcon />, label: 'VPN 组网', onClick: onHuanvaeGuardClick },
    stocks: { icon: <StockIcon />, label: '股票研究', onClick: onStocksClick },
  };

  // ---- dnd-kit 拖拽编排（标准多容器模式） ----

  const handleDragStart = (event: DragStartEvent) => {
    const key = event.active.id as SidebarItemKey;
    setActiveKey(key);
    dragSnapshotRef.current = layout;
    // 拖拽期间保证浮层可见：拖出（more→pinned）与收纳（pinned→more）都有可见目标
    if (!showMorePanel && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.top, left: rect.right + 10 });
      setShowMorePanel(true);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      return;
    }
    const activeId = active.id as SidebarItemKey;
    const overId = String(over.id);
    setLayout((prev) => {
      const activeZone = zoneOf(activeId, prev);
      const overZone =
        overId === 'pinned' || overId === 'more'
          ? overId
          : zoneOf(overId as SidebarItemKey, prev);
      if (!activeZone || !overZone || activeZone === overZone) {
        return prev;
      }
      // 跨区移动：从源区移除，插入目标区（over 是条目→插到其 index，over 是容器→追加末尾）
      const next: SidebarLayout = { pinned: [...prev.pinned], more: [...prev.more] };
      next[activeZone] = next[activeZone].filter((k) => k !== activeId);
      if (overId === 'pinned' || overId === 'more') {
        next[overZone].push(activeId);
      } else {
        const overIndex = next[overZone].indexOf(overId as SidebarItemKey);
        if (overIndex === -1) {
          next[overZone].push(activeId);
        } else {
          next[overZone].splice(overIndex, 0, activeId);
        }
      }
      return next; // 拖拽过程中不持久化，onDragEnd 才 saveLayout
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = active.id as SidebarItemKey;
    // onDragOver 的跨区更新在 pointerup 前已 flush，此处闭包 layout 即最新值。
    // saveLayout 不放进 setLayout updater（updater 必须纯，StrictMode 双调用会双写）
    let next = layout;
    if (over && over.id !== active.id && over.id !== 'pinned' && over.id !== 'more') {
      const overId = over.id as SidebarItemKey;
      const activeZone = zoneOf(activeId, layout);
      const overZone = zoneOf(overId, layout);
      if (activeZone && activeZone === overZone) {
        const from = layout[activeZone].indexOf(activeId);
        const to = layout[activeZone].indexOf(overId);
        if (from !== -1 && to !== -1 && from !== to) {
          next = { ...layout, [activeZone]: arrayMove(layout[activeZone], from, to) };
        }
      }
    }
    setLayout(next);
    saveLayout(next);
    setActiveKey(null);
    dragSnapshotRef.current = null;
  };

  const handleDragCancel = () => {
    if (dragSnapshotRef.current) {
      setLayout(dragSnapshotRef.current);
    }
    setActiveKey(null);
    dragSnapshotRef.current = null;
  };

  return (
    // pointerWithin：指针真正进入某 droppable 才算命中（"最近中心"类碰撞算法会把拖到
    // 窗口空白处也归到最近容器，造成非预期跨区移动；空白处 over=null → 保持预览位置）。
    // measuring Always：pin zone 空时不挂载、onDragStart setActiveKey 后才挂载，
    // 必须强制持续测量才能保证它作为 droppable 一定被收集到
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <motion.aside
        className="chat-sidebar"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="sidebar-avatar">
          <motion.div
            className={`avatar-wrapper${avatarKbd.isKbdFocused('avatar') ? ' a11y-kbd-focus' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onAvatarClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAvatarClick();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="打开我的资料"
            onPointerDown={avatarKbdHandlers.onPointerDown}
            onFocus={avatarKbdHandlers.onFocus}
            onBlur={avatarKbdHandlers.onBlur}
            style={{ cursor: 'pointer' }}
            title="个人资料"
          >
            <UserAvatar session={session} />
          </motion.div>
          <div className={`online-indicator ${getStatusClass()}`} />
        </div>

        <nav className="sidebar-nav">
          {/* 核心固定区：消息、好友、群聊 */}
          <motion.button
            className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => onTabChange('chat')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="消息"
          >
            <ChatIcon />
          </motion.button>
          <motion.button
            className={`nav-btn ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => onTabChange('friends')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="好友"
          >
            <FriendsIcon />
          </motion.button>
          <motion.button
            className={`nav-btn ${activeTab === 'group' ? 'active' : ''}`}
            onClick={() => onTabChange('group')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="群聊"
          >
            <GroupIcon />
          </motion.button>

          {/* 钉住区：从"更多"面板拖出的工具项。空且无拖拽时不渲染——
              .sidebar-nav gap 8px 对 0 高度空 div 也计两侧 gap，会造成 16px 不对称间隙 */}
          {(layout.pinned.length > 0 || activeKey !== null) && (
            <SidebarPinZone
              pinned={layout.pinned}
              items={moreItems}
              dragActive={activeKey !== null}
              zoneRef={pinZoneRef}
              onPinnedClick={handlePinnedClick}
            />
          )}

          {/* "更多"按钮（浮层通过 Portal 渲染到 body，避免被父容器 overflow 裁切） */}
          <motion.button
            ref={moreBtnRef}
            className={`nav-btn ${showMorePanel ? 'active' : ''}`}
            onClick={toggleMorePanel}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="更多功能"
          >
            <MoreIcon />
          </motion.button>

          {createPortal(
            <AnimatePresence>
              {showMorePanel && (
                <SidebarMorePanel
                  ref={morePanelRef}
                  items={moreItems}
                  moreKeys={layout.more}
                  position={panelPos}
                  onItemClick={handleMoreItemClick}
                />
              )}
            </AnimatePresence>,
            document.body,
          )}

          {/* 拖拽幽灵卡（DragOverlay 的 transform 由 dnd-kit 写在 overlay wrapper 上）。
              zIndex 10001：面板 .sidebar-more-panel z-index 10000，ghost 必须在其上
              （DragOverlay 默认 999 会被面板遮住） */}
          {createPortal(
            <DragOverlay zIndex={10001}>
              {activeKey ? (
                <div className="sidebar-drag-ghost">
                  <span className="more-panel-icon">{moreItems[activeKey].icon}</span>
                  <span className="more-panel-label">{moreItems[activeKey].label}</span>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </nav>

        <div className="sidebar-bottom">
          <motion.button
            className={`nav-btn ${isSettingsOpen ? 'active' : ''}`}
            onClick={onSettingsClick}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="设置"
          >
            <SettingsIcon />
          </motion.button>
          <motion.button
            className="nav-btn logout"
            onClick={onLogout}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="退出登录"
          >
            <LogoutIcon />
          </motion.button>
        </div>
      </motion.aside>
    </DndContext>
  );
}
