/**
 * 运维全景折叠区（bot 聊天页头部下方）
 *
 * @module chat/ops
 * @location src/chat/ops/OpsConsolePanel.tsx
 *
 * 仅 ops-bot 的 owner 可见（gate 由 useOpsConsole 经后端数据判定；
 * gate 未通过/判定中一律 return null，不闪 loading）。
 * 折叠展开用条件渲染 + 纯 CSS（无 framer-motion/GSAP，动画单一所有权）。
 */

import { useState } from 'react';
import { useOpsConsole } from './useOpsConsole';
import type { OpsStatus } from '../../api/ops';
import { formatMessageTime } from '../../utils/time';
import '../../styles/ops-console.css';

/** 状态徽章文案 */
const STATUS_LABELS: Record<OpsStatus, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 展开视图事件流展示的尾部条数上限 */
const MAX_VISIBLE_EVENTS = 30;

/** 事件 payload 摘要：string 直接用，其他 JSON 序列化；超 200 字符截断 */
export function formatOpsPayload(payload: unknown): string {
  // String() 兜住 JSON.stringify 对 undefined 等不可序列化值返回 undefined 的边角
  const text = typeof payload === 'string'
    ? payload
    : String(JSON.stringify(payload));
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function StatusBadge({ status }: { status: OpsStatus }) {
  return (
    <span className={`ops-status ops-status--${status}`}>{STATUS_LABELS[status]}</span>
  );
}

export function OpsConsolePanel({ botUserId }: { botUserId: string }) {
  const {
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
  } = useOpsConsole(botUserId);
  const [expanded, setExpanded] = useState(false);

  if (!gated) {
    return null;
  }

  // 事件取尾部最多 MAX_VISIBLE_EVENTS 条，倒序（最新在上）
  const visibleEvents = events.slice(-MAX_VISIBLE_EVENTS).reverse();

  return (
    <div className="ops-console">
      <button
        type="button"
        className="ops-console-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="ops-console-title">运维全景</span>
        <span className="ops-console-summary">
          {runningTaskCount} 任务运行中 · {runningWorkerCount} worker 在跑
        </span>
        <span className={`ops-console-chevron${expanded ? ' expanded' : ''}`}>▾</span>
      </button>
      {expanded && (
        <div className="ops-console-body">
          {error && (
            <div className="ops-console-error">
              加载失败：{error}
              <button type="button" onClick={refresh}>重试</button>
            </div>
          )}
          {loading && tasks.length === 0 && (
            <div className="ops-console-loading">加载中…</div>
          )}
          {!loading && !error && tasks.length === 0 && (
            <div className="ops-console-empty">暂无任务</div>
          )}
          <div className="ops-task-list">
            {tasks.map((task) => (
              <button
                type="button"
                key={task.task_id}
                className={`ops-task-row${task.task_id === selectedTaskId ? ' selected' : ''}`}
                onClick={() => selectTask(task.task_id)}
              >
                <span className="ops-task-title">{task.title}</span>
                <StatusBadge status={task.status} />
                <span className="ops-task-time">{formatMessageTime(task.updated_at)}</span>
              </button>
            ))}
          </div>
          {selectedTaskId && (
            <div className="ops-task-detail">
              {workers.length > 0 && (
                <div className="ops-worker-list">
                  {workers.map((worker) => (
                    <div className="ops-worker-row" key={worker.worker_id}>
                      <span className="ops-layer-badge">{worker.layer}</span>
                      <span className="ops-worker-title">
                        {worker.title || worker.worker_id}
                      </span>
                      <StatusBadge status={worker.status} />
                      <span className="ops-worker-detail">{worker.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {visibleEvents.length > 0 && (
                <div className="ops-event-list">
                  {visibleEvents.map((event) => (
                    <div className="ops-event-row" key={event.event_id}>
                      <span className="ops-event-type">{event.event_type}</span>
                      <span className="ops-event-payload">{formatOpsPayload(event.payload)}</span>
                      <span className="ops-event-time">{formatMessageTime(event.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
