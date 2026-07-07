/**
 * 股票窗口 URL 编解码纯函数单元测试（src/stocks/window.ts）
 *
 * 仅测纯函数 buildStockWindowUrl / parseStockWindowData（不触 WebviewWindow 静态方法）。
 */

import { describe, it, expect } from 'vitest';
import { buildStockWindowUrl, parseStockWindowData, STOCK_WINDOW_LABEL } from '../../src/stocks/window';

const sample = {
  userId: 'u1',
  serverUrl: 'https://api.example.com',
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
};

describe('股票窗口 URL 编解码 (stocks/window)', () => {
  it('label 固定为 stocks-research', () => {
    expect(STOCK_WINDOW_LABEL).toBe('stocks-research');
  });

  it('buildStockWindowUrl：base64 编码 serverUrl/token，userId 明文', () => {
    const url = buildStockWindowUrl(sample);
    expect(url.startsWith('/stocks?')).toBe(true);
    const params = new URLSearchParams(url.slice('/stocks?'.length));
    expect(params.get('userId')).toBe('u1');
    expect(params.get('serverUrl')).toBe(btoa('https://api.example.com'));
    expect(params.get('accessToken')).toBe(btoa('access-abc'));
    expect(params.get('refreshToken')).toBe(btoa('refresh-xyz'));
  });

  it('build → parse 往返一致', () => {
    const url = buildStockWindowUrl(sample);
    const search = url.slice(url.indexOf('?'));
    expect(parseStockWindowData(search)).toEqual(sample);
  });

  it('parse 缺字段返回 null', () => {
    const search = `?userId=u1&serverUrl=${btoa('https://x')}`; // 缺 tokens
    expect(parseStockWindowData(search)).toBeNull();
  });

  it('parse 非法 base64 返回 null', () => {
    // atob 遇非法字符抛错 → 捕获返回 null
    const search = '?userId=u1&serverUrl=@@@&accessToken=@@@&refreshToken=@@@';
    expect(parseStockWindowData(search)).toBeNull();
  });

  it('parse 空串返回 null', () => {
    expect(parseStockWindowData('')).toBeNull();
  });
});
