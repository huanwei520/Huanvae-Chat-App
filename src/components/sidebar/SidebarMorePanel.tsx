/**
 * 侧边栏"更多"浮层面板（dnd-kit 双区拖放的 "more" 区）
 *
 * 结构：
 * - 头部标题区（「更多功能」+「拖到侧边栏可钉住」提示）
 * - 列表区 = useDroppable(id: 'more') 容器 + SortableContext（垂直排序）
 *   每行 MorePanelRow 由 useSortable 接管拖拽；可在面板内排序，
 *   也可拖到侧边栏钉住区（跨容器编排在 Sidebar.tsx 的 DndContext 回调里）
 * - 空态：全部项被钉住时显示提示，droppable 容器仍在（可拖回收纳）
 *
 * 布局状态与持久化（localStorage key: sidebar_layout）由 Sidebar.tsx 统一持有，
 * 本组件只消费 items + moreKeys（受控渲染）。
 *
 * 动画所有权划分（见 .claude/rules/animation.md 规则一）：
 * - 面板根 motion.div：framer-motion variants 控制进出场 opacity/x/scale
 * - .more-panel-row：dnd-kit useSortable 经 inline style 写 transform + transition
 * → 对应 CSS（.sidebar-more-panel / .more-panel-row）不得声明 transform/opacity/all
 *   transition，两个 selector 均已登记 tests/animation-conflict.test.ts
 *   MOTION_CONTROLLED_SELECTORS
 */

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SidebarItemConfig, SidebarItemKey } from './sidebarLayout';

interface SidebarMorePanelProps {
  /** 全部工具项定义（key → icon/label/onClick） */
  items: Record<SidebarItemKey, SidebarItemConfig>;
  /** "more" 区当前的 key 顺序（由 Sidebar 的 layout 状态驱动） */
  moreKeys: SidebarItemKey[];
  /** fixed 定位坐标（由 Sidebar 根据"更多"按钮位置计算） */
  position: { top: number; left: number };
  /** 项点击回调（Sidebar 负责执行 action + 关闭浮层） */
  onItemClick: (action: () => void) => void;
}

/** 面板入出场动画（opacity/x/scale, 0.15s） */
const panelVariants = {
  initial: { opacity: 0, x: -8, scale: 0.95 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -8, scale: 0.95 },
};

interface MorePanelRowProps {
  itemKey: SidebarItemKey;
  item: SidebarItemConfig;
  onItemClick: (action: () => void) => void;
}

/** 单行（dnd-kit useSortable：transform/transition 由 dnd-kit inline style 提供） */
function MorePanelRow({ itemKey, item, onItemClick }: MorePanelRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemKey });

  return (
    <div
      ref={setNodeRef}
      className={`more-panel-row${isDragging ? ' more-panel-row--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      // 无键盘 sensor，wrapper 不该抢 tab 焦点（覆写 attributes 的 tabIndex=0），焦点留给内层真 button
      tabIndex={-1}
    >
      <button
        className="more-panel-item"
        onClick={() => onItemClick(item.onClick)}
      >
        <span className="more-panel-icon">{item.icon}</span>
        <span className="more-panel-label">{item.label}</span>
      </button>
    </div>
  );
}

/**
 * 侧边栏"更多"浮层面板组件
 *
 * forwardRef 暴露面板根 div，Sidebar 用它做"点击浮层外关闭"的 contains 判定。
 */
export const SidebarMorePanel = forwardRef<HTMLDivElement, SidebarMorePanelProps>(
  function SidebarMorePanel({ items, moreKeys, position, onItemClick }, ref) {
    const { setNodeRef: setListRef, isOver } = useDroppable({ id: 'more' });

    return (
      <motion.div
        ref={ref}
        className="sidebar-more-panel"
        style={{ top: position.top, left: position.left }}
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.15 }}
      >
        <div className="more-panel-header">
          <span className="more-panel-title">更多功能</span>
          <span className="more-panel-hint">拖到侧边栏可钉住</span>
        </div>
        <div
          ref={setListRef}
          className={`more-panel-list${isOver ? ' more-panel-list--over' : ''}`}
        >
          <SortableContext items={moreKeys} strategy={verticalListSortingStrategy}>
            {moreKeys.map((key) => (
              <MorePanelRow
                key={key}
                itemKey={key}
                item={items[key]}
                onItemClick={onItemClick}
              />
            ))}
          </SortableContext>
          {moreKeys.length === 0 && (
            <div className="more-panel-empty">
              <span className="more-panel-empty-main">已全部钉到侧边栏</span>
              <span className="more-panel-empty-sub">从侧边栏拖回此处可收纳</span>
            </div>
          )}
        </div>
      </motion.div>
    );
  },
);
