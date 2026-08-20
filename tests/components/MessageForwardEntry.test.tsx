/**
 * 转发入口的门控（右键菜单 + 多选操作栏）
 *
 * §5 要求「不可转发的消息**不给转发入口**」——判定住在 canForwardMessage，
 * 但真正决定用户看不看得见按钮的是这两个入口组件的门控，所以两侧都要有断言：
 * 开关或回调缺一 ⇒ 该项不渲染（不是渲染出来点了没反应）。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageContextMenu } from '../../src/chat/shared/MessageContextMenu';
import { MultiSelectActionBar } from '../../src/chat/shared/MultiSelectActionBar';

vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));

function renderMenu(over: Record<string, unknown> = {}) {
  return render(
    <MessageContextMenu
      isOpen
      position={{ x: 10, y: 10 }}
      canRecall={false}
      onRecall={vi.fn()}
      onDelete={vi.fn()}
      onMultiSelect={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe('MessageContextMenu 的「转发」项', () => {
  it('canForward + onForward 都给时才出现，点击后触发转发并关菜单', () => {
    const onForward = vi.fn();
    const onClose = vi.fn();
    renderMenu({ canForward: true, onForward, onClose });

    const item = screen.getByText('转发');
    fireEvent.click(item);

    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('canForward=false（如卡片 / 已撤回 / 在途）⇒ 不给入口', () => {
    renderMenu({ canForward: false, onForward: vi.fn() });
    expect(screen.queryByText('转发')).toBeNull();
    // 同一次渲染里「删除」仍在 —— 证明菜单本身渲染出来了，不是整体没渲染
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('只给 canForward 不给回调 ⇒ 同样不给入口（不渲染一个点了没反应的按钮）', () => {
    renderMenu({ canForward: true });
    expect(screen.queryByText('转发')).toBeNull();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });
});

describe('MultiSelectActionBar 的「转发」按钮', () => {
  const base = {
    selectedCount: 2,
    totalCount: 10,
    canBatchRecall: false,
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onBatchDelete: vi.fn(),
    onBatchRecall: vi.fn(),
    onCancel: vi.fn(),
  };

  it('选中项里有可转发的 ⇒ 出现转发按钮，点击打开转发面板', () => {
    const onBatchForward = vi.fn();
    render(<MultiSelectActionBar {...base} canBatchForward onBatchForward={onBatchForward} />);

    fireEvent.click(screen.getByText('转发'));
    expect(onBatchForward).toHaveBeenCalledTimes(1);
  });

  it('选中项全不可转发 ⇒ 不出现转发按钮（删除按钮仍在，证明操作栏已渲染）', () => {
    render(<MultiSelectActionBar {...base} canBatchForward={false} onBatchForward={vi.fn()} />);
    expect(screen.queryByText('转发')).toBeNull();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('未接入批量转发的调用方（不传回调）⇒ 不出现转发按钮', () => {
    render(<MultiSelectActionBar {...base} canBatchForward />);
    expect(screen.queryByText('转发')).toBeNull();
  });
});
