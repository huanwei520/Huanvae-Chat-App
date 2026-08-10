/**
 * 账号排序纯函数测试（src/utils/accountOrder.ts）
 *
 * 覆盖账号选择器「上次登录的账号排第一」所依赖的三种数据形态：
 * - 全部账号都有 last_login_at
 * - 全部账号都没有（存量数据）→ 回落 created_at
 * - 混合：有的有、有的没有 → 两种取值放在同一把尺子上比较（必须能互相穿插）
 */

import { describe, it, expect } from 'vitest';
import { getAccountRecencyKey, sortAccountsByLastLogin } from '../../src/utils/accountOrder';
import type { SavedAccount } from '../../src/types/account';

function makeAccount(
  userId: string,
  createdAt: string,
  lastLoginAt: string | null,
): SavedAccount {
  return {
    user_id: userId,
    nickname: `昵称-${userId}`,
    server_url: 'https://example.test',
    avatar_path: null,
    created_at: createdAt,
    last_login_at: lastLoginAt,
  };
}

const ids = (accounts: SavedAccount[]): string[] => accounts.map((a) => a.user_id);

describe('getAccountRecencyKey', () => {
  it('有 last_login_at 时用它，忽略 created_at', () => {
    const account = makeAccount('u1', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z');
    expect(getAccountRecencyKey(account)).toBe(Date.parse('2026-03-01T00:00:00Z'));
  });

  it('last_login_at 为 null（存量账号）时回落 created_at', () => {
    const account = makeAccount('u1', '2026-01-01T00:00:00Z', null);
    expect(getAccountRecencyKey(account)).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('时间串解析失败记为 0（排最旧），不返回 NaN 污染比较器', () => {
    const broken = makeAccount('u1', 'not-a-date', null);
    const key = getAccountRecencyKey(broken);
    expect(Number.isNaN(key)).toBe(false);
    expect(key).toBe(0);
  });
});

describe('sortAccountsByLastLogin', () => {
  it('全部账号都有 last_login_at：按 last_login_at 倒序', () => {
    const accounts = [
      makeAccount('u1', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      makeAccount('u2', '2026-01-02T00:00:00Z', '2026-01-15T00:00:00Z'),
      makeAccount('u3', '2026-01-03T00:00:00Z', '2026-06-01T00:00:00Z'),
    ];
    expect(ids(sortAccountsByLastLogin(accounts))).toEqual(['u3', 'u1', 'u2']);
  });

  it('全部账号都没有 last_login_at（存量数据）：回落按 created_at 倒序', () => {
    const accounts = [
      makeAccount('u1', '2026-01-01T00:00:00Z', null),
      makeAccount('u2', '2026-05-01T00:00:00Z', null),
      makeAccount('u3', '2026-02-01T00:00:00Z', null),
    ];
    expect(ids(sortAccountsByLastLogin(accounts))).toEqual(['u2', 'u3', 'u1']);
  });

  it('混合：无 last_login_at 的账号用 created_at 参与同一次比较，可穿插在有值的账号之间', () => {
    const accounts = [
      // 有 last_login_at → 2026-03-01
      makeAccount('u1', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      // 无 last_login_at → 回落 created_at 2026-05-01，应排在 u1 之前、u3 之后
      makeAccount('u2', '2026-05-01T00:00:00Z', null),
      // 有 last_login_at → 2026-06-01
      makeAccount('u3', '2026-02-01T00:00:00Z', '2026-06-01T00:00:00Z'),
    ];
    expect(ids(sortAccountsByLastLogin(accounts))).toEqual(['u3', 'u2', 'u1']);
  });

  it('混合：created_at 更新但 last_login_at 更旧时，仍以 last_login_at 为准', () => {
    const accounts = [
      // created_at 是三者中最新的，但上次登录是最旧的 → 必须排最后
      makeAccount('u1', '2026-09-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      makeAccount('u2', '2026-02-01T00:00:00Z', null),
      makeAccount('u3', '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
    ];
    expect(ids(sortAccountsByLastLogin(accounts))).toEqual(['u3', 'u2', 'u1']);
  });

  it('时刻完全相同的账号保持原有相对顺序（排序稳定，列表不会每次加载抖动）', () => {
    const accounts = [
      makeAccount('u1', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      makeAccount('u2', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      makeAccount('u3', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
    ];
    expect(ids(sortAccountsByLastLogin(accounts))).toEqual(['u1', 'u2', 'u3']);
  });

  it('返回新数组，不改动入参顺序', () => {
    const accounts = [
      makeAccount('u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      makeAccount('u2', '2026-01-01T00:00:00Z', '2026-09-01T00:00:00Z'),
    ];
    const sorted = sortAccountsByLastLogin(accounts);
    expect(sorted).not.toBe(accounts);
    expect(ids(sorted)).toEqual(['u2', 'u1']);
    expect(ids(accounts)).toEqual(['u1', 'u2']);
  });

  it('空列表返回空数组', () => {
    expect(sortAccountsByLastLogin([])).toEqual([]);
  });
});
