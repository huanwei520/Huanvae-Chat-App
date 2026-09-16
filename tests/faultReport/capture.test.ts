/**
 * 前端采集器单测：console 劫持（记录+原样转发+写入前脱敏）、网络错误摘要（仅 URL+状态码）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFaultCapture, isFaultCaptureInstalled } from '../../src/services/faultReport/capture';
import { faultReportInstance } from '../../src/services/faultReport/instance';

let uninstall: (() => void) | null = null;

afterEach(() => {
  if (uninstall) {
    uninstall();
    uninstall = null;
  }
  vi.restoreAllMocks();
});

describe('faultReport capture —— 前端采集面', () => {
  it('安装为幂等', () => {
    expect(isFaultCaptureInstalled()).toBe(false);
    const u1 = installFaultCapture();
    expect(isFaultCaptureInstalled()).toBe(true);
    const u2 = installFaultCapture();
    expect(isFaultCaptureInstalled()).toBe(true);
    u1();
    u2();
    expect(isFaultCaptureInstalled()).toBe(false);
  });

  it('console.warn 劫持：写入前脱敏 + 原样转发', () => {
    const spy = vi.spyOn(console, 'warn');
    uninstall = installFaultCapture();
    const before = faultReportInstance.buffer.stats().count;
    console.warn('token=supersecret123 should be redacted');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('token=supersecret123 should be redacted');
    const after = faultReportInstance.buffer.stats();
    expect(after.count).toBe(before + 1);
    const snap = faultReportInstance.buffer.snapshot(0);
    expect(snap).not.toContain('supersecret123');
    expect(snap).toContain('[REDACTED]');
  });

  it('聊天正文零采集（硬红线）：console 打印聊天消息对象 → 整体丢弃，正文零入缓冲', () => {
    const spy = vi.spyOn(console, 'warn');
    uninstall = installFaultCapture();
    const chatMsg = { id: 'm1', content: '今晚老地方见暗号苹果', conversationId: 'c9', senderId: 'u1', createdAt: 1 };
    console.warn('[ChatStore] append message', chatMsg);
    expect(spy).toHaveBeenCalledTimes(1); // 原样转发不受影响
    const snap = faultReportInstance.buffer.snapshot(0);
    // 正文与会话 ID 均零入缓冲，只留丢弃占位符
    expect(snap).not.toContain('今晚老地方见暗号苹果');
    expect(snap).not.toContain('"c9"');
    expect(snap).toContain('[聊天对象已按零采集红线丢弃]');
  });

  it('console.error 记录并转发', () => {
    const spy = vi.spyOn(console, 'error');
    uninstall = installFaultCapture();
    console.error('boom password=abc');
    expect(spy).toHaveBeenCalledTimes(1);
    const snap = faultReportInstance.buffer.snapshot(0);
    expect(snap).toContain('boom');
    expect(snap).not.toContain('password=abc');
  });

  it('未捕获异常（window.onerror）进入缓冲（Error 对象形态）', () => {
    uninstall = installFaultCapture();
    const before = faultReportInstance.buffer.stats().count;
    const err = new TypeError('x is not a function');
    window.onerror?.('Uncaught TypeError', 'file.js', 1, 1, err);
    expect(faultReportInstance.buffer.stats().count).toBe(before + 1);
    const snap = faultReportInstance.buffer.snapshot(0);
    expect(snap).toContain('TypeError');
  });

  it('网络失败摘要：只含 URL 与状态码，不含请求头；URL query 值已脱敏（硬红线）', async () => {
    uninstall = installFaultCapture();
    const originalFetch = window.fetch;
    // 构造一个必定失败的请求（jsdom 无网络栈），URL query 携带 token 形态敏感值
    const before = faultReportInstance.networkErrors.length;
    try {
      await window.fetch('https://127.0.0.1:1/definitely-unreachable?access_token=SECRET-QTOK&trace=ab12');
    } catch {
      // 预期失败
    }
    expect(faultReportInstance.networkErrors.length).toBe(before + 1);
    const last = faultReportInstance.networkErrors[faultReportInstance.networkErrors.length - 1];
    expect(last.url).not.toContain('SECRET-QTOK');
    expect(last.url).not.toContain('ab12');
    expect(last.url).toContain('access_token=');
    expect(last.status).toBe(0);
    // 摘要字段白名单：只有 at/url/status
    expect(Object.keys(last).sort()).toEqual(['at', 'status', 'url']);
    // 环形缓冲快照（字符串全文）不得含 token/query 值明文（异常行与摘要行均由本次 fetch 产生）
    const snap = faultReportInstance.buffer.snapshot();
    expect(snap).not.toContain('SECRET-QTOK');
    expect(snap).not.toContain('ab12');
    expect(snap).toContain('status=0');
    window.fetch = originalFetch;
  });

  it('卸载后 console 恢复原样', () => {
    const original = console.warn;
    const u = installFaultCapture();
    expect(console.warn).not.toBe(original);
    u();
    expect(console.warn).toBe(original);
  });
});
