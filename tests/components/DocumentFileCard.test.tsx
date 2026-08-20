/**
 * DocumentFileCard 测试（FilesModal 内部子组件）
 *
 * 覆盖：
 * 1. 已下载状态：渲染 LocalBadge + 本地路径文本 + 文件名/大小/日期
 * 2. 未下载状态：不渲染 LocalBadge / 本地路径文本，但仍渲染下载按钮
 * 3. 桌面端三态点击：
 *    - 已下载点击 → openInFolder（不调 onPreview）
 *    - 未下载点击 → triggerBackgroundDownload（不调 onPreview）
 *    - 下载中点击 → noop（不调 openInFolder / triggerBackgroundDownload / onPreview）
 * 4. 移动端点击 → onPreview（不走桌面三态）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockHooks = vi.hoisted(() => ({
  useFileCache: vi.fn(),
  useFileCacheStore: vi.fn(),
  triggerBackgroundDownload: vi.fn(),
  openInFolder: vi.fn(),
  isMobile: vi.fn(),
}));

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: mockHooks.useFileCache,
  useImageCache: vi.fn(),
  useVideoCache: vi.fn(),
}));

vi.mock('../../src/stores/fileCacheStore', () => ({
  useFileCacheStore: mockHooks.useFileCacheStore,
  selectDownloadTask: vi.fn(),
}));

vi.mock('../../src/services/fileCache', () => ({
  triggerBackgroundDownload: mockHooks.triggerBackgroundDownload,
  getPresignedUrl: vi.fn(),
  getCachedFilePath: vi.fn(),
  // 同上：DocumentDownloadAction 经 fileIdentityKey 取任务键
  fileIdentityKey: (fileUuid: string, knownHash?: string | null) => knownHash || fileUuid,
}));

vi.mock('../../src/utils/platform', () => ({
  isMobile: mockHooks.isMobile,
}));

// FilesModal.tsx 整文件 import 会触发其他模块，但 DocumentFileCard 自身只用到上述 mock
import { DocumentFileCard } from '../../src/components/files/FilesModal';

const FILE = {
  file_uuid: 'uuid-1',
  filename: 'report.pdf',
  file_hash: 'hash-abc',
  file_size: 2048,
  content_type: 'application/pdf',
  file_url: '',
  storage_location: 'user_files',
  preview_support: 'inline_preview' as const,
  created_at: '2026-05-07T00:00:00Z',
  updated_at: '2026-05-07T00:00:00Z',
};

const formatDate = () => '2026-05-07';

describe('DocumentFileCard', () => {
  beforeEach(() => {
    cleanup();
    mockHooks.useFileCache.mockReset();
    mockHooks.useFileCacheStore.mockReset();
    mockHooks.openInFolder.mockReset();
    mockHooks.triggerBackgroundDownload.mockReset();
    mockHooks.isMobile.mockReset();
    mockHooks.useFileCacheStore.mockReturnValue(undefined);
    mockHooks.isMobile.mockReturnValue(false); // 默认桌面
  });

  function setupHook(overrides: Record<string, unknown> = {}) {
    mockHooks.useFileCache.mockReturnValue({
      src: 'https://example.com/report.pdf',
      isLocal: false,
      localPath: null,
      openInFolder: mockHooks.openInFolder,
      loading: false,
      error: null,
      cacheFile: vi.fn(),
      reload: vi.fn(),
      retryWithNewUrl: vi.fn(),
      ...overrides,
    });
  }

  it('已下载（isLocal）：渲染 LocalBadge 和本地路径文本', () => {
    setupHook({
      isLocal: true,
      localPath: '/data/u_srv/file/documents/abc12345_report.pdf',
    });

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={vi.fn()} formatDate={formatDate} />,
    );

    expect(document.querySelector('.file-local-badge')).toBeInTheDocument();
    const localPathEl = document.querySelector('.document-local-path');
    expect(localPathEl).toBeInTheDocument();
    expect(localPathEl?.textContent).toContain('abc12345_report.pdf');
    expect(document.querySelector('.document-download')).not.toBeInTheDocument();
  });

  it('未下载：不渲染 LocalBadge 和本地路径，但渲染下载按钮', () => {
    setupHook();

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={vi.fn()} formatDate={formatDate} />,
    );

    expect(document.querySelector('.file-local-badge')).not.toBeInTheDocument();
    expect(document.querySelector('.document-local-path')).not.toBeInTheDocument();
    expect(document.querySelector('.document-download')).toBeInTheDocument();
  });

  it('桌面端 已下载 点击卡片 → openInFolder（不调 onPreview）', () => {
    mockHooks.isMobile.mockReturnValue(false);
    setupHook({
      isLocal: true,
      localPath: '/data/u_srv/file/documents/report.pdf',
    });
    const onPreview = vi.fn();

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={onPreview} formatDate={formatDate} />,
    );

    fireEvent.click(screen.getByText('report.pdf').closest('.file-card')!);
    expect(mockHooks.openInFolder).toHaveBeenCalledWith('/data/u_srv/file/documents/report.pdf');
    expect(mockHooks.triggerBackgroundDownload).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('桌面端 未下载 点击卡片 → triggerBackgroundDownload（不调 onPreview）', () => {
    mockHooks.isMobile.mockReturnValue(false);
    setupHook();
    const onPreview = vi.fn();

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={onPreview} formatDate={formatDate} />,
    );

    fireEvent.click(screen.getByText('report.pdf').closest('.file-card')!);
    expect(mockHooks.triggerBackgroundDownload).toHaveBeenLastCalledWith(
      'https://example.com/report.pdf',
      'hash-abc',
      'report.pdf',
      'document',
      2048,
    );
    expect(mockHooks.openInFolder).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('桌面端 下载中 点击卡片 → noop（不调任何回调）', () => {
    mockHooks.isMobile.mockReturnValue(false);
    setupHook();
    mockHooks.useFileCacheStore.mockReturnValue({ status: 'downloading', percent: 42 });
    const onPreview = vi.fn();

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={onPreview} formatDate={formatDate} />,
    );

    fireEvent.click(screen.getByText('report.pdf').closest('.file-card')!);
    expect(mockHooks.openInFolder).not.toHaveBeenCalled();
    expect(mockHooks.triggerBackgroundDownload).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('移动端 点击卡片 → onPreview（不走桌面三态）', () => {
    mockHooks.isMobile.mockReturnValue(true);
    setupHook({
      isLocal: true,
      localPath: '/data/u_srv/file/documents/report.pdf',
    });
    const onPreview = vi.fn();

    render(
      <DocumentFileCard file={FILE} index={0} onPreview={onPreview} formatDate={formatDate} />,
    );

    fireEvent.click(screen.getByText('report.pdf').closest('.file-card')!);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(mockHooks.openInFolder).not.toHaveBeenCalled();
    expect(mockHooks.triggerBackgroundDownload).not.toHaveBeenCalled();
  });
});
