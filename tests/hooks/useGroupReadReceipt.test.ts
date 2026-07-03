/**
 * useGroupReadReceipt Hook 行为测试（renderHook 驱动，非纯函数）
 *
 * 补审计缺口：纯函数（countReadersAtSeq/readersAtSeq/...）已由 tests/unit/readReceipt.test.ts 覆盖，
 * 但 hook 本体的【快照拉取 / WS 补拉去抖 / 只增不减 merge / timer 清理 / isNewReader 门控】此前零渲染测试。
 * 本文件用 renderHook + fake timers 驱动这些行为路径，观测【getGroupReadPositions 调用次数】+【countReaders 输出】。
 *
 * 覆盖：
 * 1. 挂载拉一次快照，memberCount / 已读人数反映响应
 * 2. 多个未知读者 800ms 内 burst → 只补拉一次快照（scheduleSnapshotRefetch 去抖）
 * 3. applySnapshot 只增不减：补拉的较低读位不打回 WS 已推进的位置（max merge）
 * 4. unmount 清 timer：卸载后不再补拉（cleanup）
 * 5. 已知读者的 WS 推进不触发补拉（isNewReader 门控），但位置照常推进
 * 6. 换群：重置状态并对新群重新拉快照
 *
 * mock 说明：resolveServerAvatarUrl 走 passthrough（avatar.ts 依赖 @tauri-apps/api/core + secureProxy），
 * 本测试聚焦 timer/merge 行为，头像解析由 tests/secure-display-routing.test.ts 静态守。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGetGroupReadPositions = vi.hoisted(() => vi.fn());
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
  getGroupReadPositions: mockGetGroupReadPositions,
}));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (u: string | null | undefined) => u ?? null,
}));

import { useGroupReadReceipt } from '../../src/chat/group/useGroupReadReceipt';

/** 一个已读位置项（后端 snake_case 契约形状） */
const pos = (userId: string, seq: number) => ({
  user_id: userId,
  last_read_seq: seq,
  display_name: userId.toUpperCase(),
  avatar_url: null,
  last_read_at: null,
});

const snapshot = (positions: ReturnType<typeof pos>[], memberCount: number) => ({
  positions,
  member_count: memberCount,
});

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

describe('useGroupReadReceipt（hook 行为：快照/去抖补拉/merge/清理）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetGroupReadPositions.mockReset();
    wsState.cb = null;
    wsState.unsub.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. 挂载拉一次快照，memberCount 与已读人数反映响应', async () => {
    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('u1', 5)], 3));
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1);
    expect(result.current.memberCount).toBe(3);
    expect(result.current.countReaders(5, 'sender')).toBe(1); // u1 读到 seq5
    expect(result.current.countReaders(6, 'sender')).toBe(0); // 无人读到 seq6
  });

  it('2. 多个未知读者 800ms 内 burst → 只补拉一次快照（去抖合并）', async () => {
    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('u1', 5)], 5));
    renderHook(() => useGroupReadReceipt('g1', []));
    await flush();
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1);

    // 快照里没有的两个新读者 u2 / u3 在 800ms 窗口内先后到达
    fireReadSync(readSync('u2', 4));
    act(() => {
      vi.advanceTimersByTime(300); // 未到 800ms
    });
    fireReadSync(readSync('u3', 4)); // 重置去抖窗口
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1); // 仍未补拉

    await flush(); // 让去抖 timer 触发
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(2); // 两个新读者合并成一次补拉
  });

  it('3. applySnapshot 只增不减：补拉的较低读位不打回 WS 已推进的位置', async () => {
    mockGetGroupReadPositions.mockResolvedValueOnce(snapshot([pos('u1', 5)], 5));
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();

    // WS 把【已知】读者 u1 推进到 seq10（u1 已知 → 不触发补拉）
    fireReadSync(readSync('u1', 10));
    expect(result.current.countReaders(10, 'sender')).toBe(1); // u1 已读到 10

    // 未知读者 u2 触发补拉；补拉快照把 u1 报成较低的 seq5（后端快照滞后于 WS）
    mockGetGroupReadPositions.mockResolvedValueOnce(snapshot([pos('u1', 5), pos('u2', 8)], 5));
    fireReadSync(readSync('u2', 8));
    await flush();

    expect(result.current.countReaders(10, 'sender')).toBe(1); // u1 仍是 10，未被快照的 5 打回
    expect(result.current.countReaders(8, 'sender')).toBe(2); // u1(10) + u2(8)
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(2); // 初始 + 一次补拉
  });

  it('4. unmount 清 timer：卸载后不再补拉', async () => {
    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('u1', 5)], 5));
    const { unmount } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1);

    fireReadSync(readSync('u2', 4)); // 排一次去抖补拉
    unmount(); // 卸载 → cleanup 清 timer + unsubscribe
    await flush(); // 推进所有 timer

    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1); // 补拉未发生
    expect(wsState.unsub).toHaveBeenCalledTimes(1); // 已退订
  });

  it('5. 已知读者的 WS 推进不触发补拉（isNewReader 门控），但位置照常推进', async () => {
    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('u1', 5)], 5));
    const { result } = renderHook(() => useGroupReadReceipt('g1', []));
    await flush();
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1);

    fireReadSync(readSync('u1', 7)); // u1 已在快照里 → 已知读者
    await flush();

    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1); // 无补拉
    expect(result.current.countReaders(7, 'sender')).toBe(1); // 但位置推进到 7
  });

  it('6. 换群：重置状态并对新群重新拉快照', async () => {
    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('u1', 5)], 3));
    const { result, rerender } = renderHook(({ gid }) => useGroupReadReceipt(gid, []), {
      initialProps: { gid: 'g1' },
    });
    await flush();
    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(1);
    expect(mockGetGroupReadPositions).toHaveBeenLastCalledWith(expect.anything(), 'g1');

    mockGetGroupReadPositions.mockResolvedValue(snapshot([pos('x9', 2)], 9));
    rerender({ gid: 'g2' });
    await flush();

    expect(mockGetGroupReadPositions).toHaveBeenCalledTimes(2);
    expect(mockGetGroupReadPositions).toHaveBeenLastCalledWith(expect.anything(), 'g2');
    expect(result.current.memberCount).toBe(9);
    expect(result.current.countReaders(5, 'sender')).toBe(0); // 旧群 u1 已清
  });
});
