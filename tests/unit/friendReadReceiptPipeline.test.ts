/**
 * useFriendReadReceipt 已读管线测试（L2：jsdom + mock 上下文/db/syncService，真 chatStore）
 *
 * 重构契约（F4）：私聊已读位置并入消息同步管线，根除进会话"清 0 → 异步拉取 → 弹入"两阶段闪。
 * - 懒初始化读 chatStore 内存镜像（二开首帧非空，不清 0）；
 * - mount 异步读本地 conversations.peer_last_read_seq 校准（单调 max）；
 * - sync 快照转发（subscribeReadPositions，friend）→ 校准 + 落库；
 * - WS friend read_sync（reader===friendId）→ 校准 + 落库；
 * - 原独立端点 GET /api/messages/{friend_id}/read-positions 已删除（消费方不再调）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { WsReadSync } from '../../src/types/websocket';
import type { ConversationReadPositions } from '../../src/services/syncService';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useWebSocket: vi.fn(),
  getConversationPeerReadSeq: vi.fn(),
  setConversationPeerReadSeq: vi.fn(),
  subscribeReadPositions: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({ useSession: mocks.useSession }));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: mocks.useWebSocket }));
vi.mock('../../src/db', () => ({
  getConversationPeerReadSeq: mocks.getConversationPeerReadSeq,
  setConversationPeerReadSeq: mocks.setConversationPeerReadSeq,
}));
vi.mock('../../src/services/syncService', () => ({ subscribeReadPositions: mocks.subscribeReadPositions }));

import { useFriendReadReceipt } from '../../src/chat/friend/useFriendReadReceipt';
import { getFriendConversationId } from '../../src/utils/conversationId';
import { useChatStore } from '../../src/stores/chatStore';

const ME = 'me';
const FRIEND = 'friendF';
const CONV = getFriendConversationId(ME, FRIEND);

let onReadSyncCb: ((msg: WsReadSync) => void) | null = null;
let syncListener: ((p: ConversationReadPositions) => void) | null = null;

beforeEach(() => {
  mocks.useSession.mockReturnValue({ session: { userId: ME } });
  onReadSyncCb = null;
  mocks.useWebSocket.mockReturnValue({
    onReadSync: (cb: (msg: WsReadSync) => void) => {
      onReadSyncCb = cb;
      return () => { onReadSyncCb = null; };
    },
  });
  mocks.getConversationPeerReadSeq.mockResolvedValue(0);
  mocks.setConversationPeerReadSeq.mockResolvedValue(undefined);
  syncListener = null;
  mocks.subscribeReadPositions.mockImplementation((cb: (p: ConversationReadPositions) => void) => {
    syncListener = cb;
    return () => { syncListener = null; };
  });
  // 清空真 chatStore 镜像
  useChatStore.getState().clearMessageCache();
});

function friendReadSync(over: Partial<WsReadSync>): WsReadSync {
  return {
    type: 'read_sync',
    source_type: 'friend',
    source_id: ME,
    reader_id: FRIEND,
    read_at: '2026-07-08T00:00:00Z',
    seq: 10,
    ...over,
  };
}

describe('useFriendReadReceipt 已读管线', () => {
  it('懒初始化从 chatStore 镜像取值（二开首帧非空，不清 0）', async () => {
    useChatStore.getState().cacheFriendReadPositions(CONV, 42);

    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));

    // 首帧同步即为镜像值 42（非 0）
    expect(result.current.peerLastReadSeq).toBe(42);

    // db 校准返回更低值（0）也不回退（单调 max）
    await waitFor(() => expect(mocks.getConversationPeerReadSeq).toHaveBeenCalledWith(CONV));
    expect(result.current.peerLastReadSeq).toBe(42);
  });

  it('镜像空时从本地 db 校准（getConversationPeerReadSeq）', async () => {
    mocks.getConversationPeerReadSeq.mockResolvedValue(55);

    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));

    await waitFor(() => expect(result.current.peerLastReadSeq).toBe(55));
  });

  it('sync 快照转发（friend）→ 校准 peer + 落库', async () => {
    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));
    await waitFor(() => expect(mocks.subscribeReadPositions).toHaveBeenCalled());

    act(() => {
      syncListener?.({
        type: 'friend',
        conversationId: CONV,
        data: { my_last_read_seq: 100, peer_last_read_seq: 77 },
      });
    });

    expect(result.current.peerLastReadSeq).toBe(77);
    expect(mocks.setConversationPeerReadSeq).toHaveBeenCalledWith(CONV, 77);
  });

  it('sync 快照针对别的会话 → 忽略', async () => {
    useChatStore.getState().cacheFriendReadPositions(CONV, 5);
    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));
    await waitFor(() => expect(mocks.subscribeReadPositions).toHaveBeenCalled());

    act(() => {
      syncListener?.({
        type: 'friend',
        conversationId: 'conv-other-xyz',
        data: { my_last_read_seq: 1, peer_last_read_seq: 999 },
      });
    });

    expect(result.current.peerLastReadSeq).toBe(5);
    expect(mocks.setConversationPeerReadSeq).not.toHaveBeenCalled();
  });

  it('WS read_sync（reader===friendId）→ 校准 + 落库（只增不减）', async () => {
    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));
    await waitFor(() => expect(onReadSyncCb).not.toBeNull());

    act(() => onReadSyncCb?.(friendReadSync({ seq: 88 })));

    expect(result.current.peerLastReadSeq).toBe(88);
    expect(mocks.setConversationPeerReadSeq).toHaveBeenCalledWith(CONV, 88);

    // 更低的 seq 不回退
    act(() => onReadSyncCb?.(friendReadSync({ seq: 50 })));
    expect(result.current.peerLastReadSeq).toBe(88);
  });

  it('WS read_sync reader 为自己（非对方）→ 不动 peer', async () => {
    const { result } = renderHook(() => useFriendReadReceipt(FRIEND));
    await waitFor(() => expect(onReadSyncCb).not.toBeNull());

    act(() => onReadSyncCb?.(friendReadSync({ reader_id: ME, seq: 999 })));

    expect(result.current.peerLastReadSeq).toBe(0);
  });

  it('unmount 把当前 peer 写回镜像（供二开秒取）', async () => {
    mocks.getConversationPeerReadSeq.mockResolvedValue(33);
    const { unmount } = renderHook(() => useFriendReadReceipt(FRIEND));
    await waitFor(() =>
      expect(useChatStore.getState()).toBeDefined(),
    );
    // 等 db 校准到 33
    await waitFor(() => expect(mocks.getConversationPeerReadSeq).toHaveBeenCalled());

    unmount();

    expect(useChatStore.getState().cachedFriendReadPositions[CONV]).toBe(33);
  });
});

describe('404 消费方删除回归（GET /api/messages/{friend_id}/read-positions 已移除）', () => {
  const MESSAGES_API = readFileSync(resolve(__dirname, '../../src/api/messages.ts'), 'utf-8');
  const FRIEND_HOOK = readFileSync(
    resolve(__dirname, '../../src/chat/friend/useFriendReadReceipt.ts'),
    'utf-8',
  );

  it('api/messages.ts 不再导出 getFriendReadPositions / FriendReadPositionsResponse', () => {
    // 真正的回归守卫：函数与类型删除（说明性注释里可保留端点路径以记录"已移除"，不作断言）。
    expect(MESSAGES_API).not.toMatch(/export function getFriendReadPositions/);
    expect(MESSAGES_API).not.toMatch(/interface FriendReadPositionsResponse/);
    // 不得再有实际调用该端点的 api.get 语句
    expect(MESSAGES_API).not.toMatch(/api\.get<[^>]*>\(`\/api\/messages\/\$\{friendId\}\/read-positions`\)/);
  });

  it('useFriendReadReceipt 不再 import/调用 getFriendReadPositions，改订阅 sync 转发 + 读本地', () => {
    expect(FRIEND_HOOK).not.toMatch(/getFriendReadPositions/);
    expect(FRIEND_HOOK).toMatch(/subscribeReadPositions/);
    expect(FRIEND_HOOK).toMatch(/getConversationPeerReadSeq/);
  });
});
