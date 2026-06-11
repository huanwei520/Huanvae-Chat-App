/**
 * 私聊已读回执 Hook（按消息序列号，仅自己发出的消息）
 *
 * @module chat/friend
 * @location src/chat/friend/useFriendReadReceipt.ts
 *
 * 维护对方在本会话"已读到的消息序列号"(peer last-read-seq)，供我发出的每条消息显示已读态：
 * - 我发的消息：对方 last-read-seq >= 该消息 seq → 对方已读（Telegram 风：只显示自己消息）
 * - 对方发的消息：不显示任何已读态。
 *
 * 数据来源：
 * 1. 进入会话拉一次 GET /api/messages/{friend_id}/read-positions 建立初始快照（取 peer 位置）；
 * 2. 订阅 WebSocket 的 friend read_sync（带 seq）实时推进：reader_id === friendId → 对方读了我的消息。
 */

import { useEffect, useState } from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useApi } from '../../contexts/SessionContext';
import { getFriendReadPositions } from '../../api/messages';

export interface FriendReadReceipt {
  /** 对方已读到的序列号 */
  peerLastReadSeq: number;
}

/**
 * 某条消息是否已被读到：阅读者 last-read-seq >= 该消息 seq。
 *
 * seq 缺失(undefined)或仍是占位 0（乐观发送窗口 / 从本地 DB 加载的旧消息）→ 视为未读。
 * 关键：占位 0 必须挡掉——否则 readerLastReadSeq(>=0) >= 0 恒真，会让自己刚发出、
 * 对方根本没读的消息瞬时虚显"已读"。真实 seq 由发送响应回写 + WebSocket 回显补齐。
 */
export function isReadBySeq(msgSeq: number | undefined, readerLastReadSeq: number): boolean {
  if (msgSeq === undefined || msgSeq <= 0) {
    return false;
  }
  return readerLastReadSeq >= msgSeq;
}

export function useFriendReadReceipt(friendId: string | null): FriendReadReceipt {
  const ws = useWebSocket();
  const api = useApi();

  const [peerLastReadSeq, setPeerLastReadSeq] = useState(0);

  // 初始快照（只取对方位置）
  useEffect(() => {
    setPeerLastReadSeq(0);
    if (!friendId) {
      return undefined;
    }
    let cancelled = false;
    getFriendReadPositions(api, friendId)
      .then((resp) => {
        if (cancelled) {
          return;
        }
        setPeerLastReadSeq((prev) => Math.max(prev, resp.peer_last_read_seq));
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 获取私聊已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, friendId]);

  // 实时已读推送：对方读了我的消息（只增不减）
  useEffect(() => {
    if (!friendId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type !== 'friend' || msg.seq === undefined) {
        return;
      }
      if (msg.reader_id === friendId) {
        setPeerLastReadSeq((prev) => Math.max(prev, msg.seq as number));
      }
    });
    return unsubscribe;
  }, [ws, friendId]);

  return { peerLastReadSeq };
}
