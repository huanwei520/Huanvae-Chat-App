/**
 * connected 时序契约测试（L2：jsdom + mock db，驱动 handleWebSocketMessage）
 *
 * 缺陷②（登录后列表抽搐）的 WS 侧根因回归：connected 三段式
 * 「同步 setUnreadSummary(快照基线 unread>0) → 异步读 db → merge 清零」产生
 * 基线(上移)→清零(下移)的 V 型翻转，被卡片 layout 动画放大成抽搐。
 *
 * 契约：
 * (i) 读位内存 Map 已载入 → connected 一步 setUnreadSummary（已纠正的终值），
 *     任一会话不出现 unread >0 → 0 的纠正翻转中间态（无 V 型）；
 * (ii) Map 未载入（冷启动竞态）→ 维持两段式现行为（同步基线 + 异步 functional merge），
 *     并把 db 快照灌入 Map（下次 connected 走同步路径）。
 * 两条路径都回传 resync_read_positions，且 connected 后执行 activeChat 兜底标读 + 补发暂存 mark_read。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import type { UnreadSummary } from '../../src/types/websocket';

const mockDb = vi.hoisted(() => ({
  getConversations: vi.fn(),
  // new_message 的异步落库链（saveMessageToLocal）会触达，仅消音，不在本文件断言
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
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
  isReadPositionsLoaded,
} from '../../src/contexts/readPositions';
import { getFriendConversationId } from '../../src/utils/conversationId';

const ME = 'me';
const convOf = (friendId: string) => getFriendConversationId(ME, friendId);

function makeFriend(id: string, count: number) {
  return {
    friend_id: id,
    unread_count: count,
    last_message_preview: `f-${id}`,
    last_message_time: '2026-06-10T00:00:00Z',
  };
}

/** 模拟 React state：记录每次 setUnreadSummary 后的可见状态序列 */
function makeCtx() {
  let state: UnreadSummary | null = null;
  const states: Array<UnreadSummary | null> = [];
  const setUnreadSummary = vi.fn((action: React.SetStateAction<UnreadSummary | null>) => {
    state = typeof action === 'function'
      ? (action as (prev: UnreadSummary | null) => UnreadSummary | null)(state)
      : action;
    states.push(state);
  });
  const sendResyncReadPositions = vi.fn();
  const flushPendingMarkReads = vi.fn();
  const markActiveChatRead = vi.fn();

  const ctx = {
    activeChatRef: { current: null },
    currentUserId: ME,
    setUnreadSummary,
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set() },
    recalledListeners: { current: new Set() },
    notificationListeners: { current: new Set() },
    readSyncListeners: { current: new Set() },
    sendResyncReadPositions,
    flushPendingMarkReads,
    markActiveChatRead,
  } as unknown as MessageHandlerContext;

  return {
    ctx,
    states,
    getState: () => state,
    setUnreadSummary,
    sendResyncReadPositions,
    flushPendingMarkReads,
    markActiveChatRead,
  };
}

/** 某好友会话在状态序列中的 unread 轨迹（跳过 null 状态与缺条目的状态） */
function unreadSeries(states: Array<UnreadSummary | null>, friendId: string): number[] {
  const series: number[] = [];
  for (const s of states) {
    const entry = s?.friend_unreads.find(u => u.friend_id === friendId);
    if (entry) {
      series.push(entry.unread_count);
    }
  }
  return series;
}

/** V 型 = 出现过 >0，随后被纠正为 0，之后又 >0 */
function hasVShape(series: number[]): boolean {
  let sawPositive = false;
  let correctedToZero = false;
  for (const v of series) {
    if (v > 0 && correctedToZero) { return true; }
    if (v > 0) { sawPositive = true; }
    if (v === 0 && sawPositive) { correctedToZero = true; }
  }
  return false;
}

function connectedFrame(summary: UnreadSummary): string {
  return JSON.stringify({ type: 'connected', unread_summary: summary, session_id: 's1' });
}

const flushMicrotasks = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

describe('connected 时序契约 - 读位已载入走同步一步纠正（无 V 型）', () => {
  beforeEach(() => {
    resetReadPositions();
    mockDb.getConversations.mockReset();
  });

  it('已载入：一步 setUnreadSummary 输出纠正终值，已读会话不经历 >0 中间态，不读 db', async () => {
    // A 本地已读到最新(7/7)、B 未读完(9/6)
    seedReadPositions([
      { id: convOf('A'), last_seq: 7, last_read_seq: 7 },
      { id: convOf('B'), last_seq: 9, last_read_seq: 6 },
    ]);
    const harness = makeCtx();

    const snapshot: UnreadSummary = {
      total_count: 8,
      friend_unreads: [makeFriend('A', 5), makeFriend('B', 3)],
      group_unreads: [],
    };
    handleWebSocketMessage(connectedFrame(snapshot), harness.ctx);

    // 一步到位：仅 1 次 setState，A 直接 0（从未以 >0 可见）、B 保留 3
    expect(harness.setUnreadSummary).toHaveBeenCalledTimes(1);
    expect(unreadSeries(harness.states, 'A')).toEqual([0]);
    expect(unreadSeries(harness.states, 'B')).toEqual([3]);
    expect(harness.getState()?.total_count).toBe(3);

    // resync 仍回传（A 已读位置）
    expect(harness.sendResyncReadPositions).toHaveBeenCalledWith([
      { target_type: 'friend', target_id: 'A', last_read_seq: 7 },
    ]);

    // 同步路径不再读 db；flush 微任务后也没有第二次 setState（无异步纠正尾巴）
    await flushMicrotasks();
    expect(mockDb.getConversations).not.toHaveBeenCalled();
    expect(harness.setUnreadSummary).toHaveBeenCalledTimes(1);
  });

  it('已载入：connected 后补发的 new_message 在纠正终值上叠加，全程无 V 型', async () => {
    seedReadPositions([{ id: convOf('A'), last_seq: 7, last_read_seq: 7 }]);
    const harness = makeCtx();

    handleWebSocketMessage(connectedFrame({
      total_count: 5,
      friend_unreads: [makeFriend('A', 5)],
      group_unreads: [],
    }), harness.ctx);

    // 登录补发：A 来了一条真新消息
    handleWebSocketMessage(JSON.stringify({
      type: 'new_message',
      source_type: 'friend',
      source_id: 'A',
      message_uuid: 'u-8',
      sender_id: 'A',
      sender_nickname: 'A',
      content: 'hi',
      message_type: 'text',
      seq: 8,
      timestamp: '2026-06-10T00:01:00Z',
    }), harness.ctx);

    await flushMicrotasks();
    // 轨迹：0（纠正终值）→ 1（真实新未读），无 >0→0→>0 翻转
    expect(unreadSeries(harness.states, 'A')).toEqual([0, 1]);
    expect(hasVShape(unreadSeries(harness.states, 'A'))).toBe(false);
  });

  it('connected 后执行 activeChat 兜底标读 + 补发暂存 mark_read（两条路径都触发）', () => {
    seedReadPositions([{ id: convOf('A'), last_seq: 7, last_read_seq: 7 }]);
    const harness = makeCtx();
    handleWebSocketMessage(connectedFrame({
      total_count: 0, friend_unreads: [], group_unreads: [],
    }), harness.ctx);
    expect(harness.markActiveChatRead).toHaveBeenCalledTimes(1);
    expect(harness.flushPendingMarkReads).toHaveBeenCalledTimes(1);
  });
});

describe('connected 时序契约 - 读位未载入维持两段式（不回退现行为）', () => {
  beforeEach(() => {
    resetReadPositions();
    mockDb.getConversations.mockReset();
  });

  it('未载入：先同步立基线（快照原值可见），异步 merge 后纠正，且 db 快照灌入 Map', async () => {
    expect(isReadPositionsLoaded()).toBe(false);
    mockDb.getConversations.mockResolvedValue([
      { id: convOf('A'), last_seq: 7, last_read_seq: 7 },
      { id: convOf('B'), last_seq: 9, last_read_seq: 6 },
    ]);
    const harness = makeCtx();

    const snapshot: UnreadSummary = {
      total_count: 8,
      friend_unreads: [makeFriend('A', 5), makeFriend('B', 3)],
      group_unreads: [],
    };
    handleWebSocketMessage(connectedFrame(snapshot), harness.ctx);

    // 第一段：同步基线 = 服务端快照原值
    expect(harness.setUnreadSummary).toHaveBeenCalledTimes(1);
    expect(unreadSeries(harness.states, 'A')).toEqual([5]);

    await flushMicrotasks();

    // 第二段：异步 merge 把本地已读的 A 清 0，B 保留；并回传 resync
    expect(harness.setUnreadSummary).toHaveBeenCalledTimes(2);
    expect(unreadSeries(harness.states, 'A')).toEqual([5, 0]);
    expect(unreadSeries(harness.states, 'B')).toEqual([3, 3]);
    expect(harness.sendResyncReadPositions).toHaveBeenCalledWith([
      { target_type: 'friend', target_id: 'A', last_read_seq: 7 },
    ]);

    // 兜底路径顺手灌入 Map：下次 connected 走同步一步路径
    expect(isReadPositionsLoaded()).toBe(true);
    expect(harness.markActiveChatRead).toHaveBeenCalledTimes(1);
    expect(harness.flushPendingMarkReads).toHaveBeenCalledTimes(1);
  });
});
