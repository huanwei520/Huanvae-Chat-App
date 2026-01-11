/**
 * 设置状态管理
 *
 * 使用 Zustand + persist 保存用户设置到 localStorage
 *
 * 功能分组：
 * - 通知设置：提示音开关、音效选择、音量
 * - 文件缓存设置：大文件直连阈值（≥阈值的文件不复制到缓存）
 *
 * @module stores/settingsStore
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

/** 文件缓存设置 */
export interface FileCacheSettings {
  /** 大文件阈值（MB），≥此值不复制到缓存目录，直接链接原始路径 */
  largeFileThresholdMB: number;
}

/** 设置状态 */
interface SettingsState {
  /** 通知设置 */
  notification: NotificationSettings;
  /** 文件缓存设置 */
  fileCache: FileCacheSettings;

  /** 设置提示音 */
  setNotificationSound: (soundName: string) => void;
  /** 设置是否启用提示音 */
  setNotificationEnabled: (enabled: boolean) => void;
  /** 设置音量 */
  setNotificationVolume: (volume: number) => void;
  /** 设置大文件阈值（MB） */
  setLargeFileThreshold: (mb: number) => void;
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
      fileCache: {
        largeFileThresholdMB: 100, // 默认 100MB
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

      // 设置大文件阈值
      setLargeFileThreshold: (mb: number) => {
        set((state) => ({
          fileCache: {
            ...state.fileCache,
            largeFileThresholdMB: Math.max(10, Math.min(1000, mb)), // 限制 10MB - 1000MB
          },
        }));
      },
    }),
    {
      name: 'huanvae-settings',
    },
  ),
);
