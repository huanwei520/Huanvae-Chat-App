/**
 * useOAuthClients Hook 行为测试（renderHook）
 *
 * 只 mock SessionContext 的 useApi（vi.hoisted 稳定引用，避免虚假重触发 effect），
 * 不 mock src/api/oauth —— 让真实 API 封装层跑在假 ApiClient 上，
 * 一并覆盖 hook + api 层集成（path/body 正确性由 api.get/post/delete 断言）。
 *
 * 覆盖：挂载自动刷新（成功/失败/非数组守卫）、create 成功/失败、
 * remove 成功/失败、resetSecret 成功/失败、operatingId 生命周期。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { OAuthClient } from '../../src/api/oauth';

// 稳定的 api 引用：hook 的 useCallback deps 含 api，每次 render 返回新对象会导致重建回调 + 重跑 mount effect。
const apiState = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiState.api,
}));

import { useOAuthClients } from '../../src/hooks/useOAuthClients';

const client = (id: string, name = id.toUpperCase()): OAuthClient => ({
  client_id: id,
  client_type: 'external',
  app_name: name,
  app_description: '',
  app_homepage_url: null,
  app_logo_url: null,
  redirect_uris: ['https://app.example/cb'],
  allowed_scopes: ['profile'],
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
});

describe('useOAuthClients', () => {
  beforeEach(() => {
    apiState.api.get.mockReset();
    apiState.api.post.mockReset();
    apiState.api.delete.mockReset();
  });

  it('挂载自动刷新：GET /api/oauth/clients 成功 → clients 填充、loading=false、error=null', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1'), client('c2')]);
    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.clients).toHaveLength(2);
    });
    expect(apiState.api.get).toHaveBeenCalledWith('/api/oauth/clients');
    expect(result.current.clients[0]?.client_id).toBe('c1');
    expect(result.current.error).toBeNull();
  });

  it('挂载加载失败：api.get 拒绝 → error 为异常消息、clients 保持空', async () => {
    apiState.api.get.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.clients).toEqual([]);
  });

  it('非数组响应：api.get 返回 null → Array.isArray 守卫兜到空数组、无 error', async () => {
    apiState.api.get.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(apiState.api.get).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.clients).toEqual([]); // null 未透传进 state
    expect(result.current.error).toBeNull();
  });

  it('create 成功：POST 后 refresh 一次（get 共 2 次），返回响应、operatingId 归 null、列表刷新', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1')]); // mount
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.clients).toHaveLength(1);
    });

    const createResp = { client_id: 'c2', client_secret: 'sec-2', app_name: 'New App' };
    apiState.api.post.mockResolvedValueOnce(createResp);
    apiState.api.get.mockResolvedValueOnce([client('c1'), client('c2', 'New App')]); // refresh

    let out: unknown;
    await act(async () => {
      out = await result.current.create({
        app_name: 'New App',
        redirect_uris: ['https://app.example/cb'],
        scopes: ['profile'],
      });
    });

    expect(apiState.api.post).toHaveBeenCalledWith('/api/oauth/clients', {
      app_name: 'New App',
      redirect_uris: ['https://app.example/cb'],
      scopes: ['profile'],
    });
    expect(out).toEqual(createResp);
    expect(apiState.api.get).toHaveBeenCalledTimes(2); // mount + refresh
    expect(result.current.clients).toHaveLength(2);
    expect(result.current.operatingId).toBeNull();
  });

  it('create 失败：POST 拒绝 → 返回 null、error 置为异常消息、不触发 refresh', async () => {
    apiState.api.get.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    apiState.api.post.mockRejectedValueOnce(new Error('create-fail'));
    let out: unknown = 'sentinel';
    await act(async () => {
      out = await result.current.create({ app_name: 'X', redirect_uris: ['https://a/cb'] });
    });

    expect(out).toBeNull();
    expect(result.current.error).toBe('create-fail');
    expect(apiState.api.get).toHaveBeenCalledTimes(1); // 仅 mount，无 refresh
    expect(result.current.operatingId).toBeNull();
  });

  it('remove 成功：DELETE /api/oauth/clients/<id> → 返回 true 且 refresh 一次', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1')]);
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.clients).toHaveLength(1);
    });

    apiState.api.delete.mockResolvedValueOnce({ message: 'deleted' });
    apiState.api.get.mockResolvedValueOnce([]); // refresh 后列表为空

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.remove('c1');
    });

    expect(ok).toBe(true);
    expect(apiState.api.delete).toHaveBeenCalledWith('/api/oauth/clients/c1');
    expect(apiState.api.get).toHaveBeenCalledTimes(2);
    expect(result.current.clients).toEqual([]);
  });

  it('remove 失败：DELETE 拒绝 → 返回 false、error 置为异常消息', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1')]);
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.clients).toHaveLength(1);
    });

    apiState.api.delete.mockRejectedValueOnce(new Error('del-fail'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.remove('c1');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('del-fail');
    expect(apiState.api.get).toHaveBeenCalledTimes(1); // 失败不 refresh
  });

  it('resetSecret 成功：POST reset-secret 空对象 body → 返回新密钥并 refresh', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1')]);
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.clients).toHaveLength(1);
    });

    apiState.api.post.mockResolvedValueOnce({ client_secret: 's2' });
    apiState.api.get.mockResolvedValueOnce([client('c1')]);

    let secret: string | null = null;
    await act(async () => {
      secret = await result.current.resetSecret('c1');
    });

    expect(secret).toBe('s2');
    expect(apiState.api.post).toHaveBeenCalledWith('/api/oauth/clients/c1/reset-secret', {});
    expect(apiState.api.get).toHaveBeenCalledTimes(2);
  });

  it('resetSecret 失败：POST 拒绝 → 返回 null、error 置为异常消息', async () => {
    apiState.api.get.mockResolvedValueOnce([client('c1')]);
    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.clients).toHaveLength(1);
    });

    apiState.api.post.mockRejectedValueOnce(new Error('reset-fail'));
    let secret: string | null = 'sentinel';
    await act(async () => {
      secret = await result.current.resetSecret('c1');
    });

    expect(secret).toBeNull();
    expect(result.current.error).toBe('reset-fail');
  });
});
