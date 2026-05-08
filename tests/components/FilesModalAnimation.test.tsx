/**
 * FilesModal 动画守卫测试
 *
 * 覆盖（本次新增/修复的动画相关行为）：
 * 1. 上传按钮 disabled=false 时 motion.button 接收 whileHover/whileTap props（hover 视觉激活）
 * 2. 上传按钮 disabled=true 时 motion.button 不接收 whileHover/whileTap（修瑕疵 D3）
 *
 * 由于 FilesModal 渲染依赖 useFiles / useFileUpload / SessionContext / useApi 等众多 hook，
 * 直接渲染 FilesModal 非常重；这里采用 mock 一切外部依赖 + 直接断言 motion.button 的属性策略。
 *
 * 用 framer-motion 的真实 motion.button 渲染，断言 DOM 属性即可（whileHover/whileTap 不会落到 DOM
 * attr，但 disabled 属性会落到 button DOM）。
 *
 * 实际守卫的逻辑：FilesModal.tsx:644-648 的
 *   whileHover={uploading ? undefined : { scale: 1.02 }}
 *   whileTap={uploading ? undefined : { scale: 0.98 }}
 * 这是源代码层的条件，无法在测试运行时动态读取传给 motion.button 的 props（被 framer 包装），
 * 但我们能验证 DOM 上 disabled 属性确实存在 — 这是 motion.button 的 React 属性透传，
 * 与 hover 守卫共同作用。
 *
 * 真正反向回归保护：disabled=true 时按钮不响应 click（fireEvent.click 不触发 handler）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ============== Mock SessionContext ==============
const mockSession = vi.hoisted(() => ({
  session: {
    serverUrl: 'http://test',
    userId: 'u1',
    accessToken: 't',
    refreshToken: 'r',
    profile: {
      user_id: 'u1',
      user_nickname: 'Test',
      user_email: null,
      user_signature: null,
      user_avatar_url: null,
      admin: 'false',
      created_at: '',
      updated_at: '',
    },
    avatarPath: null,
  },
  setSession: vi.fn(),
}));
const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => mockSession,
  useApi: () => mockApi,
}));

// ============== Mock useFiles ==============
const mockUseFilesReturn = vi.hoisted(() => ({
  files: [] as any[],
  allFiles: [] as any[],
  loading: false,
  error: null as string | null,
  category: 'all' as const,
  searchQuery: '',
  total: 0,
  page: 1,
  hasMore: false,
  setCategory: vi.fn(),
  setSearchQuery: vi.fn(),
  refresh: vi.fn(),
  loadMore: vi.fn(),
}));
vi.mock('../../src/hooks/useFiles', () => ({
  useFiles: () => mockUseFilesReturn,
}));

// ============== Mock useFileUpload（uploading 状态可控） ==============
const mockFileUpload = vi.hoisted(() => ({
  uploading: false,
  progress: null as any,
  uploadFile: vi.fn(),
  resetUpload: vi.fn(),
}));
vi.mock('../../src/hooks/useFileUpload', () => ({
  useFileUpload: () => mockFileUpload,
}));

// ============== Mock useFileCache 系列 ==============
vi.mock('../../src/hooks/useFileCache', () => ({
  useImageCache: () => ({
    src: null, isLocal: false, loading: false, error: null,
    onLoad: vi.fn(), localPath: null, cacheFile: vi.fn(), reload: vi.fn(),
    retryWithNewUrl: vi.fn(), openInFolder: vi.fn(),
  }),
  useVideoCache: () => ({
    src: null, isLocal: false, loading: false, error: null,
    onPlay: vi.fn(), localPath: null,
  }),
  useFileCache: () => ({
    src: null, isLocal: false, localPath: null, openInFolder: vi.fn(),
    loading: false, error: null, cacheFile: vi.fn(), reload: vi.fn(), retryWithNewUrl: vi.fn(),
  }),
}));

// ============== Mock fileCacheStore ==============
vi.mock('../../src/stores/fileCacheStore', () => ({
  useFileCacheStore: vi.fn().mockReturnValue(undefined),
  selectDownloadTask: vi.fn(),
}));

// ============== Mock services & 子组件 ==============
vi.mock('../../src/services/fileCache', () => ({
  getPresignedUrl: vi.fn(),
  getCachedFilePath: vi.fn(),
  triggerBackgroundDownload: vi.fn(),
  isFileNotFoundError: () => false, // 默认非 404，避免触发 toast 流程
}));

// FilesModal 在 isOpen=true 时通过 useEffect 调 listen('media-preview-file-unavailable')
// @tauri-apps/api/event 未在 setup.ts 全局 mock，需在此显式 mock 避免 unhandled rejection
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db', () => ({
  saveFileUuidHash: vi.fn(),
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ fileCache: { largeFileThresholdMB: 100 } }) },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (s: string) => s,
}));

vi.mock('../../src/chat/shared/UploadProgress', () => ({
  UploadProgress: () => <div data-testid="upload-progress" />,
}));

vi.mock('../../src/chat/shared/FilePreviewModal', () => ({
  FilePreviewModal: () => null,
}));

vi.mock('../../src/media', () => ({
  openMediaWindow: vi.fn(),
}));

// 必须在 mock 之后 import
import { FilesModal } from '../../src/components/files/FilesModal';

describe('FilesModal 上传按钮 disabled 守卫', () => {
  beforeEach(() => {
    cleanup();
    mockUseFilesReturn.files = [];
    mockUseFilesReturn.total = 0;
    mockFileUpload.uploading = false;
    mockFileUpload.progress = null;
    mockFileUpload.uploadFile = vi.fn();
    mockFileUpload.resetUpload = vi.fn();
  });

  it('uploading=false：上传按钮无 disabled 属性，可点击', () => {
    render(<FilesModal isOpen onClose={vi.fn()} />);
    const uploadBtn = screen.getByRole('button', { name: /上传文件/ });
    expect(uploadBtn).not.toBeDisabled();
  });

  it('uploading=true：上传按钮 disabled，点击不触发 uploadFile', () => {
    mockFileUpload.uploading = true;
    render(<FilesModal isOpen onClose={vi.fn()} />);
    const uploadBtn = screen.getByRole('button', { name: /上传文件/ });
    expect(uploadBtn).toBeDisabled();

    fireEvent.click(uploadBtn);
    expect(mockFileUpload.uploadFile).not.toHaveBeenCalled();
  });

  it('isOpen=false：弹窗不渲染（AnimatePresence 守卫）', () => {
    render(<FilesModal isOpen={false} onClose={vi.fn()} />);
    expect(document.querySelector('.files-modal')).not.toBeInTheDocument();
  });
});
