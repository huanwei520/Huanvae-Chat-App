/**
 * HuanvaeGuard 安卓取数轨（阶段 2b 前端双轨 · 安卓侧）
 *
 * ## 为什么独立成模块
 * 桌面轨（localApi.ts）是「回环明文 http」专供：它的端口解析、超时、CORS 语义全部
 * 绑定「本机守护进程」这个形态。安卓上没有守护进程 —— Guard 能力由阶段 2a 自研插件
 * `tauri-plugin-hg-guard` 的命令面直接在进程内提供（勘察交付 §5 路径 C）。两条轨道
 * 的传输层毫无交集，独立模块让 localApi 的桌面路径**零改动**（本阶段验收④），
 * 分流只在页面层按 `platform()==='android'` 做。
 *
 * ## 命令面（与阶段 2a 交付 §2.1 契约表一一对应，此处只列消费面）
 *   hg_status         无参 → { available, bridgeVersion, statusCode, statusJson }
 *   hg_connect        { masterUrl, session } → { ok, statusCode }，两步制：未授权拒绝
 *                     `hg_guard_vpn_not_prepared`，由本模块先 prepare 后重试（授权闸）
 *   hg_disconnect     无参 → { ok, statusCode }（幂等，内部已停控制面）
 *   hg_prepare_vpn    无参 → { authorized }
 *   hg_control_start  { masterUrl, session } → { ok }
 *   hg_control_stop   无参 → { ok }（幂等）
 * 通道：`invoke('plugin:hg-guard|<cmd>', args)`；Rust 命令参数 snake_case，
 * JS 侧传 camelCase（tauri 自动转换）。
 *
 * ## 轮询投影（2a 既定决策）
 * Rust 核心无 Rust→Kotlin 回调出口（勘察 §2.2），状态事件面挂起，安卓轨以 hg_status
 * 轮询投影。页面侧 probeService 的 3s 单飞语义不变，只是取数函数换成本模块的 getStatus。
 *
 * ## statusJson 投影（tunnelSummary.ts 五态判定零改动复用的依据）
 * 插件返回的 statusJson = Guard 核心 `HgNative.statusJson()` 原文，字段
 * status_code/active/interface_name/address/listen_port/peers[]/control_plane/last_error
 * 与桌面 TunnelStatus 同型（安卓 TunnelStatus 多 status_code/last_error 两字段，页面
 * 不消费、不影响）。control_plane 字段与桌面 ControlPlaneStatus 逐字段同构 ⇒ 页面的
 * controlPlaneWarning 五态判定原样可用。注意 Kotlin 侧是字符串承载（JSObject.put 一个
 * JSON 字符串），跨 IPC 后 JS 拿到 string，此处负责 JSON.parse。
 *
 * ## redact 纪律
 * 会话 JSON（device_id/access_token[/refresh_token]/master_url）只在本模块内存中构造、
 * 经 invoke 参数直传插件（插件内走管道 fd 入 Rust 核心）。不落盘、不打日志；错误文案
 * 只透传插件/核心给的 redact 后缀，绝不拼接凭据原值。
 */

import { invoke } from '@tauri-apps/api/core';
import type { TunnelStatus } from './types';

/** 阶段 2a 插件命令面（tauri-plugin-hg-guard，仅安卓注册） */
const CMD = {
  status: 'plugin:hg-guard|hg_status',
  connect: 'plugin:hg-guard|hg_connect',
  disconnect: 'plugin:hg-guard|hg_disconnect',
  prepareVpn: 'plugin:hg-guard|hg_prepare_vpn',
  controlStart: 'plugin:hg-guard|hg_control_start',
  controlStop: 'plugin:hg-guard|hg_control_stop',
} as const;

/** hg_status 返回（插件契约：available=false 时其余字段缺省） */
interface HgStatusPayload {
  available?: boolean;
  bridgeVersion?: number;
  statusCode?: number;
  /** Kotlin 侧以 JSON 字符串承载（HgGuardPlugin.hgStatus：`HgNative.statusJson()` 原文） */
  statusJson?: string | null;
}

export interface GuardStatusSnapshot {
  /** 桥可用（libhg_android.so 加载 + BRIDGE_VERSION 自检通过）——投影为页面的「组件就绪」 */
  available: boolean;
  /** statusJson 解析结果（与桌面 TunnelStatus 同型；桥不可用/未就绪为 null） */
  status: TunnelStatus | null;
}

/** 单次探活：hg_status → 投影。抛错（IPC 失败等）交调用方按「不可用」处理。 */
export async function getStatus(): Promise<GuardStatusSnapshot> {
  const r = await invoke<HgStatusPayload>(CMD.status);
  if (r?.available !== true) {
    return { available: false, status: null };
  }
  const raw = r.statusJson;
  if (typeof raw !== 'string' || raw === '') {
    return { available: true, status: null };
  }
  return { available: true, status: JSON.parse(raw) as TunnelStatus };
}

/** 构造 hg_connect / hg_control_start 的会话参数（任务卡第 2 项的入参形态） */
export interface GuardSessionParams {
  /** master 源站（明文字段，插件契约里唯一非凭据入站） */
  masterUrl: string;
  /** 用户 UUID（核心 StoredSession 必填字段；server 端配置拉取的用户上下文） */
  userId: string;
  /** Guard 设备 UUID = 页面选中的那台设备（控制面寻址 /api/hg/devices/{id}/config） */
  deviceId: string;
  /** 用户 JWT（拉配置与控制面凭据） */
  accessToken: string;
  /** 续期令牌；可缺，但缺了控制链会在 access_token 过期后死掉（与桌面同纪律：说出来） */
  refreshToken?: string;
}

export interface GuardStartResult {
  ok: true;
  /** 控制面是否已启动。false = 隧道已在跑但控制面失败（镜像桌面 CONTROL_PLANE_START_FAILED
   * 语义：接口照样成功、cp-warn 告警条经轮询投影说话），controlError 带失败原因供日志。 */
  controlStarted: boolean;
  controlError?: string;
}

/**
 * 建立隧道（安卓全链）：hg_connect（含授权闸重试）→ hg_control_start。
 *
 * 拉配置（serverApi.getDeviceConfig 的安卓对应物）在 hg_connect 内部完成
 * （controlFetchConfig 就地归一化 /32、listen_port=0），前端不再单拉配置。
 * 控制面启动失败不中止：隧道已建立，健康度由 hg_status 的 control_plane 字段
 * 经常驻轮询投影成页面 cp-warn 告警条 —— 与桌面「不带 control 的 start 照样 200、
 * 告警条说话」的既有语义对齐。
 */
export async function startTunnel(p: GuardSessionParams): Promise<GuardStartResult> {
  const session = buildSessionJson(p);
  await connectWithVpnAuthGate(p.masterUrl, session);

  let controlStarted = true;
  let controlError: string | undefined;
  try {
    await invoke(CMD.controlStart, { masterUrl: p.masterUrl, session });
  } catch (e) {
    controlStarted = false;
    controlError = describeError(e);
  }
  return { ok: true, controlStarted, controlError };
}

/**
 * 断开：hg_disconnect（幂等：控制面 + 隧道 + 服务收尾）后按任务卡契约再显式
 * hg_control_stop 一发（同为幂等；hg_disconnect 内部已停一次，这里是契约面上
 * 的显式收尾，两次调用都安全）。
 */
export async function stopTunnel(): Promise<void> {
  await invoke(CMD.disconnect);
  await invoke(CMD.controlStop);
}

/**
 * 授权闸（两步制）：hg_connect 未授权时拒绝 `hg_guard_vpn_not_prepared`、不自动弹窗
 * （插件选型，见 2a 交付 §2.3）—— 本模块显式 hg_prepare_vpn，用户同意后重试一次。
 * 用户拒绝 → 人话错误抛给页面错误横幅；重试仍 not_prepared → 按原样抛（describeError
 * 会给「去授权」指引）。
 */
async function connectWithVpnAuthGate(masterUrl: string, session: string): Promise<void> {
  try {
    await invoke(CMD.connect, { masterUrl, session });
    return;
  } catch (e) {
    // 实测（2026-09-08 模拟器真机）：插件经 run_mobile_plugin 转发的 reject 带包装前缀
    // （形态："hg_guard: mobile invoke hgConnect failed: hg_guard_vpn_not_prepared"），
    // 故用 includes 而非 startsWith —— 授权闸必须对包装形态同样生效，否则弹窗永不出现。
    if (!toText(e).includes('hg_guard_vpn_not_prepared')) {
      throw e;
    }
  }
  const prep = await invoke<{ authorized?: boolean }>(CMD.prepareVpn);
  if (prep?.authorized !== true) {
    throw new Error('VPN 授权未通过：未能在系统弹窗中允许建立 VPN 连接，已取消连接');
  }
  await invoke(CMD.connect, { masterUrl, session });
}

/**
 * 会话 JSON（核心 StoredSession 反序列化契约，control.rs:36-56）：
 * master_url / user_id / device_id / access_token / refresh_token?。键名是线格式，
 * 不许改拼法；user_id 为核心必填字段（缺它 fetch_config 反序列化即拒：missing field）。
 * 值全部来自运行时入参 —— 本模块无任何字面量凭据（验收⑤机扫面）。
 */
function buildSessionJson(p: GuardSessionParams): string {
  const session: Record<string, string> = {
    master_url: p.masterUrl,
    user_id: p.userId,
    device_id: p.deviceId,
    access_token: p.accessToken,
  };
  // 空串与缺失同义（JSON.stringify 丢 undefined 键是桌面轨先例；此处显式跳过空串）
  if (p.refreshToken) {
    session.refresh_token = p.refreshToken;
  }
  return JSON.stringify(session);
}

/**
 * reject 前缀族 → 页面人话错误条（验收⑦映射表的实现处）。
 * 后缀 detail 来自插件/Rust 核心的 redact 文案（2a 契约：只含异常类名/错误码），
 * 原样透传；本函数绝不拼接会话/令牌值。
 */
export function describeError(e: unknown): string {
  const msg = toText(e);
  for (const { prefix, text } of REJECT_PREFIX_HINTS) {
    // 用 indexOf 而非 startsWith：插件转发层会包一层（"hg_guard: mobile invoke
    // hgConnect failed: <前缀>…"），人话映射必须对包装形态同样生效。
    const idx = msg.indexOf(prefix);
    if (idx >= 0) {
      // 空后缀（reject 恰为裸前缀）时 detail 为空串，无参模板忽略之；
      // 带后缀模板拼上 redact 明细。detail 绝不含凭据（插件/核心侧已 redact）。
      const detail = msg.slice(idx + prefix.length).replace(/^[:\s]+/, '').trim();
      return text(detail);
    }
  }
  return msg;
}

function toText(e: unknown): string {
  if (typeof e === 'string') { return e; }
  if (e instanceof Error) { return e.message; }
  return String(e);
}

/** 前缀 → 人话模板。顺序即匹配顺序（无前缀互为前缀的冲突）。 */
const REJECT_PREFIX_HINTS: readonly { prefix: string; text: (detail: string) => string }[] = [
  {
    prefix: 'hg_guard_bridge_unavailable',
    text: (detail) => `Guard 原生组件不可用（桥加载失败或版本不匹配${detail ? `：${detail}` : ''}）。请重启应用后重试；若仍复现，说明此构建未包含可用的 Guard 组件`,
  },
  {
    prefix: 'hg_guard_invalid_args',
    text: (detail) => `Guard 调用参数错误（应用缺陷）：${detail}`,
  },
  {
    prefix: 'hg_guard_fetch_config_failed',
    text: (detail) => `获取设备配置失败：${detail}`,
  },
  {
    prefix: 'hg_guard_vpn_not_prepared',
    text: () => 'VPN 尚未获得系统授权：请重试，并在系统弹窗中允许建立 VPN 连接',
  },
  {
    prefix: 'hg_guard_start_service_failed',
    text: (detail) => `VPN 服务启动失败：${detail}（可能是系统前台服务限制，请回到前台重试）`,
  },
  {
    prefix: 'hg_guard_control_failed',
    text: (detail) => `控制面启动失败：${detail}`,
  },
];
