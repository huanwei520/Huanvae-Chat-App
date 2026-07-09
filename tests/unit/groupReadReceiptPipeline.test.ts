/**
 * useGroupReadReceipt 已读管线测试（L2：jsdom + mock 上下文/api/db/syncService/avatar，真 chatStore）
 *
 * 重构契约（F3）：群已读位置并入消息同步管线，根除进群"清空 → 独立首拉 → 弹入"两阶段闪。
 * - 懒初始化读 chatStore 内存镜像（二开首帧非空，不清空）；
 * - mount 异步读本地 group_read_positions 校准（member_count=行数）；
 * - sync 快照转发（subscribeReadPositions，group）→ applySnapshot 校准 + 落库；
 * - WS group read_sync → 推进成员位置 + 落库；
 * - avatar_url 经唯一收口 resolveServerAvatarUrl 解析（applySnapshot）；
 * - unmount 把当前已读态写回镜像。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { WsReadSync } from '../../src/types/websocket';
import type { ConversationReadPositions } from '../../src/services/syncService';
import type { GroupReadPositionRow } from '../../src/db';

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  useSession: vi.fn(),
  useWebSocket: vi.fn(),
  getGroupReadPositions: vi.fn(),
  dbGetGroupReadPositions: vi.fn(),
  dbUpsertGroupReadPositions: vi.fn(),
  dbReplaceGroupReadPositions: vi.fn(),
  subscribeReadPositions: vi.fn(),
  resolveServerAvatarUrl: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: mocks.useApi,
  useSession: mocks.useSession,
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: mocks.useWebSocket }));
vi.mock('../../src/api/groups', () => ({ getGroupReadPositions: mocks.getGroupReadPositions }));
vi.mock('../../src/db', () => ({
  getGroupReadPositions: mocks.dbGetGroupReadPositions,
  upsertGroupReadPositions: mocks.dbUpsertGroupReadPositions,
  replaceGroupReadPositions: mocks.dbReplaceGroupReadPositions,
}));
vi.mock('../../src/services/syncService', () => ({ subscribeReadPositions: mocks.subscribeReadPositions }));
vi.mock('../../src/utils/avatar', () => ({ resolveServerAvatarUrl: mocks.resolveServerAvatarUrl }));

import { useGroupReadReceipt } from '../../src/chat/group/useGroupReadReceipt';
import type { GroupReaderInfo } from '../../src/chat/group/useGroupReadReceipt';
import { useChatStore } from '../../src/stores/chatStore';
import type { GroupMessage } from '../../src/api/groupMessages';

const GROUP = 'group-1';
const ME = 'me';

let onReadSyncCb: ((msg: WsReadSync) => void) | null = null;
let syncListener: ((p: ConversationReadPositions) => void) | null = null;

const noMessages: GroupMessage[] = [];

beforeEach(() => {
  mocks.useApi.mockReturnValue({});
  mocks.useSession.mockReturnValue({ session: { userId: ME } });
  onReadSyncCb = null;
  mocks.useWebSocket.mockReturnValue({
    onReadSync: (cb: (msg: WsReadSync) => void) => {
      onReadSyncCb = cb;
      return () => { onReadSyncCb = null; };
    },
  });
  mocks.getGroupReadPositions.mockResolvedValue({ positions: [], member_count: 0 });
  mocks.dbGetGroupReadPositions.mockResolvedValue([]);
  mocks.dbUpsertGroupReadPositions.mockResolvedValue(undefined);
  mocks.dbReplaceGroupReadPositions.mockResolvedValue(undefined);
  syncListener = null;
  mocks.subscribeReadPositions.mockImplementation((cb: (p: ConversationReadPositions) => void) => {
    syncListener = cb;
    return () => { syncListener = null; };
  });
  // 头像收口 mock：加前缀，便于断言"已解析值"
  mocks.resolveServerAvatarUrl.mockImplementation((s: string | null) => (s ? `proxy:${s}` : null));
  useChatStore.getState().clearMessageCache();
});

function seedMirror(
  positions: Record<string, number>,
  readerInfo: Record<string, GroupReaderInfo>,
  memberCount: number,
) {
  useChatStore.getState().cacheGroupReadPositions(GROUP, { positions, readerInfo, memberCount });
}

describe('useGroupReadReceipt 已读管线', () => {
  it('懒初始化从 chatStore 镜像取值（二开首帧非空，不清空）', () => {
    seedMirror(
      { alice: 5 },
      { alice: { displayName: 'Alice', avatarUrl: 'proxy:a.png', lastReadAt: '2026-07-08T10:00:00Z' } },
      3,
    );

    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));

    // 首帧同步即非空
    expect(result.current.memberCount).toBe(3);
    expect(result.current.countReaders(4, 'self')).toBe(1); // alice(5)>=4
    const readers = result.current.readersAt(4, 'self');
    expect(readers).toHaveLength(1);
    expect(readers[0].avatarUrl).toBe('proxy:a.png');
  });

  it('镜像空、db 返回空时 memberCount 保持 0，但不因 mount 清空既有镜像（不清空回归）', async () => {
    seedMirror({ bob: 9 }, { bob: { displayName: 'Bob', avatarUrl: null, lastReadAt: null } }, 4);
    // db 返回空 → 不应把已有 4 清成 0
    mocks.dbGetGroupReadPositions.mockResolvedValue([]);

    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    expect(result.current.memberCount).toBe(4);

    await waitFor(() => expect(mocks.dbGetGroupReadPositions).toHaveBeenCalledWith(GROUP));
    // db 空不覆盖既有镜像
    expect(result.current.memberCount).toBe(4);
    expect(result.current.countReaders(9, 'x')).toBe(1);
  });

  it('镜像空时从本地 db 校准（member_count = 行数）', async () => {
    const rows: GroupReadPositionRow[] = [
      { group_id: GROUP, user_id: 'bob', last_read_seq: 9, display_name: 'Bob', avatar_url: 'b.png', last_read_at: null },
      { group_id: GROUP, user_id: 'carol', last_read_seq: 12, display_name: 'Carol', avatar_url: null, last_read_at: null },
    ];
    mocks.dbGetGroupReadPositions.mockResolvedValue(rows);

    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));

    await waitFor(() => expect(result.current.memberCount).toBe(2));
    expect(result.current.countReaders(9, 'x')).toBe(2); // bob(9) carol(12)
    // db 原始 avatar_url 经收口解析
    expect(result.current.readersAt(9, 'x').find((r) => r.userId === 'bob')?.avatarUrl).toBe('proxy:b.png');
  });

  it('sync 快照转发（group）→ applySnapshot 校准 + 落库', async () => {
    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(mocks.subscribeReadPositions).toHaveBeenCalled());

    act(() => {
      syncListener?.({
        type: 'group',
        conversationId: GROUP,
        data: {
          positions: [
            { user_id: 'dave', last_read_seq: 20, display_name: 'Dave', avatar_url: 'd.png', last_read_at: '2026-07-08T11:00:00Z' },
          ],
          member_count: 6,
        },
      });
    });

    expect(result.current.memberCount).toBe(6);
    expect(result.current.countReaders(20, 'x')).toBe(1);
    expect(result.current.readersAt(20, 'x')[0].avatarUrl).toBe('proxy:d.png');
    // 权威快照走 replace（删幽灵行）落库（原始 avatar_url）
    expect(mocks.dbReplaceGroupReadPositions).toHaveBeenCalledWith(GROUP, [
      { group_id: GROUP, user_id: 'dave', last_read_seq: 20, display_name: 'Dave', avatar_url: 'd.png', last_read_at: '2026-07-08T11:00:00Z' },
    ]);
  });

  it('sync 权威快照 prune 退群幽灵（不在快照的成员被剔除，快照内成员取 max 不回退）', async () => {
    // 镜像里有 alice(读到 8) + ghost(读到 20，已退群)
    seedMirror(
      { alice: 8, ghost: 20 },
      {
        alice: { displayName: 'Alice', avatarUrl: null, lastReadAt: null },
        ghost: { displayName: 'Ghost', avatarUrl: null, lastReadAt: null },
      },
      3,
    );
    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(mocks.subscribeReadPositions).toHaveBeenCalled());
    // 初值：ghost 计入
    expect(result.current.countReaders(20, 'x')).toBe(1); // ghost(20)

    act(() => {
      syncListener?.({
        type: 'group',
        conversationId: GROUP,
        data: {
          // 权威快照只含 alice（ghost 已退群，不在其中）；alice 报较低的 5（滞后于本地 8）
          positions: [
            { user_id: 'alice', last_read_seq: 5, display_name: 'Alice', avatar_url: null, last_read_at: null },
          ],
          member_count: 4,
        },
      });
    });

    // ghost 被 prune → 不再计入
    expect(result.current.countReaders(20, 'x')).toBe(0);
    // alice 仍在（快照内），且取 max(本地8, 快照5)=8 不回退
    expect(result.current.countReaders(8, 'x')).toBe(1);
    expect(result.current.countReaders(6, 'x')).toBe(1);
    expect(result.current.memberCount).toBe(4); // 权威 member_count
    // 名单不含 ghost
    expect(result.current.readersAt(1, 'x').map((r) => r.userId)).toEqual(['alice']);
  });

  it('sync 快照针对别的群 → 忽略', async () => {
    seedMirror({ alice: 5 }, { alice: { displayName: 'Alice', avatarUrl: null, lastReadAt: null } }, 3);
    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(mocks.subscribeReadPositions).toHaveBeenCalled());

    act(() => {
      syncListener?.({
        type: 'group',
        conversationId: 'group-other',
        data: { positions: [{ user_id: 'x', last_read_seq: 99, display_name: 'X', avatar_url: null, last_read_at: null }], member_count: 9 },
      });
    });

    expect(result.current.memberCount).toBe(3);
    expect(mocks.dbUpsertGroupReadPositions).not.toHaveBeenCalled();
  });

  it('WS group read_sync → 推进成员位置（只增不减）+ 落库（身份传 null 供 COALESCE 保留）', async () => {
    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(onReadSyncCb).not.toBeNull());

    act(() =>
      onReadSyncCb?.({
        type: 'read_sync',
        source_type: 'group',
        source_id: GROUP,
        reader_id: 'eve',
        read_at: '2026-07-08T12:00:00Z',
        seq: 7,
      }),
    );

    expect(result.current.countReaders(7, 'x')).toBe(1);
    const calls = mocks.dbUpsertGroupReadPositions.mock.calls;
    const upsertCall = calls[calls.length - 1];
    expect(upsertCall?.[0]).toBe(GROUP);
    expect(upsertCall?.[1][0]).toMatchObject({
      group_id: GROUP,
      user_id: 'eve',
      last_read_seq: 7,
      display_name: null,
      avatar_url: null,
    });

    // 更低 seq 不回退
    act(() =>
      onReadSyncCb?.({
        type: 'read_sync', source_type: 'group', source_id: GROUP, reader_id: 'eve',
        read_at: '2026-07-08T12:01:00Z', seq: 3,
      }),
    );
    expect(result.current.countReaders(7, 'x')).toBe(1);
    expect(result.current.countReaders(8, 'x')).toBe(0);
  });

  it('WS read_sync 针对别的群 → 忽略', async () => {
    const { result } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(onReadSyncCb).not.toBeNull());

    act(() =>
      onReadSyncCb?.({
        type: 'read_sync', source_type: 'group', source_id: 'group-other', reader_id: 'zoe',
        read_at: '2026-07-08T12:00:00Z', seq: 50,
      }),
    );

    expect(result.current.countReaders(50, 'x')).toBe(0);
  });

  it('unmount 把当前已读态写回镜像（供二开秒取）', async () => {
    mocks.dbGetGroupReadPositions.mockResolvedValue([
      { group_id: GROUP, user_id: 'bob', last_read_seq: 9, display_name: 'Bob', avatar_url: 'b.png', last_read_at: null },
    ]);
    const { unmount } = renderHook(() => useGroupReadReceipt(GROUP, noMessages));
    await waitFor(() => expect(mocks.dbGetGroupReadPositions).toHaveBeenCalled());

    unmount();

    const mirror = useChatStore.getState().cachedGroupReadPositions[GROUP];
    expect(mirror).toBeDefined();
    expect(mirror.positions.bob).toBe(9);
    expect(mirror.memberCount).toBe(1);
    expect(mirror.readerInfo.bob.avatarUrl).toBe('proxy:b.png');
  });
});
