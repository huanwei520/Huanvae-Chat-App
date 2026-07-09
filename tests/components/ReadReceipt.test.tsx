/**
 * 已读回执组件测试
 *
 * 覆盖（聚焦各组件的条件分支逻辑，非静态字面量 tautology）：
 * - PrivateReadReceipt：status → 图标/类名状态机（时钟/红叹号/灰双勾/绿双勾）
 * - ReaderAvatarStack：slice 截断 + "+N" 溢出 + 头像/占位分支 + 空数组渲染 null
 * - GroupReadReceipt：status 分支 + text=null 不渲染 + 有/无已读者的可点击性与回调
 * - GroupReadListModal：开/关 + 名单行渲染 + 关闭回调 + 桌面/移动类名
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 可控的平台 mock（GroupReadListModal 用 isMobile() 决定桌面 modal / 移动 sheet）
const platformMock = vi.hoisted(() => ({ isMobile: vi.fn(() => false) }));
vi.mock('../../src/utils/platform', () => platformMock);

import { PrivateReadReceipt } from '../../src/chat/shared/PrivateReadReceipt';
import { ReaderAvatarStack } from '../../src/chat/shared/ReaderAvatarStack';
import { GroupReadReceipt } from '../../src/chat/group/GroupReadReceipt';
import { GroupReadListModal } from '../../src/chat/group/GroupReadListModal';
import type { GroupReader } from '../../src/chat/group/useGroupReadReceipt';

const reader = (id: string, over: Partial<GroupReader> = {}): GroupReader => ({
  userId: id,
  displayName: over.displayName ?? `User_${id}`,
  avatarUrl: over.avatarUrl ?? null,
  lastReadAt: over.lastReadAt ?? '2026-06-10T10:00:00Z',
});

describe('PrivateReadReceipt（私聊状态槽）', () => {
  it('sending → 时钟图标槽 .read-receipt-icon.sending', () => {
    const { container } = render(<PrivateReadReceipt status="sending" isRead={false} />);
    expect(container.querySelector('.read-receipt-icon.sending')).toBeTruthy();
    expect(container.querySelector('.double-check')).toBeNull();
  });

  it('failed → 红叹号 .read-receipt-icon.failed', () => {
    const { container } = render(<PrivateReadReceipt status="failed" isRead={false} />);
    expect(container.querySelector('.read-receipt-icon.failed')).toBeTruthy();
  });

  it('已送达未读 → 灰双勾 .double-check.unread（非 read）', () => {
    const { container } = render(<PrivateReadReceipt status="sent" isRead={false} />);
    const icon = container.querySelector('.read-receipt-icon.double-check');
    expect(icon).toBeTruthy();
    expect(icon?.classList.contains('unread')).toBe(true);
    expect(icon?.classList.contains('read')).toBe(false);
  });

  it('已读 → 绿双勾 .double-check.read（缺省 status 视为已送达）', () => {
    const { container } = render(<PrivateReadReceipt isRead />);
    const icon = container.querySelector('.read-receipt-icon.double-check');
    expect(icon?.classList.contains('read')).toBe(true);
    expect(icon?.classList.contains('unread')).toBe(false);
  });
});

describe('ReaderAvatarStack（已读者头像堆叠）', () => {
  it('空数组渲染 null', () => {
    const { container } = render(<ReaderAvatarStack readers={[]} />);
    expect(container.querySelector('.reader-avatar-stack')).toBeNull();
  });

  it('超过 maxVisible 时只显示前 N 个并显示 +溢出数', () => {
    const readers = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => reader(id));
    const { container } = render(<ReaderAvatarStack readers={readers} maxVisible={5} />);
    expect(container.querySelectorAll('.reader-avatar-stack-item')).toHaveLength(5);
    expect(container.querySelector('.reader-avatar-stack-more')?.textContent).toBe('+2');
  });

  it('未超过时不显示 +溢出', () => {
    const readers = [reader('a'), reader('b')];
    const { container } = render(<ReaderAvatarStack readers={readers} maxVisible={5} />);
    expect(container.querySelectorAll('.reader-avatar-stack-item')).toHaveLength(2);
    expect(container.querySelector('.reader-avatar-stack-more')).toBeNull();
  });

  it('有头像渲染 img，无头像渲染首字母占位', () => {
    const readers = [
      reader('a', { avatarUrl: 'http://x/a.png', displayName: 'Alice' }),
      reader('b', { avatarUrl: null, displayName: 'bob' }),
    ];
    const { container } = render(<ReaderAvatarStack readers={readers} />);
    expect(container.querySelector('img[src="http://x/a.png"]')).toBeTruthy();
    // 无头像走统一 AvatarPlaceholder（.avatar-placeholder-unified），首字母大写
    const placeholder = container.querySelector('.avatar-placeholder-unified');
    expect(placeholder?.textContent).toBe('B'); // bob 首字母大写
  });
});

describe('GroupReadReceipt（群状态槽）', () => {
  it('sending → 时钟，不渲染已读按钮', () => {
    const { container } = render(
      <GroupReadReceipt status="sending" text={null} readers={[]} onOpenList={vi.fn()} />,
    );
    expect(container.querySelector('.read-receipt-icon.sending')).toBeTruthy();
    expect(container.querySelector('.group-read-receipt')).toBeNull();
  });

  it('已送达但 text=null（占位/无应读者）→ 不渲染', () => {
    const { container } = render(
      <GroupReadReceipt status="sent" text={null} readers={[]} onOpenList={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('有已读者：显示文案 + 可点击，点击触发 onOpenList', () => {
    const onOpenList = vi.fn();
    render(
      <GroupReadReceipt status="sent" text="2 人已读" readers={[reader('a'), reader('b')]} onOpenList={onOpenList} />,
    );
    expect(screen.getByText('2 人已读')).toBeTruthy();
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onOpenList).toHaveBeenCalledTimes(1);
  });

  it('无已读者：按钮禁用，点击不触发 onOpenList', () => {
    const onOpenList = vi.fn();
    render(<GroupReadReceipt status="sent" text="0 人已读" readers={[]} onOpenList={onOpenList} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onOpenList).not.toHaveBeenCalled();
  });
});

describe('GroupReadListModal（已读名单弹层）', () => {
  beforeEach(() => {
    platformMock.isMobile.mockReturnValue(false); // 默认桌面
  });

  it('关闭时不渲染名单行', () => {
    render(<GroupReadListModal isOpen={false} onClose={vi.fn()} readers={[reader('a')]} />);
    expect(screen.queryByText('User_a')).toBeNull();
  });

  it('打开时按名单渲染每位已读者（名字 + 已读时间）', () => {
    render(
      <GroupReadListModal
        isOpen
        onClose={vi.fn()}
        readers={[reader('a', { displayName: 'Alice' }), reader('b', { displayName: 'Bob' })]}
      />,
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('已读 2')).toBeTruthy();
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<GroupReadListModal isOpen onClose={onClose} readers={[reader('a')]} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('桌面端用居中 modal 类名 .desktop', () => {
    platformMock.isMobile.mockReturnValue(false);
    // 弹层经 createPortal 挂到 document.body，用 document 查询
    render(<GroupReadListModal isOpen onClose={vi.fn()} readers={[reader('a')]} />);
    expect(document.querySelector('.group-read-list-panel.desktop')).toBeTruthy();
    expect(document.querySelector('.group-read-list-panel.mobile')).toBeNull();
  });

  it('移动端用底部 sheet 类名 .mobile', () => {
    platformMock.isMobile.mockReturnValue(true);
    render(<GroupReadListModal isOpen onClose={vi.fn()} readers={[reader('a')]} />);
    expect(document.querySelector('.group-read-list-panel.mobile')).toBeTruthy();
    expect(document.querySelector('.group-read-list-panel.desktop')).toBeNull();
  });
});
