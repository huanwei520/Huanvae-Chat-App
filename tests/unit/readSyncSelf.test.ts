/**
 * read_sync 自读消费测试（L2：jsdom + mock db，驱动 handleWebSocketMessage）
 *
 * 缺陷①（红点顽固）的多端侧根因回归（P5）：本人其他设备 mark_read 后，后端会向本机推
 * read_sync（reader_id = 自己，source_id = 接收者视角的会话对端，带 seq）。原实现只转发给
 * 回执监听器，不清 summary 不推本地读位 → 别端读过的会话本机红点顽固到下次重连。
 *
 * 契约：
 * - reader == 本人：advance（带显式 seq）+ 内存 Map 写穿 + summary 条目按规则清 0；
 *   seq >= 本地该会话 last_seq → 清 0；否则不动（留给下次 connected 纠正）。绝不增加/负数。
 * - reader == 他人：只转发回执监听器，summary/读位不动（原行为保留）。
 * - 两种情况都必须继续转发给回执监听器（已读回执显示不被破坏）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import type { UnreadSummary, WsReadSync } from '../../src/types/websocket';

const mockDb = vi.hoisted(() => ({
  advanceConversationRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);
vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn().mockResolvedValue(undefined),
}));

import { handleWebSocketMessage, type MessageHandlerContext } from '../../src/contexts/wsHandlers';
import {
  seedReadPositions,
  resetReadPositions,
  getReadPosition,
} from '../../src/contexts/readPositions';
import { getFriendConversationId } from '../../src/utils/conversationId';

const ME = 'me';
const FRIEND = 'friendF';
const GROUP = 'group-1';
const FRIEND_CONV = getFriendConversationId(ME, FRIEND);

function makeHarness(initial: UnreadSummary) {
  let state: UnreadSummary | null = initial;
  const setUnreadSummary = vi.fn((action: React.SetStateAction<UnreadSummary | null>) => {
    state = typeof action === 'function'
      ? (action as (prev: UnreadSummary | null) => UnreadSummary | null)(state)
      : action;
  });
  const readSyncReceived: WsReadSync[] = [];
  const ctx = {
    activeChatRef: { current: null },
    currentUserId: ME,
    setUnreadSummary,
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set() },
    recalledListeners: { current: new Set() },
    notificationListeners: { current: new Set() },
    readSyncListeners: { current: new Set([(msg: WsReadSync) => readSyncReceived.push(msg)]) },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  } as unknown as MessageHandlerContext;
  return { ctx, getState: () => state, setUnreadSummary, readSyncReceived };
}

function readSyncFrame(over: Partial<WsReadSync>): string {
  return JSON.stringify({
    type: 'read_sync',
    source_type: 'friend',
    source_id: FRIEND,
    reader_id: ME,
    read_at: '2026-06-10T00:00:00Z',
    seq: 8,
    ...over,
  });
}

const summaryWith = (friendUnread: number, groupUnread: number): UnreadSummary => ({
  total_count: friendUnread + groupUnread,
  friend_unreads: [{
    friend_id: FRIEND,
    unread_count: friendUnread,
    last_message_preview: 'p',
    last_message_time: '2026-06-10T00:00:00Z',
  }],
  group_unreads: [{
    group_id: GROUP,
    unread_count: groupUnread,
    last_message_preview: 'g',
    last_message_time: '2026-06-10T00:00:00Z',
  }],
});

describe('read_sync reader==self - 多端自读消费', () => {
  beforeEach(() => {
    resetReadPositions();
    mockDb.advanceConversationRead.mockClear();
  });

  it('私聊 seq >= 本地 last_seq → advance(convId, seq) + Map 写穿 + summary 清 0 + 仍转发回执', () => {
    seedReadPositions([{ id: FRIEND_CONV, last_seq: 8, last_read_seq: 5 }]);
    const h = makeHarness(summaryWith(3, 2));

    handleWebSocketMessage(readSyncFrame({ seq: 8 }), h.ctx);

    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(FRIEND_CONV, 8);
    expect(getReadPosition(FRIEND_CONV)).toEqual({ last_seq: 8, last_read_seq: 8 });
    expect(h.getState()?.friend_unreads[0].unread_count).toBe(0);
    expect(h.getState()?.group_unreads[0].unread_count).toBe(2); // 别的会话不动
    expect(h.getState()?.total_count).toBe(2);
    expect(h.readSyncReceived).toHaveLength(1); // 回执转发保留
  });

  it('私聊 seq < 本地 last_seq（别端没读到本地最新）→ advance 照做但 summary 不动', () => {
    seedReadPositions([{ id: FRIEND_CONV, last_seq: 8, last_read_seq: 5 }]);
    const h = makeHarness(summaryWith(3, 0));

    handleWebSocketMessage(readSyncFrame({ seq: 6 }), h.ctx);

    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(FRIEND_CONV, 6);
    // Map 只推进 last_read_seq 到显式读位 6，不越权标到本地最新 8
    expect(getReadPosition(FRIEND_CONV)).toEqual({ last_seq: 8, last_read_seq: 6 });
    expect(h.setUnreadSummary).not.toHaveBeenCalled();
    expect(h.getState()?.friend_unreads[0].unread_count).toBe(3);
    expect(h.readSyncReceived).toHaveLength(1);
  });

  it('群聊 seq >= 本地 last_seq → 用 group_id 做会话 id，summary 群条目清 0', () => {
    seedReadPositions([{ id: GROUP, last_seq: 4, last_read_seq: 1 }]);
    const h = makeHarness(summaryWith(3, 5));

    handleWebSocketMessage(readSyncFrame({ source_type: 'group', source_id: GROUP, seq: 4 }), h.ctx);

    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(GROUP, 4);
    expect(h.getState()?.group_unreads[0].unread_count).toBe(0);
    expect(h.getState()?.friend_unreads[0].unread_count).toBe(3);
    expect(h.getState()?.total_count).toBe(3);
  });

  it('本地无该会话读位记录 → advance 照做（持久化），summary 不动（无从判定，留给 connected 纠正）', () => {
    const h = makeHarness(summaryWith(3, 0));

    handleWebSocketMessage(readSyncFrame({ seq: 8 }), h.ctx);

    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(FRIEND_CONV, 8);
    expect(h.setUnreadSummary).not.toHaveBeenCalled();
    expect(h.getState()?.friend_unreads[0].unread_count).toBe(3);
  });

  it('reader == 他人（对方读了我的消息）→ 只转发回执：不 advance、summary 不动', () => {
    seedReadPositions([{ id: FRIEND_CONV, last_seq: 8, last_read_seq: 5 }]);
    const h = makeHarness(summaryWith(3, 0));

    handleWebSocketMessage(readSyncFrame({ reader_id: FRIEND, source_id: ME, seq: 99 }), h.ctx);

    expect(mockDb.advanceConversationRead).not.toHaveBeenCalled();
    expect(h.setUnreadSummary).not.toHaveBeenCalled();
    expect(getReadPosition(FRIEND_CONV)).toEqual({ last_seq: 8, last_read_seq: 5 });
    expect(h.readSyncReceived).toHaveLength(1);
    expect(h.readSyncReceived[0].seq).toBe(99);
  });

  it('reader == self 但帧无 seq → 不消费（无从定位读位），只转发回执', () => {
    seedReadPositions([{ id: FRIEND_CONV, last_seq: 8, last_read_seq: 5 }]);
    const h = makeHarness(summaryWith(3, 0));

    handleWebSocketMessage(readSyncFrame({ seq: undefined }), h.ctx);

    expect(mockDb.advanceConversationRead).not.toHaveBeenCalled();
    expect(h.setUnreadSummary).not.toHaveBeenCalled();
    expect(h.readSyncReceived).toHaveLength(1);
  });
});
