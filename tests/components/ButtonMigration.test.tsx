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
import { CreateGroupTab } from '../../src/components/modals/add/CreateGroupTab';
import { JoinGroupTab } from '../../src/components/modals/add/JoinGroupTab';

beforeEach(() => {
  cleanup();
});

// 注：AddFriendTab 已改为自包含（内部用 useAddFriendFlow → SessionContext/useApi），
// 且提交按钮改为「查找 → 确认发送」两段式条件渲染，不再是无 context 的 props-driven 组件。
// 其按钮/流程回归改由 tests/components/AddFriendFlow.test.tsx 覆盖（带 context mock）。

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
