/**
 * 运维任务状态管理 Store (Zustand)
 *
 * 数据来源（三路合流，均为服务端真值的本地镜像）：
 * - REST 首屏 seed：getOpsTasks / getOpsTask / getOpsTaskEvents 拉快照灌入；
 * - WS ops_update 增量：按 kind（task/worker/event）实时 upsert；
 * - 断线重连补拉：以 lastEventIdByTask 作 after_id 游标增量补事件。
 *
 * 事件每任务上限 MAX_EVENTS_PER_TASK 条（内存里只保留最近一段进度流水，
 * 服务端事件本身 7 天滚动清理，完整历史不在前端职责内）。
 *
 * 使用方式：
 * ```typescript
 * const tasks = useOpsStore(state => state.tasks)
 * // WebSocket 回调中（React 外部）
 * useOpsStore.getState().applyOpsUpdate(msg.kind, msg.data)
 * ```
 */

import { create } from 'zustand';
import type { OpsTaskInfo, OpsWorkerInfo, OpsEventInfo } from '../api/ops';

/** 每任务在内存中保留的事件上限（超出裁掉最旧的） */
const MAX_EVENTS_PER_TASK = 200;

// ============================================
// 类型定义
// ============================================

interface OpsState {
  /** 任务快照，key: task_id */
  tasks: Record<string, OpsTaskInfo>;
  /** worker 快照，taskId → workerId → info */
  workersByTask: Record<string, Record<string, OpsWorkerInfo>>;
  /** 事件流水，event_id 升序，每任务上限 MAX_EVENTS_PER_TASK 条 */
  eventsByTask: Record<string, OpsEventInfo[]>;
  /** 各任务已见最大 event_id（断线补拉的 after_id 游标） */
  lastEventIdByTask: Record<string, number>;
}

interface OpsActions {
  /** 任务列表快照合并（按 task_id upsert，不清别的任务） */
  seedTasks: (tasks: OpsTaskInfo[]) => void;
  /** 任务详情 seed：task upsert + 整组替换该任务的 workers map */
  seedTaskDetail: (task: OpsTaskInfo, workers: OpsWorkerInfo[]) => void;
  /** 按 event_id 去重追加 + 升序排序 + 裁到最近 MAX_EVENTS_PER_TASK 条，并推进游标 */
  appendEvents: (taskId: string, events: OpsEventInfo[]) => void;
  /** WS ops_update 增量：按 kind 校验 data 形状后分发（不合形状丢弃并 warn） */
  applyOpsUpdate: (kind: 'task' | 'worker' | 'event', data: unknown) => void;
  /** 全部清空（登出/切账号） */
  clear: () => void;
}

export type OpsStore = OpsState & OpsActions;

// ============================================
// WS data 类型守卫（跨进程输入校验，非过度防御）
// ============================================

function isOpsTaskInfo(v: unknown): v is OpsTaskInfo {
  if (typeof v !== 'object' || v === null) { return false; }
  const o = v as Record<string, unknown>;
  return typeof o.task_id === 'string'
    && typeof o.bot_user_id === 'string'
    && typeof o.title === 'string'
    && typeof o.status === 'string'
    && typeof o.summary === 'string'
    && typeof o.created_at === 'string'
    && typeof o.updated_at === 'string';
}

function isOpsWorkerInfo(v: unknown): v is OpsWorkerInfo {
  if (typeof v !== 'object' || v === null) { return false; }
  const o = v as Record<string, unknown>;
  return typeof o.task_id === 'string'
    && typeof o.worker_id === 'string'
    && typeof o.layer === 'string'
    && typeof o.title === 'string'
    && typeof o.status === 'string'
    && typeof o.detail === 'string'
    && typeof o.created_at === 'string'
    && typeof o.updated_at === 'string';
}

function isOpsEventInfo(v: unknown): v is OpsEventInfo {
  if (typeof v !== 'object' || v === null) { return false; }
  const o = v as Record<string, unknown>;
  return typeof o.event_id === 'number'
    && typeof o.task_id === 'string'
    && (o.worker_id === null || typeof o.worker_id === 'string')
    && typeof o.event_type === 'string'
    && typeof o.created_at === 'string';
}

// ============================================
// 事件合并（纯函数，供 appendEvents / applyOpsUpdate 复用）
// ============================================

/** 去重（按 event_id，新值覆盖）+ 升序 + 裁到最近 MAX_EVENTS_PER_TASK 条 */
function mergeEvents(existing: OpsEventInfo[], incoming: OpsEventInfo[]): OpsEventInfo[] {
  const byId = new Map<number, OpsEventInfo>();
  existing.forEach((e) => byId.set(e.event_id, e));
  incoming.forEach((e) => byId.set(e.event_id, e));
  const merged = [...byId.values()].sort((a, b) => a.event_id - b.event_id);
  return merged.length > MAX_EVENTS_PER_TASK
    ? merged.slice(merged.length - MAX_EVENTS_PER_TASK)
    : merged;
}

// ============================================
// Store
// ============================================

export const useOpsStore = create<OpsStore>((set, get) => ({
  // ==================== 初始状态 ====================
  tasks: {},

  workersByTask: {},

  eventsByTask: {},

  lastEventIdByTask: {},

  // ==================== 快照 seed ====================
  seedTasks: (tasks) => set((state) => {
    const next = { ...state.tasks };
    tasks.forEach((t) => {
      next[t.task_id] = t;
    });
    return { tasks: next };
  }),

  seedTaskDetail: (task, workers) => set((state) => {
    const workerMap: Record<string, OpsWorkerInfo> = {};
    workers.forEach((w) => {
      workerMap[w.worker_id] = w;
    });
    return {
      tasks: { ...state.tasks, [task.task_id]: task },
      workersByTask: { ...state.workersByTask, [task.task_id]: workerMap },
    };
  }),

  // ==================== 事件追加 ====================
  appendEvents: (taskId, events) => set((state) => {
    const merged = mergeEvents(state.eventsByTask[taskId] ?? [], events);
    const lastId = merged.length > 0 ? merged[merged.length - 1].event_id : 0;
    const prevLastId = state.lastEventIdByTask[taskId] ?? 0;
    return {
      eventsByTask: { ...state.eventsByTask, [taskId]: merged },
      lastEventIdByTask: {
        ...state.lastEventIdByTask,
        [taskId]: Math.max(prevLastId, lastId),
      },
    };
  }),

  // ==================== WS 增量分发 ====================
  applyOpsUpdate: (kind, data) => {
    switch (kind) {
      case 'task':
        if (!isOpsTaskInfo(data)) {
          console.warn('[OpsStore] 丢弃形状不合法的 task 增量:', data);
          return;
        }
        set((state) => ({ tasks: { ...state.tasks, [data.task_id]: data } }));
        break;

      case 'worker':
        if (!isOpsWorkerInfo(data)) {
          console.warn('[OpsStore] 丢弃形状不合法的 worker 增量:', data);
          return;
        }
        set((state) => ({
          workersByTask: {
            ...state.workersByTask,
            [data.task_id]: {
              ...state.workersByTask[data.task_id],
              [data.worker_id]: data,
            },
          },
        }));
        break;

      case 'event':
        if (!isOpsEventInfo(data)) {
          console.warn('[OpsStore] 丢弃形状不合法的 event 增量:', data);
          return;
        }
        get().appendEvents(data.task_id, [data]);
        break;
    }
  },

  // ==================== 清理 ====================
  clear: () => set({
    tasks: {},
    workersByTask: {},
    eventsByTask: {},
    lastEventIdByTask: {},
  }),
}));
