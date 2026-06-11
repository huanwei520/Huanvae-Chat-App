/**
 * 群聊已读回执 Hook（每条消息显示"全部已读 / N 人已读" + 已读名单）
 *
 * @module chat/group
 * @location src/chat/group/useGroupReadReceipt.ts
 *
 * 维护群内各成员的"已读到的消息序列号"(last-read-seq) 与展示信息（昵称/头像/已读时间），
 * 供每条消息统计已读人数并渲染已读者头像堆叠 + 点击展开已读名单。
 *
 * 数据来源：
 * 1. 进入群聊拉一次 GET /api/groups/{id}/read-positions 快照（各成员 last_read_seq +
 *    display_name + avatar_url + last_read_at + member_count）；
 * 2. 订阅 WebSocket 的 group read_sync（带 reader_id + seq）实时推进对应成员位置（已读时间
 *    取客户端当前时间作为近似；重新进入会话拉快照会得到后端精确时间）；
 * 3. 我在群内时 App 会自动 markRead，故把"我自己的位置"乐观推进到当前已加载消息的最大 seq，
 *    使我对别人消息的已读也被统计在内。
 *
 * 某条消息(seq=S, sender=X)的已读人数 = last-read-seq>=S 的成员数（排除发送者 X）；
 * 应读人数 = member_count − 1（排除发送者）。
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useApi, useSession } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getGroupReadPositions } from '../../api/groups';
import type { GroupMessage } from '../../api/groupMessages';

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
 * 纯函数：根据已读人数与应读人数生成展示文案（"全部已读" / "N 人已读"）；无应读者返回 null（不展示）
 */
export function readReceiptText(readers: number, eligible: number): string | null {
  if (eligible <= 0) {
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

  // member_id -> last_read_seq（用于计数；纯函数 countReadersAtSeq 在其上工作）
  const [positions, setPositions] = useState<Record<string, number>>({});
  // member_id -> 展示信息（昵称/头像/已读时间），与 positions 并行维护
  const [readerInfo, setReaderInfo] = useState<Record<string, GroupReaderInfo>>({});
  const [memberCount, setMemberCount] = useState(0);

  // 拉取初始已读位置快照
  useEffect(() => {
    setPositions({});
    setReaderInfo({});
    setMemberCount(0);
    if (!groupId) {
      return undefined;
    }
    let cancelled = false;
    getGroupReadPositions(api, groupId)
      .then((resp) => {
        if (cancelled) {
          return;
        }
        const posMap: Record<string, number> = {};
        const infoMap: Record<string, GroupReaderInfo> = {};
        resp.positions.forEach((p) => {
          posMap[p.user_id] = p.last_read_seq;
          infoMap[p.user_id] = {
            displayName: p.display_name,
            avatarUrl: p.avatar_url,
            lastReadAt: p.last_read_at,
          };
        });
        setPositions(posMap);
        setReaderInfo(infoMap);
        setMemberCount(resp.member_count);
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 获取群已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, groupId]);

  // 订阅群已读实时推送，推进对应成员的 last-read-seq（只增不减）+ 更新已读时间为当前时间
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
            lastReadAt: new Date().toISOString(),
          },
        };
      });
    });
    return unsubscribe;
  }, [ws, groupId]);

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
