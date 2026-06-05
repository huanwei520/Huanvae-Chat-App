/**
 * MiniAppsModal 测试
 *
 * MiniAppsModal 顶层依赖 SessionContext + useMiniApps + WebviewWindow 静态方法，
 * 整体渲染 mock 成本过高。可测的部分拆两类：
 *
 * 1. 纯函数（无 React/Tauri 依赖）：
 *    - buildMiniAppLaunchUrl: 打开小程序时拼 platform JWT 到 query
 *    - buildResourceProposal: 申请表单 CPU/内存输入 → 后端 proposed_cpu/proposed_mem
 * 2. AppCard 组件（不依赖 SessionContext/WebviewWindow，只吃 props）：
 *    - 「我的」列表对被驳回小程序展示驳回原因（reject_reason）的守卫
 *
 * 注：审批制改造后,创建走「提交申请」(submitMiniAppRequest),响应不含容器/凭据,
 * 原 buildCredentialsFields 已删除,其测试一并移除。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  buildMiniAppLaunchUrl,
  buildResourceProposal,
} from '../../src/components/miniapps/launch';
import { AppCard } from '../../src/components/miniapps/MiniAppsModal';
import type { MiniApp, MiniAppStatus } from '../../src/api/miniapps';

describe('buildMiniAppLaunchUrl', () => {
  const serverUrl = 'https://api.huanvae.cn';
  const token = 'eyJhbGciOi.payload.sig';

  it('appends ?token=... when access_url has no query', () => {
    const result = buildMiniAppLaunchUrl(serverUrl, '/apps/my-app/', token);
    expect(result).toBe(
      'https://api.huanvae.cn/apps/my-app/?token=eyJhbGciOi.payload.sig',
    );
  });

  it('appends &token=... when access_url already has query', () => {
    const result = buildMiniAppLaunchUrl(
      serverUrl,
      '/apps/my-app/?lang=zh',
      token,
    );
    expect(result).toBe(
      'https://api.huanvae.cn/apps/my-app/?lang=zh&token=eyJhbGciOi.payload.sig',
    );
  });

  it('URL encodes token characters that are not URL-safe', () => {
    const tokenWithSpecial = 'a+b/c=d';
    const result = buildMiniAppLaunchUrl(serverUrl, '/apps/x/', tokenWithSpecial);
    expect(result).toContain('token=a%2Bb%2Fc%3Dd');
  });

  it('preserves access_url path segments verbatim', () => {
    const result = buildMiniAppLaunchUrl(serverUrl, '/apps/nested/path/', token);
    expect(result.startsWith('https://api.huanvae.cn/apps/nested/path/')).toBe(
      true,
    );
  });

  it('handles empty access_url (degenerate input)', () => {
    const result = buildMiniAppLaunchUrl(serverUrl, '', token);
    expect(result).toBe('https://api.huanvae.cn?token=eyJhbGciOi.payload.sig');
  });
});

describe('buildResourceProposal', () => {
  it('omits both fields when inputs are empty (backend uses 2c2g default)', () => {
    expect(buildResourceProposal('', '')).toEqual({});
  });

  it('includes only proposed_cpu when memory is empty', () => {
    expect(buildResourceProposal('2', '')).toEqual({ proposed_cpu: '2' });
  });

  it('includes only proposed_mem (with g suffix) when cpu is empty', () => {
    expect(buildResourceProposal('', '4')).toEqual({ proposed_mem: '4g' });
  });

  it('includes both, appending g to memory only', () => {
    expect(buildResourceProposal('2', '2')).toEqual({
      proposed_cpu: '2',
      proposed_mem: '2g',
    });
  });

  it('trims whitespace from inputs', () => {
    expect(buildResourceProposal('  3 ', ' 4 ')).toEqual({
      proposed_cpu: '3',
      proposed_mem: '4g',
    });
  });

  it('preserves decimal values (backend parse_mem_mb uses f64)', () => {
    expect(buildResourceProposal('2.5', '2.5')).toEqual({
      proposed_cpu: '2.5',
      proposed_mem: '2.5g',
    });
  });

  it('omits non-positive values (0, negative) instead of sending garbage proposals', () => {
    expect(buildResourceProposal('0', '0')).toEqual({});
    expect(buildResourceProposal('-5', '-1')).toEqual({});
  });

  it('omits non-numeric input (empty .value from number inputs already trimmed)', () => {
    expect(buildResourceProposal('abc', 'xyz')).toEqual({});
  });
});

describe('AppCard — 驳回原因展示', () => {
  const baseApp: MiniApp = {
    miniapp_id: 'app-1',
    name: 'my-app',
    display_name: '我的小程序',
    description: '一个测试小程序',
    icon_url: '',
    access_url: '/apps/my-app/',
    status: 'rejected',
    developer_id: 'user-1',
    developer_nickname: '张三',
    created_at: '2026-01-27T08:00:00+00:00',
    updated_at: '2026-01-27T10:00:00+00:00',
    published_at: null,
    reject_reason: '资源申请超出配额，请调整后重新提交',
  };

  const noop = vi.fn();
  const cardProps = {
    index: 0,
    operating: false,
    onOpen: noop,
    onPublish: noop,
    onUnpublish: noop,
    onStart: noop,
    onStop: noop,
    onRestart: noop,
    onContainerInfo: noop,
    onDelete: noop,
  };

  const renderCard = (app: MiniApp, isMine: boolean) =>
    render(<AppCard app={app} isMine={isMine} {...cardProps} />);

  it('shows reject reason for own rejected miniapp', () => {
    renderCard(baseApp, true);
    expect(
      screen.getByText('驳回原因：资源申请超出配额，请调整后重新提交'),
    ).toBeInTheDocument();
  });

  it('hides reject reason in published square view (isMine=false)', () => {
    renderCard({ ...baseApp }, false);
    expect(screen.queryByText(/驳回原因/)).not.toBeInTheDocument();
  });

  it('hides reject reason for non-rejected status even when reason present', () => {
    renderCard({ ...baseApp, status: 'running' as MiniAppStatus }, true);
    expect(screen.queryByText(/驳回原因/)).not.toBeInTheDocument();
  });

  it('hides reject reason block when reject_reason is null', () => {
    renderCard({ ...baseApp, reject_reason: null }, true);
    expect(screen.queryByText(/驳回原因/)).not.toBeInTheDocument();
  });

  it('hides reject reason block when reject_reason is missing (published list shape)', () => {
    const { reject_reason: _omit, ...withoutReason } = baseApp;
    renderCard(withoutReason as MiniApp, true);
    expect(screen.queryByText(/驳回原因/)).not.toBeInTheDocument();
  });
});
