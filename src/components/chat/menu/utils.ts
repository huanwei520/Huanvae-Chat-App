/**
 * ChatMenu 工具函数
 */

import type { GroupMember } from '../../../api/groups';

/**
 * 检查成员是否被禁言
 */
export function isMuted(member: GroupMember): boolean {
  if (!member.muted_until) { return false; }
  return new Date(member.muted_until) > new Date();
}

/**
 * 格式化禁言结束时间
 */
export function formatMutedUntil(mutedUntil: string): string {
  const date = new Date(mutedUntil);
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化禁言时长
 */
export function formatMuteDuration(mins: number): string {
  if (mins < 60) {
    return `${mins}分钟`;
  }
  if (mins < 1440) {
    return `${mins / 60}小时`;
  }
  return `${mins / 1440}天`;
}

/**
 * 禁言时长选项（分钟）
 */
export const MUTE_DURATION_OPTIONS = [10, 30, 60, 1440, 10080];
