/**
 * DocumentDownloadAction 共享组件测试
 *
 * 覆盖：
 * 1. inline 未下载状态：渲染 .document-download 按钮（反向断言无进度环）
 * 2. inline 下载中：渲染 CircularProgress（反向断言无下载按钮）
 * 3. inline 已下载：document-actions 容器仍在但内部不渲染按钮/进度
 * 4. centered 已下载：渲染"打开文件"大按钮
 * 5. 点击下载按钮调用 triggerBackgroundDownload(完整 5 参数)
 * 6. 点击下载按钮 e.stopPropagation 不触发外层 onClick
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ============== Mock useFileCache ==============
const mockHooks = vi.hoisted(() => ({
  useFileCache: vi.fn(),
  useFileCacheStore: vi.fn(),
  triggerBackgroundDownload: vi.fn(),
  openInFolder: vi.fn(),
}));

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: mockHooks.useFileCache,
}));

vi.mock('../../src/stores/fileCacheStore', () => ({
  useFileCacheStore: mockHooks.useFileCacheStore,
  selectDownloadTask: vi.fn(),
}));

vi.mock('../../src/services/fileCache', () => ({
  triggerBackgroundDownload: mockHooks.triggerBackgroundDownload,
}));

// 必须在 mock 之后再 import
import { DocumentDownloadAction } from '../../src/chat/shared/DocumentDownloadAction';

const PROPS = {
  fileUuid: 'uuid-1',
  fileHash: 'hash-abc',
  filename: 'doc.pdf',
  fileSize: 1024,
  urlType: 'user' as const,
};

function setupHook(overrides: Record<string, unknown> = {}) {
  mockHooks.useFileCache.mockReturnValue({
    src: 'https://example.com/file.pdf',
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

describe('DocumentDownloadAction', () => {
  beforeEach(() => {
    cleanup();
    mockHooks.useFileCache.mockReset();
    mockHooks.useFileCacheStore.mockReset();
    mockHooks.triggerBackgroundDownload.mockReset();
    mockHooks.openInFolder.mockReset();
    setupHook();
    mockHooks.useFileCacheStore.mockReturnValue(undefined);
  });

  it('inline 未下载：渲染 .document-download 按钮，无进度环', () => {
    render(<DocumentDownloadAction layout="inline" {...PROPS} />);

    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('document-download');
    // 反向断言：下载中状态不存在
    expect(document.querySelector('.document-download-progress')).not.toBeInTheDocument();
  });

  it('inline 下载中：渲染 CircularProgress，无下载按钮', () => {
    mockHooks.useFileCacheStore.mockReturnValue({
      fileHash: 'hash-abc',
      fileName: 'doc.pdf',
      fileType: 'document',
      status: 'downloading',
      downloaded: 420,
      total: 1024,
      percent: 42,
      startTime: Date.now(),
    });

    render(<DocumentDownloadAction layout="inline" {...PROPS} />);

    expect(document.querySelector('.document-download-progress')).toBeInTheDocument();
    expect(document.querySelector('.circular-progress-svg')).toBeInTheDocument();
    // 反向断言：未下载的下载按钮不存在
    expect(document.querySelector('.document-download')).not.toBeInTheDocument();
  });

  it('inline 已下载（completed task）：document-actions 容器存在但无按钮/进度', () => {
    mockHooks.useFileCacheStore.mockReturnValue({
      fileHash: 'hash-abc',
      fileName: 'doc.pdf',
      fileType: 'document',
      status: 'completed',
      downloaded: 1024,
      total: 1024,
      percent: 100,
      localPath: '/data/doc.pdf',
      startTime: Date.now(),
    });

    render(<DocumentDownloadAction layout="inline" {...PROPS} />);

    expect(document.querySelector('.document-actions')).toBeInTheDocument();
    expect(document.querySelector('.document-download-progress')).not.toBeInTheDocument();
    expect(document.querySelector('.document-download')).not.toBeInTheDocument();
  });

  it('centered 已下载：渲染 .download-btn.open 大按钮', () => {
    setupHook({ isLocal: true, localPath: '/data/doc.pdf' });

    render(<DocumentDownloadAction layout="centered" {...PROPS} />);

    const btn = screen.getByRole('button', { name: /打开文件/ });
    expect(btn).toHaveClass('download-btn', 'open');
    // 反向断言：未下载的下载文件按钮不存在
    expect(screen.queryByRole('button', { name: /^下载文件$/ })).toBeNull();
  });

  it('点击下载按钮：triggerBackgroundDownload 收到完整 5 参数', () => {
    render(<DocumentDownloadAction layout="inline" {...PROPS} />);

    fireEvent.click(screen.getByRole('button'));

    expect(mockHooks.triggerBackgroundDownload).toHaveBeenLastCalledWith(
      'https://example.com/file.pdf',
      'hash-abc',
      'doc.pdf',
      'document',
      1024,
    );
  });

  it('点击下载按钮：stopPropagation 阻止外层 onClick', () => {
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <DocumentDownloadAction layout="inline" {...PROPS} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(mockHooks.triggerBackgroundDownload).toHaveBeenCalledTimes(1);
    expect(outerClick).not.toHaveBeenCalled();
  });
});
