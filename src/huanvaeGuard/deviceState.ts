/**
 * VPN 设备「可否被本终端选取连接」的判定（纯逻辑，零 import）
 *
 * ## 为什么单独成文件
 * 本仓测试规范要求：纯逻辑抽到无依赖模块才能零 mock 单测
 * （HuanvaeGuardPage.tsx 顶层 import 了 `@tauri-apps/plugin-os` / `@tauri-apps/api/event`，
 *  从它 import 任何东西都会拖起整条 Tauri 模块加载链）。
 * 所以本文件**不得**引入任何 import —— React / Tauri / 本仓其它模块一概不许。
 *
 * ## 解决的问题（死锁 / lockout）
 * 同一台注册设备在 HG 侧只有一个 VPN IP、一份密钥。若两台终端同时拿它建隧道，
 * 两边会互相抢同一个地址 —— 必须在 UI 层就禁止选取「已经在别的终端跑着」的设备。
 */

/** 被占用设备的禁用原因（tooltip + 行内徽标共用，必须说清**为什么**不能选） */
export const OCCUPIED_HINT = '该设备已在其它终端连接运行中，不能重复连接';

/**
 * 判断某台设备是否「已被其它终端占用」——占用即不可再被本终端选取连接。
 *
 * 判定式：服务端说它在线，但它不由**本终端**持有 ⇒ 它在别的终端上跑着。
 *
 * @param serverStatus **服务端原值** `HgDevice.status`（`'online' | 'offline' | 'unknown' | …`）。
 *   ⚠️ 必须传服务端原值，**不能**传 UI 覆盖后的值：页面为了让本机连上隧道后立刻显示在线，
 *   会把「本机正在用的那台」在展示层强制显示成 `'online'`；拿那个覆盖值来判定，
 *   会把本机自己这台也误判成被占用，连带废掉对它的锁定 / 解锁 / 删除操作。
 * @param isHeldByThisTerminal 该设备的 VPN 地址是否由**本终端**持有。两种情形都算持有：
 *   ① 本机此刻隧道正用着它；② 本机**刚刚把它放开**、而服务端那份 `'online'` 还是没刷新的陈旧读数。
 *   这个集合由 {@link reconcileSelfHeldIps} 维护 —— 服务端读数一追上就不再算持有。
 * @returns true = 已被别的终端占用，不能再连。
 */
export function isDeviceOccupiedElsewhere(serverStatus: string, isHeldByThisTerminal: boolean): boolean {
  return serverStatus === 'online' && !isHeldByThisTerminal;
}

/** {@link reconcileSelfHeldIps} 需要的设备最小形状。本文件零 import，故用结构类型而非 `HgDevice`。 */
interface DeviceAddressStatus {
  virtual_ip: string;
  status: string;
}

/**
 * 维护「本终端持有的 VPN 地址」集合 —— 断开隧道后那台设备**当帧**重新可选的关键。
 *
 * ## 它修的是什么
 * 服务端 `HgDevice.status` 要等心跳超时才翻 `offline`，而本机一断开，隧道地址当帧就变 `null`。
 * 只看这两者，刚被本机放开的那台在服务端追上之前会被判成「已被其它终端占用」而灰掉
 * ——用户看到的就是「断开之后要等一段时间那台才重新可操作」。
 *
 * ## 两条规则，缺一不可
 * - **记住**：本机此刻在用的地址一定在集合里（连接期间每次调用都会补进来）。
 * - **忘掉**：已不是本机在用、且服务端读数**已经刷新**（该设备不再 `'online'`，或已从列表消失）
 *   的地址要移出集合。少了这一条，该地址会被永久放行 —— 之后别的终端真把它连起来时
 *   本终端不再灰掉它，等于废掉本文件开头写的死锁 / lockout 防护。
 *
 * 内容不变时**原样返回 `prev`**（引用稳定），调用方可以把返回值直接塞回 state 而不会自激。
 *
 * ## 已知边界（不藏着）
 * 「忘掉」这一条依赖**服务端最终会把该设备刷成非 `'online'`**。若某个服务端实现的心跳
 * 永不超时、该设备恒报 `'online'`，本终端就会一直把这个地址算作自己持有 ⇒ 别的终端接手时
 * 不再灰掉它。根治要服务端在断开时即时改状态（不在本仓）。这里**不加**「持有多久就过期」
 * 之类的计时兜底：那只是把一个确定的判据换成一个猜的阈值，且会让本次修的症状按时复发。
 *
 * @param prev 上一轮的集合
 * @param localTunnelIp 本机此刻隧道在用的地址（去掉 CIDR 前缀）；未连接为 null
 * @param devices 设备列表（只用到 `virtual_ip` + **服务端原值** `status`）
 */
export function reconcileSelfHeldIps(
  prev: readonly string[],
  localTunnelIp: string | null,
  devices: readonly DeviceAddressStatus[],
): readonly string[] {
  const kept = prev.filter(
    ip => ip === localTunnelIp
      || devices.some(d => d.virtual_ip === ip && d.status === 'online'),
  );
  const next = localTunnelIp !== null && !kept.includes(localTunnelIp)
    ? [...kept, localTunnelIp]
    : kept;
  const unchanged = next.length === prev.length && next.every((ip, i) => ip === prev[i]);
  return unchanged ? prev : next;
}
