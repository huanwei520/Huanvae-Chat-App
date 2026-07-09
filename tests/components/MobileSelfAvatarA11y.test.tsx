/**
 * 移动端「本人头像」a11y 测试（可点击头像容器 a11y 修复，点 6 + 点 10）
 *
 * 锁定契约：
 * - MobileHeader `.mobile-header-avatar`（恒有）：role=button / tabIndex=0 /
 *   aria-label="打开我的资料" + onKeyDown(Enter/Space)=onAvatarClick + 键盘焦点环
 * - MobileDrawer `.mobile-drawer-avatar`（恒有）：同上，回调=onProfileClick
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Session } from '../../src/types/session';

// MobileHeader 依赖 WebSocket 连接状态指示器
vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ connected: true, connecting: false }),
}));

import { MobileHeader } from '../../src/pages/mobile/MobileHeader';
import { MobileDrawer } from '../../src/pages/mobile/MobileDrawer';

const session = {
  serverUrl: 'https://api.test', userId: 'me', accessToken: 't', refreshToken: 'r',
  profile: {
    user_id: 'me', user_nickname: 'Me', user_email: null, user_signature: null,
    user_avatar_url: null, admin: 'false', created_at: '', updated_at: '',
  },
  avatarPath: null,
} as Session;

describe('MobileHeader — 本人头像 a11y', () => {
  beforeEach(() => {
    cleanup();
  });

  function renderHeader() {
    const onAvatarClick = vi.fn();
    const { container } = render(
      <MobileHeader
        session={session}
        searchQuery=""
        onSearchChange={vi.fn()}
        onAvatarClick={onAvatarClick}
      />,
    );
    const avatar = container.querySelector('.mobile-header-avatar') as HTMLElement;
    expect(avatar).not.toBeNull();
    return { avatar, onAvatarClick };
  }

  it('头像具备 role=button / tabIndex=0 / aria-label=打开我的资料', () => {
    const { avatar } = renderHeader();
    expect(avatar).toHaveAttribute('role', 'button');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(avatar).toHaveAttribute('aria-label', '打开我的资料');
  });

  it('Enter → onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderHeader();
    fireEvent.keyDown(avatar, { key: 'Enter' });
    expect(onAvatarClick).toHaveBeenCalledTimes(1);
  });

  it('Space → onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderHeader();
    fireEvent.keyDown(avatar, { key: ' ' });
    expect(onAvatarClick).toHaveBeenCalledTimes(1);
  });

  it('无关键（如 a）不触发 onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderHeader();
    fireEvent.keyDown(avatar, { key: 'a' });
    expect(onAvatarClick).not.toHaveBeenCalled();
  });

  it('键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { avatar } = renderHeader();
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(avatar);
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});

describe('MobileDrawer — 本人头像 a11y', () => {
  beforeEach(() => {
    cleanup();
  });

  function renderDrawer() {
    const onProfileClick = vi.fn();
    const { container } = render(
      <MobileDrawer
        isOpen
        session={session}
        onClose={vi.fn()}
        onProfileClick={onProfileClick}
        onFilesClick={vi.fn()}
        onLanTransferClick={vi.fn()}
        onMiniAppsClick={vi.fn()}
        onMeetingClick={vi.fn()}
        onSettingsClick={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    const avatar = container.querySelector('.mobile-drawer-avatar') as HTMLElement;
    expect(avatar).not.toBeNull();
    return { avatar, onProfileClick };
  }

  it('头像具备 role=button / tabIndex=0 / aria-label=打开我的资料', () => {
    const { avatar } = renderDrawer();
    expect(avatar).toHaveAttribute('role', 'button');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(avatar).toHaveAttribute('aria-label', '打开我的资料');
  });

  it('Enter → onProfileClick', () => {
    const { avatar, onProfileClick } = renderDrawer();
    fireEvent.keyDown(avatar, { key: 'Enter' });
    expect(onProfileClick).toHaveBeenCalledTimes(1);
  });

  it('Space → onProfileClick', () => {
    const { avatar, onProfileClick } = renderDrawer();
    fireEvent.keyDown(avatar, { key: ' ' });
    expect(onProfileClick).toHaveBeenCalledTimes(1);
  });

  it('无关键（如 a）不触发 onProfileClick', () => {
    const { avatar, onProfileClick } = renderDrawer();
    fireEvent.keyDown(avatar, { key: 'a' });
    expect(onProfileClick).not.toHaveBeenCalled();
  });

  it('键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { avatar } = renderDrawer();
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(avatar);
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});
