/**
 * useProfileEditor 共享 Hook 测试
 *
 * 覆盖背景相关的纯逻辑（不触发 canvas/真实图片加载）：
 * - 初始无背景：hasBackground=false、coverStyle/cardStyle 为空、error/success null
 * - 超大/非法背景图被拒（走 setError 早返回，不进压缩/上传）
 * - handleColorBackground 设纯色（PUT 后端，用响应刷新 store）→ coverStyle/cardStyle 正确派生 + 跟随开默认驱动主题主色
 * - handleBackgroundRemove 清空（DELETE 后端，用响应刷新 store）
 *
 * 背景接口走 mock 的 ApiClient（put/delete 解包后即 BackgroundUpdateResponse）；
 * 头像上传链路依赖 session + 网络、背景图压缩 + 上传依赖 canvas，由组件集成层 / 专项 store 测试覆盖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSetSession = vi.hoisted(() => vi.fn());
const mockPut = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'https://s',
    accessToken: 't',
    profile: { user_nickname: 'Me', user_avatar_url: null },
  },
  setSession: mockSetSession,
}));
const mockUploadBackground = vi.hoisted(() => vi.fn());
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionState,
  useApi: () => ({ get: mockGet, put: mockPut, delete: mockDelete }),
}));
// 仅替换走 XHR 的 uploadBackground 为 spy（验证校验早返回时不发上传）；
// setBackgroundColor/clearProfileBackground 保留真实实现，经上面 mock 的 api.put/delete 走通。
vi.mock('../../src/api/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/profile')>();
  return { ...actual, uploadBackground: mockUploadBackground };
});
vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({ updateAvatar: vi.fn(), updateNickname: vi.fn() }),
}));
vi.mock('../../src/components/common/AvatarCropModal', () => ({
  useAvatarCrop: () => ({ requestCrop: vi.fn(), cropModal: null }),
}));

import { useProfileEditor } from '../../src/hooks/useProfileEditor';
import { useProfileBackground } from '../../src/stores';
import { useThemeStore } from '../../src/theme/store';

function imageChangeEvent(file: File): React.ChangeEvent<HTMLInputElement> {
  return { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

beforeEach(() => {
  mockPut.mockReset();
  mockDelete.mockReset();
  mockGet.mockReset();
  mockUploadBackground.mockReset();
  useProfileBackground.setState({
    kind: 'none',
    backgroundUrl: null,
    color: null,
    dominant: null,
    themeFollowsBackground: true,
  });
  useThemeStore.getState().reset();
});

describe('useProfileEditor', () => {
  it('初始无背景：hasBackground=false、coverStyle/cardStyle 空、error/success null', () => {
    const { result } = renderHook(() => useProfileEditor());
    expect(result.current.error).toBeNull();
    expect(result.current.success).toBeNull();
    expect(result.current.hasBackground).toBe(false);
    expect(result.current.coverStyle).toEqual({});
    expect(result.current.cardStyle).toEqual({});
  });

  it('超大背景图被拒（setError，不落背景，不发上传）', () => {
    const { result } = renderHook(() => useProfileEditor());
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'b.png', { type: 'image/png' });
    act(() => { void result.current.handleImageBackgroundSelect(imageChangeEvent(big)); });
    expect(result.current.error).toBe('背景图太大，最大 10MB');
    expect(result.current.hasBackground).toBe(false);
    expect(mockUploadBackground).not.toHaveBeenCalled();
  });

  it('非法类型背景图被拒（setError，不落背景，不发上传）', () => {
    const { result } = renderHook(() => useProfileEditor());
    const bad = new File([new Uint8Array(10)], 'b.txt', { type: 'text/plain' });
    act(() => { void result.current.handleImageBackgroundSelect(imageChangeEvent(bad)); });
    expect(result.current.error).toBe('背景图格式不支持，仅支持 jpg、png、gif、webp');
    expect(result.current.hasBackground).toBe(false);
    expect(mockUploadBackground).not.toHaveBeenCalled();
  });

  it('纯色背景：PUT 响应刷新 store → coverStyle 用纯色、cardStyle 淡染、hasBackground=true；跟随开默认驱动主题主色', async () => {
    mockPut.mockResolvedValue({ user_background_url: '', user_background_color: '#1e1e3c', message: 'ok' });
    const { result } = renderHook(() => useProfileEditor());
    await act(async () => { await result.current.handleColorBackground('#1e1e3c'); });

    expect(mockPut).toHaveBeenCalledWith('/api/profile/background', { color: '#1e1e3c' });
    expect(result.current.hasBackground).toBe(true);
    expect(result.current.coverStyle).toEqual({ backgroundImage: 'none', backgroundColor: '#1e1e3c' });
    // 30,30,60 与白 0.82 混合 → 215,215,220
    expect(result.current.cardStyle).toEqual({ background: 'rgba(215, 215, 220, 1)' });
    // 跟随默认开：主题主色 + 强调色都被设为背景色（整个主题统一跟随）
    expect(useThemeStore.getState().config.customColors.primary).toBe('#1e1e3c');
    expect(useThemeStore.getState().config.customColors.accent).toBe('#1e1e3c');
  });

  it('handleBackgroundRemove：DELETE 响应刷新 store → 清空背景', async () => {
    mockPut.mockResolvedValue({ user_background_url: '', user_background_color: '#1e1e3c', message: 'ok' });
    mockDelete.mockResolvedValue({ user_background_url: '', user_background_color: '', message: 'ok' });
    const { result } = renderHook(() => useProfileEditor());
    await act(async () => { await result.current.handleColorBackground('#1e1e3c'); });
    await act(async () => { await result.current.handleBackgroundRemove(); });

    expect(mockDelete).toHaveBeenCalledWith('/api/profile/background');
    expect(result.current.hasBackground).toBe(false);
    expect(result.current.coverStyle).toEqual({});
    expect(result.current.cardStyle).toEqual({});
  });

  it('纯色背景设置失败：PUT reject → setError(err.message) + store 不被污染', async () => {
    mockPut.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useProfileEditor());
    await act(async () => { await result.current.handleColorBackground('#1e1e3c'); });

    expect(result.current.error).toBe('boom');
    expect(result.current.hasBackground).toBe(false);
    expect(result.current.coverStyle).toEqual({});
  });

  it('清除背景失败：DELETE reject → setError，且原背景保留（store 未被清）', async () => {
    mockPut.mockResolvedValue({ user_background_url: '', user_background_color: '#1e1e3c', message: 'ok' });
    mockDelete.mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useProfileEditor());
    await act(async () => { await result.current.handleColorBackground('#1e1e3c'); });
    await act(async () => { await result.current.handleBackgroundRemove(); });

    expect(result.current.error).toBe('net');
    // 清除失败 → 仍是之前的纯色背景，未被清空
    expect(result.current.hasBackground).toBe(true);
    expect(result.current.coverStyle).toEqual({ backgroundImage: 'none', backgroundColor: '#1e1e3c' });
  });
});
