/**
 * 隧道摘要的取数逻辑（纯逻辑，零 import）
 *
 * ## 为什么单独成文件
 * 本仓测试规范要求：纯逻辑抽到无依赖模块才能零 mock 单测
 * （HuanvaeGuardPage.tsx 顶层 import 了 `@tauri-apps/plugin-os` / `@tauri-apps/api/event`，
 *  从它 import 任何东西都会拖起整条 Tauri 模块加载链）。
 * 所以本文件**不得**引入任何 import —— React / Tauri / 本仓其它模块一概不许。
 *
 * ## 解决的问题（承接 213cc60「不再把『正常但空闲』显示成『坏了』」）
 * 状态冠要用一句话概括「这条隧道最近一次被证明还活着是什么时候」。
 * 天真写法 `Math.min(...peers.map(p => p.last_handshake))` 是**错的**：
 * `last_handshake` 是**距今秒数（age）**，而 `0` 有歧义 —— 它既可能是"从未握手"，
 * 也可能是"刚握手不到 1 秒"（见 format.ts 的长注释）。只要拓扑里有**任意一个**
 * 从未握手的对端，min 就会取到 0，整条隧道于是被报成「尚未握手」——
 * 哪怕另一个对端 4 秒前刚握过手。那正是把「正常」显示成「坏了」。
 *
 * 因此：**只在真正握过手的对端里取最新的那个**；一个都没有时返回 null，
 * 由调用方单独措辞（不许拼出「最近握手 尚未握手」这种自相矛盾的串）。
 */

/**
 * 取所有**确实握过手**的对端里最新的那一次握手的 age（秒）。
 *
 * @param peers 对端列表；只用到 `last_handshake`（距今秒数，**不是**绝对时间戳）
 * @returns 最小的正 age；没有任何对端握过手（或列表为空）时返回 null
 */
export function freshestHandshakeAge(peers: { last_handshake: number }[]): number | null {
  // age > 0 才算"握过手"：0 是歧义值（从未握手 / 刚握手不到 1 秒），
  // 拿它参与 min 会让一个空闲对端拖垮整条隧道的结论
  const ages = peers.map(p => p.last_handshake).filter(age => age > 0);
  if (ages.length === 0) {
    return null;
  }
  return Math.min(...ages);
}
