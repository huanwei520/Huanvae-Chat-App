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
 * 判定式：服务端说它在线，但它不是本机此刻正在跑的那台 ⇒ 它在别的终端上跑着。
 *
 * @param serverStatus **服务端原值** `HgDevice.status`（`'online' | 'offline' | 'unknown' | …`）。
 *   ⚠️ 必须传服务端原值，**不能**传 UI 覆盖后的值：页面为了让本机连上隧道后立刻显示在线，
 *   会把「本机正在用的那台」在展示层强制显示成 `'online'`；拿那个覆盖值来判定，
 *   会把本机自己这台也误判成被占用，连带废掉对它的锁定 / 解锁 / 删除操作。
 * @param isSelf 该设备是否就是本机此刻隧道在用的那台（本机隧道地址 === 该设备 virtual_ip）。
 * @returns true = 已被别的终端占用，不能再连。
 */
export function isDeviceOccupiedElsewhere(serverStatus: string, isSelf: boolean): boolean {
  return serverStatus === 'online' && !isSelf;
}
