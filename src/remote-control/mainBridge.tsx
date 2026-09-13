/**
 * 主窗控制域桥（dev 门控面；挂载于 App.tsx 主窗分支一次）
 *
 * 职责：meeting 窗经事件总线送达的动作 → 主 WS 上行（M1/M2，设计 §6.3）。
 * WS 发送器由 WebSocketContext 建连时注册（dev 门控）；未登录/未注册时
 * sendControlSessionWs 返回 false 并留痕（演示环境无后端属预期）。
 *
 * 身份口径：服务端以 JWT claims 重写 M1.from 的 user_id/device_id（防伪造），
 * 客户端只填展示用 device_name/display_name；M2.target_user_id 取 N1.from.user_id
 * （sessionStore 权威）。观看端 dev 目标用户经 localStorage `rc.dev.target-user`。
 *
 * @module remote-control/mainBridge
 */

import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  RC_AUTH_DECISION,
  RC_REQUEST_CONTROL,
  type RcAuthDecisionPayload,
  type RcRequestControlPayload,
} from './bus';
import { sendControlSessionWs } from './wsSender';
import { useControlSessionStore } from './sessionStore';
import { devTargetUser } from './meetingBridge';
import { isDevControl } from './devGate';

export function MainBridge() {
  const onAuthDecision = useCallback((payload: RcAuthDecisionPayload) => {
    const { peerUserId } = useControlSessionStore.getState();
    const sent = sendControlSessionWs({
      type: 'control_session_decision',
      request_id: payload.request_id,
      grant_id: payload.approved ? (payload.grant_id ?? null) : null,
      approved: payload.approved,
      target_user_id: peerUserId ?? 'dev-watcher-user',
      decided_at: Date.now(),
    });
    if (!sent) {
      console.warn('[RemoteControl] M2 未发送（主 WS 不可用）——演示链路仅本地态');
    }
  }, []);

  const onRequestControl = useCallback((payload: RcRequestControlPayload) => {
    // M1.target_user_id 真值源 = 右键 tile 参会者的聊天 user_id（MeetingPage
    // data-rc-user-id 委托解析，缺口③修复 2026-09-13）；dev 构建才回退
    // devTargetUser() 演示链 —— 正式构建无目标（访客 tile/非 tile 右键）不盲发，
    // 防止把控制申请发给硬编码占位用户。
    const target = payload.target_user_id ?? (isDevControl() ? devTargetUser() : null);
    if (!target) {
      console.warn('[RemoteControl] M1 未发送：右键目标无 user_id（访客不可被指定为控制目标）');
      return;
    }
    const requestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `rc-${Date.now()}`;
    const sent = sendControlSessionWs({
      type: 'control_session_request',
      request_id: requestId,
      target_user_id: target,
      from: {
        // 服务端以 claims 重写 user_id/device_id（§5.1）；此处仅展示名有语义
        user_id: 'self',
        device_id: 'self-device',
        device_name: 'watcher',
        display_name: '我',
      },
      meeting_ctx: null,
      created_at: Date.now(),
    });
    if (sent) {
      useControlSessionStore.getState().beginRequest(requestId, null, payload.participant_name);
    } else {
      console.warn('[RemoteControl] M1 未发送（主 WS 不可用）——演示链路仅本地态');
      // 测试面诊断哔（幂等无害）：抵达此处＝emit/listener 链已通、发送器侧不可用；
      // daemon 审计多一条 arm 行即此分支执行的物证（Xvfb 无控制台可见性时替代告警）。
      void import('./api').then(({ controlArm }) => controlArm());
    }
  }, []);

  useEffect(() => {
    // cancelled 守卫：listen() 是异步注册，StrictMode 双挂载下 cleanup 可能先于
    // promise resolve 运行——不守卫则首次注册泄漏（同一 emit → M1 双发，
    // 2026-09-08 实测两笔 M1 的根因）。
    const unlisteners: Array<() => void> = [];
    let cancelled = false;
    listen<RcAuthDecisionPayload>(RC_AUTH_DECISION, (ev) => onAuthDecision(ev.payload))
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisteners.push(fn); }
      })
      .catch(() => undefined);
    listen<RcRequestControlPayload>(RC_REQUEST_CONTROL, (ev) => onRequestControl(ev.payload))
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisteners.push(fn); }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [onAuthDecision, onRequestControl]);

  return null;
}

export default MainBridge;
