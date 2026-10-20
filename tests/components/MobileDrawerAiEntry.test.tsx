/**
 * MobileDrawer AI 助手入口测试（块 1792465686977-647uggj7-1 testharness 层）
 *
 * 锁定契约：移动端聊天列表固定 AI 置顶卡移除后，抽屉工具面新增「AI 助手」菜单项
 * （MobileDrawer.tsx 菜单列表首位），点击必须触发 onAiAssistantClick 并关闭抽屉
 * （onClose）；其余菜单回调零调用。移动端此前无任何 MobileDrawer 测试，本文件从零建立
 * 最小组件回归，防止后续菜单项增删时误伤 AI 入口。
 *
 * 非恒真论证：若 AI 菜单项漏挂回调/绑错回调，onAiAssistantClick 次数断言 FAIL；
 * 若点击后不关抽屉（onClose 漏调），onClose 次数断言 FAIL。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Session } from '../../src/types/session';

vi.mock('../../src/hooks/useKbdFocusRing', () => ({
  useKbdFocusRing: () => ({
    isKbdFocused: () => false,
    handlersFor: () => ({ onPointerDown: () => {}, onFocus: () => {}, onBlur: () => {} }),
  }),
}));

import { MobileDrawer } from '../../src/pages/mobile/MobileDrawer';

const session = {
  serverUrl: 'https://api.huanvae.cn',
  userId: 'u-test',
  accessToken: 'at',
  refreshToken: 'rt',
  profile: { user_nickname: '测试用户', user_avatar_url: null },
  avatarPath: null,
} as unknown as Session;

function renderDrawer() {
  const fns = {
    onClose: vi.fn(),
    onProfileClick: vi.fn(),
    onAiAssistantClick: vi.fn(),
    onFilesClick: vi.fn(),
    onLanTransferClick: vi.fn(),
    onMiniAppsClick: vi.fn(),
    onBotsClick: vi.fn(),
    onHuanvaeGuardClick: vi.fn(),
    onMeetingClick: vi.fn(),
    onSettingsClick: vi.fn(),
    onLogout: vi.fn(),
  };
  render(<MobileDrawer isOpen={true} session={session} {...fns} />);
  return fns;
}

describe('MobileDrawer AI 助手入口', () => {
  it('菜单含「AI 助手」项，点击 → onAiAssistantClick + onClose 各恰一次', () => {
    const fns = renderDrawer();

    expect(screen.getByText('AI 助手')).toBeInTheDocument();
    fireEvent.click(screen.getByText('AI 助手'));

    expect(fns.onAiAssistantClick).toHaveBeenCalledTimes(1);
    expect(fns.onClose).toHaveBeenCalledTimes(1);
  });

  it('点「AI 助手」不误触其他菜单回调', () => {
    const fns = renderDrawer();

    fireEvent.click(screen.getByText('AI 助手'));

    expect(fns.onFilesClick).toHaveBeenCalledTimes(0);
    expect(fns.onLanTransferClick).toHaveBeenCalledTimes(0);
    expect(fns.onMiniAppsClick).toHaveBeenCalledTimes(0);
    expect(fns.onBotsClick).toHaveBeenCalledTimes(0);
    expect(fns.onHuanvaeGuardClick).toHaveBeenCalledTimes(0);
    expect(fns.onMeetingClick).toHaveBeenCalledTimes(0);
    expect(fns.onSettingsClick).toHaveBeenCalledTimes(0);
    expect(fns.onLogout).toHaveBeenCalledTimes(0);
    expect(fns.onProfileClick).toHaveBeenCalledTimes(0);
  });
});
