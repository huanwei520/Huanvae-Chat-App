/**
 * 侧边栏双区布局纯模块（无 React 运行时依赖，仅 type import）
 *
 * 布局 schema（SidebarLayout）：
 * - pinned：被用户拖到侧边栏"钉住区"的工具项 key（图标常驻侧边栏）
 * - more：收纳在"更多"浮层面板里的工具项 key（可拖拽排序 / 拖出钉住）
 * 两区合计恒等于 SIDEBAR_ITEM_KEYS 全集（normalizeLayout 保证：去重 + 补缺）。
 *
 * 持久化：
 * - localStorage key = LAYOUT_STORAGE_KEY（'sidebar_layout'），值为 JSON 序列化的 SidebarLayout
 * - 读取经 normalizeLayout 清洗（非法结构 / 非法 key / 跨区重复 / 缺失 key 均可恢复）
 *
 * 零迁移决策：
 * - 旧版单区排序 key（framer-motion 拖拽排序时代）已彻底废弃，不做任何读取迁移；
 *   旧数据自然失效，用户从默认布局（全部在 more 区）重新开始。项目处于个人开发验证期，
 *   不考虑向后兼容（见 .claude/CLAUDE.md「项目阶段」）。
 */

import type { ReactNode } from 'react';

/** 可钉住/可收纳工具项的稳定 key（持久化用，与展示 label 解耦） */
export type SidebarItemKey =
  | 'files'
  | 'lan'
  | 'meeting'
  | 'miniapps'
  | 'bots'
  | 'lowcode'
  | 'guard'
  | 'stocks';

/** 全部工具项 key 的默认顺序（补缺时按此顺序追加到 more 末尾） */
export const SIDEBAR_ITEM_KEYS: readonly SidebarItemKey[] = [
  'files',
  'lan',
  'meeting',
  'miniapps',
  'bots',
  'lowcode',
  'guard',
  'stocks',
];

/** 单个工具项配置（icon + 文案 + 点击动作） */
export interface SidebarItemConfig {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/** 双区布局：钉住区 + 更多面板区 */
export interface SidebarLayout {
  pinned: SidebarItemKey[];
  more: SidebarItemKey[];
}

/** localStorage 持久化 key */
export const LAYOUT_STORAGE_KEY = 'sidebar_layout';

/** 默认布局：无钉住项，全部工具收纳在更多面板 */
export function defaultLayout(): SidebarLayout {
  return { pinned: [], more: [...SIDEBAR_ITEM_KEYS] };
}

function isSidebarItemKey(value: unknown): value is SidebarItemKey {
  return (
    typeof value === 'string' &&
    (SIDEBAR_ITEM_KEYS as readonly string[]).includes(value)
  );
}

/**
 * 清洗任意来源的布局数据（纯函数，便于单测）：
 * - 不是 plain object、或 pinned/more 任一不是数组 → defaultLayout()
 * - 逐元素过滤：仅接受 SIDEBAR_ITEM_KEYS 中的字符串
 * - 跨区去重：同 key 先出现在 pinned 则留 pinned（pinned 优先）；同区重复留首个
 * - 8 个 key 中缺失的按 SIDEBAR_ITEM_KEYS 默认顺序补到 more 末尾
 */
export function normalizeLayout(saved: unknown): SidebarLayout {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
    return defaultLayout();
  }
  const candidate = saved as { pinned?: unknown; more?: unknown };
  if (!Array.isArray(candidate.pinned) || !Array.isArray(candidate.more)) {
    return defaultLayout();
  }
  const seen = new Set<SidebarItemKey>();
  const pinned: SidebarItemKey[] = [];
  for (const key of candidate.pinned) {
    if (isSidebarItemKey(key) && !seen.has(key)) {
      seen.add(key);
      pinned.push(key);
    }
  }
  const more: SidebarItemKey[] = [];
  for (const key of candidate.more) {
    if (isSidebarItemKey(key) && !seen.has(key)) {
      seen.add(key);
      more.push(key);
    }
  }
  for (const key of SIDEBAR_ITEM_KEYS) {
    if (!seen.has(key)) {
      more.push(key);
    }
  }
  return { pinned, more };
}

/** 从 localStorage 读取布局（无保存 / JSON 解析失败 → 默认布局；其余走 normalizeLayout） */
export function loadLayout(): SidebarLayout {
  const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (raw === null) {
    return defaultLayout();
  }
  try {
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return defaultLayout();
  }
}

/** 布局持久化到 localStorage */
export function saveLayout(layout: SidebarLayout): void {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
