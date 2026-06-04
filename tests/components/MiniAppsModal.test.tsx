/**
 * MiniAppsModal 可测的纯函数测试
 *
 * MiniAppsModal 组件依赖 SessionContext + useMiniApps + WebviewWindow 静态方法，
 * 整体渲染 mock 成本过高。关键新逻辑（URL 拼接）已抽成 pure function：
 * - buildMiniAppLaunchUrl: 打开小程序时拼 platform JWT 到 query
 *
 * 注：审批制改造后,创建走「提交申请」(submitMiniAppRequest),响应不含容器/凭据,
 * 原 buildCredentialsFields 已删除,其测试一并移除。
 *
 * 测试范围：
 * 1. URL 拼接（access_url 有/无 query、token URL encode）
 */

import { describe, it, expect } from 'vitest';
import { buildMiniAppLaunchUrl } from '../../src/components/miniapps/launch';

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
