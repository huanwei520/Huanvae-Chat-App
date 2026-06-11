/**
 * 私聊已读回执（仅自己发出的消息，Telegram 风单向）
 *
 * @module chat/shared/PrivateReadReceipt
 * @location src/chat/shared/PrivateReadReceipt.tsx
 *
 * 统一状态槽，按消息状态显示一个图标，与时间戳基线对齐：
 * - sending → 时钟
 * - failed  → 红色感叹号
 * - 已送达且 isRead=false → 灰色双勾（未读）
 * - 已送达且 isRead=true  → 绿色双勾（已读）
 *
 * 「已读」严格由真实 seq 判定（见 useFriendReadReceipt.isReadBySeq），刚发出未回执的消息不会绿。
 */

import type { MessageSendStatus } from '../../types/chat';
import { ClockIcon, DoubleCheckIcon, FailedIcon } from './ReadReceiptIcons';

interface PrivateReadReceiptProps {
  /** 发送状态（sending / failed / sent；缺省视为 sent） */
  status?: MessageSendStatus;
  /** 对方是否已读（仅在已送达时有意义） */
  isRead: boolean;
}

export function PrivateReadReceipt({ status, isRead }: PrivateReadReceiptProps) {
  if (status === 'sending') {
    return (
      <span className="read-receipt-icon sending" title="发送中">
        <ClockIcon />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="read-receipt-icon failed" title="发送失败">
        <FailedIcon />
      </span>
    );
  }
  return (
    <span
      className={`read-receipt-icon double-check ${isRead ? 'read' : 'unread'}`}
      title={isRead ? '已读' : '已送达'}
    >
      <DoubleCheckIcon />
    </span>
  );
}
