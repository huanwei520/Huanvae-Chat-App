/**
 * 可交互卡片 live 内容管理 Store (Zustand)
 *
 * 数据来源:WS `message_updated` 增量帧。
 * 已发出的卡片消息内容可被发卡方(bot)后续 patch 刷新(如轮询进度、行情跳动),
 * 服务端每次 patch 携带**单调递增** rev,前端据此收敛到最新态、拒绝乱序/重放/回退。
 *
 * 仅**内存**存储(不持久化):好友 UI 是 DB-first 且本地消息表无 rev 列,
 * live patch 只活在当前会话内存里,冷启动以 DB/同步快照为基线。
 *
 * S1→S2 交接点:消息同步(sync)路径返回的卡片内容**不带 rev**,被视作"当前基线/rev=0",
 * CardRenderer 以 `live.rev >= (messageRev ?? 0)` 判定是否采用 live 覆盖;单调 store 天然拒绝
 * 比基线更旧的重放。
 *
 * 使用方式:
 * ```typescript
 * const live = useCardLiveStore(state => state.cards[messageUuid])
 * // WebSocket 回调中(React 外部)
 * useCardLiveStore.getState().applyUpdate(msg.message_uuid, msg.content, msg.rev)
 * ```
 */

import { create } from 'zustand';

// ============================================
// 类型定义
// ============================================

/** 单条卡片的 live 快照(内容 + 单调游标) */
interface CardLiveEntry {
  /** 更新后的完整卡片内容(schema JSON 串) */
  content: string;
  /** 单调递增内容修订号(幂等/顺序游标) */
  rev: number;
}

interface CardLiveState {
  /** live 快照,key: message_uuid */
  cards: Record<string, CardLiveEntry>;
}

interface CardLiveActions {
  /**
   * 应用一条 live patch。**单调收敛**:仅当无既有条目、或 rev 严格大于既有 rev 时写入;
   * 否则忽略(拒绝乱序、重放、回退),保证任意到达顺序下都收敛到最大 rev 的内容。
   */
  applyUpdate: (messageUuid: string, content: string, rev: number) => void;
  /** 全部清空(登出/切账号) */
  clear: () => void;
}

export type CardLiveStore = CardLiveState & CardLiveActions;

// ============================================
// Store
// ============================================

export const useCardLiveStore = create<CardLiveStore>((set) => ({
  // ==================== 初始状态 ====================
  cards: {},

  // ==================== 单调增量 ====================
  applyUpdate: (messageUuid, content, rev) => set((state) => {
    const existing = state.cards[messageUuid];
    if (existing && rev <= existing.rev) {
      // 更旧或重复的 rev —— 丢弃,维持已有更新态
      return state;
    }
    return { cards: { ...state.cards, [messageUuid]: { content, rev } } };
  }),

  // ==================== 清理 ====================
  clear: () => set({ cards: {} }),
}));
