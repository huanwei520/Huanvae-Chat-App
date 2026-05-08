/**
 * FileContextMenu 测试（我的文件右键/长按菜单 — 纯展示组件）
 *
 * 覆盖：
 * 1. 渲染：未下载文档（onDownload + onDelete）→ 「下载文件」+ 「删除文件」+ divider
 * 2. 渲染：已下载（onOpenInFolder + onDelete）→ 「在文件夹中显示」+ 「删除文件」+ divider
 * 3. 渲染：仅 onDelete（图片/视频无 local 时）→ 仅「删除文件」（无 divider，反向断言）
 * 4. 点击「下载文件」→ onDownload + onClose
 * 5. 点击「删除文件」→ onDelete + onClose
 * 6. Escape 键 → onClose（未触发 action）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const mockIsMobile = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: mockIsMobile.fn,
}));

import { FileContextMenu } from '../../src/components/files/FileContextMenu';

describe('FileContextMenu', () => {
  beforeEach(() => {
    cleanup();
    mockIsMobile.fn.mockReset();
    mockIsMobile.fn.mockReturnValue(false); // 默认桌面
  });

  it('未下载文档：渲染「下载文件」+ 「删除文件」+ divider', () => {
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('下载文件')).toBeInTheDocument();
    expect(screen.getByText('删除文件')).toBeInTheDocument();
    expect(screen.queryByText('在文件夹中显示')).not.toBeInTheDocument();
    expect(document.querySelector('.context-menu-divider')).toBeInTheDocument();
  });

  it('已下载：渲染「在文件夹中显示」+ 「删除文件」+ divider', () => {
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onOpenInFolder={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('在文件夹中显示')).toBeInTheDocument();
    expect(screen.getByText('删除文件')).toBeInTheDocument();
    expect(screen.queryByText('下载文件')).not.toBeInTheDocument();
    expect(document.querySelector('.context-menu-divider')).toBeInTheDocument();
  });

  it('仅删除项（图片/视频无 local）：仅渲染「删除文件」，无 divider', () => {
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('删除文件')).toBeInTheDocument();
    expect(screen.queryByText('下载文件')).not.toBeInTheDocument();
    expect(screen.queryByText('在文件夹中显示')).not.toBeInTheDocument();
    expect(document.querySelector('.context-menu-divider')).not.toBeInTheDocument();
  });

  it('点击「下载文件」→ onDownload + onClose', () => {
    const onDownload = vi.fn();
    const onClose = vi.fn();
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onDownload={onDownload}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('下载文件'));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击「删除文件」→ onDelete + onClose', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onOpenInFolder={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('删除文件'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape 键 → onClose（不触发 action）', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onDelete = vi.fn();
    render(
      <FileContextMenu
        isOpen={true}
        position={{ x: 100, y: 100 }}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    // 100ms 延迟后注册 keydown 监听
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
