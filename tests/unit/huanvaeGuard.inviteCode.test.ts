/**
 * HuanvaeGuard 群组邀请码合成/解析单测（零 mock 纯函数）
 *
 * 被测模块 `src/huanvaeGuard/inviteCode.ts` 刻意零 import，所以这里不需要任何 Tauri mock。
 *
 * 测试重点是 **decode 的严格性**：它是"用户粘进来的任意字符串"与"真的去调 acceptGroupInvite"
 * 之间唯一的一道闸。凡是它没能拒绝的畸形码，最终都会变成一次参数错误的服务端调用，
 * 或者更糟 —— 把人导向一个错误的群组。
 *
 * 为避免循环论证（拿 SUT 的 encode 造样本再喂给 SUT 的 decode），下面所有**畸形样本**
 * 都用测试内自带的 `makeCode()` 独立构造，不经过 SUT。
 */

import { describe, it, expect } from 'vitest';
import {
  GROUP_INVITE_PREFIX,
  encodeGroupInvite,
  decodeGroupInvite,
} from '../../src/huanvaeGuard/inviteCode';

/** 独立于 SUT 的 base64url 编码，用来构造畸形样本（不复用 SUT 的实现） */
function base64url(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 把任意 JSON 值包装成"前缀正确、载荷是它"的码 */
function makeCode(payload: unknown): string {
  return GROUP_INVITE_PREFIX + base64url(JSON.stringify(payload));
}

describe('encodeGroupInvite', () => {
  it('产出带 HGG1- 前缀、载荷为 base64url 的码', () => {
    const code = encodeGroupInvite('grp-1', 'tok-1');
    expect(code).not.toBeNull();
    expect(code!.startsWith(GROUP_INVITE_PREFIX)).toBe(true);
    // base64url 字符集：不得出现 base64 的 `+` `/` `=`
    const payload = code!.slice(GROUP_INVITE_PREFIX.length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('码内只含 groupId + token 两个值（不夹带任何其它字段）', () => {
    const code = encodeGroupInvite('grp-1', 'tok-1')!;
    const raw = code.slice(GROUP_INVITE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4))));
    expect(JSON.parse(json)).toEqual(['grp-1', 'tok-1']);
  });

  it('任一参数为空 / 纯空白 → null', () => {
    expect(encodeGroupInvite('', 'tok-1')).toBeNull();
    expect(encodeGroupInvite('grp-1', '')).toBeNull();
    expect(encodeGroupInvite('   ', 'tok-1')).toBeNull();
    expect(encodeGroupInvite('grp-1', '  \t ')).toBeNull();
    expect(encodeGroupInvite('', '')).toBeNull();
  });
});

describe('decodeGroupInvite — round trip', () => {
  it('普通 ASCII 值可原样还原', () => {
    const code = encodeGroupInvite('grp-abc123', 'invite-token-xyz')!;
    expect(decodeGroupInvite(code)).toEqual({
      groupId: 'grp-abc123',
      token: 'invite-token-xyz',
    });
  });

  it('含特殊字符 / 非 ASCII 的值可原样还原', () => {
    const groupId = '群组-测试 🌐 "quoted" [bracket]';
    const token = 'tök/en+with=base64%chars\\and\n换行';
    const code = encodeGroupInvite(groupId, token)!;
    expect(decodeGroupInvite(code)).toEqual({ groupId, token });
  });

  it('首尾带空白的合法码（用户粘贴常带）仍能解出', () => {
    const code = encodeGroupInvite('grp-1', 'tok-1')!;
    expect(decodeGroupInvite(`  \n${code}\t `)).toEqual({ groupId: 'grp-1', token: 'tok-1' });
  });
});

describe('decodeGroupInvite — 严格拒绝', () => {
  it('前缀缺失 → null', () => {
    const payload = base64url(JSON.stringify(['grp-1', 'tok-1']));
    expect(decodeGroupInvite(payload)).toBeNull();
    expect(decodeGroupInvite(`HGG2-${payload}`)).toBeNull();
    expect(decodeGroupInvite(`hgg1-${payload}`)).toBeNull();
  });

  it('空串 / 只有前缀 → null', () => {
    expect(decodeGroupInvite('')).toBeNull();
    expect(decodeGroupInvite('   ')).toBeNull();
    expect(decodeGroupInvite(GROUP_INVITE_PREFIX)).toBeNull();
  });

  it('前缀对但载荷不是 base64url（含非法字符 / 空白）→ null', () => {
    expect(decodeGroupInvite(`${GROUP_INVITE_PREFIX}@@@@`)).toBeNull();
    expect(decodeGroupInvite(`${GROUP_INVITE_PREFIX}not base64`)).toBeNull();
    expect(decodeGroupInvite(`${GROUP_INVITE_PREFIX}++//==`)).toBeNull();
  });

  it('载荷能 base64 解码但不是 JSON → null', () => {
    expect(decodeGroupInvite(GROUP_INVITE_PREFIX + base64url('这不是 JSON'))).toBeNull();
    expect(decodeGroupInvite(GROUP_INVITE_PREFIX + base64url('{"groupId":'))).toBeNull();
  });

  it('JSON 是对象 / 字符串 / 数字而非数组 → null', () => {
    expect(decodeGroupInvite(makeCode({ groupId: 'grp-1', token: 'tok-1' }))).toBeNull();
    expect(decodeGroupInvite(makeCode('grp-1'))).toBeNull();
    expect(decodeGroupInvite(makeCode(42))).toBeNull();
    expect(decodeGroupInvite(makeCode(null))).toBeNull();
  });

  it('数组长度不是 2（0 / 1 / 3）→ null', () => {
    expect(decodeGroupInvite(makeCode([]))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1']))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1', 'tok-1', 'extra']))).toBeNull();
  });

  it('元素不是字符串（数字 / null / 对象）→ null', () => {
    expect(decodeGroupInvite(makeCode([1, 2]))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1', null]))).toBeNull();
    expect(decodeGroupInvite(makeCode([null, 'tok-1']))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1', { t: 'tok-1' }]))).toBeNull();
  });

  it('元素为空串 / 纯空格 → null', () => {
    expect(decodeGroupInvite(makeCode(['', 'tok-1']))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1', '']))).toBeNull();
    expect(decodeGroupInvite(makeCode(['   ', 'tok-1']))).toBeNull();
    expect(decodeGroupInvite(makeCode(['grp-1', ' \t ']))).toBeNull();
  });

  it('长度恰好 2 且都是非空字符串才放行（正向对照：证明上面的拒绝不是恒 null）', () => {
    expect(decodeGroupInvite(makeCode(['grp-1', 'tok-1']))).toEqual({
      groupId: 'grp-1',
      token: 'tok-1',
    });
  });
});
