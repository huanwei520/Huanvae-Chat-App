/**
 * 会议内远程控制——控制会话状态 store（主窗侧观测粒度，dev 门控域内）
 *
 * zustand 先例：src/stores/cardLiveStore.ts 等。独立 JS 上下文不跨窗（Tauri
 * 多 WebView 各自模块实例）——remote-control 窗口只经 daemon status 感知会话态，
 * 本 store 仅活在主窗（wsHandlers dispatch 与桥组件消费）。
 *
 * @module remote-control/sessionStore
 */

import { create } from 'zustand';
import type { ControlReleaseReason, ControlSessionState } from './types';

interface ControlSessionStore {
  state: ControlSessionState;
  requestId: string | null;
  grantId: string | null;
  /** 观看端 user_id（N1.from.user_id；共享端发 M2 的 target_user_id 用） */
  peerUserId: string | null;
  /** 观看端显示名（N1.from.display_name；共享端横幅/弹层展示用） */
  peerDisplayName: string | null;
  releaseReason: ControlReleaseReason | null;
  setState: (s: ControlSessionState) => void;
  beginRequest: (requestId: string, peerUserId?: string | null, peerDisplayName?: string | null) => void;
  advanceLinking: (requestId: string, grantId: string) => void;
  activate: (grantId?: string | null) => void;
  release: (reason: ControlReleaseReason) => void;
  reset: () => void;
}

export const useControlSessionStore = create<ControlSessionStore>((set) => ({
  state: 'idle',
  requestId: null,
  grantId: null,
  peerUserId: null,
  peerDisplayName: null,
  releaseReason: null,
  setState: (state) => set({ state }),
  beginRequest: (requestId, peerUserId = null, peerDisplayName = null) =>
    set({
      state: 'requesting',
      requestId,
      peerUserId,
      peerDisplayName,
      grantId: null,
      releaseReason: null,
    }),
  advanceLinking: (requestId, grantId) =>
    set({ state: 'linking', requestId, grantId, releaseReason: null }),
  activate: (grantId = null) =>
    set((s) => ({ state: 'active', grantId: grantId ?? s.grantId })),
  release: (reason) => set({ state: 'released', releaseReason: reason }),
  reset: () =>
    set({
      state: 'idle',
      requestId: null,
      grantId: null,
      peerUserId: null,
      peerDisplayName: null,
      releaseReason: null,
    }),
}));
