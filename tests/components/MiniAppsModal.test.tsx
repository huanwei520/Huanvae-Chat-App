/**
 * MiniAppsModal 可测的纯函数测试
 *
 * MiniAppsModal 组件依赖 SessionContext + useMiniApps + WebviewWindow 静态方法，
 * 整体渲染 mock 成本过高。关键新逻辑（URL 拼接、凭据字段构建）已抽成 pure function：
 * - buildMiniAppLaunchUrl: 打开小程序时拼 platform JWT 到 query
 * - buildCredentialsFields: 创建小程序响应 → SecretDisplay 用的 fields 数组
 *
 * 测试范围：
 * 1. URL 拼接（access_url 有/无 query、token URL encode）
 * 2. 凭据字段构建（OAuth 字段有/无、SSH 字段始终在）
 */

import { describe, it, expect } from 'vitest';
import {
  buildMiniAppLaunchUrl,
  buildCredentialsFields,
} from '../../src/components/miniapps/launch';
import type { CreateMiniAppResponse } from '../../src/api/miniapps';

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

describe('buildCredentialsFields', () => {
  const baseResponse: CreateMiniAppResponse = {
    miniapp_id: 'mid-1',
    name: 'my-app',
    status: 'running',
    access_url: '/apps/my-app/',
    container: {
      ssh_port: 2200,
      ssh_user: 'dev',
      ssh_password: 'p@ss123',
    },
  };

  it('returns OAuth + SSH fields when both oauth_* fields are present', () => {
    const fields = buildCredentialsFields({
      ...baseResponse,
      oauth_client_id: 'cid-xxx',
      oauth_client_secret: 'sec-yyy',
    });

    expect(fields).toEqual([
      { label: 'OAuth Client ID', value: 'cid-xxx' },
      { label: 'OAuth Client Secret', value: 'sec-yyy' },
      { label: 'SSH 端口', value: '2200' },
      { label: 'SSH 用户', value: 'dev' },
      { label: 'SSH 密码', value: 'p@ss123' },
    ]);
  });

  it('omits OAuth rows when oauth_client_id and oauth_client_secret are missing', () => {
    const fields = buildCredentialsFields(baseResponse);

    expect(fields).toEqual([
      { label: 'SSH 端口', value: '2200' },
      { label: 'SSH 用户', value: 'dev' },
      { label: 'SSH 密码', value: 'p@ss123' },
    ]);
    expect(fields.some((f) => f.label.startsWith('OAuth'))).toBe(false);
  });

  it('omits only Client Secret row if only oauth_client_id returned', () => {
    const fields = buildCredentialsFields({
      ...baseResponse,
      oauth_client_id: 'cid-only',
    });

    expect(fields.map((f) => f.label)).toEqual([
      'OAuth Client ID',
      'SSH 端口',
      'SSH 用户',
      'SSH 密码',
    ]);
  });

  it('converts ssh_port number to string', () => {
    const fields = buildCredentialsFields(baseResponse);
    const portField = fields.find((f) => f.label === 'SSH 端口');
    expect(portField?.value).toBe('2200');
    expect(typeof portField?.value).toBe('string');
  });
});
