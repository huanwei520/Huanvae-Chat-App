/**
 * 私聊已读回执 Hook
 *
 * @module chat/friend
 * @location src/chat/friend/useFriendReadReceipt.ts
 *
 * 订阅 WebSocket 的 read_sync 事件：当对方（friendId）标记会话已读时，
 * 后端推送 source_type='friend' 的 read_sync（带 reader_id + read_at）。
 * 本 hook 记录"对方最新一次已读时间"，供发送方在自己最后一条消息上显示"已读/未读"。
 *
 * 注：read_at 单调取最新（多设备/多次标记取最大值）；切换好友时重置。
 * 仅基于实时推送，不做跨会话持久化（重开会话后等下一次 read_sync 刷新）。
 */

import { useEffect, useState } from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';

export function useFriendReadReceipt(friendId: string | null): string | null {
  const ws = useWebSocket();
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);

  useEffect(() => {
    setPeerReadAt(null);
    if (!friendId) {
      return undefined;
    }
    const unsubscribe = ws.onReadSync((msg) => {
      if (msg.source_type === 'friend' && msg.reader_id === friendId) {
        // ISO 8601 时间串可直接字典序比较，保留最新
        setPeerReadAt((prev) => (prev !== null && prev >= msg.read_at ? prev : msg.read_at));
      }
    });
    return unsubscribe;
  }, [ws, friendId]);

  return peerReadAt;
}

/**
 * 判断某条已发消息是否已被对方读到：对方已读时间 >= 该消息发送时间
 */
export function isMessageReadByPeer(sendTime: string, peerReadAt: string | null): boolean {
  if (peerReadAt === null) {
    return false;
  }
  return new Date(peerReadAt).getTime() >= new Date(sendTime).getTime();
}
