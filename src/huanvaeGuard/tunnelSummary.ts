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

/**
 * 控制面（配置热更新链路）读数的形状。
 *
 * 结构式声明、**不 import** `types.ts` 的 `ControlPlaneStatus` —— 本文件顶部那条
 * 「零 import」不变量是它能被零 mock 单测的全部理由（与 `freshestHandshakeAge` 的
 * `peers: { last_handshake: number }[]` 同一个写法）。两处不会漂：调用方传进来的就是
 * `TunnelStatus['control_plane']`，字段一改，调用点当场 typecheck 失败。
 */
interface ControlPlaneReading {
  enabled: boolean;
  connected: boolean;
  applied_peers: number;
  applied_at?: number;
  last_error?: string;
  auth_failures: number;
}

/**
 * 隧道在跑、而**配置热更新这条链路不健康**时，要摆到用户脸上的那句话；健康则返回 null。
 *
 * ## 为什么这个函数必须存在
 * 上级给的通用规矩，原样抄在这里：**一个功能缺失时，界面不许显示成功。**
 * 这条比接线本身更重要 —— 接线可能哪天又被改掉（本次修的正是"接线从来没做过"），
 * 而"缺了会喊"是唯一能长期挡住它的东西。
 *
 * 控制面坏掉的全部症状是「什么都没发生」：`/api/tunnel/start` 200、`active: true`、
 * 对端表照常有数字，只是**后来加入的设备永远不出现**。用户没有任何理由怀疑界面，
 * 所以这句话不说出来就等于没有。
 *
 * ## 五种读数必须可区分（处置各不相同，压成一句就等于没说）
 * | 读数 | 含义 | 用户该做什么 |
 * |---|---|---|
 * | `undefined` | 守护进程**根本没下发**这个字段 ⇒ 旧版本 | 升级 / 修复守护进程 |
 * | `enabled=false` 且无 `last_error` | 本次启动**没带凭据**（守护进程走了 `CONTROL_PLANE_ABSENT`） | 断开重连；仍旧则报缺陷 |
 * | `enabled=false` 且有 `last_error` | 带了凭据但控制链**启动失败**（`CONTROL_PLANE_START_FAILED`） | 看原因，多为 TLS / 参数 |
 * | `enabled=true, connected=false` | 曾经连上、**此刻断了**（重连中） | 等；持续不恢复看原因 |
 * | `enabled=true, connected=true` 但有 `last_error` | 连着，但守护进程报了一件**热更新办不到的事** | 按原因处理（多为"需重启隧道"） |
 *
 * 最后一行不在最初的四态里，是读守护进程源码补的：`NodeMigrated` / `ObfsChanged` 两个分支
 * 只写 `last_error` 而**不动** `connected`（daemon.rs 的 `handle_event`），
 * 因为中继迁移 / 混淆参数轮换**没法热更新、必须重建隧道**。漏掉这一行，
 * 正好是这套判据里唯一一处"链路好好的、功能却真的失效了"，也就正好是它要防的那种失败。
 *
 * ## 为什么 `auth_failures` 只当后缀、不单独触发
 * access_token 900 秒就过期，长命隧道**正常**会走「被拒 → 刷新 → 重连」，
 * 于是 `auth_failures > 0` 在健康链路上也是常态。拿它单独报警 = 一条永远亮着的红灯，
 * 训练所有人忽略红灯。所以它只在**别的判据已经判定不健康**时追加一句次数。
 *
 * @param cp 守护进程 `/api/tunnel/status` 里的 `control_plane`；旧守护进程为 `undefined`
 * @returns 要显示的告警原文；链路健康时 `null`（调用方据此决定显不显示）
 */
export function controlPlaneWarning(cp: ControlPlaneReading | undefined): string | null {
  if (cp === undefined) {
    return '守护进程版本过旧，配置热更新不可用：本次连接之后新增的设备不会自动出现，需要断开重连才能看到。请点「修复服务」升级守护进程';
  }

  // 已判定不健康时才追加：说清"凭据被拒过几次"，但绝不拿它单独当报警条件（理由见上）
  const authNote = cp.auth_failures > 0 ? `（凭据已被拒绝 ${cp.auth_failures} 次）` : '';

  if (!cp.enabled) {
    return cp.last_error === undefined
      ? `未启用配置热更新（本次启动未携带控制面凭据）：新增的设备不会自动出现${authNote}`
      : `配置热更新启动失败：${cp.last_error}${authNote}`;
  }

  if (!cp.connected) {
    const why = cp.last_error === undefined ? '' : `：${cp.last_error}`;
    return `配置热更新已断开${why}${authNote}`;
  }

  if (cp.last_error !== undefined) {
    return `配置热更新报告了一个问题：${cp.last_error}${authNote}`;
  }

  return null;
}
