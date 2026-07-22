/**
 * sandboxEscape 纯函数单测(沙箱逃逸阀,默认关闭)
 *
 * 零 Tauri 依赖:openSandboxEscapeWindow 涉及 WebviewWindow 静态方法,留给组件/e2e;
 * 这里锁死纯函数契约 —— 总开关/白名单默认全拒、initData 风格 data-check-string、
 * HMAC-SHA256 签名(独立验签)、开窗 URL 拼装(经反代收口,端口 0 时原样透传)。
 */

import { describe, it, expect } from 'vitest';
import {
  SANDBOX_ESCAPE_ENABLED,
  SANDBOX_ESCAPE_ALLOWED_ORIGINS,
  isSandboxEscapeAllowed,
  buildSandboxDataCheckString,
  signSandboxInitData,
  buildSandboxWindowUrl,
} from '../../src/chat/shared/sandboxEscape';

describe('sandboxEscape 常量(逃逸阀默认关闭的核心断言)', () => {
  it('总开关默认 false', () => {
    expect(SANDBOX_ESCAPE_ENABLED).toBe(false);
  });

  it('来源白名单默认空数组(全拒)', () => {
    expect(SANDBOX_ESCAPE_ALLOWED_ORIGINS).toEqual([]);
  });
});

describe('isSandboxEscapeAllowed', () => {
  it('默认(无 opts)任意 https URL → false(总开关关)', () => {
    expect(isSandboxEscapeAllowed('https://a.example/x')).toBe(false);
  });

  it('enabled=true 但 origins 空 → false', () => {
    expect(isSandboxEscapeAllowed('https://a.example/x', { enabled: true })).toBe(false);
  });

  it('enabled + origins 命中 → true;子域 / 异 scheme / 非法串 → false', () => {
    const opts = { enabled: true, origins: ['https://a.example'] };
    // 精确 origin 命中
    expect(isSandboxEscapeAllowed('https://a.example/x', opts)).toBe(true);
    expect(isSandboxEscapeAllowed('https://a.example', opts)).toBe(true);
    // 子域不是同一 origin
    expect(isSandboxEscapeAllowed('https://sub.a.example/x', opts)).toBe(false);
    // origin 含 scheme:http ≠ https
    expect(isSandboxEscapeAllowed('http://a.example/x', opts)).toBe(false);
    // 非法 URL 解析失败
    expect(isSandboxEscapeAllowed('not a url', opts)).toBe(false);
    // 非 http/https scheme
    expect(isSandboxEscapeAllowed('ftp://a.example/x', opts)).toBe(false);
  });
});

describe('buildSandboxDataCheckString', () => {
  it('键乱序输入 → 按 key 字典序 k=v 以 \\n 连接(精确字符串)', () => {
    const out = buildSandboxDataCheckString({ nonce: 'n1', auth_date: '1700000000', card_id: 'c9' });
    expect(out).toBe('auth_date=1700000000\ncard_id=c9\nnonce=n1');
  });

  it('空对象 → 空串', () => {
    expect(buildSandboxDataCheckString({})).toBe('');
  });
});

describe('signSandboxInitData', () => {
  const FIELDS = { auth_date: '1700000000', nonce: 'abc-123' };

  it('输出 64 位小写 hex;同输入确定;不同 secret 不同签名', async () => {
    const sig1 = await signSandboxInitData(FIELDS, 'secret-A');
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);

    const sig2 = await signSandboxInitData(FIELDS, 'secret-A');
    expect(sig2).toBe(sig1);

    const sig3 = await signSandboxInitData(FIELDS, 'secret-B');
    expect(sig3).not.toBe(sig1);
  });

  it('可用 crypto.subtle.verify 独立验签通过(证明是合法 HMAC-SHA256)', async () => {
    const sig = await signSandboxInitData(FIELDS, 'secret-A');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('secret-A'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = new Uint8Array(sig.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
    const data = new TextEncoder().encode(buildSandboxDataCheckString(FIELDS));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    expect(ok).toBe(true);

    // 篡改数据 → 验签失败
    const tampered = new TextEncoder().encode('auth_date=1700000001\nnonce=abc-123');
    const okTampered = await crypto.subtle.verify('HMAC', key, sigBytes, tampered);
    expect(okTampered).toBe(false);
  });
});

describe('buildSandboxWindowUrl', () => {
  it('fields + hash 并入 query,保留既有参数(反代端口 0 时原样透传)', () => {
    const out = buildSandboxWindowUrl(
      'https://a.example/page?x=1',
      { auth_date: '1', nonce: 'n' },
      'abc',
    );
    const u = new URL(out);
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.searchParams.get('auth_date')).toBe('1');
    expect(u.searchParams.get('nonce')).toBe('n');
    expect(u.searchParams.get('hash')).toBe('abc');
  });

  it('target 已有同名参数时被 fields 覆盖', () => {
    const out = buildSandboxWindowUrl('https://a.example/p?nonce=old', { nonce: 'new' }, 'h');
    expect(new URL(out).searchParams.get('nonce')).toBe('new');
  });
});
