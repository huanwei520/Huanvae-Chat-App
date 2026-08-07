/**
 * HuanvaeGuard 共享格式化工具（纯函数，无副作用 import）
 */

/**
 * 10 年的秒数。超过它的入参一定不是 age（见 formatHandshake 的"时间异常"守卫）。
 * 315_360_000 = 10 * 365 * 24 * 3600
 */
const TEN_YEARS_SECONDS = 315_360_000;

/**
 * 把守护进程给出的"上次握手距今秒数（age）"格式化为中文相对时间
 *
 * ⚠️ 入参语义：**距今秒数（age）**，**不是**绝对 Unix 时间戳。
 * 真值源 = HuanvaeGuard 仓 `client/windows/src/uapi.rs` 的 `handshake_age_secs()`
 * （macOS `hg-macos` 同名同逻辑）——它把 UAPI 下发的 `last_handshake_time_sec`
 * （那个才是绝对 Unix 时间戳）换算成 age 之后才放进 `/api/tunnel/status` 的 peer 段。
 *
 * 🔴 `0` 是有歧义的，**不能**被解读成"从未握手"：`handshake_age_secs()` 对两种
 * 完全不同的情况都返回 0 ——
 *   ① peer 从未握手（核心侧 `core/src/device/api.rs` 在 peer 从未握手时**整段省略**
 *      `last_handshake_time_sec` 行，解析器默认取 0）；
 *   ② **刚握手完不到 1 秒**（`now - abs == 0`）。
 * 所以文案用"尚未握手"而不是"从未"：daemon 既然区分不了这两者，UI 就不该替它下断言。
 * "从未"读起来像永久失败（用户会当成坏了），"尚未"只陈述"当前没有可报告的握手时间"。
 *
 * 📛 历史教训（本项目同一字段已栽过两次）：把 age 当成绝对 epoch 去算差值，得到
 * 17.8 亿秒的荒谬值，设备状态因此恒为 offline。为此加了下面这条守卫。
 *
 * 守卫（**不是兜底，是拒绝撒谎**）：入参 > 10 年（315_360_000 秒）时返回 "时间异常"。
 * 这个量级只可能是有人把**绝对 Unix 时间戳**当 age 传了进来（正是上面那个回归）。
 * 旧代码遇到它会渲染出"49 万小时前"——一句**看起来像真话的假话**；守卫把它变成
 * 一眼可见的异常。这里**刻意不做任何自动换算**：自动换算 = 掩盖回归，违反本仓
 * CLAUDE.md 的「禁兜底」。
 *
 * - >10 年 → "时间异常"
 * - 0      → "尚未握手"（从未握手 / 刚握手不到 1 秒，二者不可分辨）
 * - <60    → "N 秒前"
 * - <3600  → "N 分钟前"
 * - 其他   → "N 小时前"
 */
export function formatHandshake(ageSeconds: number): string {
  // 守卫必须在最前：否则荒谬值会掉进下面的 "N 小时前" 分支，渲染成看似合理的假话
  if (ageSeconds > TEN_YEARS_SECONDS) { return '时间异常'; }
  if (ageSeconds === 0) { return '尚未握手'; }
  if (ageSeconds < 60) { return `${ageSeconds} 秒前`; }
  if (ageSeconds < 3600) { return `${Math.floor(ageSeconds / 60)} 分钟前`; }
  return `${Math.floor(ageSeconds / 3600)} 小时前`;
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
