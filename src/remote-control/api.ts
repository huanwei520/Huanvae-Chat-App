/**
 * 会议内远程控制——回环客户端（§7.3 控制面端面逐字段 + 数据面辅助）
 *
 * 端面（设计 §7.3 表逐字段；daemon＝块 A hv-control-daemon，回环明文 http://127.0.0.1）：
 *   controlArm()        POST /control/arm        共享开始挂受理（幂等；armed=true）
 *   controlDisarm()     POST /control/disarm     共享停止（触发 T10 强制拆除）
 *   controlIncoming(ev) POST /control/incoming   裁决事件转发（App dispatch 后，§6.4 daemon 权威）
 *   controlStatus()     GET  /control/status     状态巡检
 *   controlKillswitch() POST /control/killswitch 本地急停（§5.4）
 * 数据面（帧渲染 §7.1 / 输入上行 §7.2；本块 dstdrrek-2 起会话在位时走
 * control-session DC 对端寻址，回环端点仅剩单机演示链与被控端注入汇）：
 *   controlFrameUrl()   GET  /control/frame（遗留面，仅无会话时）
 *   controlInput(ev)    0x06 InputEvent（会话→DC；无会话→POST /control/input）
 *
 * 刻意沿用 plugin-http（不迁 secure_http）：回环明文 http(127.0.0.1)，无 TLS、
 * 非后端数据面调用——huanvaeGuard localApi.ts 同款判例（注释原文见该文件头）。
 *
 * @module remote-control/api
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { ControlDaemonStatus, ControlIncomingEvent, ControlInputEvent } from './types';
// 跨端帧通道（本块 dstdrrek-2）：0x06 上行优先走会话对端（DC），回环仅剩本地 daemon 标准件
import { isPeerSessionActive, sendInput } from './frameChannel';

/**
 * 本机 daemon 回环控制端口默认值。
 * 块 A（hv-control-daemon）定型后如端口有出入以 A 块为准；本键可被
 * localStorage `rc.control.port` 覆盖（多实例/自定义部署口）。
 *
 * 🔴 寻址语义（本块 dstdrrek-2 收口）：该基址**仅**用于「本机 daemon 标准件」
 * 控制面（arm/disarm/incoming/status/killswitch）与被控端注入汇——bind_policy
 * 回环约束（设计 §5.4③）语义内。跨端数据面（控制窗帧流/点击移动上行）不再
 * 走本基址：controlInput()/ControlWindow 帧源在会话在位时改走 control-session
 * DataChannel 对端寻址（frameChannel.ts）。前代断链（4r2sli2c deliverable 6.5①：
 * baseUrl() 硬编码 127.0.0.1 ⇒ 控制窗帧=本机回环非对端屏）由此根除。
 */
export const DEFAULT_CONTROL_PORT = 19290;
const PORT_KEY = 'rc.control.port';

/** 解析本次会话要连的回环控制端口（localStorage 覆盖 → 默认常量） */
export function resolveControlPort(): number {
  try {
    const raw = localStorage.getItem(PORT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_CONTROL_PORT;
  } catch {
    return DEFAULT_CONTROL_PORT;
  }
}

/** 本机 daemon 回环基址（语义见 DEFAULT_CONTROL_PORT 注：仅标准件控制面/注入汇） */
function localDaemonBase(): string {
  return `http://127.0.0.1:${resolveControlPort()}`;
}

/** plugin-http fetch 初始化（connectTimeout 为 tauri 扩展字段，非标准 DOM RequestInit；
 *  本仓 eslint env 未注 DOM 全局（no-undef），以模块局部类型收口，2026-09-09） */
type LoopbackFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  connectTimeout?: number;
};

function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(`${localDaemonBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // 回环极速失败：daemon 不在时 1.5s 超时，避免 UI 挂死
    connectTimeout: 1500,
  } as LoopbackFetchInit);
}

/** POST /control/arm —— 共享开始挂受理（幂等） */
export async function controlArm(): Promise<boolean> {
  try {
    return (await postJson('/control/arm')).ok;
  } catch {
    return false;
  }
}

/** POST /control/disarm —— 共享停止（T10 强制拆除入口） */
export async function controlDisarm(): Promise<boolean> {
  try {
    return (await postJson('/control/disarm')).ok;
  } catch {
    return false;
  }
}

/** POST /control/incoming 应答（daemon grant 注册表推进结果；pending 态带其签发的 grant_id） */
export interface ControlIncomingResponse {
  state?: string;
  grant_id?: string;
  expires_in_ms?: number;
  error?: string;
  [k: string]: unknown;
}

/** POST /control/incoming —— 主 WS 裁决事件转发 daemon（§7.3 胶水；失败不阻塞 UI）。
 * 返回 daemon 应答（共享端据此把 daemon 签发的 grant_id 带回 M2，§3.2 T5）；不可达返回 null。 */
export async function controlIncoming(ev: ControlIncomingEvent): Promise<ControlIncomingResponse | null> {
  try {
    const resp = await postJson('/control/incoming', ev);
    if (!resp.ok) { return null; }
    return (await resp.json()) as ControlIncomingResponse;
  } catch {
    return null;
  }
}

/** GET /control/status —— 状态巡检（兼探活；daemon 不可达返回 null） */
export async function controlStatus(): Promise<ControlDaemonStatus | null> {
  try {
    const resp = await fetch(`${localDaemonBase()}/control/status`, { connectTimeout: 1500 } as LoopbackFetchInit);
    if (!resp.ok) { return null; }
    return (await resp.json()) as ControlDaemonStatus;
  } catch {
    return null;
  }
}

/** POST /control/killswitch —— 本地急停（§5.4 五段连锁入口） */
export async function controlKillswitch(): Promise<boolean> {
  try {
    return (await postJson('/control/killswitch')).ok;
  } catch {
    return false;
  }
}

/**
 * GET /control/frame —— 帧端点 URL（供 <img> 轮询；cache-bust 由调用方拼 query）。
 *
 * ⚠️ 遗留面（本块 dstdrrek-2 标注）：仅单机回环演示链使用。跨端会话的帧源是
 * control-session DC 上的 FrameSlice(0x07)（frameChannel.subscribeFrames），
 * ControlWindow 在会话在位时不再轮询本端点——本机回环帧冒充对端屏的旧断链面
 * 已从跨端路径摘除。
 */
export function controlFrameUrl(cacheBust?: number): string {
  const t = cacheBust ?? Date.now();
  return `${localDaemonBase()}/control/frame?t=${t}`;
}

/**
 * POST /control/input —— 上行 0x06 域输入事件（§7.2）。
 *
 * 寻址（本块 dstdrrek-2 会话化收口）：会话在位时优先经 control-session DC 直达
 * 会话对端（跨端点击/移动注入的真路径）；无会话时才落本机 daemon 回环（单机
 * 演示链遗留面，跨端拓扑永不触达）。postLocalInput 为本机回环投递原语，仅供
 * 被控端注入汇（frameChannel.relayInjection）使用——被控端把自己的对端输入
 * 落到本机注入标准件，不属于跨端寻址。
 */
export function controlInput(ev: ControlInputEvent): Promise<boolean> {
  if (isPeerSessionActive()) {
    return Promise.resolve(sendInput(ev));
  }
  return postLocalInput(ev);
}

/** POST 本机 daemon /control/input（回环投递原语；被控端注入汇专用） */
export async function postLocalInput(ev: ControlInputEvent): Promise<boolean> {
  try {
    return (await postJson('/control/input', ev)).ok;
  } catch {
    return false;
  }
}
