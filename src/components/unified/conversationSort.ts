/**
 * 会话卡片排序纯函数（UnifiedList 与 MobileChatList 共用）
 *
 * 稳定性保证：
 * - 时间串解析为 NaN（非法格式）或 null/缺失时一律按 0 处理，确定落底，
 *   不会让全员并列放大成整列卡片翻动
 * - 任何并列最终用 uniqueKey localeCompare tie-break，保证任意输入序下
 *   输出序唯一（无 tie-break 时并列项顺序 = 输入数组序，friends/groups
 *   在「本地 db 序 → REST 序」两次整体替换间翻动会放大成卡片上下抽搐）
 */

/** 排序所需的最小卡片形状（UnifiedCard / ConversationCard 均满足） */
export interface SortableCard {
  /** 稳定唯一键，如 `friend-<id>` / `group-<id>` */
  uniqueKey: string;
  /** 最后消息时间（ISO 串，可能为 null 或非法格式） */
  lastMessageTime: string | null;
  /** 未读消息数 */
  unreadCount: number;
}

/** 时间串 → epoch 毫秒；null / 非法（NaN）按 0 处理，确定落底 */
function toEpoch(time: string | null): number {
  if (!time) { return 0; }
  const ms = new Date(time).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** 纯时间降序（新 → 旧），并列按 uniqueKey 稳定 tie-break（chat/friends/group 三 tab 共用） */
export function compareByTimeDesc(a: SortableCard, b: SortableCard): number {
  const diff = toEpoch(b.lastMessageTime) - toEpoch(a.lastMessageTime);
  if (diff !== 0) { return diff; }
  return a.uniqueKey.localeCompare(b.uniqueKey);
}
