/**
 * MobileMediaPreview ⋮ 菜单测试
 *
 * 覆盖：
 * 1. 顶部右侧渲染 ⋮ 按钮（默认菜单收起，无菜单项）
 * 2. 未下载状态（localPath=null, isDownloading=false）→ 点 ⋮ → 菜单显示「下载」
 * 3. 下载中状态（isDownloading=true）→ 点 ⋮ → 菜单显示「下载中 42%」disabled
 * 4. 已下载状态（localPath 有值）→ 点 ⋮ → 菜单显示「保存到相册」+「通过其它方式打开」
 * 5. 点击「下载」触发 onDownload 回调并收起菜单
 * 6. 点击「通过其它方式打开」触发 onOpenWith 回调
 * 7. 点击 backdrop 关闭菜单
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

// MobileMediaPreview 挂的是**浮层车道** useMobileBackOverlay（不是页面级栈）；
// vi.mock 工厂是整体替换，工厂里没列的导出在被测代码里就是不存在的，故必须列全。
vi.mock('../../src/hooks/useMobileBackHandler', () => ({
  useMobileBackHandler: vi.fn(),
  useMobileBackOverlay: vi.fn(),
}));

vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn().mockResolvedValue({ success: true }),
}));

import { MobileMediaPreview } from '../../src/chat/shared/MobileMediaPreview';

function makeBaseProps() {
  return {
    isOpen: true,
    type: 'image' as const,
    src: 'http://example.com/img.jpg',
    filename: 'photo.jpg',
    onClose: vi.fn(),
  };
}

describe('MobileMediaPreview ⋮ 菜单', () => {
  beforeEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('⋮ 始终渲染，默认菜单不展开', () => {
    render(<MobileMediaPreview {...makeBaseProps()} />);
    expect(screen.getByLabelText('更多操作')).toBeInTheDocument();
    expect(screen.queryByText('下载')).toBeNull();
    expect(screen.queryByText('保存到相册')).toBeNull();
  });

  it('无任何回调时点 ⋮ 显示「暂无可用操作」空态', () => {
    render(<MobileMediaPreview {...makeBaseProps()} />);
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('暂无可用操作')).toBeInTheDocument();
  });

  it('未下载状态点 ⋮ 显示「下载」菜单项', () => {
    const onDownload = vi.fn();
    render(<MobileMediaPreview {...makeBaseProps()} onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.queryByText('保存到相册')).toBeNull();
    expect(screen.queryByText('通过其它方式打开')).toBeNull();
  });

  it('下载中状态点 ⋮ 显示「下载中 X%」disabled 项', () => {
    render(
      <MobileMediaPreview
        {...makeBaseProps()}
        isDownloading
        downloadProgress={42}
        onDownload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('更多操作'));
    const item = screen.getByText('下载中 42%').closest('button');
    expect(item).toBeDisabled();
  });

  it('已下载状态点 ⋮ 显示「保存到相册」+「通过其它方式打开」', () => {
    render(
      <MobileMediaPreview
        {...makeBaseProps()}
        localPath="/data/photo.jpg"
        onOpenWith={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('保存到相册')).toBeInTheDocument();
    expect(screen.getByText('通过其它方式打开')).toBeInTheDocument();
    expect(screen.queryByText('下载')).toBeNull();
  });

  it('点击「下载」触发 onDownload 并收起菜单', async () => {
    const onDownload = vi.fn();
    render(<MobileMediaPreview {...makeBaseProps()} onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText('更多操作'));
    await act(async () => {
      fireEvent.click(screen.getByText('下载'));
    });
    expect(onDownload).toHaveBeenCalledTimes(1);
    // 菜单收起（AnimatePresence exit 完成后从 DOM 移除）
    await waitFor(() => {
      expect(screen.queryByText('下载')).toBeNull();
    });
  });

  it('点击「通过其它方式打开」触发 onOpenWith', () => {
    const onOpenWith = vi.fn();
    render(
      <MobileMediaPreview
        {...makeBaseProps()}
        localPath="/data/photo.jpg"
        onOpenWith={onOpenWith}
      />,
    );
    fireEvent.click(screen.getByLabelText('更多操作'));
    act(() => {
      fireEvent.click(screen.getByText('通过其它方式打开'));
    });
    expect(onOpenWith).toHaveBeenCalledTimes(1);
  });

  it('点击 backdrop 关闭菜单（不关闭预览）', async () => {
    const onClose = vi.fn();
    render(
      <MobileMediaPreview
        {...makeBaseProps()}
        onClose={onClose}
        onDownload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('下载')).toBeInTheDocument();

    // backdrop 是菜单下层透明 div（class=mobile-media-preview-menu-backdrop）
    const backdrop = document.querySelector('.mobile-media-preview-menu-backdrop');
    expect(backdrop).not.toBeNull();
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fireEvent.click(backdrop!);
    });
    await waitFor(() => {
      expect(screen.queryByText('下载')).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
