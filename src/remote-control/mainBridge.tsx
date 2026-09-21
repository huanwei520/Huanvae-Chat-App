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
 * M1 目标解析（2026-09-21 生产 E2E 断链修复）：会议 join 不绑定聊天账号，信令层
 * 参会者恒为访客（user_info 为空），tile 侧 payload.target_user_id 因此恒 null；
 * 此处增加「参会人展示名 = 好友昵称」好友列表解析兜底（远控正当目标本应即好友），
 * 解析不到再回落 devTargetUser()（仅 dev 构建）/不盲发，安全语义不变。
 *
 * @module remote-control/mainBridge
 */

import { useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSession } from '../contexts/SessionContext';
import {
  RC_AUTH_DECISION,
  RC_REQUEST_CONTROL,
  RC_REQUEST_RELEASE,
  type RcAuthDecisionPayload,
  type RcRequestControlPayload,
} from './bus';
import { sendControlSessionWs } from './wsSender';
import { getFriends } from '../api/friends';
import { invoke as rcDbgInvoke } from '@tauri-apps/api/core';
import { useControlSessionStore } from './sessionStore';
import { devTargetUser } from './meetingBridge';
import { isDevControl } from './devGate';

export function MainBridge() {
  // 申请人展示名真值源＝本机会话昵称（缺省才回落「我」）。
  // 🔴 病历（2026-09-14 双机真机实测）：这里原先把 display_name 硬编码为 '我'，
  //    服务端只重写 user_id/device_id、**不重写 display_name**（见文件头「身份口径」），
  //    于是**被申请方**的授权弹层里渲染成了「我 申请控制你正在共享的屏幕」、
  //    接受后横幅变成「正在被 我 控制」——把申请人叫成被申请人自己。
  const { session, api } = useSession();
  const selfDisplayName = session?.profile?.user_nickname?.trim() || '我';
  // 用 ref 传给发送回调，而不是把 selfDisplayName 加进 onRequestControl 的依赖：
  // 后者会让下方 listen() 效果在昵称到货时**重新注册**监听器，在注销→重注之间
  // 存在丢事件的窗口（而这个文件的历史教训正是「同一 emit 双发/漏发」，见下方
  // cancelled 守卫注释）。ref 读最新值、依赖保持 []，注册一次不再变。
  const selfNameRef = useRef(selfDisplayName);
  selfNameRef.current = selfDisplayName;
  // api 同理走 ref：onRequestControl 依赖保持 []，监听器注册一次不再变。
  const apiRef = useRef(api);
  apiRef.current = api;

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

  const onRequestRelease = useCallback((payload: { grant_id: string; request_id?: string; reason?: string }) => {
    void rcDbgInvoke('rc_debug_marker', { marker: 'DBG2-listener' }).catch(() => undefined); // RC-DBG2
    if (!payload?.grant_id) {
      void rcDbgInvoke('rc_debug_marker', { marker: 'DBG2b-no-grantid' }).catch(() => undefined);
      console.warn('[RemoteControl] M3 未发送：载荷无 grant_id');
      return;
    }
    const sent = sendControlSessionWs({
      type: 'control_session_release',
      grant_id: payload.grant_id,
      request_id: payload.request_id ?? '',
      reason: payload.reason ?? 'revoked',
      // M3 必填 by{user_id,device_id}（ControlSessionReleaseMsg 无 serde(default)，
      // 缺字段 = serde 反序列化失败 = 服务器当 invalid 帧丢弃 —— 2026-09-14 DBG 探针定位）。
      // 值为占位：handle_control_session_release 首行按 JWT 重写 by 两字段。
      by: {
        user_id: session?.profile?.user_id ?? '',
        device_id: 'self-device',
      },
      released_at: Date.now(),
    });
    if (!sent) {
      console.warn('[RemoteControl] M3 未发送（主 WS 不可用）');
    }
  }, [session]);

  const onRequestControl = useCallback(async (payload: RcRequestControlPayload) => {
    // M1.target_user_id 真值源 = 右键 tile 参会者的聊天 user_id（MeetingPage
    // data-rc-user-id 委托解析，缺口③修复 2026-09-13）；dev 构建才回退
    // devTargetUser() 演示链 —— 正式构建无目标（访客 tile/非 tile 右键）不盲发，
    // 防止把控制申请发给硬编码占位用户。
    let target = payload.target_user_id ?? null;
    if (!target) {
      // 缺口修复（2026-09-21 生产 E2E 断链实证）：会议 join 不绑定聊天账号，
      // 信令层参会者恒为访客（user_info 为空，生产日志 user_id=(访客)），
      // payload.target_user_id 因此恒 null，正式构建 M1 永远发不出。
      // 此处按「参会人展示名 = 好友昵称」从好友列表解析 user_id：
      // 会议内可申请控制的正当目标本应就是自己的好友（远控高敏操作），
      // 非好友/改名访客解析不到 → 保持不盲发的安全语义不变。
      const name = payload.participant_name?.trim();
      const client = apiRef.current;
      if (name && client) {
        try {
          const friends = await getFriends(client);
          const hit =
            friends.find((f) => f.friend_nickname?.trim() === name) ??
            friends.find((f) => f.friend_nickname?.trim().toLowerCase() === name.toLowerCase());
          if (hit) {
            target = hit.friend_id;
            console.info(`[RemoteControl] M1 目标经好友列表解析：${name} -> ${hit.friend_id}`);
          }
        } catch {
          // 好友列表拉取失败按未命中处理（落下方不盲发分支）
        }
      }
    }
    target = target ?? (isDevControl() ? devTargetUser() : null);
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
        display_name: selfNameRef.current,
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
    listen<RcRequestControlPayload>(RC_REQUEST_CONTROL, (ev) => { void onRequestControl(ev.payload); })
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisteners.push(fn); }
      })
      .catch(() => undefined);
    listen<{ grant_id: string; request_id?: string; reason?: string }>(RC_REQUEST_RELEASE, (ev) => onRequestRelease(ev.payload))
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisteners.push(fn); }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [onAuthDecision, onRequestControl, onRequestRelease]);

  return null;
}

export default MainBridge;
