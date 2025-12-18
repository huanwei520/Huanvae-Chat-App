/**
 * 时间格式化工具函数
 */

/**
 * 格式化消息时间
 * - 今天: 显示时:分
 * - 昨天: 显示"昨天"
 * - 一周内: 显示星期几
 * - 更早: 显示月/日
 */
export function formatMessageTime(timeStr: string): string {
  const date = new Date(timeStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (daysDiff === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  if (daysDiff === 1) {
    return '昨天';
  }
  if (daysDiff < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[date.getDay()];
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
