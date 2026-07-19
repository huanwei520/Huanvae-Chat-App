/**
 * Sidebar 桌面侧栏本人头像 a11y 测试（可点击头像容器 a11y 修复，第 11 处）
 *
 * 锁定契约（src/components/sidebar/Sidebar.tsx `.avatar-wrapper`，motion.div）：
 * - 恒有 role=button / tabIndex=0 / aria-label="打开我的资料"
 * - onKeyDown(Enter/Space) → onAvatarClick；无关键不触发
 * - useKbdFocusRing 焦点环：键盘 focus → a11y-kbd-focus；pointerDown+focus → 不含
 *
 * motion.div 在 setup.ts 已 MotionGlobalConfig.skipAnimations=true，正常 render 即可。
 * useWebSocket 未被 setup.ts 全局 mock → 文件内 mock；UserAvatar mock 成 stub
 * （避开头像 URL 解析链，与 MessageBubbleAvatarClick 测试同法）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { SessionInfo } from '../../src/components/common/Avatar';

vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ connected: true, connecting: false }),
}));
vi.mock('../../src/components/common/Avatar', () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
  FriendAvatar: () => <div data-testid="friend-avatar" />,
}));

import { Sidebar } from '../../src/components/sidebar/Sidebar';

const session: SessionInfo = {
  profile: { user_nickname: 'Me', user_avatar_url: null },
  avatarPath: null,
};

function renderSidebar() {
  const onAvatarClick = vi.fn();
  const { container } = render(
    <Sidebar
      session={session}
      activeTab="chat"
      onTabChange={vi.fn()}
      onAvatarClick={onAvatarClick}
      onFilesClick={vi.fn()}
      onLanTransferClick={vi.fn()}
      onMeetingClick={vi.fn()}
      onMiniAppsClick={vi.fn()}
      onBotsClick={vi.fn()}
      onLowcodeClick={vi.fn()}
      onHuanvaeGuardClick={vi.fn()}
      onStocksClick={vi.fn()}
      onSettingsClick={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  const avatar = container.querySelector('.avatar-wrapper') as HTMLElement;
  expect(avatar).not.toBeNull();
  return { avatar, onAvatarClick };
}

describe('Sidebar — 桌面侧栏本人头像 a11y', () => {
  beforeEach(() => {
    cleanup();
  });

  it('头像具备 role=button / tabIndex=0 / aria-label=打开我的资料', () => {
    const { avatar } = renderSidebar();
    expect(avatar).toHaveAttribute('role', 'button');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(avatar).toHaveAttribute('aria-label', '打开我的资料');
  });

  it('Enter → onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderSidebar();
    fireEvent.keyDown(avatar, { key: 'Enter' });
    expect(onAvatarClick).toHaveBeenCalledTimes(1);
  });

  it('Space → onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderSidebar();
    fireEvent.keyDown(avatar, { key: ' ' });
    expect(onAvatarClick).toHaveBeenCalledTimes(1);
  });

  it('无关键（如 a）不触发 onAvatarClick', () => {
    const { avatar, onAvatarClick } = renderSidebar();
    fireEvent.keyDown(avatar, { key: 'a' });
    expect(onAvatarClick).not.toHaveBeenCalled();
  });

  it('键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { avatar } = renderSidebar();
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(avatar);
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});
