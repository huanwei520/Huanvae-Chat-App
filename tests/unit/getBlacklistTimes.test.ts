/**
 * api/friends.getBlacklistTimes — 拉黑时间映射构建测试
 *
 * 锁定契约：把 getBlacklist 返回的列表构建为 user_id → 服务器 created_at 映射。
 * 群消息「只折叠拉黑之后发的」依赖此映射的服务器时间（非客户端时钟）作折叠边界。
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import { getBlacklistTimes } from '../../src/api/friends';

function mockApi(blacklist: unknown): ApiClient {
  return { get: vi.fn().mockResolvedValue(blacklist) } as unknown as ApiClient;
}

describe('getBlacklistTimes', () => {
  it('把黑名单列表映射为 user_id → created_at', async () => {
    const api = mockApi([
      { user_id: 'u1', user_nickname: 'A', user_avatar_url: null, created_at: '2026-02-01T00:00:00Z' },
      { user_id: 'u2', user_nickname: 'B', user_avatar_url: null, created_at: '2026-02-02T00:00:00Z' },
    ]);
    const times = await getBlacklistTimes(api);
    expect(times).toEqual({ u1: '2026-02-01T00:00:00Z', u2: '2026-02-02T00:00:00Z' });
  });

  it('空列表 → 空映射', async () => {
    expect(await getBlacklistTimes(mockApi([]))).toEqual({});
  });

  it('非数组（异常响应）→ 空映射（不抛）', async () => {
    expect(await getBlacklistTimes(mockApi(null))).toEqual({});
  });
});
