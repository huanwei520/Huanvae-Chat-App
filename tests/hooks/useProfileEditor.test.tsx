/**
 * useProfileEditor 共享 Hook 测试
 *
 * 覆盖封面相关的纯逻辑（不触发 canvas/真实 blob 加载）：
 * - 初始无封面：cardStyle/coverStyle 为空、error/success null
 * - 超大/非法封面文件被拒（走 setError 早返回，不进 createObjectURL）
 * - store 有封面 + 主色 → cardStyle/coverStyle 正确派生；handleCoverRemove 清空
 *
 * 头像上传 / 昵称更新链路依赖 session + 网络，由组件集成层与 OtherProfile.test 间接覆盖。
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSetSession = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'https://s',
    accessToken: 't',
    profile: { user_nickname: 'Me', user_avatar_url: null },
  },
  setSession: mockSetSession,
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionState,
  useApi: () => ({ get: vi.fn(), put: vi.fn() }),
}));
vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({ updateAvatar: vi.fn(), updateNickname: vi.fn() }),
}));
vi.mock('../../src/components/common/AvatarCropModal', () => ({
  useAvatarCrop: () => ({ requestCrop: vi.fn(), cropModal: null }),
}));

import { useProfileEditor } from '../../src/hooks/useProfileEditor';
import { useProfileCoverPrototype } from '../../src/stores';

function coverChangeEvent(file: File): React.ChangeEvent<HTMLInputElement> {
  return { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

beforeAll(() => {
  // jsdom 默认无 createObjectURL/revokeObjectURL，store 替换/清除封面时会调用
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
  globalThis.URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  useProfileCoverPrototype.getState().clearCover();
});

describe('useProfileEditor', () => {
  it('初始无封面：cardStyle/coverStyle 为空、error/success null', () => {
    const { result } = renderHook(() => useProfileEditor());
    expect(result.current.error).toBeNull();
    expect(result.current.success).toBeNull();
    expect(result.current.coverUrl).toBeNull();
    expect(result.current.cardStyle).toEqual({});
    expect(result.current.coverStyle).toEqual({});
  });

  it('超大封面文件被拒（setError，不落 coverUrl）', () => {
    const { result } = renderHook(() => useProfileEditor());
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'c.png', { type: 'image/png' });
    act(() => { result.current.handleCoverSelect(coverChangeEvent(big)); });
    expect(result.current.error).toBe('封面图太大，最大 10MB');
    expect(result.current.coverUrl).toBeNull();
  });

  it('非法类型封面被拒（setError，不落 coverUrl）', () => {
    const { result } = renderHook(() => useProfileEditor());
    const bad = new File([new Uint8Array(10)], 'c.txt', { type: 'text/plain' });
    act(() => { result.current.handleCoverSelect(coverChangeEvent(bad)); });
    expect(result.current.error).toBe('封面图格式不支持，仅支持 jpg、png、gif、webp');
    expect(result.current.coverUrl).toBeNull();
  });

  it('store 有封面 + 深色主色 → coverStyle 用图、cardStyle 用淡染；handleCoverRemove 清空', () => {
    act(() => { useProfileCoverPrototype.getState().setCover('blob:fake', { r: 30, g: 30, b: 60 }); });
    const { result } = renderHook(() => useProfileEditor());
    expect(result.current.coverStyle).toEqual({ backgroundImage: 'url(blob:fake)' });
    // 与 qqHeroStyles 公式一致（mixWithWhite 0.82 → 215,215,220）
    expect(result.current.cardStyle).toEqual({ background: 'rgba(215, 215, 220, 1)' });

    act(() => { result.current.handleCoverRemove(); });
    expect(result.current.coverUrl).toBeNull();
    expect(result.current.coverStyle).toEqual({});
    expect(result.current.cardStyle).toEqual({});
  });
});
