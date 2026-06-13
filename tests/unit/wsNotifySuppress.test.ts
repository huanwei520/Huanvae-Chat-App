/**
 * handleWebSocketMessage — 折叠发送者系统通知抑制集成测试（M2 接线）
 *
 * 纯函数 isGroupSenderFolded 的单测无法覆盖「接线」：守卫取反、漏掉 source_type==='group'
 * 作用域、或两个同形参数（groupBlocks / friendBlacklistTimes）传反，纯函数测试都照样过。
 * 本测试驱动真实 handleWebSocketMessage、mock notifyNewMessage，断言：
 *  - 群内折叠发送者（D6 屏蔽 / 拉黑后发）→ 不弹通知，但消息仍入库（仅抑制通知）
 *  - 群内未折叠发送者 → 正常弹通知
 *  - 私聊消息即使发送者在 friendBlacklistTimes（异常）也弹通知（抑制仅作用于群）
 *  - 自己发的消息 → 不弹（own 守卫不被破坏）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMock = vi.hoisted(() => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);
const notifMock = vi.hoisted(() => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn(),
}));
vi.mock('../../src/services/notificationService', () => notifMock);

import { handleWebSocketMessage } from '../../src/contexts/wsHandlers';
import { useChatStore } from '../../src/stores/chatStore';

function makeCtx() {
  return {
    activeChatRef: { current: null },
    currentUserId: 'me',
    setUnreadSummary: vi.fn(),
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set() },
    recalledListeners: { current: new Set() },
    notificationListeners: { current: new Set() },
    readSyncListeners: { current: new Set() },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  } as never;
}

function groupMsg(senderId = 'u2', timestamp = '2026-02-02T00:00:00Z') {
  return JSON.stringify({
    type: 'new_message', source_type: 'group', source_id: 'g-1', message_uuid: 'm1',
    sender_id: senderId, sender_nickname: 'Bob', content: 'hi', message_type: 'text',
    seq: 5, timestamp,
  });
}
function friendMsg(senderId = 'f2') {
  return JSON.stringify({
    type: 'new_message', source_type: 'friend', source_id: senderId, message_uuid: 'm2',
    sender_id: senderId, sender_nickname: 'Al', content: 'hi', message_type: 'text',
    seq: 5, timestamp: '2026-02-02T00:00:00Z',
  });
}

describe('handleWebSocketMessage — 折叠发送者通知抑制 (M2)', () => {
  beforeEach(() => {
    dbMock.saveMessage.mockClear();
    notifMock.notifyNewMessage.mockClear();
    useChatStore.setState({ groupMessageBlocks: {}, friendBlacklistTimes: {}, groupSpecialCares: {}, friends: [] });
  });

  it('群: 发送者被 D6 屏蔽 → 不弹通知，但消息仍入库（仅抑制通知）', () => {
    useChatStore.setState({ groupMessageBlocks: { 'g-1': ['u2'] } });
    handleWebSocketMessage(groupMsg('u2'), makeCtx());
    expect(notifMock.notifyNewMessage).not.toHaveBeenCalled();
    expect(dbMock.saveMessage).toHaveBeenCalledTimes(1);
  });

  it('群: 发送者被拉黑(消息发于拉黑后) → 不弹通知', () => {
    useChatStore.setState({ friendBlacklistTimes: { u2: '2026-02-01T00:00:00Z' } });
    handleWebSocketMessage(groupMsg('u2', '2026-02-02T00:00:00Z'), makeCtx());
    expect(notifMock.notifyNewMessage).not.toHaveBeenCalled();
  });

  it('群: 拉黑发送者但消息发于拉黑之前 → 仍弹通知（拉黑前历史不折叠）', () => {
    useChatStore.setState({ friendBlacklistTimes: { u2: '2026-02-01T00:00:00Z' } });
    handleWebSocketMessage(groupMsg('u2', '2026-01-31T00:00:00Z'), makeCtx());
    expect(notifMock.notifyNewMessage).toHaveBeenCalledTimes(1);
  });

  it('群: 未折叠发送者 → 正常弹通知', () => {
    handleWebSocketMessage(groupMsg('u9'), makeCtx());
    expect(notifMock.notifyNewMessage).toHaveBeenCalledTimes(1);
  });

  it('私聊: 发送者在 friendBlacklistTimes(异常) 也弹通知（抑制仅作用于群，不破坏私聊路径）', () => {
    useChatStore.setState({ friendBlacklistTimes: { f2: '2026-01-01T00:00:00Z' } });
    handleWebSocketMessage(friendMsg('f2'), makeCtx());
    expect(notifMock.notifyNewMessage).toHaveBeenCalledTimes(1);
  });

  it('自己发的群消息 → 不弹通知（own 守卫保持）', () => {
    handleWebSocketMessage(groupMsg('me'), makeCtx());
    expect(notifMock.notifyNewMessage).not.toHaveBeenCalled();
  });
});
