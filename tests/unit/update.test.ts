/**
 * 更新服务单元测试
 *
 * 测试更新检测、下载、安装流程
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';
import { checkForUpdates, formatSize } from '../../src/update/service';

// Mock check 函数
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

describe('更新服务', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkForUpdates', () => {
    it('无更新时返回 available: false', async () => {
      vi.mocked(check).mockResolvedValue(null);

      const result = await checkForUpdates();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
    });

    it('有更新时返回正确的版本信息', async () => {
      const mockUpdate = {
        available: true,
        version: '2.0.0',
        currentVersion: '1.0.0',
        body: '新版本更新说明',
        date: '2025-01-01',
        rawJson: {},
        download: vi.fn(),
        downloadAndInstall: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(check).mockResolvedValue(mockUpdate as never);

      const result = await checkForUpdates();

      expect(result.available).toBe(true);
      expect(result.version).toBe('2.0.0');
      expect(result.notes).toBe('新版本更新说明');
      expect(result.update).toBe(mockUpdate);
    });

    it('网络错误时静默返回 available: false', async () => {
      vi.mocked(check).mockRejectedValue(new Error('network error'));

      const result = await checkForUpdates();

      expect(result.available).toBe(false);
    });

    it('其他错误时抛出异常', async () => {
      vi.mocked(check).mockRejectedValue(new Error('unknown error'));

      await expect(checkForUpdates()).rejects.toThrow('unknown error');
    });
  });

  describe('formatSize', () => {
    it('格式化字节', () => {
      expect(formatSize(500)).toBe('500 B');
    });

    it('格式化 KB', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(2048)).toBe('2.0 KB');
    });

    it('格式化 MB', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
    });

    it('格式化 GB', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });
  });
});

