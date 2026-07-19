/**
 * OAuthClientsPanel 组件测试
 *
 * mock useOAuthClients（hook 本体已由 tests/hooks/useOAuthClients.test.tsx 覆盖），
 * 面板为被测对象。mock 值为 vi.hoisted 稳定单例（对齐真实 hook 返回的引用语义），
 * 每个用例仅原地改字段。
 *
 * 覆盖：加载态 / 错误态+重试 / 空态 / 客户端卡片渲染（外部有操作、内部无操作、
 * 停用徽章）/ 删除二次确认（含取消）/ 创建对话框（禁用门控 + 精确 payload）/
 * 创建成功后 SecretDisplay / 重置密钥后 SecretDisplay。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import type { OAuthClient } from '../../src/api/oauth';

const hookState = vi.hoisted(() => ({
  value: {
    clients: [] as unknown[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    resetSecret: vi.fn(),
    operatingId: null as string | null,
  },
}));

vi.mock('../../src/hooks/useOAuthClients', () => ({
  useOAuthClients: () => hookState.value,
}));

import { OAuthClientsPanel } from '../../src/components/oauth/OAuthClientsPanel';

const client = (over: Partial<OAuthClient>): OAuthClient => ({
  client_id: 'c1',
  client_type: 'external',
  app_name: 'Ext App',
  app_description: '',
  app_homepage_url: null,
  app_logo_url: null,
  redirect_uris: ['https://app.example/cb'],
  allowed_scopes: ['profile'],
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
  ...over,
});

/** 按应用名定位所属卡片根节点 */
function cardOf(appName: string): HTMLElement {
  const card = screen.getByText(appName).closest('.oauth-client-card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('OAuthClientsPanel', () => {
  beforeEach(() => {
    cleanup();
    hookState.value.clients = [];
    hookState.value.loading = false;
    hookState.value.error = null;
    hookState.value.operatingId = null;
    hookState.value.refresh.mockReset();
    hookState.value.create.mockReset();
    hookState.value.remove.mockReset();
    hookState.value.remove.mockResolvedValue(true);
    hookState.value.resetSecret.mockReset();
  });

  it('加载态：显示"加载中..."', () => {
    hookState.value.loading = true;
    render(<OAuthClientsPanel onBack={vi.fn()} />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('暂无 OAuth 客户端')).not.toBeInTheDocument();
  });

  it('错误态：显示错误文案，点击"重试"调用 refresh', () => {
    hookState.value.error = '加载 OAuth 客户端失败';
    render(<OAuthClientsPanel onBack={vi.fn()} />);
    expect(screen.getByText('加载 OAuth 客户端失败')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(hookState.value.refresh).toHaveBeenCalledTimes(1);
  });

  it('空态：显示"暂无 OAuth 客户端"', () => {
    render(<OAuthClientsPanel onBack={vi.fn()} />);
    expect(screen.getByText('暂无 OAuth 客户端')).toBeInTheDocument();
  });

  it('卡片渲染：外部有操作按钮、内部显示"内部"徽章且无操作、停用显示"已停用"', () => {
    hookState.value.clients = [
      client({ client_id: 'c1', app_name: 'Ext App', client_type: 'external' }),
      client({ client_id: 'c2', app_name: 'Int App', client_type: 'internal' }),
      client({ client_id: 'c3', app_name: 'Dead App', client_type: 'external', is_active: false }),
    ];
    render(<OAuthClientsPanel onBack={vi.fn()} />);

    // 外部卡片：有重置密钥 + 删除
    const ext = cardOf('Ext App');
    expect(within(ext).getByText('外部')).toBeInTheDocument();
    expect(within(ext).getByText('重置密钥')).toBeInTheDocument();
    expect(within(ext).getByText('删除')).toBeInTheDocument();
    expect(within(ext).queryByText('已停用')).not.toBeInTheDocument();

    // 内部卡片："内部"徽章、无任何操作按钮（负向断言）
    const int = cardOf('Int App');
    expect(within(int).getByText('内部')).toBeInTheDocument();
    expect(within(int).queryByText('重置密钥')).not.toBeInTheDocument();
    expect(within(int).queryByText('删除')).not.toBeInTheDocument();

    // 停用卡片：显示"已停用"
    expect(within(cardOf('Dead App')).getByText('已停用')).toBeInTheDocument();
  });

  it('删除二次确认：取消不调 remove；确认后 remove(client_id)', () => {
    hookState.value.clients = [client({ client_id: 'c1', app_name: 'Ext App' })];
    render(<OAuthClientsPanel onBack={vi.fn()} />);

    // 第一步：点删除只展开确认，不触发 remove
    fireEvent.click(screen.getByText('删除'));
    expect(screen.getByText('确认删除')).toBeInTheDocument();
    expect(hookState.value.remove).not.toHaveBeenCalled();

    // 取消：确认收起，remove 未被调
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('确认删除')).not.toBeInTheDocument();
    expect(hookState.value.remove).not.toHaveBeenCalled();

    // 再次删除 → 确认 → remove(client_id)
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('确认删除'));
    expect(hookState.value.remove).toHaveBeenCalledTimes(1);
    expect(hookState.value.remove).toHaveBeenCalledWith('c1');
  });

  it('创建对话框：填齐 app_name + 回调 URI 前禁用；提交精确 payload（空描述不带 app_description）', async () => {
    hookState.value.create.mockResolvedValue(null);
    render(<OAuthClientsPanel onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('+ 创建'));
    expect(screen.getByText('创建 OAuth 客户端')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: '创建' });
    expect(submitBtn).toBeDisabled(); // 全空 → 禁用

    fireEvent.change(screen.getByPlaceholderText('My App'), { target: { value: 'Test App' } });
    expect(submitBtn).toBeDisabled(); // 只有名称、无回调 URI → 仍禁用

    fireEvent.change(screen.getByPlaceholderText('https://example.com/callback'), {
      target: { value: 'https://cb.example/x' },
    });
    expect(submitBtn).toBeEnabled(); // 名称 + URI 均有 → 可提交

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(hookState.value.create).toHaveBeenCalledTimes(1);
    });
    // 精确 payload：默认 scope=['profile']；描述/首页留空时不带对应 key
    expect(hookState.value.create).toHaveBeenCalledWith({
      app_name: 'Test App',
      redirect_uris: ['https://cb.example/x'],
      scopes: ['profile'],
    });
    expect(hookState.value.create.mock.calls[0]?.[0]).not.toHaveProperty('app_description');
    expect(hookState.value.create.mock.calls[0]?.[0]).not.toHaveProperty('app_homepage_url');
  });

  it('创建成功：关闭表单并以 SecretDisplay 展示 client_secret', async () => {
    hookState.value.create.mockResolvedValue({
      client_id: 'cid-1',
      client_secret: 'sec-xyz',
      app_name: 'Test App',
    });
    render(<OAuthClientsPanel onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('+ 创建'));
    fireEvent.change(screen.getByPlaceholderText('My App'), { target: { value: 'Test App' } });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/callback'), {
      target: { value: 'https://cb.example/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(screen.getByText('Test App - 客户端凭据')).toBeInTheDocument();
      // 表单已关闭（AnimatePresence 退场卸载异步，须在 waitFor 内断言）
      expect(screen.queryByText('创建 OAuth 客户端')).not.toBeInTheDocument();
    });
    expect(screen.getByText('sec-xyz')).toBeInTheDocument();
    expect(screen.getByText('cid-1')).toBeInTheDocument();
  });

  it('重置密钥：resetSecret(client_id) 成功后以 SecretDisplay 展示新密钥', async () => {
    hookState.value.clients = [client({ client_id: 'c1', app_name: 'Ext App' })];
    hookState.value.resetSecret.mockResolvedValue('new-secret');
    render(<OAuthClientsPanel onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('重置密钥'));
    await waitFor(() => {
      expect(screen.getByText('new-secret')).toBeInTheDocument();
    });
    expect(hookState.value.resetSecret).toHaveBeenCalledTimes(1);
    expect(hookState.value.resetSecret).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Ext App - 客户端凭据')).toBeInTheDocument();
  });
});
