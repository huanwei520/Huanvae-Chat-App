/**
 * 更新服务单元测试
 *
 * 测试更新检查功能，包括：
 * - Windows 使用 MSI 更新目标
 * - 其他平台使用默认目标
 *
 * @updated 2026-01-25 简化为仅 MSI 更新
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri APIs
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Update Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getWindowsUpdateTarget', () => {
    it('should return undefined for non-Windows platforms', async () => {
      const { platform } = await import('@tauri-apps/plugin-os');
      vi.mocked(platform).mockResolvedValue('linux');

      // 重新导入模块以获取最新的 mock
      const { checkForUpdates } = await import('../../src/update/service');
      const { check } = await import('@tauri-apps/plugin-updater');
      vi.mocked(check).mockResolvedValue(null);

      await checkForUpdates();

      // check 应该被调用时没有 target 参数
      expect(check).toHaveBeenCalledWith(undefined);
    });

    it('should return "windows-x86_64-msi" for Windows platform', async () => {
      // Windows 平台始终使用 MSI 更新包
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('windows'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const service = await import('../../src/update/service');
      await service.checkForUpdates();

      const { check: checkMock } = await import('@tauri-apps/plugin-updater');
      expect(checkMock).toHaveBeenCalledWith({ target: 'windows-x86_64-msi' });
    });
  });

  describe('checkForUpdates', () => {
    it('should return available: false when no update is available', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('linux'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const { checkForUpdates } = await import('../../src/update/service');
      const result = await checkForUpdates();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
    });

    it('should return update info when update is available', async () => {
      const mockUpdate = {
        version: '1.0.26',
        body: 'New features',
        date: '2026-01-24',
      };

      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('linux'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockResolvedValue(mockUpdate),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const { checkForUpdates } = await import('../../src/update/service');
      const result = await checkForUpdates();

      expect(result.available).toBe(true);
      expect(result.version).toBe('1.0.26');
      expect(result.notes).toBe('New features');
      expect(result.date).toBe('2026-01-24');
    });

    it('should handle network errors gracefully', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('linux'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockRejectedValue(new Error('network error')),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const { checkForUpdates } = await import('../../src/update/service');
      const result = await checkForUpdates();

      // 网络错误应该返回 available: false 而不是抛出异常
      expect(result.available).toBe(false);
    });
  });

  describe('formatSize', () => {
    it('should format bytes correctly', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn(),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const { formatSize } = await import('../../src/update/service');

      expect(formatSize(500)).toBe('500 B');
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(1048576)).toBe('1.0 MB');
      expect(formatSize(1073741824)).toBe('1.00 GB');
    });
  });
});
