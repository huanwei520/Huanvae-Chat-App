/**
 * 会议内远程控制——回环客户端（§7.3 控制面端面逐字段 + 数据面辅助）
 *
 * 端面（设计 §7.3 表逐字段；daemon＝块 A hv-control-daemon，回环明文 http://127.0.0.1）：
 *   controlArm()        POST /control/arm        共享开始挂受理（幂等；armed=true）
 *   controlDisarm()     POST /control/disarm     共享停止（触发 T10 强制拆除）
 *   controlIncoming(ev) POST /control/incoming   裁决事件转发（App dispatch 后，§6.4 daemon 权威）
 *   controlStatus()     GET  /control/status     状态巡检
 *   controlKillswitch() POST /control/killswitch 本地急停（§5.4）
 * 数据面辅助（块 A daemon 同源端点；帧渲染 §7.1 / 输入上行 §7.2）：
 *   controlFrameUrl()   GET  /control/frame
 *   controlInput(ev)    POST /control/input
 *
 * 刻意沿用 plugin-http（不迁 secure_http）：回环明文 http(127.0.0.1)，无 TLS、
 * 非后端数据面调用——huanvaeGuard localApi.ts 同款判例（注释原文见该文件头）。
 *
 * @module remote-control/api
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { ControlDaemonStatus, ControlIncomingEvent, ControlInputEvent } from './types';

/**
 * 控制 daemon 回环控制端口默认值。
 * 块 A（hv-control-daemon）定型后如端口有出入以 A 块为准；本键可被
 * localStorage `rc.control.port` 覆盖（多实例/自定义部署口）。
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

function baseUrl(): string {
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
  return fetch(`${baseUrl()}${path}`, {
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
    const resp = await fetch(`${baseUrl()}/control/status`, { connectTimeout: 1500 } as LoopbackFetchInit);
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

/** GET /control/frame —— 帧端点 URL（供 <img> 轮询；cache-bust 由调用方拼 query） */
export function controlFrameUrl(cacheBust?: number): string {
  const t = cacheBust ?? Date.now();
  return `${baseUrl()}/control/frame?t=${t}`;
}

/** POST /control/input —— 上行 0x06 域输入事件（§7.2；daemon 组帧经 P3 会话上行） */
export async function controlInput(ev: ControlInputEvent): Promise<boolean> {
  try {
    return (await postJson('/control/input', ev)).ok;
  } catch {
    return false;
  }
}
