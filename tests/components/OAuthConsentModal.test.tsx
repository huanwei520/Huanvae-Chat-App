/**
 * OAuthConsentModal 组件测试
 *
 * 只 mock SessionContext 的 useApi（vi.hoisted 稳定引用）——真实 authorize/isConsentRequired
 * 跑在假 api.post 上；resolveDisplayUrl passthrough（显示收口由
 * tests/secure-display-routing.test.ts 静态守）。
 *
 * 组件经 createPortal 挂到 document.body，RTL 的 screen 默认覆盖 body。
 *
 * 覆盖：挂载首次 authorize（精确 payload、无 consent 键）+ consent UI（scope 文案 /
 * 未知 scope 回退）/ 内部客户端自动放行 / 点击"允许"二次 authorize(consent:true) /
 * 挂载失败 + 关闭 / "拒绝"取消。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// 稳定的 api 引用（组件仅用 api.post 发 authorize）
const apiState = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiState.api,
}));

vi.mock('../../src/services/secureProxy', () => ({
  resolveDisplayUrl: (u: string | null | undefined) => u ?? null,
}));

import { OAuthConsentModal } from '../../src/components/oauth/OAuthConsentModal';

const baseProps = {
  clientId: 'c1',
  redirectUri: 'https://app.example/cb',
  scope: 'profile unknown_scope',
  state: 's1',
  codeChallenge: 'ch',
  codeChallengeMethod: 'S256',
};

/** 挂载首次 authorize 的预期 payload（makeRequest 无 consent 分支） */
const expectedMountPayload = {
  client_id: 'c1',
  redirect_uri: 'https://app.example/cb',
  scope: 'profile unknown_scope',
  state: 's1',
  code_challenge: 'ch',
  code_challenge_method: 'S256',
};

const consentResp = {
  consent_required: true,
  app_name: 'Demo App',
  app_logo_url: null,
  scopes: ['profile', 'unknown_scope'],
};

describe('OAuthConsentModal', () => {
  beforeEach(() => {
    cleanup();
    apiState.api.post.mockReset();
  });

  it('挂载：authorize 一次（精确 payload、无 consent 键）→ consent UI 渲染 scope 文案（未知 scope 回退原名）', async () => {
    apiState.api.post.mockResolvedValueOnce(consentResp);
    render(<OAuthConsentModal {...baseProps} onComplete={vi.fn()} onCancel={vi.fn()} />);

    // 未落定前先显示加载态
    expect(screen.getByText('正在加载应用信息...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument();
    });
    expect(apiState.api.post).toHaveBeenCalledTimes(1);
    expect(apiState.api.post).toHaveBeenCalledWith('/api/oauth/authorize', expectedMountPayload);
    expect(apiState.api.post.mock.calls[0]?.[1]).not.toHaveProperty('consent'); // 首次请求不带 consent

    // scope 文案：已知 scope 翻译 + desc，未知 scope 回退原名
    expect(screen.getByText('个人资料')).toBeInTheDocument();
    expect(screen.getByText('昵称和头像')).toBeInTheDocument();
    expect(screen.getByText('unknown_scope')).toBeInTheDocument();
  });

  it('自动放行：首次 authorize 直接返回 code → onComplete(code, state)，不渲染 consent UI', async () => {
    apiState.api.post.mockResolvedValueOnce({ code: 'c-auto', state: 's1', redirect_uri: 'https://app.example/cb' });
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<OAuthConsentModal {...baseProps} onComplete={onComplete} onCancel={onCancel} />);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('c-auto', 's1');
    });
    expect(screen.queryByText('允许')).not.toBeInTheDocument(); // 无 consent UI
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点击"允许"：二次 authorize 带 consent:true → onComplete(code, state)', async () => {
    apiState.api.post.mockResolvedValueOnce(consentResp);
    const onComplete = vi.fn();
    render(<OAuthConsentModal {...baseProps} onComplete={onComplete} onCancel={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('允许')).toBeInTheDocument();
    });

    apiState.api.post.mockResolvedValueOnce({ code: 'c-2', state: 's1', redirect_uri: 'https://app.example/cb' });
    fireEvent.click(screen.getByText('允许'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('c-2', 's1');
    });
    expect(apiState.api.post).toHaveBeenCalledTimes(2);
    expect(apiState.api.post).toHaveBeenNthCalledWith(2, '/api/oauth/authorize', {
      ...expectedMountPayload,
      consent: true,
    });
  });

  it('挂载失败：显示错误消息，"关闭"按钮接 onCancel', async () => {
    apiState.api.post.mockRejectedValueOnce(new Error('authz-fail'));
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    render(<OAuthConsentModal {...baseProps} onComplete={onComplete} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('authz-fail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('关闭'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('点击"拒绝"：调用 onCancel，不触发二次 authorize', async () => {
    apiState.api.post.mockResolvedValueOnce(consentResp);
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    render(<OAuthConsentModal {...baseProps} onComplete={onComplete} onCancel={onCancel} />);
    await waitFor(() => {
      expect(screen.getByText('拒绝')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('拒绝'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(apiState.api.post).toHaveBeenCalledTimes(1); // 仅挂载那次
    expect(onComplete).not.toHaveBeenCalled();
  });
});
