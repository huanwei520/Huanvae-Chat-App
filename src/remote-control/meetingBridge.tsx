/**
 * meeting 窗内控制域桥（dev 门控面；由 MeetingPage 挂载一次）
 *
 * 组成（全部 isDevControl() 门控，生产构建死代码摇树）：
 * - 授权弹层挂载点（ControlAuthPopup；监听主窗 rc-auth-request 事件）
 * - dev 面板：模拟收到控制申请 / 模拟共享开始（arm）/ 模拟共享停止（disarm）/
 *   模拟控制结束（banner 撤下）/ 本地急停（killswitch）
 * - 「正在被 <name> 控制」横幅（§4.3 control-session-changed 单向消费展示）
 * - tile 右键 dev 菜单「申请控制」（观看端；emit rc-request-control → 主窗发 M1）
 * - dev bootstrap：无 meetingData 时 seed 演示数据（isDevControl() 时不再 window.close()）
 *
 * @module remote-control/meetingBridge
 */

import { useCallback, useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { controlArm, controlDisarm, controlKillswitch } from './api';
import {
  CONTROL_SESSION_CHANGED,
  RC_AUTH_DECISION,
  RC_AUTH_REQUEST,
  RC_REQUEST_CONTROL,
  type ControlSessionChangedPayload,
  type RcAuthRequestPayload,
} from './bus';
import { isDevControl } from './devGate';
import ControlAuthPopup from './ControlAuthPopup';
import type { ControlSessionRequestedData } from './types';

/** dev 演示目标（tile 菜单「申请控制」的主窗侧目标用户，localStorage 可覆盖） */
export const DEV_TARGET_USER_KEY = 'rc.dev.target-user';

/**
 * dev 目标用户解析链（主窗 M1 target_user_id 同链，mainBridge 消费）：
 * localStorage `rc.dev.target-user` ?? 构建期注入 `VITE_DEV_RC_TARGET` ?? 演示默认。
 * 仅 dev 门控面消费；生产构建本模块不挂载。
 */
export function devTargetUser(): string {
  return (
    localStorage.getItem(DEV_TARGET_USER_KEY) ??
    (import.meta.env.VITE_DEV_RC_TARGET as string | undefined) ??
    'dev-sharer-user'
  );
}

export interface MeetingBridgeProps {
  /** 是否正在屏幕共享（模拟共享开始/停止按钮的禁用态用） */
  screenSharing: boolean;
}

function uuidLike(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) { return crypto.randomUUID(); }
  return `rc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** dev 演示用模拟申请（零真实凭据，§5.5：只含 id/显示名/时间戳） */
function mockRequest(): ControlSessionRequestedData {
  return {
    request_id: uuidLike(),
    from: {
      user_id: localStorage.getItem(DEV_TARGET_USER_KEY) ?? 'dev-watcher-user',
      device_id: 'dev-watcher-device',
      device_name: 'watcher-dev-pc',
      display_name: '演示观看者',
    },
    meeting_ctx: { room_id: 'dev-room', participant_id: 'dev-participant' },
    created_at: Date.now(),
  };
}

export function MeetingBridge({ screenSharing }: MeetingBridgeProps) {
  const [authRequest, setAuthRequest] = useState<ControlSessionRequestedData | null>(null);
  /** daemon grant 注册表为当前弹层申请签发的 pending grant_id（§3.2 T5；RC_AUTH_REQUEST 载荷回传） */
  const [authGrantId, setAuthGrantId] = useState<string | null>(null);
  const [controlledByName, setControlledByName] = useState<string | null>(null);
  const [sharingOn, setSharingOn] = useState(screenSharing);
  const [daemonNote, setDaemonNote] = useState<string | null>(null);

  useEffect(() => setSharingOn(screenSharing), [screenSharing]);

  // —— 主窗 → meeting 窗：授权请求展示（真实 N1 路径）——
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<RcAuthRequestPayload>(RC_AUTH_REQUEST, (ev) => {
      setAuthRequest(ev.payload.data);
      setAuthGrantId(ev.payload.daemon_grant_id ?? null);
    }).then((fn) => { un = fn; }).catch(() => undefined);
    return () => { un?.(); };
  }, []);

  // —— 控制域 → meeting 窗：§4.3 单向横幅（只读展示，不回写 meeting 状态）——
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<ControlSessionChangedPayload>(CONTROL_SESSION_CHANGED, (ev) => {
      setControlledByName(ev.payload.controlledByName);
    }).then((fn) => { un = fn; }).catch(() => undefined);
    return () => { un?.(); };
  }, []);

  // —— 授权裁决：meeting 窗 → 主窗（主窗发 M2）＋本地演示推进 ——
  const onDecide = useCallback((approved: boolean, req: ControlSessionRequestedData) => {
    setAuthRequest(null);
    // 测试面插桩：X 窗口标题可直接读（xdotool），零绘制依赖——验证弹层链路用
    document.title = `视频会议|decided=${approved}`;
    // grant_id 权威＝共享端 daemon 签发的 pending grant_id（§3.2 T5，随 RC_AUTH_REQUEST
    // 载荷回传）；daemon 缺席时才退回本地自造（单机演示链路），留痕不静默。
    const grantId = authGrantId ?? uuidLike();
    void emit(RC_AUTH_DECISION, {
      request_id: req.request_id,
      grant_id: approved ? grantId : null,
      approved,
    }).catch(() => undefined);
    if (approved) {
      // 真实链路：控制窗口由观看端 N2 分支（dispatch.ts → openRemoteControlWindow）
      // 开窗；共享端不开控制窗（单机双角色演示的本地开窗已移除，2026-09-08）。
      // 本地立即呈现「正在被控制」（真实链路由 N3/daemon 状态驱动横幅）
      setControlledByName(req.from?.display_name ?? '对方');
    }
  }, [authGrantId]);

  // —— dev 面板动作 ——
  const simulateIncomingRequest = useCallback(() => {
    setAuthRequest(mockRequest());
    // 测试面插桩：弹层 setState 同步标记（零绘制依赖验证渲染链路）
    document.title = '视频会议|popup=ON';
  }, []);

  const simulateShareStart = useCallback(async () => {
    const ok = await controlArm();
    setSharingOn(true);
    setDaemonNote(ok ? 'arm 已送达 daemon' : 'daemon 未连接（arm 为本地态演示）');
  }, []);

  const simulateShareStop = useCallback(async () => {
    const ok = await controlDisarm();
    setSharingOn(false);
    setControlledByName(null);
    setDaemonNote(ok ? 'disarm 已送达 daemon' : 'daemon 未连接（disarm 为本地态演示）');
  }, []);

  const simulateControlEnd = useCallback(() => {
    setControlledByName(null);
    void emit(CONTROL_SESSION_CHANGED, { controlledByName: null }).catch(() => undefined);
  }, []);

  const killswitch = useCallback(async () => {
    const ok = await controlKillswitch();
    setSharingOn(false);
    setControlledByName(null);
    setDaemonNote(ok ? 'killswitch 已触发（五段连锁，§5.4）' : 'daemon 未连接（急停为本地态演示）');
  }, []);

  // —— 观看端真实申请（dev 门控）：emit → 主窗 MainBridge 发 M1（真主 WS 上行，
  //    target_user_id = devTargetUser() 解析链）。与「模拟收到控制申请」的区别：
  //    本按钮走 chat 后端真实路由（M1→N1），模拟按钮只本地 setState。 ——
  const realRequestControl = useCallback(() => {
    void emit(RC_REQUEST_CONTROL, { participant_name: 'watcher-dev' }).catch(() => undefined);
  }, []);

  return (
    <>
      <ControlAuthPopup request={authRequest} onDecide={onDecide} />

      {controlledByName && (
        <div className="rc-banner">正在被 {controlledByName} 控制</div>
      )}

      {/* dev 面板仅 VITE_DEV_CONTROL=1 构建渲染；正式构建只保留授权弹层＋横幅
          （正式功能入口），模拟按钮群不进入正式包（缺口③修复，2026-09-13） */}
      {isDevControl() && (
        <div className="rc-devpanel" data-testid="rc-devpanel">
          <span className="rc-devpanel__title">远程控制 dev 面板（VITE_DEV_CONTROL=1）</span>
          <div className="rc-devpanel__row">
            <button onClick={simulateIncomingRequest}>模拟收到控制申请</button>
            <button onClick={realRequestControl}>申请控制（真 WS）</button>
            <button onClick={simulateShareStart} disabled={sharingOn}>
              模拟共享开始
            </button>
            <button onClick={simulateShareStop} disabled={!sharingOn}>
              模拟共享停止
            </button>
            <button onClick={simulateControlEnd}>模拟控制结束</button>
            <button onClick={killswitch}>本地急停</button>
          </div>
          <span className="rc-devpanel__note">
            共享态：{sharingOn ? '共享中' : '未共享'} · {daemonNote ?? '（等待操作）'}
          </span>
          <span className="rc-devpanel__note" data-testid="rc-dev-target">
            申请目标（真 WS M1 target_user_id）：{devTargetUser()}
          </span>
        </div>
      )}
    </>
  );
}

export default MeetingBridge;
