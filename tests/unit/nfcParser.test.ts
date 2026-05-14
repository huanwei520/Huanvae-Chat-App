/**
 * NFC parser 单元测试
 *
 * 覆盖：
 * - decodeNdefUriPayload prefix code 处理
 * - parseAction 白名单判定 + 参数提取
 * - computePayloadHash 稳定性
 * - summarizeAction 含关键字段
 *
 * 不测：bytesToHex 简单串接（编译期保证）
 */

import { describe, it, expect } from 'vitest';
import {
  decodeNdefUriPayload,
  parseAction,
  computePayloadHash,
  summarizeAction,
} from '../../src/nfc/parser';

function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

describe('decodeNdefUriPayload', () => {
  it('prefix code 0x00 → 完整 URI（无前缀）', () => {
    const payload = [0x00, ...utf8Bytes('huanvae://miniapp/open?id=abc')];
    expect(decodeNdefUriPayload(payload)).toBe('huanvae://miniapp/open?id=abc');
  });

  it('prefix code 0x03 → http:// 拼接', () => {
    const payload = [0x03, ...utf8Bytes('example.com/foo')];
    expect(decodeNdefUriPayload(payload)).toBe('http://example.com/foo');
  });

  it('prefix code 0x04 → https:// 拼接', () => {
    const payload = [0x04, ...utf8Bytes('example.com/foo')];
    expect(decodeNdefUriPayload(payload)).toBe('https://example.com/foo');
  });

  it('未知 prefix code 返 ""', () => {
    const payload = [0xff, ...utf8Bytes('foo')];
    expect(decodeNdefUriPayload(payload)).toBe('');
  });

  it('空 payload 返 ""', () => {
    expect(decodeNdefUriPayload([])).toBe('');
  });
});

describe('parseAction', () => {
  it('miniapp/open 命中 → 返结构化 action', () => {
    const action = parseAction('huanvae://miniapp/open?id=app-123');
    expect(action).toEqual({ kind: 'miniapp/open', miniappId: 'app-123' });
  });

  it('miniapp/open 缺 id → 返 null', () => {
    expect(parseAction('huanvae://miniapp/open')).toBeNull();
  });

  it('http/request GET 命中 → method 大写、body null', () => {
    const action = parseAction('huanvae://http/request?url=https://example.com&method=GET');
    expect(action).toEqual({
      kind: 'http/request',
      url: 'https://example.com',
      method: 'GET',
      body: null,
    });
  });

  it('http/request POST 带 body（base64 JSON）→ body 解析后挂上', () => {
    const json = JSON.stringify({ a: 1, b: 'x' });
    const body64 = btoa(json);
    const uri = `huanvae://http/request?url=https://api.test/p&method=POST&body=${body64}`;
    const action = parseAction(uri);
    expect(action).toEqual({
      kind: 'http/request',
      url: 'https://api.test/p',
      method: 'POST',
      body: { a: 1, b: 'x' },
    });
  });

  it('http/request method 非白名单 → 返 null', () => {
    expect(
      parseAction('huanvae://http/request?url=https://example.com&method=DELETE'),
    ).toBeNull();
  });

  it('http/request GET + body → 返 null（fetch 规范禁止 GET+body，防摘要外藏数据）', () => {
    const body64 = btoa(JSON.stringify({ secret: 'x' }));
    expect(
      parseAction(`huanvae://http/request?url=https://api.test/x&method=GET&body=${body64}`),
    ).toBeNull();
  });

  it('http/request body 解码失败 → 返 null（整条丢弃）', () => {
    const uri = 'huanvae://http/request?url=https://example.com&method=POST&body=not-base64-!!!';
    expect(parseAction(uri)).toBeNull();
  });

  it('http/request url 非 http(s) scheme → 返 null', () => {
    expect(
      parseAction('huanvae://http/request?url=file:///etc/passwd&method=GET'),
    ).toBeNull();
  });

  it('未知 path → 返 null', () => {
    expect(parseAction('huanvae://unknown/cmd?x=1')).toBeNull();
  });

  it('非 huanvae:// scheme → 返 null', () => {
    expect(parseAction('https://example.com/miniapp/open?id=1')).toBeNull();
  });
});

describe('summarizeAction', () => {
  it('miniapp/open 含 miniappId', () => {
    expect(summarizeAction({ kind: 'miniapp/open', miniappId: 'app-42' })).toContain('app-42');
  });

  it('http/request 显示 host + path（让用户能判断 endpoint 是否恶意）', () => {
    const summary = summarizeAction({
      kind: 'http/request',
      url: 'https://api.test/admin/delete?id=42',
      method: 'POST',
      body: null,
    });
    expect(summary).toContain('api.test');
    expect(summary).toContain('POST');
    // path 必须可见 — 仅 host 不足以让用户识别恶意端点
    expect(summary).toContain('/admin/delete');
  });

  it('http/request 过长 path 截断到 40 字符并以省略号标记', () => {
    const longPath = '/' + 'a'.repeat(100);
    const summary = summarizeAction({
      kind: 'http/request',
      url: `https://api.test${longPath}`,
      method: 'GET',
      body: null,
    });
    expect(summary).toContain('…'); // 截断标记
    // 不应包含完整 100 字符（防 modal 过宽）
    expect(summary).not.toContain('a'.repeat(100));
  });
});

describe('computePayloadHash', () => {
  it('确定性：同输入同输出', async () => {
    const payload = [0x00, ...utf8Bytes('huanvae://miniapp/open?id=test')];
    const h1 = await computePayloadHash(payload);
    const h2 = await computePayloadHash(payload);
    expect(h1).toBe(h2);
  });

  it('prefix code 不同则 hash 不同（防卡片改写）', async () => {
    const p1 = [0x00, ...utf8Bytes('huanvae://miniapp/open?id=x')];
    const p2 = [0x03, ...utf8Bytes('huanvae://miniapp/open?id=x')];
    const h1 = await computePayloadHash(p1);
    const h2 = await computePayloadHash(p2);
    expect(h1).not.toBe(h2);
  });

  it('返回 64 字符 hex（SHA-256 = 32 bytes = 64 hex）', async () => {
    const payload = [0x00, 0x01, 0x02];
    const h = await computePayloadHash(payload);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
