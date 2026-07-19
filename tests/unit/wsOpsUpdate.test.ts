/**
 * handleWebSocketMessage — ops_update 分发接线测试
 *
 * opsStore 的 applyOpsUpdate 单测（tests/stores/opsStore.test.ts）覆盖不了「接线」：
 * wsHandlers 的 case 'ops_update' 漏写、kind/data 参数传反，store 单测照样过。
 * 本测试驱动真实 handleWebSocketMessage（真实 opsStore），断言 WS 消息
 * 经 JSON.parse → applyOpsUpdate 落进 store 的完整链路。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/db', () => ({}));
vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn(),
  notifySystemEvent: vi.fn(),
}));

import { handleWebSocketMessage } from '../../src/contexts/wsHandlers';
import { useOpsStore } from '../../src/stores/opsStore';
import type { OpsTaskInfo, OpsWorkerInfo, OpsEventInfo } from '../../src/api/ops';

function makeCtx() {
  return {
    activeChatRef: { current: null },
    currentUserId: 'me',
    setUnreadSummary: vi.fn(),
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set() },
    recalledListeners: { current: new Set() },
    notificationListeners: { current: new Set() },
    readSyncListeners: { current: new Set() },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  } as never;
}

const TASK_FIXTURE: OpsTaskInfo = {
  task_id: 'task-1',
  bot_user_id: 'bot_fake',
  title: '部署网关',
  status: 'running',
  summary: '进行中',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:01:00Z',
};

const WORKER_FIXTURE: OpsWorkerInfo = {
  task_id: 'task-1',
  worker_id: 'w-1',
  layer: 'L2',
  title: '编译 worker',
  status: 'running',
  detail: '正在编译',
  created_at: '2026-07-16T00:00:10Z',
  updated_at: '2026-07-16T00:01:10Z',
};

const EVENT_FIXTURE: OpsEventInfo = {
  event_id: 42,
  task_id: 'task-1',
  worker_id: 'w-1',
  event_type: 'progress',
  payload: 'step done',
  created_at: '2026-07-16T00:02:00Z',
};

describe('handleWebSocketMessage — ops_update 分发到 opsStore', () => {
  beforeEach(() => {
    useOpsStore.getState().clear();
  });

  it("kind='task' → tasks[task_id] 写入完整 task 数据", () => {
    handleWebSocketMessage(
      JSON.stringify({ type: 'ops_update', kind: 'task', task_id: 'task-1', data: TASK_FIXTURE }),
      makeCtx(),
    );
    expect(useOpsStore.getState().tasks['task-1']).toEqual(TASK_FIXTURE);
  });

  it("kind='worker' → workersByTask[task_id][worker_id] 写入", () => {
    handleWebSocketMessage(
      JSON.stringify({
        type: 'ops_update',
        kind: 'worker',
        task_id: 'task-1',
        worker_id: 'w-1',
        data: WORKER_FIXTURE,
      }),
      makeCtx(),
    );
    expect(useOpsStore.getState().workersByTask['task-1']).toEqual({ 'w-1': WORKER_FIXTURE });
  });

  it("kind='event' → eventsByTask 追加 + lastEventIdByTask 推进", () => {
    handleWebSocketMessage(
      JSON.stringify({
        type: 'ops_update',
        kind: 'event',
        task_id: 'task-1',
        worker_id: 'w-1',
        data: EVENT_FIXTURE,
      }),
      makeCtx(),
    );
    expect(useOpsStore.getState().eventsByTask['task-1']).toEqual([EVENT_FIXTURE]);
    expect(useOpsStore.getState().lastEventIdByTask['task-1']).toBe(42);
  });
});
