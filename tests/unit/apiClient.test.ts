/**
 * API 客户端单元测试
 *
 * 测试 src/api/client.ts 中的 createApiClient。
 * 客户端数据面已迁移到 Rust secure_http(invoke('secure_http')),故 mock invoke +
 * discovery.resolveForSecureHttp(返回 null → secureHttp 退化为 pin_ca);secureFetch 用真实实现。
 *
 * 包含测试：
 * - GET 请求：正确 URL、auth header
 * - POST 请求：JSON body、content-type header
 * - PUT/DELETE/PATCH：正确方法
 * - 401 处理：刷新 token 后重试 / 刷新失败调用 onSessionExpired
 * - getBaseUrl/getAccessToken / skipAuth / 错误响应 / refreshAccessToken 暴露
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
// 发现服务未运行场景：resolveForSecureHttp 返回 null → client 退化为 { pin_ca: true }
vi.mock('../../src/services/discovery', () => ({ resolveForSecureHttp: () => null }));

import { createApiClient } from '../../src/api/client';

/** 构造 secure_http(invoke) 返回的 SecureHttpResp */
function mockResp(overrides: { status?: number; data?: unknown } = {}) {
  const { status = 200, data = {} } = overrides;
  return { status, headers: {}, body: JSON.stringify(data) };
}

/** 取第 n 次 invoke 调用的 req 参数 */
function reqOf(callIndex: number): Record<string, unknown> {
  const args = mocks.invoke.mock.calls[callIndex] as [string, { req: Record<string, unknown> }];
  return args[1].req;
}

describe('API 客户端 (api/client)', () => {
  // token 经 getter 现取（2026-08-21 起，见 api/client.ts 的 getAccessToken 注释）。
  // 这里用一个可变的 holder 模拟「持有方（SessionContext 的 sessionRef）」。
  let holder = { accessToken: 'token-123', refreshToken: 'refresh-456' };
  const baseConfig = {
    baseUrl: 'https://api.example.com',
    getAccessToken: () => holder.accessToken,
    getRefreshToken: () => holder.refreshToken,
  };

  beforeEach(() => {
    mocks.invoke.mockReset();
    holder = { accessToken: 'token-123', refreshToken: 'refresh-456' };
  });

  describe('GET 请求', () => {
    it('应使用正确 URL 并携带 Authorization header(经 secure_http)', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { id: 1 } }));

      const client = createApiClient(baseConfig);
      await client.get('/api/users/1');

      expect(mocks.invoke).toHaveBeenCalledWith(
        'secure_http',
        {
          req: expect.objectContaining({
            method: 'GET',
            url: 'https://api.example.com/api/users/1',
            headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
            pin_ca: true,
          }),
        },
      );
    });
  });

  describe('POST 请求', () => {
    it('应发送 JSON body 并设置 Content-Type header', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { created: true } }));

      const client = createApiClient(baseConfig);
      await client.post('/api/messages', { content: 'hello' });

      expect(mocks.invoke).toHaveBeenCalledWith(
        'secure_http',
        {
          req: expect.objectContaining({
            method: 'POST',
            url: 'https://api.example.com/api/messages',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ content: 'hello' }),
          }),
        },
      );
    });
  });

  describe('PUT/DELETE/PATCH', () => {
    it('PUT 应使用正确方法', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { updated: true } }));
      const client = createApiClient(baseConfig);
      await client.put('/api/users/1', { name: 'New' });
      expect(reqOf(0).method).toBe('PUT');
    });

    it('DELETE 应使用正确方法', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { deleted: true } }));
      const client = createApiClient(baseConfig);
      await client.delete('/api/users/1');
      expect(reqOf(0).method).toBe('DELETE');
    });

    it('PATCH 应使用正确方法', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { patched: true } }));
      const client = createApiClient(baseConfig);
      await client.patch('/api/users/1', { name: 'Patched' });
      expect(reqOf(0).method).toBe('PATCH');
    });
  });

  describe('401 处理', () => {
    it('401 时应刷新 token 并用新 token 重试', async () => {
      mocks.invoke
        .mockResolvedValueOnce(mockResp({ status: 401 }))
        .mockResolvedValueOnce(mockResp({ data: { access_token: 'new-token', refresh_token: 'new-refresh' } }))
        .mockResolvedValueOnce(mockResp({ data: { data: { id: 1 } } }));

      const onTokenRefresh = vi.fn();
      const client = createApiClient({ ...baseConfig, onTokenRefresh });

      const result = await client.get('/api/users/1');

      expect(mocks.invoke).toHaveBeenCalledTimes(3); // 1 原始 + 2 刷新 + 3 重试
      expect(onTokenRefresh).toHaveBeenCalledWith('new-token', 'new-refresh');
      expect(result).toEqual({ id: 1 });
      // 重试请求带新 token
      expect((reqOf(2).headers as Record<string, string>).Authorization).toBe('Bearer new-token');
    });

    it('401 刷新失败时应调用 onSessionExpired 并抛出错误', async () => {
      mocks.invoke
        .mockResolvedValueOnce(mockResp({ status: 401 }))
        .mockResolvedValueOnce(mockResp({ status: 401 }));

      const onSessionExpired = vi.fn();
      const client = createApiClient({ ...baseConfig, onSessionExpired });

      await expect(client.get('/api/users/1')).rejects.toThrow('会话已过期，请重新登录');
      expect(onSessionExpired).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBaseUrl / getAccessToken', () => {
    it('getBaseUrl 应返回配置的 baseUrl', () => {
      const client = createApiClient(baseConfig);
      expect(client.getBaseUrl()).toBe('https://api.example.com');
    });

    it('getAccessToken 应返回当前 accessToken', () => {
      const client = createApiClient(baseConfig);
      expect(client.getAccessToken()).toBe('token-123');
    });
  });

  describe('skipAuth', () => {
    it('skipAuth 为 true 时不应添加 Authorization header', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: {} }));

      const client = createApiClient(baseConfig);
      await client.get('/api/public', { skipAuth: true });

      expect(reqOf(0).headers).not.toHaveProperty('Authorization');
    });
  });

  describe('错误响应', () => {
    it('非 2xx 响应应抛出包含错误信息的异常', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ status: 400, data: { error: '无效请求' } }));

      const client = createApiClient(baseConfig);
      await expect(client.get('/api/fail')).rejects.toThrow('无效请求');
    });

    it('无 error 字段时使用 message 或 HTTP 状态', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ status: 500, data: { message: '服务器错误' } }));

      const client = createApiClient(baseConfig);
      await expect(client.get('/api/fail')).rejects.toThrow('服务器错误');
    });
  });

  describe('refreshAccessToken 暴露', () => {
    it('刷新成功时应返回 true 并调用 onTokenRefresh', async () => {
      const onTokenRefresh = vi.fn();
      mocks.invoke.mockResolvedValue(
        mockResp({ data: { access_token: 'new-token', refresh_token: 'new-refresh' } }),
      );

      const client = createApiClient({ ...baseConfig, onTokenRefresh });
      const result = await client.refreshAccessToken();

      expect(result).toBe(true);
      expect(onTokenRefresh).toHaveBeenCalledWith('new-token', 'new-refresh');
    });

    it('刷新失败时应返回 false', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ status: 401 }));

      const client = createApiClient(baseConfig);
      const result = await client.refreshAccessToken();

      expect(result).toBe(false);
    });

    it('网络错误时应返回 false', async () => {
      mocks.invoke.mockRejectedValue(new Error('Network error'));

      const client = createApiClient(baseConfig);
      const result = await client.refreshAccessToken();

      expect(result).toBe(false);
    });

    it('单飞：并发刷新去重为一次 POST /api/auth/refresh，仅回调一次', async () => {
      let resolveRefresh: (v: unknown) => void = () => {};
      mocks.invoke.mockImplementationOnce(() => new Promise((r) => { resolveRefresh = r; }));

      const onTokenRefresh = vi.fn();
      const client = createApiClient({ ...baseConfig, onTokenRefresh });

      const p1 = client.refreshAccessToken();
      const p2 = client.refreshAccessToken(); // 并发第二次：应复用在途请求，不再发 invoke

      expect(mocks.invoke).toHaveBeenCalledTimes(1); // 单飞：只发一次刷新请求

      resolveRefresh(mockResp({ data: { access_token: 'new-token', refresh_token: 'new-refresh' } }));
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(mocks.invoke).toHaveBeenCalledTimes(1);       // 全程只一次刷新请求
      expect(onTokenRefresh).toHaveBeenCalledTimes(1);     // 只回调一次（doRefresh 只跑一次）
    });

    it('单飞句柄完成后清空：后续刷新重新发起请求（失败不毒化）', async () => {
      // 第一次失败（应返回 false 且清空句柄），第二次仍能重新发起
      mocks.invoke
        .mockResolvedValueOnce(mockResp({ status: 401 }))
        .mockResolvedValueOnce(mockResp({ data: { access_token: 't2', refresh_token: 'r2' } }));

      const client = createApiClient(baseConfig);

      const first = await client.refreshAccessToken();
      expect(first).toBe(false);
      expect(mocks.invoke).toHaveBeenCalledTimes(1);

      const second = await client.refreshAccessToken(); // 句柄已在 finally 清空 → 新请求
      expect(second).toBe(true);
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // token 经 getter 现取（外部审计 idx=53）
  // ==========================================================================
  //
  // 这一组锁的是「**同一个客户端实例**能跟上 token 变化」——它是
  // 「api 不必随 token 重建」这件事成立的前提。修前 token 是构造时的快照值，
  // 换 token 只能换实例，于是 SessionContext 的 useMemo 只好依赖整个 session，
  // 每 ~10 分钟一次的主动刷新 + 每次改昵称都把全仓 101 个依赖 api 的 effect 炸一遍。
  describe('token 现取（同一实例跟得上 token 变化）', () => {
    it('持有方换了 access token ⇒ 同一个客户端下一次请求就带新的', async () => {
      mocks.invoke.mockResolvedValue(mockResp({ data: { data: {} } }));
      const client = createApiClient(baseConfig);

      await client.get('/api/a');
      expect((reqOf(0).headers as Record<string, string>).Authorization).toBe('Bearer token-123');

      holder = { accessToken: 'token-999', refreshToken: 'refresh-456' };
      await client.get('/api/b');
      expect((reqOf(1).headers as Record<string, string>).Authorization).toBe('Bearer token-999');
    });

    it('🔴 持有方换了 refresh token ⇒ 刷新请求体带新的（修前是构造时的 const 快照，永远发旧的）', async () => {
      mocks.invoke.mockResolvedValue(
        mockResp({ data: { access_token: 'n', refresh_token: 'r' } }),
      );
      const client = createApiClient(baseConfig);

      holder = { accessToken: 'token-123', refreshToken: 'rotated-refresh' };
      await client.refreshAccessToken();

      const body = reqOf(0).body as string;
      expect(JSON.parse(body)).toEqual({ refresh_token: 'rotated-refresh' });
    });

    it('刷新后持有方还没写回时，401 重试仍用刚刷出来的新 token（不等 setState）', async () => {
      // 持有方（onTokenRefresh）故意什么都不做，模拟 React setState 尚未提交
      mocks.invoke
        .mockResolvedValueOnce(mockResp({ status: 401 }))
        .mockResolvedValueOnce(mockResp({ data: { access_token: 'fresh-token', refresh_token: 'r2' } }))
        .mockResolvedValueOnce(mockResp({ data: { data: { ok: 1 } } }));

      const client = createApiClient({ ...baseConfig, onTokenRefresh: () => { /* 尚未落地 */ } });
      await client.get('/api/x');

      expect((reqOf(2).headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
    });

    it('持有方追上之后，以持有方为准（不永久停在刷出来的那一份）', async () => {
      mocks.invoke
        .mockResolvedValueOnce(mockResp({ status: 401 }))
        .mockResolvedValueOnce(mockResp({ data: { access_token: 'fresh-token', refresh_token: 'r2' } }))
        .mockResolvedValueOnce(mockResp({ data: { data: {} } }))
        .mockResolvedValueOnce(mockResp({ data: { data: {} } }));

      const client = createApiClient({
        ...baseConfig,
        onTokenRefresh: (a, r) => { holder = { accessToken: a, refreshToken: r }; },
      });
      await client.get('/api/x');

      // 持有方之后又换了一次（例如另一个窗口广播过来的更新）
      holder = { accessToken: 'even-newer', refreshToken: 'r3' };
      await client.get('/api/y');
      expect((reqOf(3).headers as Record<string, string>).Authorization).toBe('Bearer even-newer');
    });
  });
});
