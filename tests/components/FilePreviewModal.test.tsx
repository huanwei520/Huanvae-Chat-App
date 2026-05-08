/**
 * FilePreviewModal 动画与生命周期测试
 *
 * 覆盖（动画相关 + 边界行为）：
 * 1. isOpen=false：不渲染 overlay（AnimatePresence + 条件守卫）
 * 2. isOpen=true：渲染 .file-preview-overlay 与 DocumentDownloadAction
 * 3. ESC 键触发 onClose
 * 4. 点击 overlay 触发 onClose
 * 5. 点击工具栏（stopPropagation 区域）不触发 onClose
 * 6. mount 期间 body overflow 设置为 hidden，unmount 后还原
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ============== Mock 子组件与 Hook ==============
vi.mock('../../src/chat/shared/DocumentDownloadAction', () => ({
  DocumentDownloadAction: () => <div data-testid="doc-download-action" />,
}));

vi.mock('../../src/hooks/useMobileBackHandler', () => ({
  useMobileBackHandler: vi.fn(),
}));

// 必须在 mock 之后再 import
import { FilePreviewModal } from '../../src/chat/shared/FilePreviewModal';

const PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  fileUuid: 'uuid-1',
  filename: 'doc.pdf',
  fileSize: 1024,
  fileHash: 'hash-abc',
  urlType: 'user' as const,
};

describe('FilePreviewModal', () => {
  beforeEach(() => {
    cleanup();
    PROPS.onClose = vi.fn();
    document.body.style.overflow = '';
  });

  it('isOpen=false：不渲染 overlay', () => {
    render(<FilePreviewModal {...PROPS} isOpen={false} />);
    expect(document.querySelector('.file-preview-overlay')).not.toBeInTheDocument();
  });

  it('isOpen=true：渲染 overlay + DocumentDownloadAction', () => {
    render(<FilePreviewModal {...PROPS} isOpen />);
    expect(document.querySelector('.file-preview-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('doc-download-action')).toBeInTheDocument();
  });

  it('ESC 键触发 onClose', () => {
    render(<FilePreviewModal {...PROPS} isOpen />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  it('点击 overlay 触发 onClose', () => {
    render(<FilePreviewModal {...PROPS} isOpen />);
    const overlay = document.querySelector('.file-preview-overlay')!;
    fireEvent.click(overlay);
    expect(PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  it('点击工具栏 stopPropagation：不触发 onClose', () => {
    render(<FilePreviewModal {...PROPS} isOpen />);
    const toolbar = document.querySelector('.file-preview-toolbar')!;
    fireEvent.click(toolbar);
    expect(PROPS.onClose).not.toHaveBeenCalled();
  });

  it('mount 期间设置 body overflow=hidden，unmount 后还原', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(<FilePreviewModal {...PROPS} isOpen />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
