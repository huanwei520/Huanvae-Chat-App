/**
 * FilesModal 右键菜单 + 删除流程测试
 *
 * 覆盖：
 * 1. 右键卡片 → menu 渲染
 * 2. 菜单点击「删除文件」→ ConfirmDialog 显示
 * 3. ConfirmDialog 确认 → deleteFile + refresh
 * 4. ConfirmDialog 取消 → 不调用 deleteFile
 * 5. deleteFile 失败 → console.error，refresh 不调
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { FileItem } from '../../src/api/storage';

// ============== Hoisted mocks ==============
const mockSession = vi.hoisted(() => ({
  session: {
    serverUrl: 'http://test',
    userId: 'u1',
    accessToken: 't',
    refreshToken: 'r',
    profile: {
      user_id: 'u1', user_nickname: 'Test', user_email: null,
      user_signature: null, user_avatar_url: null, admin: 'false',
      created_at: '', updated_at: '',
    },
    avatarPath: null,
  },
  setSession: vi.fn(),
}));
const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const mockUseFiles = vi.hoisted(() => ({
  files: [] as FileItem[],
  allFiles: [] as FileItem[],
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
const mockDeleteFile = vi.hoisted(() => vi.fn());
const mockGetFiles = vi.hoisted(() => vi.fn());
const mockGetPresignedUrl = vi.hoisted(() => vi.fn());
const mockTriggerDownload = vi.hoisted(() => vi.fn());
const mockUseFileCache = vi.hoisted(() => vi.fn());
const mockUseFileCacheStore = vi.hoisted(() => vi.fn());
const mockIsMobile = vi.hoisted(() => vi.fn());

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => mockSession,
  useApi: () => mockApi,
}));

vi.mock('../../src/hooks/useFiles', () => ({
  useFiles: () => mockUseFiles,
}));

vi.mock('../../src/api/storage', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/storage')>(
    '../../src/api/storage',
  );
  return {
    ...actual,
    deleteFile: mockDeleteFile,
    getFiles: mockGetFiles,
    getPresignedUrl: mockGetPresignedUrl,
  };
});

const mockServicesGetPresignedUrl = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/fileCache', async () => {
  // 保留原 isFileNotFoundError 等纯函数（FilesModal 需要它做 404 判断）
  const actual = await vi.importActual<typeof import('../../src/services/fileCache')>(
    '../../src/services/fileCache',
  );
  return {
    ...actual,
    triggerBackgroundDownload: mockTriggerDownload,
    getPresignedUrl: mockServicesGetPresignedUrl,
    getCachedFilePath: vi.fn(),
  };
});

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: mockUseFileCache,
  useImageCache: vi.fn().mockReturnValue({
    src: null, isLocal: false, loading: false, error: null,
    onLoad: vi.fn(), localPath: null,
  }),
  useVideoCache: vi.fn().mockReturnValue({
    src: null, isLocal: false, loading: false, error: null,
    localPath: null,
  }),
}));

vi.mock('../../src/stores/fileCacheStore', () => ({
  useFileCacheStore: mockUseFileCacheStore,
  selectDownloadTask: vi.fn(),
}));

vi.mock('../../src/utils/platform', () => ({
  isMobile: mockIsMobile,
}));

// @tauri-apps/api/event 未在 setup.ts 全局 mock —
// FilesModal 的 useEffect 监听 'media-preview-file-unavailable' 事件需要 mock listen
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploading: false,
    progress: null,
    uploadFile: vi.fn(),
    resetUpload: vi.fn(),
  }),
}));

const mockOpenMediaWindow = vi.hoisted(() => vi.fn());
vi.mock('../../src/media', () => ({
  openMediaWindow: mockOpenMediaWindow,
}));

import { FilesModal } from '../../src/components/files/FilesModal';

const DOC_FILE = {
  file_uuid: 'uuid-doc-1',
  filename: 'report.pdf',
  file_hash: 'hash-doc',
  file_size: 2048,
  content_type: 'application/pdf',
  file_url: '',
  storage_location: 'user_files',
  preview_support: 'inline_preview' as const,
  created_at: '2026-05-07T00:00:00Z',
  updated_at: '2026-05-07T00:00:00Z',
};

describe('FilesModal 右键菜单 + 删除流程', () => {
  beforeEach(() => {
    cleanup();
    mockDeleteFile.mockReset();
    mockUseFiles.refresh.mockReset();
    mockTriggerDownload.mockReset();
    mockUseFileCache.mockReset();
    mockUseFileCacheStore.mockReset();
    mockIsMobile.mockReset();
    mockServicesGetPresignedUrl.mockReset();
    mockUseFiles.files = [DOC_FILE];
    mockUseFiles.total = 1;
    mockIsMobile.mockReturnValue(false); // 桌面
    mockUseFileCache.mockReturnValue({
      src: 'https://example.com/report.pdf',
      isLocal: false,
      localPath: null,
      openInFolder: vi.fn(),
      loading: false,
      error: null,
      cacheFile: vi.fn(),
      reload: vi.fn(),
      retryWithNewUrl: vi.fn(),
    });
    mockUseFileCacheStore.mockReturnValue(undefined); // no download task
    mockServicesGetPresignedUrl.mockResolvedValue({
      url: 'https://example.com/lazy-fetched.pdf',
      expiresAt: '2026-12-31T00:00:00Z',
    });
    mockOpenMediaWindow.mockReset();
  });

  it('右键文件卡片 → menu 渲染', () => {
    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.file-card');
    expect(card).toBeInTheDocument();

    fireEvent.contextMenu(card!);

    expect(screen.getByText('删除文件')).toBeInTheDocument();
  });

  it('菜单「删除文件」→ ConfirmDialog 显示，确认后调 deleteFile + refresh', async () => {
    mockDeleteFile.mockResolvedValue(undefined);
    mockUseFiles.refresh.mockResolvedValue(undefined);

    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.file-card');
    fireEvent.contextMenu(card!);
    fireEvent.click(screen.getByText('删除文件'));

    // ConfirmDialog 应渲染
    await waitFor(() => {
      expect(screen.getByText(/文件「report\.pdf」删除后将从云端移除/)).toBeInTheDocument();
    });

    // 点击确认按钮
    const confirmBtn = screen.getAllByText('删除').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    act(() => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(mockDeleteFile).toHaveBeenCalledWith(mockApi, 'uuid-doc-1');
    });
    expect(mockUseFiles.refresh).toHaveBeenCalledTimes(1);
  });

  it('菜单「删除文件」→ ConfirmDialog 取消 → 不调 deleteFile', async () => {
    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.file-card');
    fireEvent.contextMenu(card!);
    fireEvent.click(screen.getByText('删除文件'));

    await waitFor(() => {
      expect(screen.getByText(/删除后将从云端移除/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('取消'));

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockUseFiles.refresh).not.toHaveBeenCalled();
  });

  it('deleteFile 抛错 → console.error，refresh 不调', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteFile.mockRejectedValue(new Error('Network error'));

    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.file-card');
    fireEvent.contextMenu(card!);
    fireEvent.click(screen.getByText('删除文件'));

    await waitFor(() => {
      expect(screen.getByText(/删除后将从云端移除/)).toBeInTheDocument();
    });

    const confirmBtn = screen.getAllByText('删除').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    act(() => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(mockDeleteFile).toHaveBeenCalledWith(mockApi, 'uuid-doc-1');
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[FilesModal] 删除文件失败:',
      expect.any(Error),
    );
    expect(mockUseFiles.refresh).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('菜单「下载文件」→ lazy 获取 presigned URL → triggerBackgroundDownload', async () => {
    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.file-card');
    fireEvent.contextMenu(card!);

    // 未下载状态下应该渲染「下载文件」（lazy 模式：菜单项立即显示，不依赖 src 是否加载完成）
    const downloadItem = screen.getByText('下载文件');
    fireEvent.click(downloadItem);

    // onDownload 是 async 的：先 await getPresignedUrl，然后调 triggerBackgroundDownload
    await waitFor(() => {
      expect(mockServicesGetPresignedUrl).toHaveBeenCalledWith(
        mockApi,
        'uuid-doc-1',
        'user',
      );
    });
    await waitFor(() => {
      expect(mockTriggerDownload).toHaveBeenLastCalledWith(
        'https://example.com/lazy-fetched.pdf',
        'hash-doc',
        'report.pdf',
        'document',
        2048,
      );
    });
  });

  it('图片文件 getPresignedUrl 服务端 404 → 显示 toast + refresh + 不打开媒体窗口', async () => {
    const IMAGE_FILE: FileItem = {
      file_uuid: 'uuid-img-1',
      filename: 'photo.jpg',
      file_hash: 'hash-img',
      file_size: 4096,
      content_type: 'image/jpeg',
      file_url: '',
      preview_support: 'inline_preview',
      created_at: '2026-05-08T00:00:00Z',
    };
    mockUseFiles.files = [IMAGE_FILE];
    mockUseFiles.total = 1;
    mockServicesGetPresignedUrl.mockRejectedValueOnce(new Error('文件 未找到'));
    mockUseFiles.refresh.mockResolvedValue(undefined);

    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    // 点击图片卡片触发 handlePreview
    const card = screen.getByText('photo.jpg').closest('.file-card');
    fireEvent.click(card!);

    // 等待 toast 出现 + refresh 被调
    await waitFor(() => {
      expect(screen.getByText(/photo\.jpg.*已从服务器删除/)).toBeInTheDocument();
    });
    expect(mockUseFiles.refresh).toHaveBeenCalledTimes(1);

    // 关键：openMediaWindow 不应被调用（404 时提前 return）
    expect(mockOpenMediaWindow).not.toHaveBeenCalled();
  });

  it('图片文件 getPresignedUrl 非 404 错误 → 仍打开媒体窗口（让窗口内自处理）', async () => {
    const IMAGE_FILE: FileItem = {
      file_uuid: 'uuid-img-2',
      filename: 'photo2.jpg',
      file_hash: 'hash-img-2',
      file_size: 4096,
      content_type: 'image/jpeg',
      file_url: '',
      preview_support: 'inline_preview',
      created_at: '2026-05-08T00:00:00Z',
    };
    mockUseFiles.files = [IMAGE_FILE];
    mockUseFiles.total = 1;
    mockServicesGetPresignedUrl.mockRejectedValueOnce(new Error('Network timeout'));

    render(<FilesModal isOpen={true} onClose={vi.fn()} />);

    const card = screen.getByText('photo2.jpg').closest('.file-card');
    fireEvent.click(card!);

    // 非 404 错误：openMediaWindow 仍被调用，refresh 不被调
    await waitFor(() => {
      expect(mockOpenMediaWindow).toHaveBeenCalledTimes(1);
    });
    expect(mockUseFiles.refresh).not.toHaveBeenCalled();
  });

  it('右键菜单立即显示「下载文件」即使 src 还未加载完成（lazy 模式）', () => {
    // 模拟 useFileCache 还在 loading 阶段（src 未 ready）
    mockUseFileCache.mockReturnValue({
      src: null,           // 关键：src 为 null
      isLocal: false,
      localPath: null,
      openInFolder: vi.fn(),
      loading: true,
      error: null,
      cacheFile: vi.fn(),
      reload: vi.fn(),
      retryWithNewUrl: vi.fn(),
    });

    render(<FilesModal isOpen={true} onClose={vi.fn()} />);
    const card = screen.getByText('report.pdf').closest('.file-card');
    fireEvent.contextMenu(card!);

    // 即使 src=null，「下载文件」菜单项仍应渲染（修复点）
    expect(screen.getByText('下载文件')).toBeInTheDocument();
  });
});
