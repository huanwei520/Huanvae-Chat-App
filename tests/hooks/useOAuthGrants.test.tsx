/**
 * useOAuthGrants Hook 行为测试（renderHook）
 *
 * 只 mock SessionContext 的 useApi（vi.hoisted 稳定引用），不 mock src/api/oauth ——
 * 真实 API 封装层跑在假 ApiClient 上，一并覆盖 hook + api 层集成。
 *
 * 覆盖：挂载自动刷新（成功/失败）、revoke 成功/失败、revoking 在途标记生命周期。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { OAuthGrant } from '../../src/api/oauth';

// 稳定的 api 引用（hook 的 useCallback deps 含 api）
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

import { useOAuthGrants } from '../../src/hooks/useOAuthGrants';

const grant = (id: string, name = id.toUpperCase()): OAuthGrant => ({
  id,
  client_id: `client-${id}`,
  app_name: name,
  app_logo_url: null,
  scope: 'profile',
  created_at: '2026-07-01T00:00:00Z',
});

describe('useOAuthGrants', () => {
  beforeEach(() => {
    apiState.api.get.mockReset();
    apiState.api.delete.mockReset();
  });

  it('挂载自动刷新：GET /api/oauth/grants 成功 → grants 填充、loading=false、error=null', async () => {
    apiState.api.get.mockResolvedValueOnce([grant('g1'), grant('g2')]);
    const { result } = renderHook(() => useOAuthGrants());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.grants).toHaveLength(2);
    });
    expect(apiState.api.get).toHaveBeenCalledWith('/api/oauth/grants');
    expect(result.current.grants[0]?.id).toBe('g1');
    expect(result.current.error).toBeNull();
  });

  it('挂载加载失败：api.get 拒绝 → error 为异常消息、grants 保持空', async () => {
    apiState.api.get.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useOAuthGrants());

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.grants).toEqual([]);
  });

  it('revoke 成功：DELETE /api/oauth/grants/<id> → 返回 true 且 refresh 一次（get 共 2 次）', async () => {
    apiState.api.get.mockResolvedValueOnce([grant('g1')]);
    const { result } = renderHook(() => useOAuthGrants());
    await waitFor(() => {
      expect(result.current.grants).toHaveLength(1);
    });

    apiState.api.delete.mockResolvedValueOnce({ message: 'revoked' });
    apiState.api.get.mockResolvedValueOnce([]); // refresh 后列表为空

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.revoke('g1');
    });

    expect(ok).toBe(true);
    expect(apiState.api.delete).toHaveBeenCalledWith('/api/oauth/grants/g1');
    expect(apiState.api.get).toHaveBeenCalledTimes(2); // mount + refresh
    expect(result.current.grants).toEqual([]);
    expect(result.current.revoking).toBeNull();
  });

  it('revoke 失败：DELETE 拒绝 → 返回 false、error 置为异常消息、不触发 refresh', async () => {
    apiState.api.get.mockResolvedValueOnce([grant('g1')]);
    const { result } = renderHook(() => useOAuthGrants());
    await waitFor(() => {
      expect(result.current.grants).toHaveLength(1);
    });

    apiState.api.delete.mockRejectedValueOnce(new Error('revoke-fail'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.revoke('g1');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('revoke-fail');
    expect(apiState.api.get).toHaveBeenCalledTimes(1); // 失败不 refresh
    expect(result.current.grants).toHaveLength(1); // 列表未变
    expect(result.current.revoking).toBeNull();
  });

  it('revoke 在途：deferred DELETE 未决期间 revoking=<id>，落定后归 null', async () => {
    apiState.api.get.mockResolvedValue([grant('g1')]); // mount + 落定后 refresh 均返回
    const { result } = renderHook(() => useOAuthGrants());
    await waitFor(() => {
      expect(result.current.grants).toHaveLength(1);
    });

    let resolveDelete!: (v: { message: string }) => void;
    apiState.api.delete.mockReturnValueOnce(
      new Promise<{ message: string }>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.revoke('g1');
    });
    // DELETE 未决 → 在途标记指向该 grant
    expect(result.current.revoking).toBe('g1');

    await act(async () => {
      resolveDelete({ message: 'revoked' });
      await pending;
    });
    expect(result.current.revoking).toBeNull();
  });
});
