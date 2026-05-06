/**
 * 按钮迁移 smoke 测试
 *
 * 验证 props-driven 的 form/tab 组件迁移到 MotionAppButton 后：
 * 1. 按钮能正确渲染（变体/尺寸/block 应用、loading 文本切换）
 * 2. 点击按钮触发 onSubmit 回调
 * 3. disabled 状态在空输入或 loading 时正确（防止意外提交）
 *
 * 不覆盖 Login/Register/AccountSelector/ProfileForms — 它们依赖 SessionContext / useApi 等运行时
 * mock 成本远高于这次 className 重构的回归价值。typecheck 已确认调用形式合法，
 * 视觉效果靠手动验证。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AddFriendTab } from '../../src/components/modals/add/AddFriendTab';
import { CreateGroupTab } from '../../src/components/modals/add/CreateGroupTab';
import { JoinGroupTab } from '../../src/components/modals/add/JoinGroupTab';
import { CreateGroupForm } from '../../src/components/modals/groups/CreateGroupForm';
import { JoinGroupForm } from '../../src/components/modals/groups/JoinGroupForm';

beforeEach(() => {
  cleanup();
});

describe('AddFriendTab — MotionAppButton primary/lg/block', () => {
  it('renders submit button with correct variant classes and text', () => {
    render(
      <AddFriendTab
        friendId="alice"
        friendReason=""
        loading={false}
        onFriendIdChange={() => {}}
        onReasonChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: '发送好友请求' });
    expect(btn).toHaveClass('app-btn--primary', 'app-btn--lg', 'app-btn--block');
  });

  it('triggers onSubmit on click', () => {
    const onSubmit = vi.fn();
    render(
      <AddFriendTab
        friendId="alice"
        friendReason=""
        loading={false}
        onFriendIdChange={() => {}}
        onReasonChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '发送好友请求' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables button when friendId is empty', () => {
    render(
      <AddFriendTab
        friendId=""
        friendReason=""
        loading={false}
        onFriendIdChange={() => {}}
        onReasonChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading text when loading=true', () => {
    render(
      <AddFriendTab
        friendId="alice"
        friendReason=""
        loading
        onFriendIdChange={() => {}}
        onReasonChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '发送中...' })).toBeDisabled();
  });
});

describe('CreateGroupTab — MotionAppButton primary/lg/block', () => {
  it('triggers onSubmit on click; disables on empty name', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <CreateGroupTab
        groupName=""
        groupDesc=""
        loading={false}
        onNameChange={() => {}}
        onDescChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('button', { name: '创建群聊' })).toBeDisabled();

    rerender(
      <CreateGroupTab
        groupName="MyGroup"
        groupDesc=""
        loading={false}
        onNameChange={() => {}}
        onDescChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '创建群聊' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('JoinGroupTab — MotionAppButton primary/lg/block', () => {
  it('triggers onSubmit on click; disables on empty inviteCode', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <JoinGroupTab inviteCode="" loading={false} onCodeChange={() => {}} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('button', { name: '加入群聊' })).toBeDisabled();

    rerender(
      <JoinGroupTab inviteCode="ABC123" loading={false} onCodeChange={() => {}} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '加入群聊' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('CreateGroupForm — MotionAppButton primary/lg/block', () => {
  it('renders button with primary lg block; click triggers onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <CreateGroupForm
        groupName="MyGroup"
        groupDesc=""
        loading={false}
        onNameChange={() => {}}
        onDescChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const btn = screen.getByRole('button', { name: '创建群聊' });
    expect(btn).toHaveClass('app-btn--primary', 'app-btn--lg', 'app-btn--block');
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('JoinGroupForm — MotionAppButton primary/lg/block', () => {
  it('renders button with primary lg block; loading disables click', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <JoinGroupForm inviteCode="ABC" loading={false} onCodeChange={() => {}} onSubmit={onSubmit} />,
    );
    const btn = screen.getByRole('button', { name: '加入群聊' });
    expect(btn).toHaveClass('app-btn--primary', 'app-btn--lg', 'app-btn--block');

    rerender(
      <JoinGroupForm inviteCode="ABC" loading onCodeChange={() => {}} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('button', { name: '加入中...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
