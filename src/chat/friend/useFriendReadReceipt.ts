/**
 * 私聊已读回执 Hook（按消息序列号，双向）
 *
 * @module chat/friend
 * @location src/chat/friend/useFriendReadReceipt.ts
 *
 * 维护本会话双方的"已读到的消息序列号"(last-read-seq)，供每条消息双向显示已读：
 * - 我发的消息：对方 last-read-seq >= 该消息 seq → 对方已读
 * - 对方发的消息：我的 last-read-seq >= 该消息 seq → 我已读
 *
 * 数据来源：
 * 1. 进入会话拉一次 GET /api/messages/{friend_id}/read-positions 建立初始快照；
 * 2. 订阅 WebSocket 的 friend read_sync（带 seq）实时推进：
 *    - reader_id === friendId → 对方读了我的消息（peer 位置前进）
 *    - reader_id === 我 且 source_id === friendId → 我在其他设备读了（my 位置前进）
 * 3. 我在会话内时，App 会自动 markRead，故把"我的位置"乐观推进到当前已加载消息的最大 seq。
 */

import { useEffect, useState, useMemo } from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useApi, useSession } from '../../contexts/SessionContext';
import { getFriendReadPositions } from '../../api/messages';
import type { Message } from '../../types/chat';

export interface FriendReadReceipt {
  /** 对方已读到的序列号 */
  peerLastReadSeq: number;
  /** 我已读到的序列号 */
  myLastReadSeq: number;
}

/** 某条消息是否已被读到：阅读者 last-read-seq >= 该消息 seq（seq 缺失时视为未读，如发送中） */
export function isReadBySeq(msgSeq: number | undefined, readerLastReadSeq: number): boolean {
  if (msgSeq === undefined) {
    return false;
  }
  return readerLastReadSeq >= msgSeq;
}

/** 取消息列表中的最大 seq（无则 0） */
export function maxSeqOf(messages: Message[]): number {
  return messages.reduce((max, m) => (m.seq !== undefined && m.seq > max ? m.seq : max), 0);
}

export function useFriendReadReceipt(friendId: string | null, messages: Message[]): FriendReadReceipt {
  const ws = useWebSocket();
  const api = useApi();
  const { session } = useSession();
  const myUserId = session?.userId ?? '';

  const [peerLastReadSeq, setPeerLastReadSeq] = useState(0);
  const [myLastReadSeq, setMyLastReadSeq] = useState(0);

  // 初始快照
  useEffect(() => {
    setPeerLastReadSeq(0);
    setMyLastReadSeq(0);
    if (!friendId) {
      return undefined;
    }
    let cancelled = false;
    getFriendReadPositions(api, friendId)
      .then((resp) => {
        if (cancelled) {
          return;
        }
        setMyLastReadSeq((prev) => Math.max(prev, resp.my_last_read_seq));
        setPeerLastReadSeq((prev) => Math.max(prev, resp.peer_last_read_seq));
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 获取私聊已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, friendId]);

  // 实时已读推送（只增不减）
  useEffect(() => {
    if (!friendId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type !== 'friend' || msg.seq === undefined) {
        return;
      }
      const seq = msg.seq;
      if (msg.reader_id === friendId) {
        setPeerLastReadSeq((prev) => Math.max(prev, seq));
      } else if (msg.reader_id === myUserId && msg.source_id === friendId) {
        setMyLastReadSeq((prev) => Math.max(prev, seq));
      }
    });
    return unsubscribe;
  }, [ws, friendId, myUserId]);

  // 我在会话内即视为已读到最新（App 打开/收到消息会 markRead）
  const maxLoadedSeq = useMemo(() => maxSeqOf(messages), [messages]);
  useEffect(() => {
    if (maxLoadedSeq > 0) {
      setMyLastReadSeq((prev) => Math.max(prev, maxLoadedSeq));
    }
  }, [maxLoadedSeq]);

  return { peerLastReadSeq, myLastReadSeq };
}
