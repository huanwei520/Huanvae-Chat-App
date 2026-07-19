/**
 * opsStore（运维任务状态 Store）reducer 测试
 *
 * 覆盖：seedTasks upsert 语义、seedTaskDetail workers 整组替换、
 * appendEvents 去重/升序/游标推进/上限 200 裁旧、
 * applyOpsUpdate 三 kind 分发 + 形状不合法丢弃、clear 全清。
 * 全部直接操作 useOpsStore.getState()（WebSocket 回调也是 React 外部这么用）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useOpsStore } from '../../src/stores/opsStore';
import type { OpsTaskInfo, OpsWorkerInfo, OpsEventInfo } from '../../src/api/ops';

function makeTask(overrides: Partial<OpsTaskInfo> = {}): OpsTaskInfo {
  return {
    task_id: 'task-1',
    bot_user_id: 'bot_fake',
    title: '部署网关',
    status: 'running',
    summary: '进行中',
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:01:00Z',
    ...overrides,
  };
}

function makeWorker(overrides: Partial<OpsWorkerInfo> = {}): OpsWorkerInfo {
  return {
    task_id: 'task-1',
    worker_id: 'w-1',
    layer: 'L2',
    title: '编译 worker',
    status: 'running',
    detail: '正在编译',
    created_at: '2026-07-16T00:00:10Z',
    updated_at: '2026-07-16T00:01:10Z',
    ...overrides,
  };
}

function makeEvent(eventId: number, overrides: Partial<OpsEventInfo> = {}): OpsEventInfo {
  return {
    event_id: eventId,
    task_id: 'task-1',
    worker_id: 'w-1',
    event_type: 'progress',
    payload: `step-${eventId}`,
    created_at: '2026-07-16T00:02:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  useOpsStore.getState().clear();
});

describe('seedTasks - 任务列表快照 upsert', () => {
  it('两次 seed 不同任务共存（不清别的任务）', () => {
    useOpsStore.getState().seedTasks([makeTask({ task_id: 'task-1' })]);
    useOpsStore.getState().seedTasks([makeTask({ task_id: 'task-2', title: '扩容' })]);
    const { tasks } = useOpsStore.getState();
    expect(tasks['task-1']).toEqual(makeTask({ task_id: 'task-1' }));
    expect(tasks['task-2']).toEqual(makeTask({ task_id: 'task-2', title: '扩容' }));
  });

  it('同 task_id 覆盖为新值', () => {
    useOpsStore.getState().seedTasks([makeTask({ status: 'running', summary: '进行中' })]);
    useOpsStore.getState().seedTasks([makeTask({ status: 'completed', summary: '已完成' })]);
    expect(useOpsStore.getState().tasks['task-1']).toEqual(
      makeTask({ status: 'completed', summary: '已完成' }),
    );
  });
});

describe('seedTaskDetail - task 写入 + workers 整组替换', () => {
  it('task 写入 tasks，workers 建立 workerId → info 映射', () => {
    const task = makeTask();
    const worker = makeWorker();
    useOpsStore.getState().seedTaskDetail(task, [worker]);
    expect(useOpsStore.getState().tasks['task-1']).toEqual(task);
    expect(useOpsStore.getState().workersByTask['task-1']).toEqual({ 'w-1': worker });
  });

  it('再次 seed 整组替换该任务的 workers（先 2 个再 seed 1 个 → 只剩 1 个）', () => {
    useOpsStore.getState().seedTaskDetail(makeTask(), [
      makeWorker({ worker_id: 'w-1' }),
      makeWorker({ worker_id: 'w-2' }),
    ]);
    const w3 = makeWorker({ worker_id: 'w-3' });
    useOpsStore.getState().seedTaskDetail(makeTask(), [w3]);
    expect(useOpsStore.getState().workersByTask['task-1']).toEqual({ 'w-3': w3 });
  });
});

describe('appendEvents - 去重 / 排序 / 游标 / 上限', () => {
  it('同 event_id 去重且新值覆盖', () => {
    useOpsStore.getState().appendEvents('task-1', [makeEvent(1, { payload: 'old' })]);
    useOpsStore.getState().appendEvents('task-1', [makeEvent(1, { payload: 'new' })]);
    expect(useOpsStore.getState().eventsByTask['task-1']).toEqual([
      makeEvent(1, { payload: 'new' }),
    ]);
  });

  it('乱序入参按 event_id 升序排序，lastEventIdByTask 推进到最大值', () => {
    useOpsStore.getState().appendEvents('task-1', [makeEvent(7), makeEvent(3), makeEvent(5)]);
    expect(useOpsStore.getState().eventsByTask['task-1']).toEqual([
      makeEvent(3),
      makeEvent(5),
      makeEvent(7),
    ]);
    expect(useOpsStore.getState().lastEventIdByTask['task-1']).toBe(7);
  });

  it('超 200 条裁掉最旧的（塞 201 条 → 长度 200，event_id=1 被裁）', () => {
    const events = Array.from({ length: 201 }, (_, i) => makeEvent(i + 1));
    useOpsStore.getState().appendEvents('task-1', events);
    const stored = useOpsStore.getState().eventsByTask['task-1'];
    expect(stored).toHaveLength(200);
    expect(stored[0].event_id).toBe(2); // 最旧的 event_id=1 被裁
    expect(stored[199].event_id).toBe(201);
    expect(useOpsStore.getState().lastEventIdByTask['task-1']).toBe(201);
  });
});

describe('applyOpsUpdate - WS 增量分发', () => {
  it('kind=task 合法数据写入 tasks', () => {
    const task = makeTask();
    useOpsStore.getState().applyOpsUpdate('task', task);
    expect(useOpsStore.getState().tasks['task-1']).toEqual(task);
  });

  it('kind=worker 合法数据写入 workersByTask（不清同任务其他 worker）', () => {
    const w1 = makeWorker({ worker_id: 'w-1' });
    const w2 = makeWorker({ worker_id: 'w-2', title: '发布 worker' });
    useOpsStore.getState().applyOpsUpdate('worker', w1);
    useOpsStore.getState().applyOpsUpdate('worker', w2);
    expect(useOpsStore.getState().workersByTask['task-1']).toEqual({ 'w-1': w1, 'w-2': w2 });
  });

  it('kind=event 合法数据走 appendEvents（事件入列 + 游标推进）', () => {
    const event = makeEvent(11);
    useOpsStore.getState().applyOpsUpdate('event', event);
    expect(useOpsStore.getState().eventsByTask['task-1']).toEqual([event]);
    expect(useOpsStore.getState().lastEventIdByTask['task-1']).toBe(11);
  });

  describe('形状不合法丢弃', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('task 缺 task_id → 丢弃不写 store 且 console.warn', () => {
      const { task_id: _omitted, ...noTaskId } = makeTask();
      useOpsStore.getState().applyOpsUpdate('task', noTaskId);
      expect(useOpsStore.getState().tasks).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('worker 传 null → 丢弃', () => {
      useOpsStore.getState().applyOpsUpdate('worker', null);
      expect(useOpsStore.getState().workersByTask).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('event 的 event_id 非 number → 丢弃', () => {
      useOpsStore.getState().applyOpsUpdate('event', { ...makeEvent(1), event_id: '1' });
      expect(useOpsStore.getState().eventsByTask).toEqual({});
      expect(useOpsStore.getState().lastEventIdByTask).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('clear - 全部清空', () => {
  it('tasks / workersByTask / eventsByTask / lastEventIdByTask 全清', () => {
    useOpsStore.getState().seedTaskDetail(makeTask(), [makeWorker()]);
    useOpsStore.getState().appendEvents('task-1', [makeEvent(1)]);
    useOpsStore.getState().clear();
    expect(useOpsStore.getState().tasks).toEqual({});
    expect(useOpsStore.getState().workersByTask).toEqual({});
    expect(useOpsStore.getState().eventsByTask).toEqual({});
    expect(useOpsStore.getState().lastEventIdByTask).toEqual({});
  });
});
