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
  const baseConfig = {
    baseUrl: 'https://api.example.com',
    accessToken: 'token-123',
    refreshToken: 'refresh-456',
  };

  beforeEach(() => {
    mocks.invoke.mockReset();
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
});
