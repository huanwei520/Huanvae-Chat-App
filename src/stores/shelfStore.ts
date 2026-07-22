/**
 * 顶置架状态管理 Store (Zustand)
 *
 * 数据来源两路（均为服务端真值的本地镜像）：
 * - REST：getShelf 拉当前会话的架条目 seed；
 * - WS shelf_updated 增量：帧含全量 items（引用，无卡片内容），整组替换。
 *
 * 按 shelfKey(scope, scopeKey) 分桶，各会话架互不干扰。条目只是引用；
 * 卡片内容/live 刷新走既有 message / cardLiveStore 通道。
 */

import { create } from 'zustand';
import type { ShelfItem, ShelfScope } from '../api/shelf';

/** 组合键：区分不同会话的架 */
export function shelfKey(scope: ShelfScope, scopeKey: string): string {
  return `${scope}|${scopeKey}`;
}

/** WS 帧 items 逐条运行时校验（跨进程输入，非过度防御）。仅校验引用字段形状。 */
export function isShelfItem(v: unknown): v is ShelfItem {
  if (typeof v !== 'object' || v === null) { return false; }
  const o = v as Record<string, unknown>;
  return typeof o.item_id === 'string'
    && typeof o.message_uuid === 'string'
    && typeof o.pinned_by === 'string'
    && (o.note === null || typeof o.note === 'string')
    && typeof o.position === 'number'
    && typeof o.created_at === 'string';
}

/** 按 position 升序（服务端已排序，前端再保序一次，稳健） */
function sortByPosition(items: ShelfItem[]): ShelfItem[] {
  return [...items].sort((a, b) => a.position - b.position);
}

interface ShelfState {
  /** 各会话的架条目，key = shelfKey(scope, scopeKey) */
  itemsByConv: Record<string, ShelfItem[]>;
}

interface ShelfActions {
  /** 整组替换某会话的架（GET 快照 + WS 全量帧共用；position 升序） */
  setItems: (scope: ShelfScope, scopeKey: string, items: ShelfItem[]) => void;
  /** 全部清空（登出/切账号） */
  clear: () => void;
}

export type ShelfStore = ShelfState & ShelfActions;

export const useShelfStore = create<ShelfStore>((set) => ({
  itemsByConv: {},

  setItems: (scope, scopeKey, items) => set((state) => ({
    itemsByConv: { ...state.itemsByConv, [shelfKey(scope, scopeKey)]: sortByPosition(items) },
  })),

  clear: () => set({ itemsByConv: {} }),
}));
