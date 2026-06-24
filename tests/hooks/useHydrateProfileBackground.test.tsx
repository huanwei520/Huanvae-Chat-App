/**
 * useHydrateProfileBackground Hook 测试
 *
 * 覆盖登录后从后端拉背景灌入 store 的三条路径：
 * - 无 session（登出/未登录）→ 清空背景 store，避免跨账号残留
 * - 有 session → 调 getProfile，用响应（图/纯色 + 代表色）灌入 store
 * - getProfile 失败 → 保持已清空状态（无上一个账号的残留），不兜底
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetProfile = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted<{ session: { userId: string } | null }>(() => ({ session: null }));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionState,
  useApi: () => ({}),
}));
vi.mock('../../src/api/profile', () => ({ getProfile: mockGetProfile }));

import { useHydrateProfileBackground } from '../../src/hooks/useHydrateProfileBackground';
import { useProfileBackground } from '../../src/stores';
import { useThemeStore } from '../../src/theme/store';

/** 预置一个非空背景，便于验证「被清空」 */
function seedStaleBackground() {
  useProfileBackground.setState({
    kind: 'image',
    backgroundUrl: 'user-backgrounds/old.jpg?t=0',
    color: null,
    dominant: { r: 1, g: 2, b: 3 },
    themeFollowsBackground: true,
  });
}

beforeEach(() => {
  mockGetProfile.mockReset();
  sessionState.session = null;
  useProfileBackground.setState({
    kind: 'none',
    backgroundUrl: null,
    color: null,
    dominant: null,
    themeFollowsBackground: true,
  });
  useThemeStore.getState().reset();
});

describe('useHydrateProfileBackground', () => {
  it('无 session → 清空背景 store（不调 getProfile）', () => {
    seedStaleBackground();
    renderHook(() => useHydrateProfileBackground());
    expect(useProfileBackground.getState().kind).toBe('none');
    expect(useProfileBackground.getState().backgroundUrl).toBeNull();
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it('有 session → 调 getProfile，用响应灌入背景（图片 + 代表色）', async () => {
    sessionState.session = { userId: 'u1' };
    mockGetProfile.mockResolvedValue({
      user_background_url: 'user-backgrounds/u1.jpg?t=1',
      user_background_color: '#c83232',
    });
    renderHook(() => useHydrateProfileBackground());
    await waitFor(() => { expect(useProfileBackground.getState().kind).toBe('image'); });
    const s = useProfileBackground.getState();
    expect(s.backgroundUrl).toBe('user-backgrounds/u1.jpg?t=1');
    expect(s.dominant).toEqual({ r: 200, g: 50, b: 50 });
    expect(mockGetProfile).toHaveBeenCalledTimes(1);
  });

  it('getProfile 失败 → 保持已清空（无上一个账号残留）', async () => {
    seedStaleBackground();
    sessionState.session = { userId: 'u2' };
    mockGetProfile.mockRejectedValue(new Error('网络错误'));
    await act(async () => {
      renderHook(() => useHydrateProfileBackground());
      await Promise.resolve();
    });
    await waitFor(() => { expect(useProfileBackground.getState().kind).toBe('none'); });
    expect(useProfileBackground.getState().backgroundUrl).toBeNull();
    // 确实尝试过拉取（失败后靠「先同步清空」保证无残留，而非依赖 catch 兜底）
    expect(mockGetProfile).toHaveBeenCalledTimes(1);
  });
});
