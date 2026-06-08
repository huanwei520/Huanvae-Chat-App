/**
 * 群聊已读回执 Hook（每条消息显示"全部已读 / N 人已读"）
 *
 * @module chat/group
 * @location src/chat/group/useGroupReadReceipt.ts
 *
 * 维护群内各成员的"已读到的消息序列号"(last-read-seq)，供每条消息统计已读人数。
 *
 * 数据来源：
 * 1. 进入群聊拉一次 GET /api/groups/{id}/read-positions 快照（各成员 last_read_seq + member_count）；
 * 2. 订阅 WebSocket 的 group read_sync（带 reader_id + seq）实时推进对应成员位置；
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

export interface GroupReadReceipt {
  /** 统计某条消息 seq 的已读人数（排除发送者 senderId 本人） */
  countReaders: (seq: number, senderId: string) => number;
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

  // member_id -> last_read_seq
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [memberCount, setMemberCount] = useState(0);

  // 拉取初始已读位置快照
  useEffect(() => {
    setPositions({});
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
        const map: Record<string, number> = {};
        resp.positions.forEach((p) => {
          map[p.user_id] = p.last_read_seq;
        });
        setPositions(map);
        setMemberCount(resp.member_count);
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 获取群已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, groupId]);

  // 订阅群已读实时推送，推进对应成员的 last-read-seq（只增不减）
  useEffect(() => {
    if (!groupId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type !== 'group' || msg.source_id !== groupId || msg.seq === undefined) {
        return;
      }
      const seq = msg.seq;
      setPositions((prev) => {
        if ((prev[msg.reader_id] ?? 0) >= seq) {
          return prev;
        }
        return { ...prev, [msg.reader_id]: seq };
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

  return { countReaders, memberCount };
}
