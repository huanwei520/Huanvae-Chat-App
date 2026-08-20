/**
 * Sidebar 钉住区（双区拖放布局）渲染测试
 *
 * 覆盖：
 * 1. 默认布局（无 localStorage 保存）：钉住区不渲染（.sidebar-pin-zone 不存在），
 *    核心固定区（消息/好友/群聊）与「更多功能」按钮存在
 * 2. localStorage 预置双区布局 → 按 pinned 顺序渲染 .sidebar-pinned-btn
 * 3. 点击钉住按钮 → 对应工具 onClick 恰被调用一次，其余工具回调零调用
 * 4. 预置含非法 key 的布局 → normalizeLayout 清洗链路生效（非法 key 不渲染）
 *
 * 分层决策：dnd-kit 拖拽手势（PointerSensor 需要真实 pointer 事件序列）jsdom
 * 无法模拟，不写假拖拽测试；拖放编排/持久化由 tests/unit/sidebarLayout.test.ts
 * 纯函数矩阵 + 真机自测覆盖。本文件只测「loadLayout → 钉住区渲染 → 点击回调」链路。
 *
 * mock 说明：
 * - useWebSocket 无 Provider 会 throw，mock 成返回连接态（Sidebar 只消费
 *   connected/connecting 两字段）
 * - UserAvatar 依赖 convertFileSrc（setup.ts 未 mock 该 named export），mock 为占位
 * - tests/setup.ts 把 window.localStorage 整体替换成 vi.fn() stub（getItem 默认
 *   返回 undefined），用 vi.mocked(getItem).mockReturnValue 预置布局 JSON
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

function renderSidebar() {
  const fns = {
    onTabChange: vi.fn(),
    onAvatarClick: vi.fn(),
    onFilesClick: vi.fn(),
    onLanTransferClick: vi.fn(),
    onMeetingClick: vi.fn(),
    onMiniAppsClick: vi.fn(),
    onBotsClick: vi.fn(),
    onHuanvaeGuardClick: vi.fn(),
    onStocksClick: vi.fn(),
    onSettingsClick: vi.fn(),
    onLogout: vi.fn(),
  };
  const utils = render(<Sidebar session={session} activeTab="chat" {...fns} />);
  return { fns, ...utils };
}

/** 读取钉住区按钮的 title 顺序 */
function pinnedTitles(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.sidebar-pinned-btn')).map((el) =>
    el.getAttribute('title'),
  );
}

describe('Sidebar 钉住区', () => {
  it('默认布局（无保存）：不渲染钉住区，固定区与「更多功能」按钮存在', () => {
    const { container } = renderSidebar();

    expect(container.querySelector('.sidebar-pin-zone')).toBeNull();
    expect(container.querySelectorAll('.sidebar-pinned-btn')).toHaveLength(0);

    expect(screen.getByTitle('消息')).toBeInTheDocument();
    expect(screen.getByTitle('好友')).toBeInTheDocument();
    expect(screen.getByTitle('群聊')).toBeInTheDocument();
    expect(screen.getByTitle('更多功能')).toBeInTheDocument();
  });

  it('localStorage 预置 pinned:["files","guard"] 时按序渲染 2 个钉住按钮', () => {
    mockedGetItem.mockReturnValue(
      '{"pinned":["files","guard"],"more":["lan","meeting","miniapps","stocks"]}',
    );
    const { container } = renderSidebar();

    expect(container.querySelector('.sidebar-pin-zone')).not.toBeNull();
    expect(pinnedTitles(container)).toEqual(['我的文件', 'VPN 组网']);
  });

  it('点击 title=我的文件 的钉住按钮 → onFilesClick 恰一次，其余 6 个工具回调零调用', () => {
    mockedGetItem.mockReturnValue(
      '{"pinned":["files","guard"],"more":["lan","meeting","miniapps","stocks"]}',
    );
    const { fns } = renderSidebar();

    fireEvent.click(screen.getByTitle('我的文件'));

    expect(fns.onFilesClick).toHaveBeenCalledTimes(1);
    expect(fns.onLanTransferClick).toHaveBeenCalledTimes(0);
    expect(fns.onMeetingClick).toHaveBeenCalledTimes(0);
    expect(fns.onMiniAppsClick).toHaveBeenCalledTimes(0);
    expect(fns.onBotsClick).toHaveBeenCalledTimes(0);
    expect(fns.onHuanvaeGuardClick).toHaveBeenCalledTimes(0);
    expect(fns.onStocksClick).toHaveBeenCalledTimes(0);
  });

  it('预置含非法 key 的 pinned（["files","bogus"]）→ 清洗后只渲染 1 个钉住按钮', () => {
    mockedGetItem.mockReturnValue(
      '{"pinned":["files","bogus"],"more":["lan","meeting","miniapps","guard","stocks"]}',
    );
    const { container } = renderSidebar();

    const titles = pinnedTitles(container);
    expect(titles).toEqual(['我的文件']);
  });
});
