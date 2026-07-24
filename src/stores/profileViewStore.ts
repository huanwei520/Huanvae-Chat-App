/**
 * 他人资料页查看状态 (Zustand)
 *
 * @location src/stores/profileViewStore.ts
 *
 * 跨组件共享"当前正在查看哪个用户的完整资料页"。任意头像点击处可调用 open(userId)
 * 打开，由顶层挂载的 OtherProfileView 订阅渲染（桌面右侧抽屉 / 移动整页）。
 * 用独立小 store 而非塞进核心 chatStore，避免污染核心状态、降低改动面。
 */

import { create } from 'zustand';

interface ProfileViewState {
  /** 当前查看的用户 id（null = 关闭） */
  userId: string | null;
  /** 从 bot 发现结果打开时携带 bot username，供面板走 addBotByUsername（人则为 null） */
  botUsername: string | null;
  /** 打开某用户的完整资料页；从 bot 发现结果打开时传 opts.botUsername */
  open: (userId: string, opts?: { botUsername?: string }) => void;
  /** 关闭资料页 */
  close: () => void;
}

export const useProfileViewStore = create<ProfileViewState>((set) => ({
  userId: null,
  botUsername: null,
  open: (userId, opts) => set({ userId, botUsername: opts?.botUsername ?? null }),
  close: () => set({ userId: null, botUsername: null }),
}));
