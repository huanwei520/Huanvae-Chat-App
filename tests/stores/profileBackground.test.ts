/**
 * profileBackground store 测试
 *
 * 覆盖核心新逻辑：用后端返回的 (背景图相对路径, 代表色 hex) 刷新背景状态（setFromBackend
 * 派生图片/纯色/无三态 + 主色），跟随开关，以及「主题色跟随背景」的单向联动
 * （背景主色 → 调 theme store setPrimaryColor/setAccentColor）。用真实 theme store 验证联动。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useProfileBackground } from '../../src/stores/profileBackground';
import { useThemeStore } from '../../src/theme/store';

const DEFAULT_PRIMARY = '#3b82f6';
const DEFAULT_ACCENT = '#8b5cf6';

/** 读当前主题的主色 + 强调色（跟随会同时驱动两者，让整个主题统一） */
function themeColors() {
  const c = useThemeStore.getState().config.customColors;
  return { primary: c.primary, accent: c.accent };
}

beforeEach(() => {
  useProfileBackground.setState({
    kind: 'none',
    backgroundUrl: null,
    color: null,
    dominant: null,
    themeFollowsBackground: true,
  });
  useThemeStore.getState().reset();
});

describe('profileBackground store', () => {
  it('setFromBackend(纯色)：空 url + 色 hex → kind=color + 主色=该色；跟随开 → 驱动主题', () => {
    useProfileBackground.getState().setFromBackend('', '#1e1e3c');
    const s = useProfileBackground.getState();
    expect(s.kind).toBe('color');
    expect(s.color).toBe('#1e1e3c');
    expect(s.backgroundUrl).toBeNull();
    expect(s.dominant).toEqual({ r: 30, g: 30, b: 60 });
    // 跟随默认开 → 主题主色 + 强调色都被设为背景色（整个主题统一跟随）
    expect(themeColors()).toEqual({ primary: '#1e1e3c', accent: '#1e1e3c' });
  });

  it('跟随关 → setFromBackend(纯色) 不动主题主色/强调色', () => {
    useProfileBackground.getState().setFollowBackground(false);
    useProfileBackground.getState().setFromBackend('', '#1e1e3c');
    expect(useProfileBackground.getState().color).toBe('#1e1e3c');
    expect(themeColors()).toEqual({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });
  });

  it('setFromBackend(图片)：url + 代表色 → kind=image + backgroundUrl + 主色；跟随开 → 主题=主色 hex', () => {
    useProfileBackground.getState().setFromBackend('user-backgrounds/u.jpg?t=1', '#c83232');
    const s = useProfileBackground.getState();
    expect(s.kind).toBe('image');
    expect(s.backgroundUrl).toBe('user-backgrounds/u.jpg?t=1');
    expect(s.color).toBeNull();
    expect(s.dominant).toEqual({ r: 200, g: 50, b: 50 });
    expect(themeColors()).toEqual({ primary: '#c83232', accent: '#c83232' });
  });

  it('setFromBackend(图片但代表色为空，提色失败)→ kind=image + 主色 null + 不动主题', () => {
    useProfileBackground.getState().setFromBackend('user-backgrounds/u.jpg?t=1', '');
    const s = useProfileBackground.getState();
    expect(s.kind).toBe('image');
    expect(s.dominant).toBeNull();
    expect(themeColors()).toEqual({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });
  });

  it('setFollowBackground(true) 时立即用当前背景主色刷新主题（主色+强调色）', () => {
    useProfileBackground.getState().setFollowBackground(false);
    useProfileBackground.getState().setFromBackend('', '#1e1e3c'); // 关时不驱动
    expect(themeColors()).toEqual({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });
    useProfileBackground.getState().setFollowBackground(true); // 开启 → 立即应用
    expect(themeColors()).toEqual({ primary: '#1e1e3c', accent: '#1e1e3c' });
  });

  it('setFromBackend(空,空)=清除：清背景但不回退主题主色/强调色', () => {
    useProfileBackground.getState().setFromBackend('', '#1e1e3c');
    expect(themeColors()).toEqual({ primary: '#1e1e3c', accent: '#1e1e3c' });
    useProfileBackground.getState().setFromBackend('', '');
    const s = useProfileBackground.getState();
    expect(s.kind).toBe('none');
    expect(s.color).toBeNull();
    expect(s.backgroundUrl).toBeNull();
    expect(s.dominant).toBeNull();
    // 主题保留当前色，不回退
    expect(themeColors()).toEqual({ primary: '#1e1e3c', accent: '#1e1e3c' });
  });
});
