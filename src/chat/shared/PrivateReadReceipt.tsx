/**
 * 私聊已读回执（仅自己发出的消息，Telegram 风单向）
 *
 * @module chat/shared/PrivateReadReceipt
 * @location src/chat/shared/PrivateReadReceipt.tsx
 *
 * 统一状态槽，按消息状态显示一个图标，与时间戳基线对齐：
 * - sending → 时钟
 * - failed  → 红色感叹号
 * - 已送达且 isRead=false → **不渲染**（对方还没读过 ⇒ 隐藏已读态）
 * - 已送达且 isRead=true  → 绿色双勾（已读）
 *
 * 「没人读过就隐藏」是产品口径：代价是"已送达"这一档信息不再有可视表达
 * （原先未读态是灰色双勾），换来的是气泡下方只在真正有已读时才出现标记。
 * 发送中 / 失败仍照常显示——那是**发送状态**，不是已读态，不在隐藏范围内。
 *
 * 「已读」严格由真实 seq 判定（见 useFriendReadReceipt.isReadBySeq），刚发出未回执的消息不会绿。
 * 「挂在哪一条」由列表侧门控（见 shared/readReceiptGate，只挂我发出的最新一条）。
 */

import type { MessageSendStatus } from '../../types/chat';
import { ClockIcon, DoubleCheckIcon, FailedIcon } from './ReadReceiptIcons';

interface PrivateReadReceiptProps {
  /** 发送状态（sending / failed / sent；缺省视为 sent） */
  status?: MessageSendStatus;
  /** 对方是否已读（仅在已送达时有意义）；false = 隐藏，不再显示"已送达"灰勾 */
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
  if (!isRead) {
    return null;
  }
  return (
    <span className="read-receipt-icon double-check read" title="已读">
      <DoubleCheckIcon />
    </span>
  );
}
