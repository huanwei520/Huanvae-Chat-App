/**
 * WS 回显认领（外部审计 idx=89 回归）
 *
 * 病灶：私聊 / 群聊两个 hook 都用 `prev.findIndex((m) => m.sendStatus === 'sending')`
 * 认领「自己发的」WS 回显。`prev` 是 **[新→旧]**、乐观消息 `[temp, ...prev]` 压进去
 * ⇒ findIndex 取到的是**最新插入**的那条，与本次回显毫无对应关系。
 * 连发 A、B 两条 ⇒ 列表 `[B(sending), A(sending)]`；A 的回显先到 ⇒ A 的 uuid 写进了 B。
 * 随后 A 的 HTTP 响应按 clientId 命中 A 也写同一个 uuid ⇒ 两条共享一个 message_uuid
 * ⇒ ChatMessages 的 `seen.has(message_uuid)` 去重把后一条整个滤掉 ⇒ B 从界面消失。
 *
 * ① 行为测试：真调 `pickSendingEchoIndex`。
 * ② 接线扫描：两个 hook 都必须用它，且不得再出现旧的 findIndex 形态。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickSendingEchoIndex } from '../../src/chat/shared/wsEchoClaim';

const FRIEND_SRC = readFileSync(
  resolve(__dirname, '../../src/chat/friend/useLocalFriendMessages.ts'),
  'utf-8',
);
const GROUP_SRC = readFileSync(
  resolve(__dirname, '../../src/chat/group/useLocalGroupMessages.ts'),
  'utf-8',
);

const sending = (content: string, type = 'text') => ({
  message_content: content,
  message_type: type,
  sendStatus: 'sending' as const,
});
const sent = (content: string, type = 'text') => ({
  message_content: content,
  message_type: type,
  sendStatus: 'sent' as const,
});

describe('① pickSendingEchoIndex 行为', () => {
  it('🔴 连发 A、B 后 A 的回显先到 ⇒ 认领 A（不是数组头部的 B）', () => {
    // [新→旧]：B 后发在前
    const list = [sending('B'), sending('A')];
    expect(pickSendingEchoIndex(list, { content: 'A', message_type: 'text' })).toBe(1);
  });

  it('B 的回显到 ⇒ 认领 B', () => {
    const list = [sending('B'), sending('A')];
    expect(pickSendingEchoIndex(list, { content: 'B', message_type: 'text' })).toBe(0);
  });

  it('正文相同的两条 ⇒ 取最早发出的那条（数组尾部）', () => {
    const list = [sending('同一句'), sending('同一句')];
    expect(pickSendingEchoIndex(list, { content: '同一句', message_type: 'text' })).toBe(1);
  });

  it('正文相同但类型不同 ⇒ 只认类型也对上的那条', () => {
    const list = [sending('x.png', 'image'), sending('x.png', 'text')];
    expect(pickSendingEchoIndex(list, { content: 'x.png', message_type: 'text' })).toBe(1);
    expect(pickSendingEchoIndex(list, { content: 'x.png', message_type: 'image' })).toBe(0);
  });

  it('正文对不上（媒体本地正文与服务端派生正文不同形）⇒ 退回最早的在途项，而不是最新那条', () => {
    const list = [sending('B'), sending('A')];
    expect(pickSendingEchoIndex(list, { content: '服务端改写过的正文', message_type: 'text' })).toBe(1);
  });

  it('一条在途消息都没有 ⇒ -1（调用方据此走「新消息」分支）', () => {
    expect(pickSendingEchoIndex([sent('A'), sent('B')], { content: 'A', message_type: 'text' })).toBe(-1);
    expect(pickSendingEchoIndex([], { content: 'A', message_type: 'text' })).toBe(-1);
  });

  it('已 sent 的同正文消息不会被误认领（只认 sending）', () => {
    const list = [sent('A'), sending('A')];
    expect(pickSendingEchoIndex(list, { content: 'A', message_type: 'text' })).toBe(1);
  });
});

describe('② 两个 hook 都接到共享认领（接线扫描）', () => {
  for (const [label, SRC] of [['friend', FRIEND_SRC], ['group', GROUP_SRC]] as const) {
    it(`${label} hook 用 pickSendingEchoIndex`, () => {
      expect(SRC).toMatch(/import \{ pickSendingEchoIndex \} from '\.\.\/shared\/wsEchoClaim';/);
      expect(SRC).toMatch(/const sendingIndex = pickSendingEchoIndex\(prev, \{/);
    });

    it(`${label} hook 不得再出现「抓第一个 sending」的旧形态`, () => {
      expect(SRC).not.toMatch(/findIndex\(\(m\) => m\.sendStatus === 'sending'\)/);
    });
  }
});
