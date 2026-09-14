/**
 * 会议内远程控制——主窗 WS dispatch 三分支（设计 §8.3 块 C；wsHandlers.ts
 * `case 'system_notification'` 的 dev 门控前置调用）
 *
 * - N1 control_session_requested：共享端——弹授权弹层（meeting 窗内，
 *   spotlight overlay 形态先例 MeetingPage.tsx:796-835）＋转发 daemon；
 * - N2 control_session_decided：观看端——approved 打开/聚焦 remote-control 窗口
 *   （getByLabel 单例先例）＋推进 Linking；rejected 终态提示；
 * - N3 control_session_released：双端终态处理（输入捕获停/横幅撤下）。
 *
 * 全部分支先 POST /control/incoming 转发本机 daemon（§7.3 回环胶水，daemon 为
 * grant 状态权威 §6.4），失败不阻塞 UI（daemon 未部署时测试面降级为纯 UI 演示）。
 *
 * @module remote-control/dispatch
 */

import { emit } from '@tauri-apps/api/event';
import type { WsSystemNotification } from '../types/websocket';
import {
  CONTROL_SESSION_CHANGED,
  RC_AUTH_REQUEST,
  type ControlSessionChangedPayload,
  type RcAuthRequestPayload,
  type RcSessionStatePayload,
  RC_SESSION_STATE,
} from './bus';
import { controlIncoming } from './api';
import { openRemoteControlWindow } from './openWindow';
import { useControlSessionStore } from './sessionStore';
import type {
  ControlSessionDecidedData,
  ControlSessionReleasedData,
  ControlSessionRequestedData,
} from './types';

/**
 * system_notification 分发入口（dev 门控：仅 isDevControl() 构建被调用）。
 * 返回 true 表示该帧被控制域消费（供调用方短路既有计数/通知路径）。
 */
export function handleControlSessionNotification(msg: WsSystemNotification): boolean {
  const store = useControlSessionStore.getState();
  switch (msg.notification_type) {
    case 'control_session_requested': {
      const data = msg.data as unknown as ControlSessionRequestedData;
      // ⑥回环胶水：dispatch 后转发 daemon（授权状态权威，§6.4）；daemon 为该申请
      // 签发 pending grant_id（§3.2 T4/T5）——随弹层载荷回传，共享端点「接受」时
      // 原样回填 M2.grant_id（grant_id 由共享端授权面签发，非客户端自造）。
      void (async () => {
        const resp = await controlIncoming({
          kind: 'control_session_requested',
          request_id: data.request_id,
          from: data.from,
          meeting_ctx: data.meeting_ctx,
          created_at: data.created_at,
        });
        void emit(RC_AUTH_REQUEST, {
          data,
          daemon_grant_id: resp?.grant_id ?? null,
        } satisfies RcAuthRequestPayload).catch(() => {
          /* 非 Tauri 环境忽略 */
        });
      })();
      store.beginRequest(data.request_id, data.from?.user_id ?? null, data.from?.display_name ?? null);
      return true;
    }
    case 'control_session_decided': {
      const data = msg.data as unknown as ControlSessionDecidedData;
      void controlIncoming({
        kind: 'control_session_decided',
        request_id: data.request_id,
        grant_id: data.grant_id,
        approved: data.approved,
      });
      if (data.approved && data.grant_id) {
        // T2：打开/聚焦独立控制窗口（getByLabel 单例先例）＋推进 Linking
        store.advanceLinking(data.request_id, data.grant_id);
        void openRemoteControlWindow();
        void emit(RC_SESSION_STATE, {
          state: 'linking',
          grant_id: data.grant_id,
        } satisfies RcSessionStatePayload).catch(() => undefined);
      } else {
        // T3：已拒绝 → 终态
        store.release('error');
        store.reset();
      }
      return true;
    }
    case 'control_session_released': {
      const data = msg.data as unknown as ControlSessionReleasedData;
      void controlIncoming({
        kind: 'control_session_released',
        grant_id: data.grant_id,
        request_id: data.request_id,
        reason: data.reason,
      });
      // T9/T10/T11/T13：双端终态——输入捕获停/窗口转「控制已结束」/横幅撤下
      store.release(data.reason);
      store.reset();
      // 撤销/终止到达时同步拆本机 daemon 链（被控端 T10；控制端本机无 daemon 时静默失败）。
      // 缺口③撤销臂接线（2026-09-14）：此前客户端只能收 N3，从不停 daemon。
      void import('./api').then(({ controlDisarm }) => controlDisarm()).catch(() => undefined);
      void emit(RC_SESSION_STATE, {
        state: 'released',
        grant_id: data.grant_id,
        reason: data.reason,
      } satisfies RcSessionStatePayload).catch(() => undefined);
      void emit(CONTROL_SESSION_CHANGED, {
        controlledByName: null,
      } satisfies ControlSessionChangedPayload).catch(() => undefined);
      return true;
    }
    default:
      return false;
  }
}
