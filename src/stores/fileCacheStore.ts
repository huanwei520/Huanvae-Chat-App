/**
 * 文件缓存状态管理 (Zustand)
 *
 * 管理：
 * - 下载任务队列
 * - 下载进度
 * - 预签名 URL 内存缓存（有时效性）
 */

import { create } from 'zustand';

// ============================================
// 类型定义
// ============================================

/** 下载任务状态 */
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

/** 下载任务 */
export interface DownloadTask {
  fileHash: string;
  fileName: string;
  fileType: 'image' | 'video' | 'document';
  status: DownloadStatus;
  downloaded: number;
  total: number;
  percent: number;
  error?: string;
  localPath?: string;
  startTime: number;
}

/** 预签名 URL 缓存项 */
export interface UrlCacheItem {
  url: string;
  expiresAt: string;
  cachedAt: number;
}

/** Store 状态 */
interface FileCacheState {
  // 下载任务（按 fileHash 索引）
  downloadTasks: Record<string, DownloadTask>;

  // 预签名 URL 缓存（按 fileUuid 索引）
  urlCache: Record<string, UrlCacheItem>;

  // 已缓存的本地文件路径（按 fileHash 索引，内存缓存）
  localPathCache: Record<string, string>;
}

/** Store 操作 */
interface FileCacheActions {
  // 下载任务管理
  addDownloadTask: (task: Omit<DownloadTask, 'status' | 'downloaded' | 'percent' | 'startTime'>) => void;
  updateDownloadProgress: (fileHash: string, downloaded: number, total: number, percent: number) => void;
  completeDownload: (fileHash: string, localPath: string) => void;
  failDownload: (fileHash: string, error: string) => void;
  removeDownloadTask: (fileHash: string) => void;
  clearCompletedTasks: () => void;

  // URL 缓存管理
  setUrlCache: (fileUuid: string, url: string, expiresAt: string) => void;
  getUrlCache: (fileUuid: string) => UrlCacheItem | null;
  clearExpiredUrls: () => void;

  // 本地路径缓存
  setLocalPath: (fileHash: string, localPath: string) => void;
  getLocalPath: (fileHash: string) => string | null;

  // 重置
  reset: () => void;
}

// ============================================
// Store 实现
// ============================================

const initialState: FileCacheState = {
  downloadTasks: {},
  urlCache: {},
  localPathCache: {},
};

export const useFileCacheStore = create<FileCacheState & FileCacheActions>((set, get) => ({
  ...initialState,

  // ============================================
  // 下载任务管理
  // ============================================

  addDownloadTask: (task) => {
    set((state) => ({
      downloadTasks: {
        ...state.downloadTasks,
        [task.fileHash]: {
          ...task,
          status: 'pending',
          downloaded: 0,
          percent: 0,
          startTime: Date.now(),
        },
      },
    }));
  },

  updateDownloadProgress: (fileHash, downloaded, total, percent) => {
    set((state) => {
      const task = state.downloadTasks[fileHash];
      if (!task) { return state; }

      return {
        downloadTasks: {
          ...state.downloadTasks,
          [fileHash]: {
            ...task,
            status: 'downloading',
            downloaded,
            total,
            percent,
          },
        },
      };
    });
  },

  completeDownload: (fileHash, localPath) => {
    set((state) => {
      const task = state.downloadTasks[fileHash];
      if (!task) { return state; }

      return {
        downloadTasks: {
          ...state.downloadTasks,
          [fileHash]: {
            ...task,
            status: 'completed',
            percent: 100,
            localPath,
          },
        },
        localPathCache: {
          ...state.localPathCache,
          [fileHash]: localPath,
        },
      };
    });
  },

  failDownload: (fileHash, error) => {
    set((state) => {
      const task = state.downloadTasks[fileHash];
      if (!task) { return state; }

      return {
        downloadTasks: {
          ...state.downloadTasks,
          [fileHash]: {
            ...task,
            status: 'failed',
            error,
          },
        },
      };
    });
  },

  removeDownloadTask: (fileHash) => {
    set((state) => {
      const { [fileHash]: _, ...rest } = state.downloadTasks;
      return { downloadTasks: rest };
    });
  },

  clearCompletedTasks: () => {
    set((state) => {
      const tasks = Object.entries(state.downloadTasks).filter(
        ([, task]) => task.status !== 'completed',
      );
      return { downloadTasks: Object.fromEntries(tasks) };
    });
  },

  // ============================================
  // URL 缓存管理
  // ============================================

  setUrlCache: (fileUuid, url, expiresAt) => {
    set((state) => ({
      urlCache: {
        ...state.urlCache,
        [fileUuid]: {
          url,
          expiresAt,
          cachedAt: Date.now(),
        },
      },
    }));
  },

  getUrlCache: (fileUuid) => {
    const cached = get().urlCache[fileUuid];
    if (!cached) { return null; }

    // 检查是否过期（提前 5 分钟失效）
    const expiresTime = new Date(cached.expiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 分钟缓冲

    if (now + bufferMs >= expiresTime) {
      // 已过期或即将过期，清除缓存
      set((state) => {
        const { [fileUuid]: _, ...rest } = state.urlCache;
        return { urlCache: rest };
      });
      return null;
    }

    return cached;
  },

  clearExpiredUrls: () => {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    set((state) => {
      const validEntries = Object.entries(state.urlCache).filter(([, item]) => {
        const expiresTime = new Date(item.expiresAt).getTime();
        return now + bufferMs < expiresTime;
      });
      return { urlCache: Object.fromEntries(validEntries) };
    });
  },

  // ============================================
  // 本地路径缓存
  // ============================================

  setLocalPath: (fileHash, localPath) => {
    set((state) => ({
      localPathCache: {
        ...state.localPathCache,
        [fileHash]: localPath,
      },
    }));
  },

  getLocalPath: (fileHash) => {
    return get().localPathCache[fileHash] || null;
  },

  // ============================================
  // 重置
  // ============================================

  reset: () => {
    set(initialState);
  },
}));

// ============================================
// 选择器
// ============================================

/** 获取进行中的下载任务数 */
export const selectActiveDownloads = (state: FileCacheState & FileCacheActions) =>
  Object.values(state.downloadTasks).filter((t) => t.status === 'downloading').length;

/** 获取所有下载任务列表 */
export const selectDownloadTasks = (state: FileCacheState & FileCacheActions) =>
  Object.values(state.downloadTasks);

/** 获取指定文件的下载任务 */
export const selectDownloadTask = (fileHash: string) => (state: FileCacheState & FileCacheActions) =>
  state.downloadTasks[fileHash];
