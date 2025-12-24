/**
 * 时间格式化工具函数
 */

/**
 * 获取日期的零点时间戳（用于日期比较）
 */
function getDateStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 格式化消息时间
 * - 今天: 显示时:分
 * - 昨天: 显示"昨天 时:分"
 * - 一周内: 显示"星期几 时:分"
 * - 更早: 显示"月/日 时:分"
 */
export function formatMessageTime(timeStr: string): string {
  const date = new Date(timeStr);
  const now = new Date();

  // 获取日期零点进行比较（避免跨天问题）
  const dateStart = getDateStart(date);
  const todayStart = getDateStart(now);
  const daysDiff = Math.floor((todayStart - dateStart) / (1000 * 60 * 60 * 24));

  const timeStr24 = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (daysDiff === 0) {
    // 今天：只显示时间
    return timeStr24;
  }
  if (daysDiff === 1) {
    // 昨天
    return `昨天 ${timeStr24}`;
  }
  if (daysDiff < 7) {
    // 一周内：显示星期几
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${timeStr24}`;
  }
  // 更早：显示月/日
  const dateStr = date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return `${dateStr} ${timeStr24}`;
}
