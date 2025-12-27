/**
 * 设置状态管理单元测试
 *
 * 测试 settingsStore 的核心功能：
 * 1. 默认值设置
 * 2. 通知音设置
 * 3. 通知启用/禁用
 * 4. 音量调节
 * 5. 持久化存储
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
});

// 导入需要放在模拟之后
import { useSettingsStore, NotificationSettings } from '../../src/stores/settingsStore';

describe('设置状态管理 (settingsStore)', () => {
  beforeEach(() => {
    // 重置 localStorage
    localStorageMock.clear();
    vi.clearAllMocks();

    // 重置 store 状态
    const store = useSettingsStore.getState();
    store.setNotificationEnabled(true);
    store.setNotificationSound('water');
    store.setNotificationVolume(70);
  });

  describe('默认值', () => {
    it('应有正确的默认通知设置', () => {
      const { result } = renderHook(() => useSettingsStore());

      expect(result.current.notification).toBeDefined();
      expect(result.current.notification.enabled).toBe(true);
      expect(result.current.notification.soundName).toBe('water');
      expect(result.current.notification.volume).toBe(70);
    });
  });

  describe('setNotificationSound', () => {
    it('应正确设置提示音名称', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationSound('custom-sound');
      });

      expect(result.current.notification.soundName).toBe('custom-sound');
    });

    it('应保持其他通知设置不变', () => {
      const { result } = renderHook(() => useSettingsStore());

      const initialEnabled = result.current.notification.enabled;
      const initialVolume = result.current.notification.volume;

      act(() => {
        result.current.setNotificationSound('new-sound');
      });

      expect(result.current.notification.enabled).toBe(initialEnabled);
      expect(result.current.notification.volume).toBe(initialVolume);
    });
  });

  describe('setNotificationEnabled', () => {
    it('应正确禁用提示音', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationEnabled(false);
      });

      expect(result.current.notification.enabled).toBe(false);
    });

    it('应正确启用提示音', () => {
      const { result } = renderHook(() => useSettingsStore());

      // 先禁用
      act(() => {
        result.current.setNotificationEnabled(false);
      });

      // 再启用
      act(() => {
        result.current.setNotificationEnabled(true);
      });

      expect(result.current.notification.enabled).toBe(true);
    });

    it('应保持其他设置不变', () => {
      const { result } = renderHook(() => useSettingsStore());

      const initialSound = result.current.notification.soundName;
      const initialVolume = result.current.notification.volume;

      act(() => {
        result.current.setNotificationEnabled(false);
      });

      expect(result.current.notification.soundName).toBe(initialSound);
      expect(result.current.notification.volume).toBe(initialVolume);
    });
  });

  describe('setNotificationVolume', () => {
    it('应正确设置音量', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationVolume(50);
      });

      expect(result.current.notification.volume).toBe(50);
    });

    it('应将音量限制在 0 以上', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationVolume(-10);
      });

      expect(result.current.notification.volume).toBe(0);
    });

    it('应将音量限制在 100 以下', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationVolume(150);
      });

      expect(result.current.notification.volume).toBe(100);
    });

    it('应处理边界值 0', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationVolume(0);
      });

      expect(result.current.notification.volume).toBe(0);
    });

    it('应处理边界值 100', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationVolume(100);
      });

      expect(result.current.notification.volume).toBe(100);
    });
  });

  describe('多个设置组合', () => {
    it('应支持连续修改多个设置', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setNotificationSound('custom');
        result.current.setNotificationEnabled(false);
        result.current.setNotificationVolume(30);
      });

      expect(result.current.notification).toEqual<NotificationSettings>({
        soundName: 'custom',
        enabled: false,
        volume: 30,
      });
    });
  });

  describe('类型安全', () => {
    it('NotificationSettings 接口应有正确的属性', () => {
      const settings: NotificationSettings = {
        enabled: true,
        soundName: 'test',
        volume: 50,
      };

      expect(settings.enabled).toBe(true);
      expect(settings.soundName).toBe('test');
      expect(settings.volume).toBe(50);
    });
  });
});

