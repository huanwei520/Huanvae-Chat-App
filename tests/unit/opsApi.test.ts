/**
 * Ops API 路径回归测试
 *
 * src/api/ops.ts 的三个函数都接收 ApiClient 并调用 .get。
 * 用最小 mock ApiClient 断言**请求路径字符串**精确正确——
 * query 参数名（after_id 下划线）/ encodeURIComponent / `!== undefined`
 * 判断（afterId=0 也要出现在 query）是后端 axum 精确匹配下最易漂移的点。
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import { getOpsTasks, getOpsTask, getOpsTaskEvents } from '../../src/api/ops';

/** 最小 mock ApiClient：只实现 get，记录调用参数 */
function mockApi() {
  const get = vi.fn().mockResolvedValue({});
  const api = { get } as unknown as ApiClient;
  return { api, get };
}

describe('ops API 请求路径', () => {
  it('getOpsTasks 无参 → /api/ops/tasks（无 query）', () => {
    const { api, get } = mockApi();
    getOpsTasks(api);
    expect(get).toHaveBeenCalledWith('/api/ops/tasks');
  });

  it('getOpsTasks 带 limit + before → query 齐全且 before 经 URL 编码', () => {
    const { api, get } = mockApi();
    getOpsTasks(api, { limit: 20, before: '2026-07-16T00:00:00Z' });
    // URLSearchParams 把 ':' 编码为 %3A
    expect(get).toHaveBeenCalledWith(
      '/api/ops/tasks?limit=20&before=2026-07-16T00%3A00%3A00Z',
    );
  });

  it('getOpsTask → /api/ops/tasks/{task_id}', () => {
    const { api, get } = mockApi();
    getOpsTask(api, 'task-1');
    expect(get).toHaveBeenCalledWith('/api/ops/tasks/task-1');
  });

  it('getOpsTask taskId 含特殊字符时 encodeURIComponent 生效（a/b → a%2Fb）', () => {
    const { api, get } = mockApi();
    getOpsTask(api, 'a/b');
    expect(get).toHaveBeenCalledWith('/api/ops/tasks/a%2Fb');
  });

  it('getOpsTaskEvents 无 opts → /api/ops/tasks/{task_id}/events（无 query）', () => {
    const { api, get } = mockApi();
    getOpsTaskEvents(api, 'task-1');
    expect(get).toHaveBeenCalledWith('/api/ops/tasks/task-1/events');
  });

  it('getOpsTaskEvents 带 afterId + workerId + limit → 三参数齐全（after_id 下划线命名）', () => {
    const { api, get } = mockApi();
    getOpsTaskEvents(api, 'task-1', { afterId: 42, workerId: 'w-1', limit: 100 });
    expect(get).toHaveBeenCalledWith(
      '/api/ops/tasks/task-1/events?after_id=42&worker_id=w-1&limit=100',
    );
  });

  it('getOpsTaskEvents afterId=0 也要出现在 query（回归 !== undefined 判断，防误用 truthy）', () => {
    const { api, get } = mockApi();
    getOpsTaskEvents(api, 'task-1', { afterId: 0 });
    expect(get).toHaveBeenCalledWith('/api/ops/tasks/task-1/events?after_id=0');
  });
});
