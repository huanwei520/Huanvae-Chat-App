/**
 * HuanvaeGuard 共享格式化工具（纯函数，无副作用 import）
 */

/**
 * 把"距上次握手的秒数"格式化为中文相对时间
 * - 0 → "从未"
 * - <60 → "N 秒前"
 * - <3600 → "N 分钟前"
 * - 其他 → "N 小时前"
 */
export function formatHandshake(secondsAgo: number): string {
  if (secondsAgo === 0) { return '从未'; }
  if (secondsAgo < 60) { return `${secondsAgo} 秒前`; }
  if (secondsAgo < 3600) { return `${Math.floor(secondsAgo / 60)} 分钟前`; }
  return `${Math.floor(secondsAgo / 3600)} 小时前`;
}

/**
 * 把 @tauri-apps/plugin-os 的 platform() 原子值映射为设备注册上报用的展示名（os 字段）
 * - 'windows' → 'Windows'
 * - 'macos'   → 'macOS'
 * - 'linux'   → 'Linux'
 * - 其他/空   → 原值或 'Unknown'
 */
export function osLabel(platform: string): string {
  switch (platform) {
    case 'windows': return 'Windows';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    default: return platform || 'Unknown';
  }
}
