/**
 * 会议内远程控制——跨窗事件总线常量（Tauri 事件；先例 MeetingPage.tsx:532
 * `emit('share-meeting-to-chat',…)` ← Main.tsx:74 `listen`）
 *
 * 方向（§4.3 窗口不变性）：
 * - 主窗（WS 属主）→ meeting 窗：rc-auth-request（展示授权弹层，meeting 窗只消费展示）
 * - meeting 窗 → 主窗：rc-auth-decision / rc-request-control（主窗经主 WS 发 M2/M1）
 * - 控制域 → meeting 窗：control-session-changed（§4.3 具名单向状态通知——
 *   meeting 窗只读展示「正在被控制」横幅，不回写、不触发 meeting 状态迁移）
 * - 主窗 → remote-control 窗：rc-session-state（终态/授权结果推进）
 *
 * @module remote-control/bus
 */

import type {
  ControlSessionRequestedData,
  ControlReleaseReason,
} from './types';

/** 主窗 → meeting 窗：授权请求弹层 */
export const RC_AUTH_REQUEST = 'rc-auth-request';
/** meeting 窗 → 主窗：共享者对申请的裁决（主窗发 M2） */
export const RC_AUTH_DECISION = 'rc-auth-decision';
/** meeting 窗 → 主窗：观看端 tile dev 菜单「申请控制」（主窗发 M1） */
export const RC_REQUEST_CONTROL = 'rc-request-control';
/** meeting 窗 → 主窗：观看端「停止远程控制」撤销（主窗经主 WS 发 M3）。
 * 2026-09-14 缺口③补：撤销与 M1 同模式跨窗转发（meeting 窗无主 WS 属权，
 * 直接调 sendControlSessionWs 摸不到主窗注册的 sender）。 */
export const RC_REQUEST_RELEASE = 'rc-request-release';
/** 控制域 → meeting 窗：§4.3 具名单向状态通知（「正在被 <name> 控制」横幅） */
export const CONTROL_SESSION_CHANGED = 'control-session-changed';
/** 主窗 → remote-control 窗：会话状态推进 */
export const RC_SESSION_STATE = 'rc-session-state';

export interface RcAuthRequestPayload {
  data: ControlSessionRequestedData;
  /** daemon grant 注册表为该申请签发的 pending grant_id（§7.3 回环应答；
   *  共享端点「接受」时回填进 M2.grant_id——grant_id 由共享端授权面签发，§3.2 T5） */
  daemon_grant_id?: string | null;
}

export interface RcAuthDecisionPayload {
  request_id: string;
  /** 模拟链路 grant_id（真实链路以服务器 N2 为准） */
  grant_id?: string | null;
  approved: boolean;
}

export interface RcRequestControlPayload {
  /** 发起 tile 的参会者展示名（申请记录/本地态展示用） */
  participant_name: string;
  /** 右键 tile 对应参会者的聊天 user_id（正式链路 M1.target_user_id 真值源，
   *  缺口③修复 2026-09-13：由 MeetingPage tile 的 data-rc-user-id 解析）。
   *  访客 tile / 未命中 tile 为 null —— 主窗仅 dev 构建回退 devTargetUser()，
   *  正式构建无目标不盲发（防止把控制申请发给硬编码占位用户）。 */
  target_user_id?: string | null;
}

export interface ControlSessionChangedPayload {
  /** null = 控制已结束（横幅撤下）；非空 = 正被该显示名控制 */
  controlledByName: string | null;
}

export interface RcSessionStatePayload {
  state: 'linking' | 'active' | 'released';
  grant_id?: string | null;
  /** N2 的 request_id（2026-09-14 补）：meeting 窗 rcGrant 镜像依赖它填 M3.request_id——
   *  服务端 validate_release 对空 request_id 回 control_release_malformed（实测复现）。 */
  request_id?: string;
  reason?: ControlReleaseReason;
}
