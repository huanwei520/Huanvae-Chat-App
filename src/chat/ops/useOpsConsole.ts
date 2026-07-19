/**
 * 运维全景折叠区数据 Hook
 *
 * @module chat/ops
 * @location src/chat/ops/useOpsConsole.ts
 *
 * 双数据源合流（均落 opsStore，本 hook 只做拉取编排 + 派生）：
 * - REST 快照：gate 通过后拉任务列表 seedTasks，并对该 bot 的 running 任务
 *   （最多 10 个）并行拉详情 seedTaskDetail，让折叠条 worker 计数与展开视图即时可用；
 * - WS ops_update 增量：wsHandlers 已直接写 opsStore，本 hook 经 selector 订阅感知；
 * - 断线重连（onReconnected）：重拉快照 + 对选中任务以 lastEventIdByTask 作
 *   after_id 游标增量补事件。
 *
 * gate 语义：getBot（owner-only）成功且 is_ops === true 才渲染面板。
 * 任何 gate 失败（含 404）都静默不渲染——后端对非 owner 返回"与不存在同形"
 * 的 404（隐私语义，契约 §3.3），不是可重试的错误，不置 error。
 * gate 之后的 REST 快照/详情失败则 fail-fast：置 error 供 UI 渲染错误条 + 重试。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getBot } from '../../api/bots';
import { getOpsTask, getOpsTaskEvents, getOpsTasks } from '../../api/ops';
import type { OpsEventInfo, OpsTaskInfo, OpsWorkerInfo } from '../../api/ops';
import { useOpsStore } from '../../stores/opsStore';

/** gate 后单次快照对 running 任务并行拉详情的上限 */
const MAX_DETAIL_PREFETCH = 10;

export interface OpsConsoleData {
  /** getBot 成功且 is_ops === true 才为 true；false 时面板不渲染 */
  gated: boolean;
  loading: boolean;
  /** REST 快照/详情失败信息（gate 失败不在此列，见文件头） */
  error: string | null;
  /** 重拉快照（错误条重试按钮用） */
  refresh: () => void;
  /** 当前 bot 的任务，updated_at 倒序、running 置顶 */
  tasks: OpsTaskInfo[];
  runningTaskCount: number;
  runningWorkerCount: number;
  selectedTaskId: string | null;
  selectTask: (taskId: string) => void;
  /** 选中任务的 workers，created_at 升序 */
  workers: OpsWorkerInfo[];
  /** 选中任务的事件，event_id 升序（UI 取尾部） */
  events: OpsEventInfo[];
}

export function useOpsConsole(botUserId: string): OpsConsoleData {
  const api = useApi();
  const { onReconnected } = useWebSocket();

  const [gated, setGated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // store 原始切片各自订阅（派生数组一律 useMemo，不在 selector 里建新对象，
  // 避免 zustand v5 下 selector 返回新引用导致无限重渲染）
  const taskMap = useOpsStore((s) => s.tasks);
  const workersByTask = useOpsStore((s) => s.workersByTask);
  const eventsByTask = useOpsStore((s) => s.eventsByTask);

  // ==================== gate 判定 ====================
  useEffect(() => {
    let cancelled = false;
    setGated(false);
    setSelectedTaskId(null);
    setError(null);
    getBot(api, botUserId)
      .then((bot) => {
        if (!cancelled && bot.is_ops) {
          setGated(true);
        }
      })
      .catch(() => {
        // gate 失败（含 404）不渲染面板也不置 error：后端对非 owner 返回
        // "与不存在同形"的 404（隐私语义，契约 §3.3），非可重试错误
        if (!cancelled) {
          setGated(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, botUserId]);

  // ==================== REST 快照 ====================
  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { seedTasks, seedTaskDetail } = useOpsStore.getState();
      const res = await getOpsTasks(api, { limit: 50 });
      seedTasks(res.tasks);
      const running = res.tasks
        .filter((t) => t.bot_user_id === botUserId && t.status === 'running')
        .slice(0, MAX_DETAIL_PREFETCH);
      const details = await Promise.all(running.map((t) => getOpsTask(api, t.task_id)));
      details.forEach((d) => seedTaskDetail(d.task, d.workers));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, botUserId]);

  useEffect(() => {
    if (!gated) {
      return;
    }
    void loadSnapshot();
  }, [gated, loadSnapshot]);

  const refresh = useCallback(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  // ==================== 任务选中 + 事件增量 ====================
  const fetchTaskDetail = useCallback(async (taskId: string) => {
    try {
      const afterId = useOpsStore.getState().lastEventIdByTask[taskId];
      const [detail, eventsRes] = await Promise.all([
        getOpsTask(api, taskId),
        getOpsTaskEvents(api, taskId, { afterId }),
      ]);
      const { seedTaskDetail, appendEvents } = useOpsStore.getState();
      seedTaskDetail(detail.task, detail.workers);
      appendEvents(taskId, eventsRes.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    void fetchTaskDetail(taskId);
  }, [fetchTaskDetail]);

  // ==================== 断线重连补拉 ====================
  // 回调经 refs 取最新值：订阅只随 onReconnected 建立/退订一次，不因状态变化反复重订
  const gatedRef = useRef(gated);
  gatedRef.current = gated;
  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;
  const loadSnapshotRef = useRef(loadSnapshot);
  loadSnapshotRef.current = loadSnapshot;
  const fetchTaskDetailRef = useRef(fetchTaskDetail);
  fetchTaskDetailRef.current = fetchTaskDetail;

  useEffect(() => onReconnected(() => {
    if (!gatedRef.current) {
      return;
    }
    void loadSnapshotRef.current();
    const taskId = selectedTaskIdRef.current;
    if (taskId) {
      // fetchTaskDetail 内部以 lastEventIdByTask 作 after_id，天然是增量补拉
      void fetchTaskDetailRef.current(taskId);
    }
  }), [onReconnected]);

  // ==================== store 派生 ====================
  const tasks = useMemo(() => {
    const list = Object.values(taskMap).filter((t) => t.bot_user_id === botUserId);
    list.sort((a, b) => {
      const aRunning = a.status === 'running' ? 1 : 0;
      const bRunning = b.status === 'running' ? 1 : 0;
      if (aRunning !== bRunning) {
        return bRunning - aRunning;
      }
      return b.updated_at.localeCompare(a.updated_at);
    });
    return list;
  }, [taskMap, botUserId]);

  const runningTaskCount = useMemo(
    () => tasks.filter((t) => t.status === 'running').length,
    [tasks],
  );

  const runningWorkerCount = useMemo(() => {
    let count = 0;
    tasks.forEach((t) => {
      const workerMap = workersByTask[t.task_id];
      if (workerMap) {
        Object.values(workerMap).forEach((w) => {
          if (w.status === 'running') {
            count += 1;
          }
        });
      }
    });
    return count;
  }, [tasks, workersByTask]);

  const workers = useMemo(() => {
    if (!selectedTaskId) {
      return [];
    }
    const workerMap = workersByTask[selectedTaskId];
    if (!workerMap) {
      return [];
    }
    return Object.values(workerMap).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [workersByTask, selectedTaskId]);

  const events = useMemo(
    () => (selectedTaskId ? eventsByTask[selectedTaskId] ?? [] : []),
    [eventsByTask, selectedTaskId],
  );

  return {
    gated,
    loading,
    error,
    refresh,
    tasks,
    runningTaskCount,
    runningWorkerCount,
    selectedTaskId,
    selectTask,
    workers,
    events,
  };
}
