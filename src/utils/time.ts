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

/** 安全解析 ISO 时间；无效返回 null */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 格式化为「YYYY年M月D日」（注册时间 / 成为好友时间 / 拉黑时间等纯日期展示）。
 * 无效时间返回空串（调用方据此隐藏该行）。
 */
export function formatDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) {
    return '';
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 格式化好友「最后在线」为相对时间。
 * - <1 分钟：刚刚
 * - <60 分钟：N 分钟前
 * - 同一天内：N 小时前
 * - 跨天：走 formatMessageTime（昨天/周几/月日 + 时:分）
 * 无效时间返回空串。
 */
export function formatLastSeen(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) {
    return '';
  }
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return '刚刚';
  }
  if (diffMin < 60) {
    return `${diffMin}分钟前`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24 && getDateStart(d) === getDateStart(new Date())) {
    return `${diffHour}小时前`;
  }
  return formatMessageTime(iso as string);
}
