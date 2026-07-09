/**
 * useGroupReadReceipt Hook 行为测试（renderHook + fake timers 驱动 WS 去抖补拉机制）
 *
 * 补审计缺口：纯函数（countReadersAtSeq/readersAtSeq/...）已由 tests/unit/readReceipt.test.ts 覆盖；
 * 已读管线的 mount 懒初始化 / db 校准 / sync 转发 / 落库 / unmount 缓存由
 * tests/unit/groupReadReceiptPipeline.test.ts 覆盖。本文件聚焦 hook 本体的
 * 【WS 陌生读者去抖补拉 / 只增不减 merge / timer 清理 / isNewReader 门控】timer 路径。
 *
 * 已读管线重构后（F3）：进群不再独立首拉服务端快照（改读本地 db + sync 转发）；
 * 服务端 getGroupReadPositions **仅**由 scheduleSnapshotRefetch（WS 收到快照里没有的陌生读者）
 * 触发。故本文件用 db mock 作为 mount 的"已知读者"来源，server fetch 计数只统计去抖补拉。
 *
 * mock 说明：resolveServerAvatarUrl passthrough（头像解析由 tests/secure-display-routing.test.ts 静态守）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/** 服务端补拉（api/groups.getGroupReadPositions）—— 仅去抖补拉触发 */
const mockServerRefetch = vi.hoisted(() => vi.fn());
/** 本地 db 读（mount 懒校准来源，建立"已知读者"） */
const mockDbGet = vi.hoisted(() => vi.fn());
const mockDbUpsert = vi.hoisted(() => vi.fn());
// 稳定的 api / ws 引用：hook 的 useEffect deps 含 api/ws，返回新对象会导致每次 render 重订阅/重拉。
const apiState = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
const wsState = vi.hoisted(() => {
  const s = {
    cb: null as null | ((m: Record<string, unknown>) => void),
    unsub: vi.fn(),
    ws: null as unknown,
  };
  s.ws = {
    onReadSync: (cb: (m: Record<string, unknown>) => void) => {
      s.cb = cb;
      return s.unsub;
    },
  };
  return s;
});

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiState.api,
  useSession: () => ({ session: { userId: 'me' } }),
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => wsState.ws,
}));
vi.mock('../../src/api/groups', () => ({
  getGroupReadPositions: mockServerRefetch,
}));
vi.mock('../../src/db', () => ({
  getGroupReadPositions: mockDbGet,
  upsertGroupReadPositions: mockDbUpsert,
  replaceGroupReadPositions: mockDbUpsert,
}));
vi.mock('../../src/services/syncService', () => ({
  subscribeReadPositions: () => () => {},
}));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (u: string | null | undefined) => u ?? null,
}));

import { useGroupReadReceipt } from '../../src/chat/group/useGroupReadReceipt';
import { useChatStore } from '../../src/stores/chatStore';

/** 一个已读位置项（后端 snake_case 契约形状；db 行同形加 group_id） */
const pos = (userId: string, seq: number, groupId = 'g1') => ({
  group_id: groupId,
  user_id: userId,
  last_read_seq: seq,
  display_name: userId.toUpperCase(),
  avatar_url: null,
  last_read_at: null,
});

/** 服务端补拉快照形状（无 group_id） */
const serverSnapshot = (
  positions: Array<{ user_id: string; last_read_seq: number; display_name: string; avatar_url: string | null; last_read_at: string | null }>,
  memberCount: number,
) => ({ positions, member_count: memberCount });

/** WS group read_sync 帧 */
const readSync = (readerId: string, seq: number, groupId = 'g1') => ({
  source_type: 'group',
  source_id: groupId,
  reader_id: readerId,
  seq,
});

/** 推进所有 pending timer + 冲刷 microtask（setTimeout 回调内 await 了 mockResolved 的 Promise）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

/** 同步派发一帧 WS（触发 setState，需包 act）。 */
function fireReadSync(msg: Record<string, unknown>): void {
  act(() => {
    wsState.cb?.(msg);
  });
}

describe('useGroupReadReceipt（hook 行为：去抖补拉/merge/清理）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockServerRefetch.mockReset();
    mockDbGet.mockReset();
    mockDbGet.mockResolvedValue([]); // 默认本地无记录
    mockDbUpsert.mockReset();
    mockDbUpsert.mockResolvedValue(undefined);
    wsState.cb = null;
    wsState.unsub.mockReset();
    useChatStore.getState().clearMessageCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. 挂载读本地 db 建立初值，不独立首拉服务端快照', async () => {
    mockDbGet.mockResolvedValue([pos('u1', 5)]);
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    expect(mockDbGet).toHaveBeenCalledWith('g1');
    expect(mockServerRefetch).not.toHaveBeenCalled(); // mount 不拉服务端
    expect(result.current.memberCount).toBe(1); // member_count = db 行数
    expect(result.current.countReaders(5, 'sender')).toBe(1); // u1 读到 seq5
    expect(result.current.countReaders(6, 'sender')).toBe(0);
  });

  it('2. 多个未知读者 800ms 内 burst → 只补拉一次服务端快照（去抖合并）', async () => {
    mockDbGet.mockResolvedValue([pos('u1', 5)]);
    renderHook(() => useGroupReadReceipt('g1', []));
    await flush();
    expect(mockServerRefetch).toHaveBeenCalledTimes(0); // mount 无服务端补拉

    mockServerRefetch.mockResolvedValue(serverSnapshot([{ user_id: 'u1', last_read_seq: 5, display_name: 'U1', avatar_url: null, last_read_at: null }], 5));

    // db 里没有的两个新读者 u2 / u3 在 800ms 窗口内先后到达
    fireReadSync(readSync('u2', 4));
    act(() => {
      vi.advanceTimersByTime(300); // 未到 800ms
    });
    fireReadSync(readSync('u3', 4)); // 重置去抖窗口
    expect(mockServerRefetch).toHaveBeenCalledTimes(0); // 仍未补拉

    await flush(); // 让去抖 timer 触发
    expect(mockServerRefetch).toHaveBeenCalledTimes(1); // 两个新读者合并成一次补拉
  });

  it('3. applySnapshot 只增不减：补拉的较低读位不打回 WS 已推进的位置', async () => {
    mockDbGet.mockResolvedValue([pos('u1', 5)]); // u1 已知
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    // WS 把【已知】读者 u1 推进到 seq10（u1 已知 → 不触发补拉）
    fireReadSync(readSync('u1', 10));
    expect(result.current.countReaders(10, 'sender')).toBe(1); // u1 已读到 10

    // 未知读者 u2 触发补拉；补拉快照把 u1 报成较低的 seq5（后端快照滞后于 WS）
    mockServerRefetch.mockResolvedValue(serverSnapshot(
      [
        { user_id: 'u1', last_read_seq: 5, display_name: 'U1', avatar_url: null, last_read_at: null },
        { user_id: 'u2', last_read_seq: 8, display_name: 'U2', avatar_url: null, last_read_at: null },
      ],
      5,
    ));
    fireReadSync(readSync('u2', 8));
    await flush();

    expect(result.current.countReaders(10, 'sender')).toBe(1); // u1 仍是 10，未被快照的 5 打回
    expect(result.current.countReaders(8, 'sender')).toBe(2); // u1(10) + u2(8)
    expect(mockServerRefetch).toHaveBeenCalledTimes(1); // 仅一次补拉
  });

  it('4. unmount 清 timer：卸载后不再补拉', async () => {
    mockDbGet.mockResolvedValue([pos('u1', 5)]);
    const { unmount } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    fireReadSync(readSync('u2', 4)); // 排一次去抖补拉
    unmount(); // 卸载 → cleanup 清 timer + unsubscribe
    await flush(); // 推进所有 timer

    expect(mockServerRefetch).toHaveBeenCalledTimes(0); // 补拉未发生
    expect(wsState.unsub).toHaveBeenCalledTimes(1); // 已退订
  });

  it('5. 已知读者的 WS 推进不触发补拉（isNewReader 门控），但位置照常推进', async () => {
    mockDbGet.mockResolvedValue([pos('u1', 5)]); // u1 已知
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    fireReadSync(readSync('u1', 7)); // u1 已知 → 已知读者
    await flush();

    expect(mockServerRefetch).toHaveBeenCalledTimes(0); // 无补拉
    expect(result.current.countReaders(7, 'sender')).toBe(1); // 但位置推进到 7
  });

  it('6. 换群=键控重挂：新实例读新群 db（不重拉服务端），旧群已读位置不残留', async () => {
    // 真实换群 = ChatMessages/GroupChatMessages 按 key 重挂 = hook 新实例（非同实例 rerender）。
    mockDbGet.mockResolvedValueOnce([pos('u1', 5, 'g1')]); // g1
    const g1 = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();
    expect(mockDbGet).toHaveBeenLastCalledWith('g1');
    expect(g1.result.current.countReaders(5, 'sender')).toBe(1);
    g1.unmount(); // 切走 = 旧实例卸载（写回 g1 镜像）

    mockDbGet.mockResolvedValueOnce([pos('x9', 2, 'g2')]); // g2
    const g2 = renderHook(() => useGroupReadReceipt('g2', [])); // 新实例（键控重挂）
    await flush();

    expect(mockDbGet).toHaveBeenLastCalledWith('g2');
    expect(mockServerRefetch).not.toHaveBeenCalled(); // 换群不拉服务端
    expect(g2.result.current.memberCount).toBe(1); // g2 db 行数（镜像空 → fallback）
    expect(g2.result.current.countReaders(5, 'sender')).toBe(0); // g1 的 u1 不在 g2 实例
    expect(g2.result.current.countReaders(2, 'sender')).toBe(1); // g2 的 x9
  });
});
