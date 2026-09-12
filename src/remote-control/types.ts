/**
 * 会议内远程控制——域类型（设计 §3 状态机 / §6.3 消息格式镜像）
 *
 * 蓝本：/work/HuanvaeRemote/docs/p3-inmeeting-remote-control-design.md。
 * 载荷零凭据（§5.5）：只含 id/uuid/设备名/显示名/时间戳。
 *
 * @module remote-control/types
 */

/** 控制会话状态机（§3.2 双角色合并视图，App 侧观测粒度） */
export type ControlSessionState =
  | 'idle'        // Idle：无会话
  | 'requesting'  // Requesting：观看端已发 M1，等裁决（30s TTL，§3.3）
  | 'linking'     // Linking：收到 N2 approved，等待 P3 会话建立（20s，§3.3）
  | 'active'      // Active：会话建立，帧流/输入通道生效
  | 'released';   // Released：终态，权限永不自动恢复（§3.2 T14）

/** M3 `reason` 七枚举（§6.3 逐字） */
export type ControlReleaseReason =
  | 'revoked'
  | 'share_stopped'
  | 'participant_left'
  | 'timeout'
  | 'network'
  | 'error'
  | 'killswitch';

/** M1 `from{}` 四元组（§6.3） */
export interface ControlRequester {
  user_id: string;
  device_id: string;
  device_name: string;
  display_name: string;
}

/** `meeting_ctx{}` 可选关联（§6.3） */
export interface ControlMeetingCtx {
  room_id: string;
  participant_id: string;
}

/** N1 data 载荷（§6.3 下行表逐字段；服务器以 JWT claims 重写 from 的 user/device） */
export interface ControlSessionRequestedData {
  request_id: string;
  from: ControlRequester;
  meeting_ctx: ControlMeetingCtx | null;
  created_at: number;
}

/** N2 data 载荷（§6.3 下行表逐字段） */
export interface ControlSessionDecidedData {
  request_id: string;
  grant_id: string | null;
  approved: boolean;
  by: { user_id: string };
  decided_at: number;
}

/** N3 data 载荷（§6.3 下行表逐字段） */
export interface ControlSessionReleasedData {
  grant_id: string;
  request_id: string;
  reason: ControlReleaseReason;
  by: { user_id: string; device_id: string };
  released_at: number;
}

/**
 * 回环 /control/incoming 事件信封（App → 本机 daemon 的裁决事件转发，§7.3 胶水）。
 * 形态与 daemon 侧 serde 变体逐字对齐（hv-control-demo control.rs IncomingEvent：
 * `tag="kind"` + 变体字段扁平并列，kind = 设计 §6.3 的 N1/N2/N3 wire 名
 * control_session_requested|decided|released）。先前「短形 kind + data 嵌套」
 * 信封会被 daemon 400（missing field request_id，2026-09-08 对齐修正）。
 * daemon 为授权状态权威（§6.4），按 kind 推进其 grant 注册表；未列字段
 * （meeting_ctx/device_name/display_name/created_at）serde 忽略，可带可不带。
 */
export type ControlIncomingEvent =
  | {
      kind: 'control_session_requested';
      request_id: string;
      from: ControlRequester;
      meeting_ctx?: ControlMeetingCtx | null;
      created_at?: number;
    }
  | { kind: 'control_session_decided'; request_id: string; grant_id?: string | null; approved: boolean }
  | { kind: 'control_session_released'; grant_id: string; request_id?: string; reason?: ControlReleaseReason };

/** GET /control/status 应答（daemon 状态巡检；daemon 侧为块 A hv-control-daemon） */
export interface ControlDaemonStatus {
  ok: boolean;
  armed?: boolean;
  grant_state?: string | null;
  grant_id?: string | null;
  inject_count?: number;
  frame_count?: number;
  /** 采集屏幕几何（width/height），坐标换算终段 frame→screen 用（§7.2） */
  screen?: { width: number; height: number } | null;
  [k: string]: unknown;
}

/** 上行输入事件（0x06 InputEvent 域值，§7.2；daemon 负责组帧上行） */
export interface ControlInputEvent {
  /** screen 坐标（u16 域） */
  x: number;
  y: number;
  /** 位掩码快照：bit0 左 / bit1 右 / bit2 中（session.rs:17） */
  buttons: number;
  /** 键码集合快照（X11 keysym 低 16 位，§7.2 最小键位表） */
  keys: number[];
}
