/**
 * `useSession().api` 的引用稳定性（外部审计 idx=53 回归）
 *
 * 病灶（本轮修复前）：
 *   `const api = useMemo(..., [session, updateTokens, clearSession])` 依赖**整个 session 对象**。
 *   `updateTokens` 与改昵称/头像（`setSession({...session, profile})`）都会造一个新的 session 对象
 *   ⇒ `api` 换新引用 ⇒ 全仓 101 处把 `api` 写进依赖数组的 effect/callback 全部重跑、
 *   重新发一轮请求（useDevices / useGroups / useMiniApps / useBots / useOAuthClients /
 *   usePendingRequests / useFiles / useBlacklist …），列表还会闪一次 loading。
 *   JWT 15 分钟、提前 5 分钟刷 ⇒ 大约**每 10 分钟自动炸一轮**；改一次昵称同样炸一轮。
 *
 * 🔴 这是**行为测试**：真渲染 `SessionProvider`、真调它导出的 `setSession` / `updateTokens`，
 *    断言的是 `api` 的**引用同一性**。不是扫源码里 useMemo 的依赖数组长什么样
 *    —— 那种写法在「依赖数组没变但里面的值变了」时会给出错误的绿。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  persistSession: vi.fn().mockResolvedValue(undefined),
  clearPersistedSession: vi.fn().mockResolvedValue(undefined),
  removeSessionLock: vi.fn().mockResolvedValue(undefined),
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../src/services/sessionPersist', () => ({
  persistSession: mocks.persistSession,
  clearPersistedSession: mocks.clearPersistedSession,
}));
vi.mock('../../src/services/sessionLock', () => ({
  removeSessionLock: mocks.removeSessionLock,
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: mocks.emit,
  listen: mocks.listen,
}));

import { SessionProvider, useSession } from '../../src/contexts/SessionContext';
import type { Session } from '../../src/types/session';

/**
 * 刻意用**非 JWT** 的 token：`getTokenExpiresAt` 解不出过期时间就直接 return，
 * 主动刷新定时器不会起 —— 本测试要测的是引用同一性，不是定时器。
 */
const baseSession: Session = {
  serverUrl: 'https://api.example.com',
  userId: 'u1',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  profile: {
    user_id: 'u1',
    user_nickname: '旧昵称',
    user_avatar_url: null,
  },
} as unknown as Session;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SessionProvider, null, children);

describe('useSession().api 引用稳定性', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockClear());
  });

  it('🔴 token 刷新不换 api 实例（修前每 ~10 分钟换一次，炸掉 101 个 effect）', () => {
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => { result.current.setSession(baseSession); });
    const api1 = result.current.api;
    expect(api1).not.toBeNull();

    act(() => { result.current.updateTokens('access-2', 'refresh-2'); });

    expect(result.current.session?.accessToken).toBe('access-2');
    expect(result.current.api).toBe(api1);
  });

  it('🔴 改昵称不换 api 实例（修前改一次昵称炸一轮）', () => {
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => { result.current.setSession(baseSession); });
    const api1 = result.current.api;

    act(() => {
      result.current.setSession({
        ...baseSession,
        profile: { ...baseSession.profile, user_nickname: '新昵称' },
      });
    });

    expect(result.current.session?.profile.user_nickname).toBe('新昵称');
    expect(result.current.api).toBe(api1);
  });

  it('token 刷新后，同一个 api 实例读到的是新 token（稳定 ≠ 用旧 token）', () => {
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => { result.current.setSession(baseSession); });
    expect(result.current.api?.getAccessToken()).toBe('access-1');

    act(() => { result.current.updateTokens('access-2', 'refresh-2'); });
    expect(result.current.api?.getAccessToken()).toBe('access-2');
  });

  it('正对照：换服务器地址**必须**换 api 实例（证明上面那些 toBe 不是恒真）', () => {
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => { result.current.setSession(baseSession); });
    const api1 = result.current.api;

    act(() => {
      result.current.setSession({ ...baseSession, serverUrl: 'https://other.example.com' });
    });

    expect(result.current.api).not.toBe(api1);
    expect(result.current.api?.getBaseUrl()).toBe('https://other.example.com');
  });

  it('updateTokens 同步写 ref：不等 React 提交，api 立刻能读到新 token', () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() => { result.current.setSession(baseSession); });
    const api = result.current.api!;

    // 不用 act 包裹、也不重新渲染：直接读同一个实例
    result.current.updateTokens('access-sync', 'refresh-sync');
    expect(api.getAccessToken()).toBe('access-sync');
  });
});
