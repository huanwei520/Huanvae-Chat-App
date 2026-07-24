/**
 * 群详情弹窗查看状态 (Zustand)
 *
 * @location src/stores/groupDetailStore.ts
 *
 * 跨组件共享"当前正在查看哪个群的详情弹窗"。任意群名/群头像点击处可调用 open(groupId)
 * 打开，由顶层挂载的 GroupDetailView 订阅渲染（桌面右侧抽屉 / 移动整页）。
 * 用独立小 store 而非塞进核心 chatStore，避免污染核心状态、降低改动面。
 */

import { create } from 'zustand';

interface GroupDetailState {
  /** 当前查看的群 id（null = 关闭） */
  groupId: string | null;
  /** 打开某群的详情弹窗 */
  open: (groupId: string) => void;
  /** 关闭详情弹窗 */
  close: () => void;
}

export const useGroupDetailStore = create<GroupDetailState>((set) => ({
  groupId: null,
  open: (groupId) => set({ groupId }),
  close: () => set({ groupId: null }),
}));
