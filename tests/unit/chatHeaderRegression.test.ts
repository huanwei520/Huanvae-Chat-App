/**
 * 聊天顶栏「切会话闪自己昵称」回归（静态扫描）
 *
 * 该 bug 的机器可复查不变量：
 * 1. 顶栏标题取自 chatTarget（对方），从不取 session 自己昵称 —— getChatTitle 私聊分支
 *    只用 friendDisplayName(chatTarget.data)（远比在顶栏加 self 兜底安全）。
 * 2. EmptyChat（唯一渲染自己昵称的欢迎页）退场必须瞬时（transition duration 0），
 *    否则选中会话时（AnimatePresence mode="wait"）其自己昵称徽章会在顶部残留一瞬。
 *
 * 用 __dirname 读源码（vitest 下 import.meta.url 非 file scheme；tests/ 不入门禁 lint）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../src/chat/shared/ChatPanel.tsx'), 'utf-8');

describe('ChatPanel 顶栏标题数据源 + 空态退场（名字闪 bug 回归）', () => {
  it('顶栏标题来自 getChatTitle(chatTarget)，非自己昵称', () => {
    expect(SRC).toMatch(/<h2>\{getChatTitle\(chatTarget\)\}<\/h2>/);
  });

  it('getChatTitle 私聊分支用对方 friendDisplayName(chatTarget.data)，无 self 兜底', () => {
    expect(SRC).toMatch(/friendDisplayName\(chatTarget\.data\)/);
  });

  it('EmptyChat 退场瞬时（transition duration 0），避免自己昵称残留', () => {
    expect(SRC).toMatch(/exit=\{\{\s*opacity:\s*0,\s*transition:\s*\{\s*duration:\s*0\s*\}\s*\}\}/);
  });
});
