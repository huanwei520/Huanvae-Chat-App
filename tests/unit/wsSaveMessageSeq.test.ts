/**
 * wsHandlers.saveMessageToLocal — seq 忠实持久化回归测试
 *
 * 锁定契约（后端 t83_user_blacklist + 私聊 seq 语义）：
 *   已送达消息 seq>=1；拉黑静默丢弃 seq=0 且只走 HTTP 响应、不产生任何 WS 事件。
 *   因此 WS 推送到达的消息必然是已送达的，保存到本地 DB 时必须忠实写入 msg.seq，
 *   绝不能把缺失/异常的 seq 强制成 0——seq=0 是 MessageBubble「未送达」红叹号的唯一信号，
 *   伪造 0 会让已送达消息（尤其多设备 WS 回显的自己的消息）误显「未送达」。
 *
 * 防回归对象：saveMessageToLocal 里 `seq: msg.seq` 不得退回 `seq: msg.seq || 0`。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WsNewMessage } from '../../src/types/websocket';

const dbMock = vi.hoisted(() => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db', () => dbMock);
vi.mock('../../src/utils/avatar', () => ({ resolveServerAvatarUrl: (u: string | null) => u ?? null }));
vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn(),
  notifySystemEvent: vi.fn(),
}));

import { saveMessageToLocal } from '../../src/contexts/wsHandlers';

function makeWsMessage(overrides: Partial<WsNewMessage> = {}): WsNewMessage {
  return {
    type: 'new_message',
    source_type: 'friend',
    source_id: 'them',
    message_uuid: 'uuid-1',
    sender_id: 'me',
    sender_nickname: 'Me',
    content: 'hello',
    message_type: 'text',
    seq: 5,
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('saveMessageToLocal — seq 忠实持久化', () => {
  beforeEach(() => {
    dbMock.saveMessage.mockClear();
    dbMock.updateConversationLastSeq.mockClear();
    dbMock.updateConversationLastMessage.mockClear();
  });

  it('正常 seq>=1 → 原样写入本地 DB', async () => {
    await saveMessageToLocal(makeWsMessage({ seq: 5 }), 'me');
    expect(dbMock.saveMessage).toHaveBeenCalledTimes(1);
    expect(dbMock.saveMessage.mock.calls[0][0].seq).toBe(5);
  });

  it('seq 缺失（异常 payload）→ 不得伪造成 0（否则会误显「未送达」红叹号）', async () => {
    // 模拟协议异常：payload 没带 seq（类型上 seq 必填，运行时仍可能缺失）
    const msg = makeWsMessage();
    delete (msg as { seq?: number }).seq;
    await saveMessageToLocal(msg, 'me');
    expect(dbMock.saveMessage).toHaveBeenCalledTimes(1);
    const savedSeq = dbMock.saveMessage.mock.calls[0][0].seq;
    expect(savedSeq).not.toBe(0); // 关键防回归：绝不能是 0
    expect(savedSeq).toBeUndefined();
  });

  it('seq 缺失时不更新会话 last_seq（避免把 0/undefined 当真实序号）', async () => {
    const msg = makeWsMessage();
    delete (msg as { seq?: number }).seq;
    await saveMessageToLocal(msg, 'me');
    expect(dbMock.updateConversationLastSeq).not.toHaveBeenCalled();
  });
});
