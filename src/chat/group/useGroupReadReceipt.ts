/**
 * 群聊已读回执 Hook（显示"全部已读 / N 人已读" + 已读名单）
 *
 * @module chat/group
 * @location src/chat/group/useGroupReadReceipt.ts
 *
 * 显示口径两条门控，都不在本 hook 里（本 hook 只负责"谁读到了哪"）：
 * - **挂在哪一条**：只挂我发出的最新一条（shared/readReceiptGate，由 GroupChatMessages 调用）；
 * - **无人已读就隐藏**：readReceiptText(readers<=0) → null（见下方该函数）。
 *
 * 维护群内各成员的"已读到的消息序列号"(last-read-seq) 与展示信息（昵称/头像/已读时间），
 * 供每条消息统计已读人数并渲染已读者头像堆叠 + 点击展开已读名单。
 *
 * 已读位置作为消息同步管线一等公民（根除进群时的"清空 → 独立首拉 → 弹入"两阶段闪）：
 * 1. 首帧初值：懒初始化读 chatStore 内存镜像（二开秒取，不清空）；mount 异步读本地
 *    group_read_positions 表校准（跨应用重启后镜像空、db 有上次持久化值）；
 * 2. sync 快照：打开会话那次增量同步带回 read_positions（全员 last_read_seq + 展示信息 +
 *    member_count），经 syncService.subscribeReadPositions 转发 → applySnapshot 校准 + 落库
 *    （取代原进群独立快照首拉）；
 * 3. WebSocket group read_sync（带 reader_id + seq）实时推进对应成员位置（已读时间取客户端
 *    当前时间作为近似）+ 落库；快照里没有的陌生 reader → 去抖补拉一次服务端快照补昵称/头像；
 * 4. 我在群内时 App 会自动 markRead，故把"我自己的位置"乐观推进到当前已加载消息的最大 seq；
 * 5. unmount 把当前已读态写回内存镜像，供二开首帧秒取。
 *
 * 所有更新单调只增（positions/db MAX），多源到达任意交错不回退。
 * 某条消息(seq=S, sender=X)的已读人数 = last-read-seq>=S 的成员数（排除发送者 X）；
 * 应读人数 = member_count − 1（排除发送者）。
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useApi, useSession } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getGroupReadPositions } from '../../api/groups';
import type { GroupMessage } from '../../api/groupMessages';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { useChatStore } from '../../stores/chatStore';
import { subscribeReadPositions } from '../../services/syncService';
import * as db from '../../db';
import type { GroupReadPositionRow } from '../../db';

/** 已读者展示信息 */
export interface GroupReaderInfo {
  /** 展示名（群昵称优先，否则用户昵称，再否则用户 id） */
  displayName: string;
  /** 头像 URL（未设置则为 null） */
  avatarUrl: string | null;
  /** 精确已读时间（RFC3339；从未推进过已读位置则为 null） */
  lastReadAt: string | null;
}

/** 某条消息的一名已读者（名单项） */
export interface GroupReader extends GroupReaderInfo {
  userId: string;
}

export interface GroupReadReceipt {
  /** 统计某条消息 seq 的已读人数（排除发送者 senderId 本人） */
  countReaders: (seq: number, senderId: string) => number;
  /** 列出某条消息 seq 的已读者（排除发送者 senderId 本人），按已读时间升序 */
  readersAt: (seq: number, senderId: string) => GroupReader[];
  /** 群活跃成员总数（含发送者） */
  memberCount: number;
}

/**
 * 已读位置快照的统一输入形状（服务端 GET /read-positions 响应、sync 快照转发、本地 db 行
 * 三者共用结构，均喂给 applySnapshot 走唯一头像收口）。
 */
interface ReadPositionsSnapshot {
  positions: Array<{
    user_id: string;
    last_read_seq: number;
    display_name: string;
    avatar_url: string | null;
    last_read_at: string | null;
  }>;
  member_count: number;
}

/**
 * 纯函数：把快照 positions 映射为本地持久化行（avatar_url 保留后端**原始**值供落库，
 * 显示层解析在 applySnapshot 内单独进行）。
 */
function snapshotToRows(groupId: string, snapshot: ReadPositionsSnapshot): GroupReadPositionRow[] {
  return snapshot.positions.map((p) => ({
    group_id: groupId,
    user_id: p.user_id,
    last_read_seq: p.last_read_seq,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    last_read_at: p.last_read_at,
  }));
}

/**
 * 纯函数：在 成员→last_read_seq 映射中统计读到 seq 的人数（排除发送者）
 */
export function countReadersAtSeq(
  positions: Record<string, number>,
  seq: number,
  senderId: string,
): number {
  return Object.entries(positions).filter(
    ([userId, lastReadSeq]) => userId !== senderId && lastReadSeq >= seq,
  ).length;
}

/**
 * 纯函数：列出读到 seq 的已读者（排除发送者），合并展示信息，按已读时间升序（无时间者排末尾）。
 *
 * msgSeq<=0（占位）→ 空数组（与 groupReadReceiptText 守卫一致，防把默认 seq=0 的全体误列为已读）。
 */
export function readersAtSeq(
  positions: Record<string, number>,
  readerInfo: Record<string, GroupReaderInfo>,
  seq: number,
  senderId: string,
): GroupReader[] {
  if (seq <= 0) {
    return [];
  }
  return Object.entries(positions)
    .filter(([userId, lastReadSeq]) => userId !== senderId && lastReadSeq >= seq)
    .map(([userId]) => ({
      userId,
      displayName: readerInfo[userId]?.displayName ?? userId,
      avatarUrl: readerInfo[userId]?.avatarUrl ?? null,
      lastReadAt: readerInfo[userId]?.lastReadAt ?? null,
    }))
    .sort((a, b) => {
      if (a.lastReadAt && b.lastReadAt) {
        return a.lastReadAt.localeCompare(b.lastReadAt);
      }
      if (a.lastReadAt) {
        return -1;
      }
      if (b.lastReadAt) {
        return 1;
      }
      return 0;
    });
}

/**
 * 纯函数：根据已读人数与应读人数生成展示文案（"全部已读" / "N 人已读"）。
 *
 * 两种"不展示"（返回 null）：
 * - 无应读者（eligible<=0，如单人群）——本就没人能读；
 * - **无人已读（readers<=0）**——产品口径：没人读过时**隐藏**已读标记，
 *   而不是显示"0 人已读"（那是在给一条零信息量的行占位）。
 */
export function readReceiptText(readers: number, eligible: number): string | null {
  if (eligible <= 0 || readers <= 0) {
    return null;
  }
  return readers >= eligible ? '全部已读' : `${readers} 人已读`;
}

/**
 * 纯函数：某条群消息当前应展示的已读文案。
 *
 * msgSeq<=0（乐观发送窗口 / 从本地 DB 加载的旧消息，真实序号未分配）→ null 不展示。
 * 关键：占位 0 必须挡掉——否则 countReadersAtSeq(_, 0, _) 把默认 last_read_seq=0 的
 * 全体成员误计为已读，自己刚发出、无人读的消息瞬时虚显"全部已读"。
 * 真实 seq 由发送响应回写 + WebSocket 回显补齐。
 */
export function groupReadReceiptText(
  msgSeq: number,
  readers: number,
  eligible: number,
): string | null {
  if (msgSeq <= 0) {
    return null;
  }
  return readReceiptText(readers, eligible);
}

/** 取群消息列表中的最大 seq（无则 0） */
export function maxGroupSeqOf(messages: GroupMessage[]): number {
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), 0);
}

export function useGroupReadReceipt(groupId: string | null, messages: GroupMessage[]): GroupReadReceipt {
  const api = useApi();
  const ws = useWebSocket();
  const { session } = useSession();
  const myUserId = session?.userId ?? '';

  // 懒初始化：首帧从内存镜像秒取（二开零异步），不清空。
  // member_id -> last_read_seq（用于计数；纯函数 countReadersAtSeq 在其上工作）
  const [positions, setPositions] = useState<Record<string, number>>(
    () => (groupId ? useChatStore.getState().cachedGroupReadPositions[groupId]?.positions ?? {} : {}),
  );
  // member_id -> 展示信息（昵称/头像/已读时间），与 positions 并行维护
  const [readerInfo, setReaderInfo] = useState<Record<string, GroupReaderInfo>>(
    () => (groupId ? useChatStore.getState().cachedGroupReadPositions[groupId]?.readerInfo ?? {} : {}),
  );
  const [memberCount, setMemberCount] = useState(
    () => (groupId ? useChatStore.getState().cachedGroupReadPositions[groupId]?.memberCount ?? 0 : 0),
  );

  // 说明：本 hook 挂在按会话 key 键控的 ChatMessages/GroupChatMessages 内（ChatPanel /
  // MobileChatView 均 key={`group-${会话id}`}），切会话 = 组件重挂 = hook 重挂，groupId 在单个
  // 实例生命周期内恒定不变。故首帧初值全靠上面的 useState 懒初始化读镜像即可，无需"groupId 变更
  // 渲染期重置"（那是给挂在非键控 useMainPage 的 useLocal*Messages 用的，此处属不可达死代码，已删）。

  // latest-ref：让 WS onReadSync 回调（deps 稳定、不含 readerInfo）能读到最新 readerInfo，
  // 据此判断某 reader_id 是否为"快照里没有的新读者"（需补拉头像/昵称）。
  const readerInfoRef = useRef(readerInfo);
  readerInfoRef.current = readerInfo;
  // latest-ref：unmount cleanup 读当前最新已读态写回镜像。
  const stateRef = useRef({ positions, readerInfo, memberCount });
  stateRef.current = { positions, readerInfo, memberCount };
  // 去抖补拉计时器：WS 收到未知读者时合并触发一次快照补全（含 avatar_url），只增不减语义不回退。
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 数据边界（唯一头像收口）：把一次快照合并进 state。三条路径共用此收口，但语义分两档：
  //
  // - `prune`（仅进会话 sync 快照这类**全量活跃成员**权威快照）：positions/readerInfo 只保留
  //   快照枚举的成员，剔除快照外的成员（退群幽灵）——否则退群者永久残留、被计入已读人数/名单。
  //   对快照内成员仍取 max(prev, 快照)，不把 WS 已推进的更高位置打回。
  //   非 prune（本地 db 校准 / WS 去抖补拉 fill-in）：合并（{...prev}），不删（避免与刚到的
  //   WS 新读者竞态误删；幽灵在下次进会话的 sync 权威快照处被剔除，与旧版"进群整体替换"同频）。
  // - `memberCountAuthoritative`（sync 快照 / 去抖补拉 = 真实服务端快照）：直接采用权威 member_count；
  //   本地 db 校准 = fallback（仅当当前为 0 时用 db 行数近似，不覆盖镜像/快照的权威值）。
  const applySnapshot = useCallback(
    (snapshot: ReadPositionsSnapshot, opts: { prune: boolean; memberCountAuthoritative: boolean }) => {
      setPositions((prev) => {
        const next: Record<string, number> = opts.prune ? {} : { ...prev };
        snapshot.positions.forEach((p) => {
          next[p.user_id] = Math.max(prev[p.user_id] ?? 0, p.last_read_seq); // 只增不减
        });
        return next;
      });
      setReaderInfo((prev) => {
        const next: Record<string, GroupReaderInfo> = opts.prune ? {} : { ...prev };
        snapshot.positions.forEach((p) => {
          next[p.user_id] = {
            displayName: p.display_name,
            // 数据边界解析：后端裸 avatar_url 经唯一显示收口点反代，webview 才验得过私有 CA
            // （下游 ReaderAvatarStack / GroupReadListModal 直接消费此已解析值）；
            // 由 tests/secure-display-routing.test.ts 静态契约强制，与 useFriends/useGroups 同模式。
            avatarUrl: resolveServerAvatarUrl(p.avatar_url),
            lastReadAt: p.last_read_at,
          };
        });
        return next;
      });
      if (opts.memberCountAuthoritative) {
        setMemberCount(snapshot.member_count);
      } else {
        setMemberCount((prev) => (prev > 0 ? prev : snapshot.member_count));
      }
    },
    [],
  );

  // 去抖：多个新读者短时间内只补拉一次服务端快照（每次新读者重置 800ms，burst 结束后才打一次）+ 落库。
  const scheduleSnapshotRefetch = useCallback(() => {
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
    }
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      if (!groupId) {
        return;
      }
      getGroupReadPositions(api, groupId)
        .then((resp) => {
          // 去抖补拉 = fill-in：合并不删（避免与刚到的 WS 新读者竞态误删）；member_count 仍权威。
          applySnapshot(resp, { prune: false, memberCountAuthoritative: true });
          db.upsertGroupReadPositions(groupId, snapshotToRows(groupId, resp)).catch((err) => {
            console.warn('[ReadReceipt] 写本地群已读位置失败:', err);
          });
        })
        .catch((err) => {
          console.warn('[ReadReceipt] 补拉群已读快照失败:', err);
        });
    }, 800);
  }, [api, groupId, applySnapshot]);

  // mount / groupId 变更：异步读本地 group_read_positions 校准（跨重启持久化值；
  // member_count = 行数，契约定义 member_count = positions 长度，即群活跃成员数）。
  useEffect(() => {
    if (!groupId) {
      return undefined;
    }
    let cancelled = false;
    db.getGroupReadPositions(groupId)
      .then((rows) => {
        if (cancelled || rows.length === 0) {
          return;
        }
        // 本地 db 非权威成员真值（表随退群幽灵累积、不删）：合并不 prune；member_count 仅
        // fallback（当前为 0 时用行数近似，不覆盖镜像/后续 sync 的权威值）。进会话 sync 权威
        // 快照到达后会 prune 幽灵并给权威 member_count。
        applySnapshot(
          {
            positions: rows.map((r) => ({
              user_id: r.user_id,
              last_read_seq: r.last_read_seq,
              display_name: r.display_name ?? r.user_id,
              avatar_url: r.avatar_url,
              last_read_at: r.last_read_at,
            })),
            member_count: rows.length,
          },
          { prune: false, memberCountAuthoritative: false },
        );
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 读本地群已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, applySnapshot]);

  // sync 快照转发：打开会话同步带回全员位置 → 校准 + 落库。
  useEffect(() => {
    if (!groupId) {
      return undefined;
    }
    return subscribeReadPositions((payload) => {
      if (payload.type !== 'group' || payload.conversationId !== groupId) {
        return;
      }
      // 进会话 sync 快照 = 全量活跃成员权威快照：prune 剔除退群幽灵 + 权威 member_count；
      // db 用 replace（删幽灵行）对齐，防表随退群累积。
      applySnapshot(payload.data, { prune: true, memberCountAuthoritative: true });
      db.replaceGroupReadPositions(groupId, snapshotToRows(groupId, payload.data)).catch((err) => {
        console.warn('[ReadReceipt] 写本地群已读位置失败:', err);
      });
    });
  }, [groupId, applySnapshot]);

  // 订阅群已读实时推送，推进对应成员的 last-read-seq（只增不减）+ 更新已读时间为当前时间 + 落库。
  useEffect(() => {
    if (!groupId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type !== 'group' || msg.source_id !== groupId || msg.seq === undefined) {
        return;
      }
      const seq = msg.seq;
      const readerId = msg.reader_id;
      // 快照里没有这个 reader_id → 我们只有占位昵称、没有头像 → 去抖补拉一次快照填充
      const isNewReader = !readerInfoRef.current[readerId];
      const readAt = new Date().toISOString();
      setPositions((prev) => {
        if ((prev[readerId] ?? 0) >= seq) {
          return prev;
        }
        return { ...prev, [readerId]: seq };
      });
      setReaderInfo((prev) => {
        const existing = prev[readerId];
        return {
          ...prev,
          [readerId]: {
            displayName: existing?.displayName ?? readerId,
            avatarUrl: existing?.avatarUrl ?? null,
            lastReadAt: readAt,
          },
        };
      });
      // 同步写本地：seq 单调 MAX；display_name/avatar_url 传 null，db COALESCE 保留已有身份不清空。
      db.upsertGroupReadPositions(groupId, [
        {
          group_id: groupId,
          user_id: readerId,
          last_read_seq: seq,
          display_name: null,
          avatar_url: null,
          last_read_at: readAt,
        },
      ]).catch((err) => {
        console.warn('[ReadReceipt] 写本地群已读位置失败:', err);
      });
      if (isNewReader) {
        scheduleSnapshotRefetch();
      }
    });
    return () => {
      unsubscribe();
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [ws, groupId, scheduleSnapshotRefetch]);

  // 我在群内即视为已读到最新（App 打开/收到消息会 markRead），使我对别人消息的已读也被统计
  const maxLoadedSeq = useMemo(() => maxGroupSeqOf(messages), [messages]);
  useEffect(() => {
    if (!myUserId || maxLoadedSeq <= 0) {
      return;
    }
    setPositions((prev) => {
      if ((prev[myUserId] ?? 0) >= maxLoadedSeq) {
        return prev;
      }
      return { ...prev, [myUserId]: maxLoadedSeq };
    });
  }, [myUserId, maxLoadedSeq]);

  // unmount 把当前已读态写回内存镜像，供二开首帧秒取。
  useEffect(() => {
    const captureGroupId = groupId;
    return () => {
      if (captureGroupId) {
        useChatStore.getState().cacheGroupReadPositions(captureGroupId, stateRef.current);
      }
    };
  }, [groupId]);

  const countReaders = useCallback(
    (seq: number, senderId: string) => countReadersAtSeq(positions, seq, senderId),
    [positions],
  );

  const readersAt = useCallback(
    (seq: number, senderId: string) => readersAtSeq(positions, readerInfo, seq, senderId),
    [positions, readerInfo],
  );

  return { countReaders, readersAt, memberCount };
}
