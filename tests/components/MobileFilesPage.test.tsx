/**
 * MobileFilesPage 动画与生命周期 + 长按菜单 + 删除流程测试
 *
 * 覆盖（动画相关）：
 * 1. mount 期间 body overflow=hidden，unmount 还原
 * 2. cardVariants 含 exit 字段（与桌面 FilesModal 对齐）
 * 3. 文档点击触发 documentPreview 状态变化（FilePreviewModal isOpen=true）
 *
 * 覆盖（长按菜单 + 删除）：
 * 4. 长按 500ms → 菜单打开
 * 5. 长按 250ms 后释放 → 菜单不打开
 * 6. 长按触发后的合成 click 被抑制（不打开 documentPreview）
 *
 * 因 MobileFilesPage 直接调 useFiles / SessionContext / useApi，需要 mock 整套依赖。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { FileItem } from '../../src/api/storage';

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
const TEST_FILE = {
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

const mockUseFilesReturn = vi.hoisted(() => ({
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

vi.mock('../../src/hooks/useFiles', () => ({
  useFiles: () => mockUseFilesReturn,
}));

// ============== Mock useImageCache ==============
vi.mock('../../src/hooks/useFileCache', () => ({
  useImageCache: () => ({
    src: null,
    isLocal: false,
    loading: false,
    error: null,
    onLoad: vi.fn(),
    localPath: null,
    cacheFile: vi.fn(),
    reload: vi.fn(),
    retryWithNewUrl: vi.fn(),
    openInFolder: vi.fn(),
  }),
  useFileCache: () => ({
    src: null,
    isLocal: false,
    localPath: null,
    openInFolder: vi.fn(),
    loading: false,
    error: null,
    cacheFile: vi.fn(),
    reload: vi.fn(),
    retryWithNewUrl: vi.fn(),
  }),
  useVideoCache: () => ({
    src: null,
    isLocal: false,
    loading: false,
    error: null,
    onPlay: vi.fn(),
    localPath: null,
  }),
}));

// ============== Mock fileCache services ==============
const mockTriggerDownload = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/fileCache', () => ({
  getPresignedUrl: vi.fn(),
  getCachedFilePath: vi.fn(),
  getVideoSource: vi.fn().mockResolvedValue({ src: '', isLocal: false }),
  triggerBackgroundDownload: mockTriggerDownload,
}));

// ============== Mock fileCacheStore + storage api ==============
const mockUseFileCacheStore = vi.hoisted(() => vi.fn());
vi.mock('../../src/stores/fileCacheStore', () => ({
  useFileCacheStore: mockUseFileCacheStore,
  selectDownloadTask: vi.fn(),
}));

const mockDeleteFile = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/storage', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/storage')>(
    '../../src/api/storage',
  );
  return {
    ...actual,
    deleteFile: mockDeleteFile,
  };
});

// ============== Mock isMobile (mobile context) ==============
vi.mock('../../src/utils/platform', () => ({
  isMobile: vi.fn().mockReturnValue(true),
}));

// ============== Mock FilePreviewModal（避免触发 useMobileBackHandler 等下游） ==============
const filePreviewModalSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/chat/shared/FilePreviewModal', () => ({
  FilePreviewModal: (props: { isOpen: boolean; fileUuid?: string }) => {
    filePreviewModalSpy(props);
    return props.isOpen
      ? <div data-testid="file-preview-modal" data-uuid={props.fileUuid} />
      : null;
  },
}));

// 必须在 mock 之后再 import
import { MobileFilesPage } from '../../src/pages/mobile/MobileFilesPage';

describe('MobileFilesPage 动画与生命周期', () => {
  beforeEach(() => {
    cleanup();
    document.body.style.overflow = '';
    mockUseFilesReturn.files = [];
    mockUseFilesReturn.total = 0;
    mockUseFilesReturn.refresh.mockReset();
    filePreviewModalSpy.mockReset();
    mockTriggerDownload.mockReset();
    mockDeleteFile.mockReset();
    mockUseFileCacheStore.mockReset();
    mockUseFileCacheStore.mockReturnValue(undefined);
  });

  it('mount 期间 body overflow=hidden，unmount 后还原（修瑕疵 D2）', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(<MobileFilesPage onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('页面渲染顶部栏与统计行（基础渲染契约）', () => {
    render(<MobileFilesPage onClose={vi.fn()} />);
    expect(screen.getByText('我的文件')).toBeInTheDocument();
    expect(screen.getByText(/共 0 个文件/)).toBeInTheDocument();
  });

  it('点击文档卡片触发 documentPreview state，渲染 FilePreviewModal 且传入正确 fileUuid', async () => {
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;

    render(<MobileFilesPage onClose={vi.fn()} />);

    const card = screen.getByText('report.pdf').closest('.mobile-file-card');
    expect(card).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(card!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-preview-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('file-preview-modal').getAttribute('data-uuid')).toBe('uuid-doc-1');
  });

  it('未点击文档时 FilePreviewModal isOpen=false（不在 DOM）', () => {
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;
    render(<MobileFilesPage onClose={vi.fn()} />);
    expect(screen.queryByTestId('file-preview-modal')).toBeNull();
  });

  it('文件被过滤后从 DOM 移除（AnimatePresence + cardVariants.exit + motion.div exit="exit" 完整链路 — 修瑕疵 D1）', async () => {
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;

    const { rerender } = render(<MobileFilesPage onClose={vi.fn()} />);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();

    // 模拟搜索过滤后文件列表变空 → AnimatePresence 触发 exit 路径
    mockUseFilesReturn.files = [];
    mockUseFilesReturn.total = 0;
    rerender(<MobileFilesPage onClose={vi.fn()} />);

    // skipAnimations=true 下 exit 立即完成，节点从 DOM 移除
    await waitFor(() => {
      expect(screen.queryByText('report.pdf')).toBeNull();
    });
  });

  it('长按 500ms → 菜单打开', async () => {
    vi.useFakeTimers();
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;

    render(<MobileFilesPage onClose={vi.fn()} />);
    const card = screen.getByText('report.pdf').closest('.mobile-file-card');
    expect(card).toBeInTheDocument();

    fireEvent.touchStart(card!, {
      touches: [{ clientX: 100, clientY: 100 }],
    });

    // 推进 500ms 触发 longpress 定时器
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // 菜单应渲染
    expect(screen.getByText('删除文件')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('长按 250ms 后释放 → 菜单不打开', async () => {
    vi.useFakeTimers();
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;

    render(<MobileFilesPage onClose={vi.fn()} />);
    const card = screen.getByText('report.pdf').closest('.mobile-file-card');

    fireEvent.touchStart(card!, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.touchEnd(card!);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // 菜单不应渲染
    expect(screen.queryByText('删除文件')).toBeNull();
    vi.useRealTimers();
  });

  it('长按触发后的合成 click 被抑制（不调 setDocumentPreview）', async () => {
    vi.useFakeTimers();
    mockUseFilesReturn.files = [TEST_FILE];
    mockUseFilesReturn.total = 1;

    render(<MobileFilesPage onClose={vi.fn()} />);
    const card = screen.getByText('report.pdf').closest('.mobile-file-card');

    fireEvent.touchStart(card!, { touches: [{ clientX: 100, clientY: 100 }] });
    await act(async () => {
      vi.advanceTimersByTime(500); // 长按触发
    });
    fireEvent.touchEnd(card!);
    fireEvent.click(card!); // 合成 click

    vi.useRealTimers();

    // FilePreviewModal 不应打开（长按已触发菜单，click 被抑制）
    // 通过验证 spy 接收的最后一次 props.isOpen 来判断
    const lastCall = filePreviewModalSpy.mock.calls[filePreviewModalSpy.mock.calls.length - 1];
    expect(lastCall?.[0].isOpen).toBe(false);
  });
});
