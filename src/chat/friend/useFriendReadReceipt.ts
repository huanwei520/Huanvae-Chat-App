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
 * 已读位置作为消息同步管线一等公民（根除进入会话时的"清 0 → 异步拉取 → 弹入"两阶段闪）：
 * 1. 首帧初值：懒初始化读 chatStore 内存镜像（二开秒取）；mount 异步读本地
 *    conversations.peer_last_read_seq 校准（跨应用重启后镜像空、db 有上次持久化值）；
 * 2. sync 快照：打开会话那次增量同步带回 read_positions（peer_last_read_seq），经
 *    syncService.subscribeReadPositions 转发 → 校准 + 落库（取代原独立 read-positions 端点，已移除）；
 * 3. WS friend read_sync（reader_id === friendId → 对方读了我的消息）→ 校准 + 落库；
 * 4. unmount 把当前 peer 位置写回内存镜像，供二开首帧秒取。
 *
 * 所有更新单调只增（Math.max / db MAX），多源到达任意交错不回退。
 */

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useSession } from '../../contexts/SessionContext';
import { useChatStore } from '../../stores/chatStore';
import { subscribeReadPositions } from '../../services/syncService';
import { getFriendConversationId } from '../../utils/conversationId';
import * as db from '../../db';

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
  const { session } = useSession();
  const myUserId = session?.userId ?? '';

  // 本会话 conversationId（本地持久化 / 镜像 / sync 转发的 key）。缺 friendId / userId → null。
  const conversationId =
    friendId && myUserId ? getFriendConversationId(myUserId, friendId) : null;

  // 懒初始化：首帧从内存镜像秒取（二开零异步），不再清 0。
  const [peerLastReadSeq, setPeerLastReadSeq] = useState<number>(() =>
    conversationId ? useChatStore.getState().cachedFriendReadPositions[conversationId] ?? 0 : 0,
  );

  // 说明：本 hook 挂在按会话 key 键控的 ChatMessages 内（ChatPanel / MobileChatView 均
  // key={`friend-${会话id}`}），切会话 = 组件重挂 = hook 重挂，friendId 在单个实例生命周期内恒定。
  // 故首帧靠 useState 懒初始化读镜像即可，无需"friendId 变更渲染期重置"（不可达死代码，已删）。

  // latest-ref：unmount cleanup 读当前最新 peer 位置写回镜像。
  const peerRef = useRef(peerLastReadSeq);
  peerRef.current = peerLastReadSeq;

  // 异步读本地 conversations.peer_last_read_seq 校准（单调 max，跨重启持久化值）。
  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }
    let cancelled = false;
    db.getConversationPeerReadSeq(conversationId)
      .then((seq) => {
        if (!cancelled) {
          setPeerLastReadSeq((prev) => Math.max(prev, seq));
        }
      })
      .catch((err) => {
        console.warn('[ReadReceipt] 读本地私聊已读位置失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // sync 快照转发：打开会话同步带回对方位置 → 校准 + 落库（只增不减）。
  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }
    return subscribeReadPositions((payload) => {
      if (payload.type !== 'friend' || payload.conversationId !== conversationId) {
        return;
      }
      const peer = payload.data.peer_last_read_seq;
      setPeerLastReadSeq((prev) => Math.max(prev, peer));
      db.setConversationPeerReadSeq(conversationId, peer).catch((err) => {
        console.warn('[ReadReceipt] 写本地私聊已读位置失败:', err);
      });
    });
  }, [conversationId]);

  // 实时已读推送：对方读了我的消息（只增不减）→ 校准 + 落库。
  useEffect(() => {
    if (!friendId || !conversationId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type !== 'friend' || msg.seq === undefined) {
        return;
      }
      if (msg.reader_id === friendId) {
        const seq = msg.seq;
        setPeerLastReadSeq((prev) => Math.max(prev, seq));
        db.setConversationPeerReadSeq(conversationId, seq).catch((err) => {
          console.warn('[ReadReceipt] 写本地私聊已读位置失败:', err);
        });
      }
    });
    return unsubscribe;
  }, [ws, friendId, conversationId]);

  // unmount 把当前 peer 位置写回内存镜像，供二开首帧秒取。
  useEffect(() => {
    const captureConvId = conversationId;
    return () => {
      if (captureConvId) {
        useChatStore.getState().cacheFriendReadPositions(captureConvId, peerRef.current);
      }
    };
  }, [conversationId]);

  return { peerLastReadSeq };
}
