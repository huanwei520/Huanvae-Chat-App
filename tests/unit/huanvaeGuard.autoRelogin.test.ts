/**
 * 会话过期自动重登（401→refresh→再401 自愈链「自动重登腿」）单元测试
 *
 * 覆盖：
 * - pickAccountForSession 纯函数选择规则（精确匹配/单账号兜底/多义放弃）
 * - performAutoRelogin 编排：取账号→取密码→login(带 macAddress)→getProfile→结果字段
 * - 无匹配账号时拒绝（调用方回退登出）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('../../src/api/auth', () => ({
  login: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn(),
}));

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `resolved:${p}` : null),
}));

vi.mock('../../src/utils/platform', () => ({
  isMobile: () => false,
}));

import {
  pickAccountForSession,
  performAutoRelogin,
  resolveAvatar,
} from '../../src/services/autoRelogin';
import { login, getProfile } from '../../src/api/auth';
import { getDeviceInfo } from '../../src/services/deviceInfo';
import type { SavedAccount } from '../../src/types/account';

function acct(serverUrl: string, userId: string, nickname = userId): SavedAccount {
  return {
    user_id: userId,
    nickname,
    server_url: serverUrl,
    avatar_path: null,
    created_at: '2026-09-26T00:00:00Z',
    last_login_at: null,
  };
}

const SRV = 'http://127.0.0.1:18900';

describe('pickAccountForSession（自动重登账号选择）', () => {
  it('server_url+user_id 精确匹配优先', () => {
    const accounts = [acct(SRV, 'owner'), acct(SRV, 'alice'), acct('http://other', 'owner')];
    expect(pickAccountForSession(accounts, SRV, 'owner')?.user_id).toBe('owner');
  });

  it('同服务器仅一个账号时兜底（user_id 变更场景）', () => {
    const accounts = [acct(SRV, 'owner2'), acct('http://other', 'x')];
    expect(pickAccountForSession(accounts, SRV, 'owner')?.user_id).toBe('owner2');
  });

  it('同服务器多账号且无精确匹配 → null（放弃自动重登）', () => {
    const accounts = [acct(SRV, 'a'), acct(SRV, 'b')];
    expect(pickAccountForSession(accounts, SRV, 'nobody')).toBeNull();
  });

  it('无任何匹配 → null', () => {
    expect(pickAccountForSession([acct('http://x', 'a')], SRV, 'a')).toBeNull();
    expect(pickAccountForSession([], SRV, 'a')).toBeNull();
  });
});

describe('performAutoRelogin（自动重登编排）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockReset();
  });

  it(' happy path：取密码→login(带 macAddress)→getProfile→返回可 setSession 字段', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_saved_accounts') {
        return Promise.resolve([acct(SRV, 'owner', 'Owner')]);
      }
      if (cmd === 'get_account_password') {
        return Promise.resolve('testpass123');
      }
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
    vi.mocked(getDeviceInfo).mockResolvedValue({
      deviceInfo: 'Mac test',
      macAddress: 'AA:BB:CC:DD:EE:FF',
    } as never);
    vi.mocked(login).mockResolvedValue({
      access_token: 'mock-access-owner-9',
      refresh_token: 'mock-refresh-owner-9',
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      data: { user_id: 'owner', user_nickname: 'Owner', user_avatar_url: 'a.png' },
    } as never);

    const r = await performAutoRelogin(SRV, 'owner');

    expect(login).toHaveBeenCalledWith(SRV, 'owner', 'testpass123', 'Mac test', 'AA:BB:CC:DD:EE:FF');
    expect(getProfile).toHaveBeenCalledWith(SRV, 'mock-access-owner-9');
    expect(r).toMatchObject({
      serverUrl: SRV,
      userId: 'owner',
      accessToken: 'mock-access-owner-9',
      refreshToken: 'mock-refresh-owner-9',
      nickname: 'Owner',
      avatarPath: null,
    });
    expect((r.profile as Record<string, unknown>).user_avatar_url).toBe('a.png');
    // resolveAvatar 由 SessionContext 在 setSession 前调用（与 App.tsx createSessionAndLogin 同构）
    expect((resolveAvatar(r.profile) as Record<string, unknown>).user_avatar_url).toBe('resolved:a.png');
  });

  it('无匹配已保存账号 → 拒绝（调用方回退登出）', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_saved_accounts') { return Promise.resolve([acct('http://other', 'x')]); }
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
    await expect(performAutoRelogin(SRV, 'owner')).rejects.toThrow('无匹配的已保存账号');
    expect(login).not.toHaveBeenCalled();
  });

  it('后端未存密码 → 拒绝（不盲目重试）', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_saved_accounts') { return Promise.resolve([acct(SRV, 'owner')]); }
      if (cmd === 'get_account_password') { return Promise.resolve(''); }
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
    await expect(performAutoRelogin(SRV, 'owner')).rejects.toThrow('未找到保存的密码');
    expect(login).not.toHaveBeenCalled();
  });
});
