/**
 * OpsConsolePanel 测试（bot 聊天页运维全景折叠区）
 *
 * mock 边界：SessionContext.useApi / WebSocketContext.useWebSocket /
 * api/bots.getBot（gate）/ api/ops 三函数（REST 快照）——全部 vi.hoisted 稳定引用，
 * 对齐真实 Context 的引用稳定性（防虚假触发依赖 effect）。
 * opsStore 用真实 store（beforeEach clear），走 useOpsConsole 完整派生链路。
 *
 * 覆盖：
 * 1. gate 不过（getBot rejects / is_ops=false）→ 面板不渲染
 * 2. gate 过 + REST 快照 → 折叠条摘要计数；默认折叠
 * 3. 展开 → running 置顶；点任务行 → getOpsTask/getOpsTaskEvents 精确入参 + worker/事件渲染
 * 4. 快照失败 → 错误条 + 重试重拉
 * 5. formatOpsPayload 纯函数（string 直用 / 对象 JSON 化 / 超 200 截断）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { OpsTaskInfo, OpsWorkerInfo, OpsEventInfo } from '../../src/api/ops';

// 稳定单例 api 对象（真实 Context 的 value 引用稳定，mock 必须对齐）
const sessionMock = vi.hoisted(() => ({
  api: {} as Record<string, unknown>,
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => sessionMock.api,
}));

// 稳定单例 ws mock：onReconnected 返回退订函数
const wsMock = vi.hoisted(() => ({
  onReconnected: vi.fn(() => () => {}),
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => wsMock,
}));

const botsApiMock = vi.hoisted(() => ({
  getBot: vi.fn(),
}));
vi.mock('../../src/api/bots', () => botsApiMock);

const opsApiMock = vi.hoisted(() => ({
  getOpsTasks: vi.fn(),
  getOpsTask: vi.fn(),
  getOpsTaskEvents: vi.fn(),
}));
vi.mock('../../src/api/ops', () => opsApiMock);

import { OpsConsolePanel, formatOpsPayload } from '../../src/chat/ops/OpsConsolePanel';
import { useOpsStore } from '../../src/stores/opsStore';

const BOT_ID = 'bot_fake';

const OPS_BOT = {
  bot_user_id: BOT_ID,
  username: 'ops_bot',
  nickname: '运维机器人',
  description: '',
  commands: [],
  webhook_url: null,
  can_join_groups: false,
  is_active: true,
  message_policy: 'owner_only',
  message_whitelist: [],
  is_discoverable: false,
  is_ops: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const RUNNING_TASK: OpsTaskInfo = {
  task_id: 'task-1',
  bot_user_id: BOT_ID,
  title: '部署网关任务',
  status: 'running',
  summary: '进行中',
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:01:00Z',
};

// updated_at 比 running 任务更新，验证 running 仍置顶（排序不是纯时间序）
const COMPLETED_TASK: OpsTaskInfo = {
  task_id: 'task-2',
  bot_user_id: BOT_ID,
  title: '巡检任务',
  status: 'completed',
  summary: '已完成',
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-16T09:00:00Z',
};

const RUNNING_WORKER: OpsWorkerInfo = {
  task_id: 'task-1',
  worker_id: 'w-1',
  layer: 'L2',
  title: '编译 worker',
  status: 'running',
  detail: '正在编译',
  created_at: '2026-07-16T00:00:10Z',
  updated_at: '2026-07-16T00:01:10Z',
};

const EVENT_ONE: OpsEventInfo = {
  event_id: 7,
  task_id: 'task-1',
  worker_id: 'w-1',
  event_type: 'progress',
  payload: 'step done',
  created_at: '2026-07-16T00:02:00Z',
};

/** gate 过 + 快照可用的默认 mock 编排 */
function arrangeHappyPath() {
  botsApiMock.getBot.mockResolvedValue(OPS_BOT);
  opsApiMock.getOpsTasks.mockResolvedValue({ tasks: [RUNNING_TASK, COMPLETED_TASK] });
  opsApiMock.getOpsTask.mockResolvedValue({ task: RUNNING_TASK, workers: [RUNNING_WORKER] });
  opsApiMock.getOpsTaskEvents.mockResolvedValue({ events: [EVENT_ONE] });
}

describe('OpsConsolePanel', () => {
  beforeEach(() => {
    cleanup();
    useOpsStore.getState().clear();
    botsApiMock.getBot.mockReset();
    Object.values(opsApiMock).forEach((m) => m.mockReset());
    wsMock.onReconnected.mockClear();
  });

  it('gate 不过（getBot rejects，非 owner 404 同形）→ 不渲染面板也不拉快照', async () => {
    botsApiMock.getBot.mockRejectedValue(new Error('404'));
    render(<OpsConsolePanel botUserId={BOT_ID} />);

    await waitFor(() => {
      expect(botsApiMock.getBot).toHaveBeenCalledWith(sessionMock.api, BOT_ID);
    });
    expect(screen.queryByText('运维全景')).toBeNull();
    expect(opsApiMock.getOpsTasks).not.toHaveBeenCalled();
  });

  it('gate 过但 is_ops=false → 同样不渲染、不拉快照', async () => {
    botsApiMock.getBot.mockResolvedValue({ ...OPS_BOT, is_ops: false });
    render(<OpsConsolePanel botUserId={BOT_ID} />);

    await waitFor(() => {
      expect(botsApiMock.getBot).toHaveBeenCalledWith(sessionMock.api, BOT_ID);
    });
    expect(screen.queryByText('运维全景')).toBeNull();
    expect(opsApiMock.getOpsTasks).not.toHaveBeenCalled();
  });

  it('gate 过 + 快照返回 → 折叠条摘要计数正确，默认折叠（任务行不可见）', async () => {
    arrangeHappyPath();
    render(<OpsConsolePanel botUserId={BOT_ID} />);

    expect(await screen.findByText('运维全景')).toBeInTheDocument();
    // 1 running 任务 + 该任务详情 prefetch 出的 1 个 running worker
    expect(await screen.findByText('1 任务运行中 · 1 worker 在跑')).toBeInTheDocument();
    // 快照编排：列表 + running 任务详情 prefetch
    expect(opsApiMock.getOpsTasks).toHaveBeenCalledWith(sessionMock.api, { limit: 50 });
    expect(opsApiMock.getOpsTask).toHaveBeenCalledWith(sessionMock.api, 'task-1');
    // 默认折叠：任务 title 不渲染
    expect(screen.queryByText('部署网关任务')).toBeNull();
    expect(screen.queryByText('巡检任务')).toBeNull();
  });

  it('展开 → running 置顶第一行；点任务行 → 详情/事件精确入参（首拉 afterId=undefined）+ worker/事件渲染', async () => {
    arrangeHappyPath();
    render(<OpsConsolePanel botUserId={BOT_ID} />);
    await screen.findByText('1 任务运行中 · 1 worker 在跑');

    // 展开折叠条
    fireEvent.click(screen.getByRole('button', { name: /运维全景/ }));
    expect(screen.getByText('部署网关任务')).toBeInTheDocument();
    expect(screen.getByText('巡检任务')).toBeInTheDocument();

    // running 置顶：completed 的 updated_at 更新，但第一行仍是 running 任务
    const rows = document.querySelectorAll('.ops-task-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('部署网关任务');
    expect(rows[1].textContent).toContain('巡检任务');

    // 点击任务行 → 详情 + 事件增量（store 无游标时 afterId=undefined 全量首拉）
    fireEvent.click(screen.getByRole('button', { name: /部署网关任务/ }));
    await waitFor(() => {
      expect(opsApiMock.getOpsTaskEvents).toHaveBeenCalledTimes(1);
    });
    expect(opsApiMock.getOpsTaskEvents).toHaveBeenCalledWith(sessionMock.api, 'task-1', {
      afterId: undefined,
    });
    // 快照 prefetch 已调过一次 getOpsTask，点击后再调一次
    expect(opsApiMock.getOpsTask).toHaveBeenCalledTimes(2);
    expect(opsApiMock.getOpsTask).toHaveBeenLastCalledWith(sessionMock.api, 'task-1');

    // worker 行渲染（layer 徽章 + title + detail）
    expect(await screen.findByText('编译 worker')).toBeInTheDocument();
    expect(screen.getByText('L2')).toBeInTheDocument();
    expect(screen.getByText('正在编译')).toBeInTheDocument();
    // 事件行渲染（event_type + payload）
    expect(await screen.findByText('progress')).toBeInTheDocument();
    expect(screen.getByText('step done')).toBeInTheDocument();
  });

  it('快照失败 → 展开后错误条可见，点重试再次拉快照', async () => {
    botsApiMock.getBot.mockResolvedValue(OPS_BOT);
    opsApiMock.getOpsTasks.mockRejectedValue(new Error('网络超时'));
    render(<OpsConsolePanel botUserId={BOT_ID} />);

    await screen.findByText('运维全景');
    await waitFor(() => {
      expect(opsApiMock.getOpsTasks).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /运维全景/ }));
    expect(await screen.findByText(/加载失败：网络超时/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(opsApiMock.getOpsTasks).toHaveBeenCalledTimes(2);
    });
    expect(opsApiMock.getOpsTasks).toHaveBeenLastCalledWith(sessionMock.api, { limit: 50 });
  });
});

describe('formatOpsPayload - 事件 payload 摘要纯函数', () => {
  it('string 直接使用（不加引号）', () => {
    expect(formatOpsPayload('plain text')).toBe('plain text');
  });

  it('对象 JSON 序列化', () => {
    expect(formatOpsPayload({ step: 3, ok: true })).toBe('{"step":3,"ok":true}');
  });

  it('超 200 字符截断为 200 + "…"（共 201），结尾为省略号', () => {
    const long = 'a'.repeat(250);
    const result = formatOpsPayload(long);
    expect(result).toHaveLength(201);
    expect(result.endsWith('…')).toBe(true);
    expect(result.slice(0, 200)).toBe('a'.repeat(200));
  });

  it('恰好 200 字符不截断', () => {
    const exact = 'b'.repeat(200);
    expect(formatOpsPayload(exact)).toBe(exact);
  });
});
