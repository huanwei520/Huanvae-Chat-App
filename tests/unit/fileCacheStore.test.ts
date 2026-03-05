/**
 * 文件缓存状态管理单元测试
 *
 * 测试 fileCacheStore 的核心功能：
 * - 下载任务管理
 * - URL 缓存
 * - 重置
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFileCacheStore } from '../../src/stores/fileCacheStore';

describe('文件缓存状态管理 (fileCacheStore)', () => {
  beforeEach(() => {
    useFileCacheStore.getState().reset();
  });

  describe('addDownloadTask', () => {
    it('应创建 pending 状态任务，downloaded=0', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });

      const task = useFileCacheStore.getState().downloadTasks['hash1'];
      expect(task).toBeDefined();
      expect(task.status).toBe('pending');
      expect(task.downloaded).toBe(0);
      expect(task.percent).toBe(0);
      expect(task.fileName).toBe('test.jpg');
      expect(task.fileType).toBe('image');
      expect(task.total).toBe(1024);
      expect(task.startTime).toBeDefined();
    });
  });

  describe('updateDownloadProgress', () => {
    it('应更新已存在任务的进度', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });

      useFileCacheStore.getState().updateDownloadProgress('hash1', 512, 1024, 50);

      const task = useFileCacheStore.getState().downloadTasks['hash1'];
      expect(task.status).toBe('downloading');
      expect(task.downloaded).toBe(512);
      expect(task.total).toBe(1024);
      expect(task.percent).toBe(50);
    });

    it('对不存在的任务应无操作', () => {
      useFileCacheStore.getState().updateDownloadProgress('nonexistent', 100, 200, 50);
      expect(useFileCacheStore.getState().downloadTasks['nonexistent']).toBeUndefined();
    });
  });

  describe('completeDownload', () => {
    it('应将状态设为 completed，percent 为 100', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });

      useFileCacheStore.getState().completeDownload('hash1', '/path/to/file.jpg');

      const task = useFileCacheStore.getState().downloadTasks['hash1'];
      expect(task.status).toBe('completed');
      expect(task.percent).toBe(100);
      expect(task.localPath).toBe('/path/to/file.jpg');
    });
  });

  describe('failDownload', () => {
    it('应将状态设为 failed 并记录错误', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });

      useFileCacheStore.getState().failDownload('hash1', '网络错误');

      const task = useFileCacheStore.getState().downloadTasks['hash1'];
      expect(task.status).toBe('failed');
      expect(task.error).toBe('网络错误');
    });
  });

  describe('removeDownloadTask', () => {
    it('应移除指定任务', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });

      useFileCacheStore.getState().removeDownloadTask('hash1');

      expect(useFileCacheStore.getState().downloadTasks['hash1']).toBeUndefined();
    });
  });

  describe('clearCompletedTasks', () => {
    it('应仅移除已完成任务', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'a.jpg',
        fileType: 'image',
        total: 100,
      });
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash2',
        fileName: 'b.jpg',
        fileType: 'image',
        total: 100,
      });

      useFileCacheStore.getState().completeDownload('hash1', '/path/a.jpg');
      useFileCacheStore.getState().updateDownloadProgress('hash2', 50, 100, 50);

      useFileCacheStore.getState().clearCompletedTasks();

      expect(useFileCacheStore.getState().downloadTasks['hash1']).toBeUndefined();
      expect(useFileCacheStore.getState().downloadTasks['hash2']).toBeDefined();
    });
  });

  describe('setUrlCache', () => {
    it('应存储 URL 并附带 cachedAt', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      useFileCacheStore.getState().setUrlCache('uuid1', 'https://example.com/file', '2025-12-31T00:00:00Z');

      const cached = useFileCacheStore.getState().urlCache['uuid1'];
      expect(cached).toBeDefined();
      expect(cached.url).toBe('https://example.com/file');
      expect(cached.expiresAt).toBe('2025-12-31T00:00:00Z');
      expect(cached.cachedAt).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('getUrlCache', () => {
    it('应返回缓存的有效项', () => {
      const futureExpiry = new Date(Date.now() + 60000 * 10).toISOString(); // 10 分钟后
      useFileCacheStore.setState({
        urlCache: {
          uuid1: {
            url: 'https://example.com/file',
            expiresAt: futureExpiry,
            cachedAt: Date.now(),
          },
        },
      });

      const result = useFileCacheStore.getState().getUrlCache('uuid1');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('https://example.com/file');
    });

    it('对不存在的 key 应返回 null', () => {
      expect(useFileCacheStore.getState().getUrlCache('nonexistent')).toBeNull();
    });

    it('对已过期（5 分钟缓冲内）的项应返回 null 并清除', () => {
      const soonExpiry = new Date(Date.now() + 60000 * 2).toISOString(); // 2 分钟后过期
      useFileCacheStore.setState({
        urlCache: {
          uuid1: {
            url: 'https://example.com/file',
            expiresAt: soonExpiry,
            cachedAt: Date.now(),
          },
        },
      });

      const result = useFileCacheStore.getState().getUrlCache('uuid1');
      // 5 分钟缓冲：now + 5min >= expiresTime 则视为过期
      // soonExpiry 是 2 分钟后，now + 5min 肯定 >= soonExpiry，所以会过期
      expect(result).toBeNull();
      expect(useFileCacheStore.getState().urlCache['uuid1']).toBeUndefined();
    });
  });

  describe('clearExpiredUrls', () => {
    it('应移除过期条目', () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const futureExpiry = new Date(Date.now() + 60000 * 10).toISOString();

      useFileCacheStore.setState({
        urlCache: {
          uuid1: {
            url: 'url1',
            expiresAt: pastExpiry,
            cachedAt: Date.now() - 10000,
          },
          uuid2: {
            url: 'url2',
            expiresAt: futureExpiry,
            cachedAt: Date.now(),
          },
        },
      });

      useFileCacheStore.getState().clearExpiredUrls();

      expect(useFileCacheStore.getState().urlCache['uuid1']).toBeUndefined();
      expect(useFileCacheStore.getState().urlCache['uuid2']).toBeDefined();
    });
  });

  describe('reset', () => {
    it('应清空所有状态', () => {
      useFileCacheStore.getState().addDownloadTask({
        fileHash: 'hash1',
        fileName: 'test.jpg',
        fileType: 'image',
        total: 1024,
      });
      useFileCacheStore.getState().setUrlCache('uuid1', 'https://x.com', '2025-12-31');

      useFileCacheStore.getState().reset();

      expect(useFileCacheStore.getState().downloadTasks).toEqual({});
      expect(useFileCacheStore.getState().urlCache).toEqual({});
    });
  });
});
