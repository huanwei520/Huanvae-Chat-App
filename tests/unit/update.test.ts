/**
 * 更新服务单元测试
 *
 * 测试更新检查功能，包括：
 * - Windows 安装类型检测
 * - 正确的更新目标选择
 *
 * @updated 2026-01-24 添加 Windows 安装类型检测测试
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

    it('should return "windows-x86_64-msi" for MSI installations on Windows', async () => {
      const { platform } = await import('@tauri-apps/plugin-os');
      const { invoke } = await import('@tauri-apps/api/core');
      const { check } = await import('@tauri-apps/plugin-updater');

      vi.mocked(platform).mockResolvedValue('windows');
      vi.mocked(invoke).mockResolvedValue('msi');
      vi.mocked(check).mockResolvedValue(null);

      // 需要重新导入以应用新的 mocks
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('windows'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue('msi'),
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockResolvedValue(null),
      }));

      const service = await import('../../src/update/service');
      await service.checkForUpdates();

      const { check: checkMock } = await import('@tauri-apps/plugin-updater');
      expect(checkMock).toHaveBeenCalledWith({ target: 'windows-x86_64-msi' });
    });

    it('should return undefined for NSIS installations on Windows', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('windows'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue('nsis'),
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
      // NSIS 使用默认 target（undefined）
      expect(checkMock).toHaveBeenCalledWith(undefined);
    });

    it('should return undefined for unknown installation type on Windows', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('windows'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue('unknown'),
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
      expect(checkMock).toHaveBeenCalledWith(undefined);
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
