/**
 * 设置状态管理
 *
 * 使用 Zustand + persist 保存用户设置到 localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// 类型定义
// ============================================

/** 通知设置 */
export interface NotificationSettings {
  /** 是否启用提示音 */
  enabled: boolean;
  /** 选中的提示音名称（不含 .mp3） */
  soundName: string;
  /** 音量 0-100 */
  volume: number;
}

/** 设置状态 */
interface SettingsState {
  /** 通知设置 */
  notification: NotificationSettings;

  /** 设置提示音 */
  setNotificationSound: (soundName: string) => void;
  /** 设置是否启用提示音 */
  setNotificationEnabled: (enabled: boolean) => void;
  /** 设置音量 */
  setNotificationVolume: (volume: number) => void;
}

// ============================================
// Store 实现
// ============================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // 默认设置
      notification: {
        enabled: true,
        soundName: 'water', // 默认使用 water
        volume: 70,
      },

      // 设置提示音
      setNotificationSound: (soundName: string) => {
        set((state) => ({
          notification: {
            ...state.notification,
            soundName,
          },
        }));
      },

      // 设置是否启用提示音
      setNotificationEnabled: (enabled: boolean) => {
        set((state) => ({
          notification: {
            ...state.notification,
            enabled,
          },
        }));
      },

      // 设置音量
      setNotificationVolume: (volume: number) => {
        set((state) => ({
          notification: {
            ...state.notification,
            volume: Math.max(0, Math.min(100, volume)),
          },
        }));
      },
    }),
    {
      name: 'huanvae-settings',
    },
  ),
);
