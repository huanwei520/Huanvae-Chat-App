/**
 * 更新服务单元测试
 *
 * 测试更新检查功能，包括：
 * - 去 SNI 更新检查（走本仓命令 `updater_check_nosni`，不用插件 JS `check()`）
 * - 线格式到插件 `Update` 的桥接
 *
 * @updated 2026-09-27 去 SNI：check 走本仓 `updater_check_nosni`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri APIs
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    constructor(metadata: Record<string, unknown>) {
      Object.assign(this, metadata);
    }
  },
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}));

// 本地 vi.mock 会**整体替换** setup.ts 的全局 mock，所以 Channel 必须在这里也补上
// （service.ts 的 downloadAndInstall 用 `new Channel()` 驱动分片下载器的进度回调）。
// 🔴 class 定义在工厂内部：vi.mock 提升到文件顶，引用外层变量会 ReferenceError。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
    id = 1;
  },
}));

const UpdateMock = class {
  constructor(metadata: Record<string, unknown>) {
    Object.assign(this, metadata);
  }
};

describe('Update Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('update check', () => {
    it('去 SNI：checkForUpdates 走本仓命令 updater_check_nosni（不再调插件 JS check()）', async () => {
      vi.resetModules();
      const invokeMock = vi.fn().mockResolvedValue(null);
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: invokeMock,
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
          id = 1;
        },
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        Update: UpdateMock,
        check: vi.fn(),
      }));
      vi.doMock('@tauri-apps/plugin-process', () => ({
        relaunch: vi.fn(),
      }));

      const service = await import('../../src/update/service');
      await service.checkForUpdates();

      // 走的是本仓去 SNI 命令，且插件 JS check() 不再被调用（插件 check 不设 configure_client，会发 SNI）
      expect(invokeMock).toHaveBeenCalledWith('updater_check_nosni');
      const { check: checkMock } = await import('@tauri-apps/plugin-updater');
      expect(checkMock).not.toHaveBeenCalled();
    });
  });

  describe('checkForUpdates', () => {
    it('should return available: false when no update is available', async () => {
      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('linux'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue(null),
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
          id = 1;
        },
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        Update: UpdateMock,
        check: vi.fn(),
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
      // 去 SNI 命令返回的线格式（对齐 @tauri-apps/plugin-updater 的 UpdateMetadata）
      const metadata = {
        rid: 7,
        currentVersion: '1.0.25',
        version: '1.0.26',
        body: 'New features',
        date: '2026-01-24',
        rawJson: {},
      };

      vi.resetModules();
      vi.doMock('@tauri-apps/plugin-os', () => ({
        platform: vi.fn().mockResolvedValue('linux'),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue(metadata),
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
          id = 1;
        },
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        Update: UpdateMock,
        check: vi.fn(),
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
        invoke: vi.fn().mockRejectedValue(new Error('network error')),
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
          id = 1;
        },
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        Update: UpdateMock,
        check: vi.fn(),
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
        Channel: class {
          onmessage: ((msg: unknown) => void) | null = null;
          id = 1;
        },
      }));
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        Update: UpdateMock,
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
