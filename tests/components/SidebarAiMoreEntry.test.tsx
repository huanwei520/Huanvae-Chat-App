/**
 * Sidebar「更多功能」浮层 → AI 助手入口点击链路测试（块 1792465686977-647uggj7-1 testharness 层）
 *
 * 锁定契约：聊天列表固定 AI 卡移除后，桌面端唯一 AI 入口 = 侧边栏「更多功能」浮层里的
 * 'ai' 工具项（sidebarLayout SIDEBAR_ITEM_KEYS 首位），点击必须且只能触发
 * onAiAssistantClick（其余工具回调零调用）——补上 SidebarPinned.test.tsx 只测钉住区、
 * SidebarMorePanel.test.tsx 只测受控 mock 之间的组装层缺口（真实 Sidebar 组装 moreItems）。
 *
 * 非恒真论证：若 Sidebar 的 moreItems.ai 误绑到其他回调（或漏挂），onAiAssistantClick
 * 调用次数断言 FAIL；若浮层打不开（更多按钮失效），getByText('AI 助手') 抛错 FAIL。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../src/components/sidebar/Sidebar';
import type { SessionInfo } from '../../src/components/common/Avatar';

vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: vi.fn(() => ({ connected: true, connecting: false })),
}));

vi.mock('../../src/components/common/Avatar', () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
}));

const mockedGetItem = vi.mocked(window.localStorage.getItem);

beforeEach(() => {
  mockedGetItem.mockReset();
  mockedGetItem.mockReturnValue(null);
});

const session: SessionInfo = {
  profile: { user_nickname: '测试用户', user_avatar_url: null },
  avatarPath: null,
};

describe('Sidebar 更多浮层 AI 助手入口（组装层）', () => {
  it('点「更多功能」打开浮层 → 点「AI 助手」→ onAiAssistantClick 恰一次，其余工具回调零调用', () => {
    const fns = {
      onTabChange: vi.fn(),
      onAvatarClick: vi.fn(),
      onAiAssistantClick: vi.fn(),
      onFilesClick: vi.fn(),
      onLanTransferClick: vi.fn(),
      onMeetingClick: vi.fn(),
      onMiniAppsClick: vi.fn(),
      onBotsClick: vi.fn(),
      onHuanvaeGuardClick: vi.fn(),
      onSettingsClick: vi.fn(),
      onLogout: vi.fn(),
    };
    render(<Sidebar session={session} activeTab="chat" {...fns} />);

    // 默认布局：'ai' 未钉住 → 收纳在更多浮层（不在钉住区）
    expect(screen.queryByTitle('AI 助手')).toBeNull();

    fireEvent.click(screen.getByTitle('更多功能'));
    fireEvent.click(screen.getByText('AI 助手'));

    expect(fns.onAiAssistantClick).toHaveBeenCalledTimes(1);
    expect(fns.onFilesClick).toHaveBeenCalledTimes(0);
    expect(fns.onLanTransferClick).toHaveBeenCalledTimes(0);
    expect(fns.onMeetingClick).toHaveBeenCalledTimes(0);
    expect(fns.onMiniAppsClick).toHaveBeenCalledTimes(0);
    expect(fns.onBotsClick).toHaveBeenCalledTimes(0);
    expect(fns.onHuanvaeGuardClick).toHaveBeenCalledTimes(0);
  });
});
