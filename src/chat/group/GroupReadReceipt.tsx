/**
 * 群聊已读回执（仅自己发出的消息）
 *
 * @module chat/group/GroupReadReceipt
 * @location src/chat/group/GroupReadReceipt.tsx
 *
 * 统一状态槽，按消息状态显示：
 * - sending → 时钟
 * - failed  → 红色感叹号
 * - 已送达 → 绿色双勾 + "N 人已读"/"全部已读" 文案 + 已读者头像堆叠；有已读者时可点击展开名单。
 *
 * text 为 null 时不展示已读部分，三种成因：**无人已读**（产品口径：没人读过就隐藏）/
 * 占位 seq / 无应读者（单人群）。文案与 null 判定全在 useGroupReadReceipt 的纯函数里
 * （readReceiptText + groupReadReceiptText），本组件只负责渲染。
 *
 * 「挂在哪一条」由列表侧门控（shared/readReceiptGate，只挂我发出的最新一条）。
 */

import type { MessageSendStatus } from '../../types/chat';
import { ClockIcon, DoubleCheckIcon, FailedIcon } from '../shared/ReadReceiptIcons';
import { ReaderAvatarStack } from '../shared/ReaderAvatarStack';
import type { GroupReader } from './useGroupReadReceipt';

interface GroupReadReceiptProps {
  /** 发送状态（sending / failed / sent；缺省视为 sent） */
  status?: MessageSendStatus;
  /** 已读文案（"N 人已读"/"全部已读"）；null 表示不展示已读部分 */
  text: string | null;
  /** 已读者名单（已排除发送者，按已读时间升序） */
  readers: GroupReader[];
  /** 点击展开已读名单 */
  onOpenList: () => void;
}

export function GroupReadReceipt({ status, text, readers, onOpenList }: GroupReadReceiptProps) {
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
  if (text === null) {
    return null;
  }

  const hasReaders = readers.length > 0;

  return (
    <button
      type="button"
      className="group-read-receipt"
      onClick={hasReaders ? onOpenList : undefined}
      disabled={!hasReaders}
      title={hasReaders ? '查看已读名单' : undefined}
    >
      <span className="read-receipt-icon double-check read">
        <DoubleCheckIcon />
      </span>
      <span className="group-read-receipt-text">{text}</span>
      <ReaderAvatarStack readers={readers} />
    </button>
  );
}
