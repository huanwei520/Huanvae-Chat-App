/**
 * 群聊已读回执 Hook
 *
 * @module chat/group
 * @location src/chat/group/useGroupReadReceipt.ts
 *
 * 维护群内各成员的"已读到的消息序列号"(last-read-seq)，供发送方在每条自己发出的
 * 群消息上显示"N 人已读"。
 *
 * 数据来源：
 * 1. 进入群聊时拉一次 GET /api/groups/{id}/read-positions 快照建立初始映射；
 * 2. 之后订阅 WebSocket 的 group read_sync（带 reader_id + seq）实时推进对应成员位置。
 *
 * 某条消息 seq 的已读人数 = last-read-seq >= 该 seq 的成员数（排除发送者本人）。
 */

import { useEffect, useState, useCallback } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getGroupReadPositions } from '../../api/groups';

export interface GroupReadReceipt {
  /** 统计某条消息 seq 的已读人数（排除发送者 senderId 本人） */
  countReaders: (seq: number, senderId: string) => number;
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

export function useGroupReadReceipt(groupId: string | null): GroupReadReceipt {
  const api = useApi();
  const ws = useWebSocket();
  // member_id -> last_read_seq
  const [positions, setPositions] = useState<Record<string, number>>({});

  // 拉取初始已读位置快照
  useEffect(() => {
    setPositions({});
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

  const countReaders = useCallback(
    (seq: number, senderId: string) => countReadersAtSeq(positions, seq, senderId),
    [positions],
  );

  return { countReaders };
}
