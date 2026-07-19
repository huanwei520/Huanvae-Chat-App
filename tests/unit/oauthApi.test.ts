/**
 * OAuth 域 API 封装单元测试（src/api/oauth.ts）
 *
 * 用假 ApiClient（get/post/delete 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/body 调用 api.get/post/delete，并返回解包后的数据；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）；
 *   - isConsentRequired 类型守卫双分支（consent 形状 true / code 形状 false）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as oauth from '../../src/api/oauth';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe('OAuth API 封装 (api/oauth)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- 正常路径：path/body 正确 + 返回数据 ----

  it('authorize 正常：POST /api/oauth/authorize，请求对象原样透传', async () => {
    const req: oauth.AuthorizeRequest = {
      client_id: 'c1',
      redirect_uri: 'https://app.example/cb',
      scope: 'profile email',
      state: 's1',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      consent: true,
    };
    const resp: oauth.AuthorizeCodeResponse = { code: 'code-1', state: 's1', redirect_uri: 'https://app.example/cb' };
    api.post.mockResolvedValue(resp);

    const out = await oauth.authorize(api, req);
    expect(api.post).toHaveBeenCalledWith('/api/oauth/authorize', req);
    expect(out).toEqual(resp);
  });

  it('listClients 正常：GET /api/oauth/clients', async () => {
    const list = [{ client_id: 'c1', app_name: 'A' }];
    api.get.mockResolvedValue(list);
    const out = await oauth.listClients(api);
    expect(api.get).toHaveBeenCalledWith('/api/oauth/clients');
    expect(out).toEqual(list);
  });

  it('createClient 正常：POST /api/oauth/clients 带 data', async () => {
    const req: oauth.CreateClientRequest = {
      app_name: 'My App',
      redirect_uris: ['https://app.example/cb'],
      scopes: ['profile'],
    };
    api.post.mockResolvedValue({ client_id: 'c9', client_secret: 'sec', app_name: 'My App' });
    const out = await oauth.createClient(api, req);
    expect(api.post).toHaveBeenCalledWith('/api/oauth/clients', req);
    expect(out).toEqual({ client_id: 'c9', client_secret: 'sec', app_name: 'My App' });
  });

  it('deleteClient 正常：DELETE /api/oauth/clients/<id>', async () => {
    api.delete.mockResolvedValue({ message: 'deleted' });
    const out = await oauth.deleteClient(api, 'c1');
    expect(api.delete).toHaveBeenCalledWith('/api/oauth/clients/c1');
    expect(out).toEqual({ message: 'deleted' });
  });

  it('resetClientSecret 正常：POST /api/oauth/clients/<id>/reset-secret 空对象 body', async () => {
    api.post.mockResolvedValue({ client_secret: 's2' });
    const out = await oauth.resetClientSecret(api, 'c1');
    expect(api.post).toHaveBeenCalledWith('/api/oauth/clients/c1/reset-secret', {});
    expect(out).toEqual({ client_secret: 's2' });
  });

  it('listGrants 正常：GET /api/oauth/grants', async () => {
    const list = [{ id: 'g1', app_name: 'A' }];
    api.get.mockResolvedValue(list);
    const out = await oauth.listGrants(api);
    expect(api.get).toHaveBeenCalledWith('/api/oauth/grants');
    expect(out).toEqual(list);
  });

  it('revokeGrant 正常：DELETE /api/oauth/grants/<id>', async () => {
    api.delete.mockResolvedValue({ message: 'revoked' });
    const out = await oauth.revokeGrant(api, 'g1');
    expect(api.delete).toHaveBeenCalledWith('/api/oauth/grants/g1');
    expect(out).toEqual({ message: 'revoked' });
  });

  // ---- isConsentRequired 类型守卫：双分支 ----

  it('isConsentRequired：consent 形状返回 true', () => {
    const resp: oauth.AuthorizeResponse = {
      consent_required: true,
      app_name: 'Demo',
      app_logo_url: null,
      scopes: ['profile'],
    };
    expect(oauth.isConsentRequired(resp)).toBe(true);
  });

  it('isConsentRequired：code 形状返回 false', () => {
    const resp: oauth.AuthorizeResponse = {
      code: 'code-1',
      state: null,
      redirect_uri: 'https://app.example/cb',
    };
    expect(oauth.isConsentRequired(resp)).toBe(false);
  });

  // ---- 异常路径：api 抛错时原样向上抛（无 try/catch 兜底）----

  it('authorize 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('authz-fail'));
    await expect(
      oauth.authorize(api, { client_id: 'c1', redirect_uri: 'https://app.example/cb' }),
    ).rejects.toThrow('authz-fail');
  });

  it('listClients 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('list-fail'));
    await expect(oauth.listClients(api)).rejects.toThrow('list-fail');
  });

  it('revokeGrant 异常：向上抛', async () => {
    api.delete.mockRejectedValue(new Error('revoke-fail'));
    await expect(oauth.revokeGrant(api, 'g1')).rejects.toThrow('revoke-fail');
  });
});
