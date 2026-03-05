/**
 * API 客户端单元测试
 *
 * 测试 src/api/client.ts 中的 createApiClient
 *
 * 包含测试：
 * - GET 请求：正确 URL、auth header
 * - POST 请求：JSON body、content-type header
 * - PUT/DELETE/PATCH：正确方法
 * - 401 处理：刷新 token 后重试
 * - 401 刷新失败：调用 onSessionExpired，抛出错误
 * - getBaseUrl/getAccessToken：返回配置值
 * - skipAuth：不添加 auth header
 * - 错误响应：抛出错误信息
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { createApiClient } from '../../src/api/client';

const mockFetch = vi.mocked(fetch);

function createMockResponse(overrides: {
  ok?: boolean;
  status?: number;
  data?: unknown;
} = {}) {
  const { ok = true, status = 200, data = {} } = overrides;
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

describe('API 客户端 (api/client)', () => {
  const baseConfig = {
    baseUrl: 'https://api.example.com',
    accessToken: 'token-123',
    refreshToken: 'refresh-456',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET 请求', () => {
    it('应使用正确 URL 并携带 Authorization header', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: { id: 1 } }) as never);

      const client = createApiClient(baseConfig);
      await client.get('/api/users/1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/users/1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        }),
      );
    });
  });

  describe('POST 请求', () => {
    it('应发送 JSON body 并设置 Content-Type header', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: { created: true } }) as never);

      const client = createApiClient(baseConfig);
      await client.post('/api/messages', { content: 'hello' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ content: 'hello' }),
        }),
      );
    });
  });

  describe('PUT/DELETE/PATCH', () => {
    it('PUT 应使用正确方法', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: { updated: true } }) as never);

      const client = createApiClient(baseConfig);
      await client.put('/api/users/1', { name: 'New' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('DELETE 应使用正确方法', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: { deleted: true } }) as never);

      const client = createApiClient(baseConfig);
      await client.delete('/api/users/1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('PATCH 应使用正确方法', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: { patched: true } }) as never);

      const client = createApiClient(baseConfig);
      await client.patch('/api/users/1', { name: 'Patched' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('401 处理', () => {
    it('401 时应刷新 token 并用新 token 重试', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 401 }) as never)
        .mockResolvedValueOnce(createMockResponse({
          ok: true,
          data: { access_token: 'new-token', refresh_token: 'new-refresh' },
        }) as never)
        .mockResolvedValueOnce(createMockResponse({ data: { id: 1 } }) as never);

      const onTokenRefresh = vi.fn();
      const client = createApiClient({
        ...baseConfig,
        onTokenRefresh,
      });

      const result = await client.get('/api/users/1');

      expect(mockFetch).toHaveBeenCalledTimes(3); // 1: original, 2: refresh, 3: retry
      expect(onTokenRefresh).toHaveBeenCalledWith('new-token', 'new-refresh');
      expect(result).toEqual({ id: 1 });
    });

    it('401 刷新失败时应调用 onSessionExpired 并抛出错误', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 401 }) as never)
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 401 }) as never);

      const onSessionExpired = vi.fn();
      const client = createApiClient({
        ...baseConfig,
        onSessionExpired,
      });

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
      mockFetch.mockResolvedValue(createMockResponse({ data: {} }) as never);

      const client = createApiClient(baseConfig);
      await client.get('/api/public', { skipAuth: true });

      const call = mockFetch.mock.calls[0][1];
      expect(call?.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('错误响应', () => {
    it('非 2xx 响应应抛出包含错误信息的异常', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          data: { error: '无效请求' },
        }) as never,
      );

      const client = createApiClient(baseConfig);

      await expect(client.get('/api/fail')).rejects.toThrow('无效请求');
    });

    it('无 error 字段时使用 message 或 HTTP 状态', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          data: { message: '服务器错误' },
        }) as never,
      );

      const client = createApiClient(baseConfig);

      await expect(client.get('/api/fail')).rejects.toThrow('服务器错误');
    });
  });
});
