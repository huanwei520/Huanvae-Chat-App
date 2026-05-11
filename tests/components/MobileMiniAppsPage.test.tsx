/**
 * MobileMiniAppsPage 测试
 *
 * 覆盖：
 * 1. launchingApp=null 时渲染搜索框 + 卡片列表
 * 2. 点击卡片调用 onLaunch(app)
 * 3. 传入 launchingApp 时渲染 iframe，src 含 token=
 * 4. 点击 iframe 顶栏返回按钮调用 onLaunchEnd
 *
 * mock 策略：
 * - useSession：返回固定 session 提供 serverUrl + accessToken
 * - useMiniApps：用 vi.hoisted 提供 apps/loading/error/searchQuery/setSearchQuery
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { MiniApp } from '../../src/api/miniapps';

const TEST_APP: MiniApp = {
  miniapp_id: 'mid-test-1',
  name: 'demo-app',
  display_name: '演示小程序',
  description: '一个示例小程序',
  icon_url: '',
  access_url: '/apps/demo-app/',
  status: 'published',
  developer_id: 'dev-1',
  developer_nickname: '开发者甲',
  created_at: '2026-05-10T00:00:00Z',
  updated_at: '2026-05-10T00:00:00Z',
  published_at: '2026-05-10T00:00:00Z',
};

const mockSession = vi.hoisted(() => ({
  session: {
    serverUrl: 'https://api.test',
    userId: 'u1',
    accessToken: 'jwt-token-xyz',
    refreshToken: 'r',
    profile: null,
    avatarPath: null,
  },
  setSession: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => mockSession,
  useApi: () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }),
}));

const mockUseMiniAppsReturn = vi.hoisted(() => ({
  tab: 'explore' as const,
  setTab: vi.fn(),
  apps: [] as MiniApp[],
  loading: false,
  error: null as string | null,
  searchQuery: '',
  setSearchQuery: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  containerInfo: vi.fn(),
  resetPassword: vi.fn(),
  operatingId: null as string | null,
}));

vi.mock('../../src/hooks/useMiniApps', async () => {
  const actual = await vi.importActual<typeof import('../../src/hooks/useMiniApps')>(
    '../../src/hooks/useMiniApps',
  );
  return {
    ...actual,
    useMiniApps: () => mockUseMiniAppsReturn,
  };
});

import { MobileMiniAppsPage } from '../../src/pages/mobile/MobileMiniAppsPage';

describe('MobileMiniAppsPage', () => {
  beforeEach(() => {
    cleanup();
    mockUseMiniAppsReturn.apps = [TEST_APP];
    mockUseMiniAppsReturn.loading = false;
    mockUseMiniAppsReturn.error = null;
    mockUseMiniAppsReturn.searchQuery = '';
    mockUseMiniAppsReturn.setSearchQuery.mockReset();
  });

  it('renders search box and card when launchingApp is null', () => {
    render(
      <MobileMiniAppsPage
        launchingApp={null}
        onLaunch={vi.fn()}
        onLaunchEnd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('搜索小程序...')).toBeInTheDocument();
    expect(screen.getByText('演示小程序')).toBeInTheDocument();
    expect(screen.getByText('一个示例小程序')).toBeInTheDocument();
    expect(screen.queryByTitle('演示小程序')).toBeInTheDocument();
    // iframe 不应渲染
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('clicking card invokes onLaunch with the app object', () => {
    const onLaunch = vi.fn();
    render(
      <MobileMiniAppsPage
        launchingApp={null}
        onLaunch={onLaunch}
        onLaunchEnd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const card = screen.getByText('演示小程序').closest('.mobile-miniapp-card');
    expect(card).not.toBeNull();
    fireEvent.click(card!);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenLastCalledWith(TEST_APP);
  });

  it('renders iframe with token in src when launchingApp is provided', () => {
    render(
      <MobileMiniAppsPage
        launchingApp={TEST_APP}
        onLaunch={vi.fn()}
        onLaunchEnd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const iframe = document.querySelector('iframe.mobile-miniapp-iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe('https://api.test/apps/demo-app/?token=jwt-token-xyz');
    // iframe 顶栏标题
    const titles = screen.getAllByText('演示小程序');
    expect(titles.length).toBeGreaterThan(0);
  });

  it('iframe back button invokes onLaunchEnd, not onClose', () => {
    const onLaunchEnd = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileMiniAppsPage
        launchingApp={TEST_APP}
        onLaunch={vi.fn()}
        onLaunchEnd={onLaunchEnd}
        onClose={onClose}
      />,
    );

    const iframeBackBtn = document.querySelector('.mobile-miniapp-iframe-back') as HTMLElement | null;
    expect(iframeBackBtn).not.toBeNull();
    fireEvent.click(iframeBackBtn!);

    expect(onLaunchEnd).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('list-mode header back button invokes onClose, not onLaunchEnd', () => {
    const onLaunchEnd = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileMiniAppsPage
        launchingApp={null}
        onLaunch={vi.fn()}
        onLaunchEnd={onLaunchEnd}
        onClose={onClose}
      />,
    );

    const headerBack = document.querySelector('.mobile-miniapps-back') as HTMLElement | null;
    expect(headerBack).not.toBeNull();
    fireEvent.click(headerBack!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLaunchEnd).not.toHaveBeenCalled();
  });
});
