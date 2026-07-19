/**
 * 认证 API (src/api/auth.ts) 契约测试
 *
 * auth.ts 自带 api() 封装（不经 ApiClient），直接调 secureHttp(invoke('secure_http'))。
 * 故 mock invoke + discovery.resolveForSecureHttp（返回 null → 退化 {pin_ca:true}），
 * 断言 secure_http 收到的 req（url / method / headers / body）与返回值解包行为。
 *
 * 验证：
 *   - login：POST /api/auth/login，body 字段（device_info 默认值 / mac_address undefined 被
 *     JSON.stringify 丢弃）、无 Authorization 头、返回 result.data 解包（不泄漏信封字段）
 *   - login 错误路径：JSON error 体透传 / 非 JSON 体降级 HTTP {status}
 *   - register：POST /api/auth/register，email '' → key 缺席；空响应体分支（body '' → 返回 {}）
 *   - getProfile：GET /api/profile，Authorization 头、无 Content-Type、body null，
 *     整体透传 RawProfileResponse（不做 .data 解包）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../src/services/discovery', () => ({ resolveForSecureHttp: () => null }));

import { login, register, getProfile } from '../../src/api/auth';

const SERVER_URL = 'https://api.example.com';
const TOKEN = 'access-token-xyz';

/** 构造 secure_http(invoke) 返回的 SecureHttpResp */
function makeResp<T>(body: T, status = 200) {
  return { status, headers: {}, body: JSON.stringify(body) };
}

/** 取第 i 次 invoke('secure_http', {req}) 的 req */
function reqOf(i: number): Record<string, unknown> {
  const args = mocks.invoke.mock.calls[i] as [string, { req: Record<string, unknown> }];
  return args[1].req;
}

beforeEach(() => {
  mocks.invoke.mockReset();
  // login 内有 console.warn 设备信息日志，静音以保持测试输出干净
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('auth.login', () => {
  it('POSTs to /api/auth/login with explicit deviceInfo + macAddress and unwraps result.data', async () => {
    const loginData = { access_token: 'at-1', refresh_token: 'rt-1' };
    mocks.invoke.mockResolvedValueOnce(makeResp({ data: loginData }));

    const result = await login(SERVER_URL, 'user-1', 'pw-1', 'DESKTOP-ABC - Windows', 'AA:BB:CC');

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][0]).toBe('secure_http');
    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/auth/login`);
    expect(req.method).toBe('POST');
    expect(req.pin_ca).toBe(true); // discovery 返回 null → 退化 {pin_ca:true}
    const headers = req.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBeUndefined(); // 登录无 token
    expect(JSON.parse(req.body as string)).toEqual({
      user_id: 'user-1',
      password: 'pw-1',
      device_info: 'DESKTOP-ABC - Windows',
      mac_address: 'AA:BB:CC',
    });

    // 解包 result.data：返回内层对象，信封字段（data/success）不泄漏
    expect(result).toEqual(loginData);
  });

  it('defaults: deviceInfo omitted → "Huanvae Chat Desktop"; macAddress null → mac_address key absent', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ data: { access_token: 'at', refresh_token: 'rt' } }),
    );

    await login(SERVER_URL, 'user-2', 'pw-2', undefined, null);

    // mac_address: null || undefined → undefined，被 JSON.stringify 丢弃 → key 缺席
    expect(JSON.parse(reqOf(0).body as string)).toEqual({
      user_id: 'user-2',
      password: 'pw-2',
      device_info: 'Huanvae Chat Desktop',
    });
  });

  it('non-ok with JSON error body → throws backend error message', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ error: 'bad credentials' }, 401));

    await expect(login(SERVER_URL, 'u', 'p')).rejects.toThrow('bad credentials');
  });

  it('non-ok with non-JSON body → falls back to HTTP {status}', async () => {
    mocks.invoke.mockResolvedValueOnce({ status: 500, headers: {}, body: 'oops' });

    await expect(login(SERVER_URL, 'u', 'p')).rejects.toThrow('HTTP 500');
  });
});

describe('auth.register', () => {
  it('POSTs to /api/auth/register with email included when provided', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ data: null }));

    await expect(
      register(SERVER_URL, {
        server_url: SERVER_URL,
        user_id: 'user-3',
        nickname: '昵称',
        password: 'pw-3',
        email: 'a@b.com',
      }),
    ).resolves.toBeUndefined();

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/auth/register`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({
      user_id: 'user-3',
      nickname: '昵称',
      password: 'pw-3',
      email: 'a@b.com',
    });
  });

  it("email '' → email key absent from body; empty response body ('') resolves cleanly", async () => {
    // 空响应体命中 api() 的 `response.body ? json : {}` 空体分支
    mocks.invoke.mockResolvedValueOnce({ status: 200, headers: {}, body: '' });

    await expect(
      register(SERVER_URL, {
        server_url: SERVER_URL,
        user_id: 'user-4',
        nickname: 'n',
        password: 'p',
        email: '',
      }),
    ).resolves.toBeUndefined();

    // email: '' || undefined → undefined，被 JSON.stringify 丢弃
    expect(JSON.parse(reqOf(0).body as string)).toEqual({
      user_id: 'user-4',
      nickname: 'n',
      password: 'p',
    });
  });

  it('non-ok with JSON error body → throws backend error message', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ error: 'user_id already taken' }, 409));

    await expect(
      register(SERVER_URL, {
        server_url: SERVER_URL,
        user_id: 'dup',
        nickname: 'n',
        password: 'p',
      }),
    ).rejects.toThrow('user_id already taken');
  });
});

describe('auth.getProfile', () => {
  it('GETs /api/profile with Bearer token, no Content-Type, null body; returns whole body (no .data unwrap)', async () => {
    const rawProfile = {
      data: {
        user_id: 'user-5',
        user_nickname: '小明',
        user_email: null,
        user_signature: null,
        user_avatar_url: null,
        admin: 'false',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    };
    mocks.invoke.mockResolvedValueOnce(makeResp(rawProfile));

    const result = await getProfile(SERVER_URL, TOKEN);

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/profile`);
    expect(req.method).toBe('GET');
    expect(req.body).toBeNull(); // 无 body → api() 传 null
    const headers = req.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBeUndefined(); // 无 body → 不设 Content-Type
    expect(headers).toEqual({ Authorization: `Bearer ${TOKEN}` });

    // getProfile 用 api<RawProfileResponse> 整体透传，保留 {data:{...}} 信封
    expect(result).toEqual(rawProfile);
  });

  it('non-ok with JSON error body → throws backend error message', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ error: 'token expired' }, 401));

    await expect(getProfile(SERVER_URL, TOKEN)).rejects.toThrow('token expired');
  });
});
