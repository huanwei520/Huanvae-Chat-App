/**
 * AuthorizedAppsPanel 组件测试
 *
 * mock useOAuthGrants（hook 本体已由 tests/hooks/useOAuthGrants.test.tsx 覆盖），
 * 面板为被测对象。mock 值为 vi.hoisted 稳定单例，每个用例仅原地改字段。
 * resolveDisplayUrl passthrough（显示收口由 tests/secure-display-routing.test.ts 静态守）。
 *
 * 覆盖：加载态 / 错误态+重试 / 空态 / 授权卡片渲染（scope 翻译、logo 兜底首字母
 * vs img）/ 撤销二次确认（含取消不撤销）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { OAuthGrant } from '../../src/api/oauth';

const hookState = vi.hoisted(() => ({
  value: {
    grants: [] as unknown[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    revoke: vi.fn(),
    revoking: null as string | null,
  },
}));

vi.mock('../../src/hooks/useOAuthGrants', () => ({
  useOAuthGrants: () => hookState.value,
}));

vi.mock('../../src/services/secureProxy', () => ({
  resolveDisplayUrl: (u: string | null | undefined) => u ?? null,
}));

import { AuthorizedAppsPanel } from '../../src/components/settings/AuthorizedAppsPanel';

const grant = (over: Partial<OAuthGrant>): OAuthGrant => ({
  id: 'g1',
  client_id: 'client-g1',
  app_name: 'myapp',
  app_logo_url: null,
  scope: 'profile',
  created_at: '2026-07-01T00:00:00Z',
  ...over,
});

/** 按应用名定位所属授权卡片根节点 */
function cardOf(appName: string): HTMLElement {
  const card = screen.getByText(appName).closest('.oauth-app-card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('AuthorizedAppsPanel', () => {
  beforeEach(() => {
    cleanup();
    hookState.value.grants = [];
    hookState.value.loading = false;
    hookState.value.error = null;
    hookState.value.revoking = null;
    hookState.value.refresh.mockReset();
    hookState.value.revoke.mockReset();
    hookState.value.revoke.mockResolvedValue(true);
  });

  it('加载态：显示"加载中..."', () => {
    hookState.value.loading = true;
    render(<AuthorizedAppsPanel onBack={vi.fn()} />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('暂无已授权的应用')).not.toBeInTheDocument();
  });

  it('错误态：显示错误文案，点击"重试"调用 refresh', () => {
    hookState.value.error = '加载已授权应用失败';
    render(<AuthorizedAppsPanel onBack={vi.fn()} />);
    expect(screen.getByText('加载已授权应用失败')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(hookState.value.refresh).toHaveBeenCalledTimes(1);
  });

  it('空态：显示"暂无已授权的应用"', () => {
    render(<AuthorizedAppsPanel onBack={vi.fn()} />);
    expect(screen.getByText('暂无已授权的应用')).toBeInTheDocument();
  });

  it('授权卡片：app_name + scope 翻译；无 logo 兜底首字母、有 logo 渲染 img', () => {
    hookState.value.grants = [
      grant({ id: 'g1', app_name: 'myapp', app_logo_url: null, scope: 'profile email' }),
      grant({ id: 'g2', app_name: 'Beta', app_logo_url: 'https://backend.example/logo.png', scope: 'unknown_scope' }),
    ];
    render(<AuthorizedAppsPanel onBack={vi.fn()} />);

    // scope 翻译：'profile email' → '个人资料、邮箱地址'；未知 scope 回退原名
    const my = cardOf('myapp');
    expect(within(my).getByText('个人资料、邮箱地址')).toBeInTheDocument();
    expect(within(cardOf('Beta')).getByText('unknown_scope')).toBeInTheDocument();

    // logo：myapp 无 logo → 首字母 'M' 兜底、无 img（负向）
    expect(within(my).getByText('M')).toBeInTheDocument();
    expect(within(my).queryByRole('img')).not.toBeInTheDocument();
    // Beta 有 logo → img（passthrough 后 src=原 URL）
    expect(screen.getByAltText('Beta')).toHaveAttribute('src', 'https://backend.example/logo.png');
  });

  it('撤销二次确认：取消收起且不调 revoke；确认后 revoke(grant.id)', () => {
    hookState.value.grants = [grant({ id: 'g1', app_name: 'myapp' })];
    render(<AuthorizedAppsPanel onBack={vi.fn()} />);

    // 第一步：点撤销只展开确认，不触发 revoke
    fireEvent.click(screen.getByText('撤销'));
    expect(screen.getByText('确认')).toBeInTheDocument();
    expect(hookState.value.revoke).not.toHaveBeenCalled();

    // 取消：确认收起、撤销按钮回归，revoke 未被调
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('确认')).not.toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(hookState.value.revoke).not.toHaveBeenCalled();

    // 再次撤销 → 确认 → revoke(grant.id)
    fireEvent.click(screen.getByText('撤销'));
    fireEvent.click(screen.getByText('确认'));
    expect(hookState.value.revoke).toHaveBeenCalledTimes(1);
    expect(hookState.value.revoke).toHaveBeenCalledWith('g1');
  });
});
