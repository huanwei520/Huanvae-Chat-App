/**
 * 个人主页封面背景 —— 原型共享状态 (Zustand)
 *
 * @location src/stores/profileCoverPrototype.ts
 *
 * ⚠️ 原型专用：封面图仅在本会话内本地 blob 预览，未落库、刷新即失效。
 * 目的：让「个人资料弹窗」里选好的封面，能同时在「单击头像的只读资料页（自己视角）」预览，
 * 方便确认双端观感。满意后接后端 user-background-url 持久化 + 别人主页显示时，整体替换为
 * 从后端 profile 取封面 URL，本 store 一并删除。
 *
 * BACKLOG: 接入 /api/profile/background 持久化后删除本文件，封面改由 profile 响应携带。
 */

import { create } from 'zustand';
import type { RGB } from '../utils/imageColor';

interface ProfileCoverPrototypeState {
  /** 当前用户封面图本地 blob URL（null = 未设置，留空不兜底） */
  coverUrl: string | null;
  /** 封面主色调（用于背景淡染 / 渐变；null = 尚未提取） */
  dominant: RGB | null;
  /** 设置封面（替换时回收旧 blob URL，避免内存泄漏） */
  setCover: (url: string, dominant: RGB | null) => void;
  /** 清除封面 */
  clearCover: () => void;
}

export const useProfileCoverPrototype = create<ProfileCoverPrototypeState>((set, get) => ({
  coverUrl: null,
  dominant: null,
  setCover: (url, dominant) => {
    const prev = get().coverUrl;
    if (prev && prev !== url) { URL.revokeObjectURL(prev); }
    set({ coverUrl: url, dominant });
  },
  clearCover: () => {
    const prev = get().coverUrl;
    if (prev) { URL.revokeObjectURL(prev); }
    set({ coverUrl: null, dominant: null });
  },
}));
