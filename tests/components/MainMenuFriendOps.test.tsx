/**
 * MainMenu 好友段关系操作测试（特别关心 / 拉黑 平铺进三条杠菜单）
 *
 * 覆盖：好友菜单渲染「特别关心 / 拉黑 / 设置备注 / 删除好友」；
 * - 未特别关心 → 显示"特别关心"，点击调 onToggleSpecialCare
 * - 已特别关心 → 显示"取消特别关心"
 * - 未拉黑 → 显示"拉黑"，点击走 onSetView('confirm-blacklist')（二次确认）
 * - 已拉黑 → 显示"取消拉黑"，点击调 onUnblacklist（直接执行）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MainMenu } from '../../src/chat/shared/menu/MainMenu';

function renderFriendMenu(overrides: Partial<React.ComponentProps<typeof MainMenu>> = {}) {
  const props = {
    targetType: 'friend' as const,
    isOwnerOrAdmin: false,
    isOwner: false,
    isMultiSelectMode: false,
    isFriendSpecialCare: false,
    isFriendBlacklisted: false,
    onSetView: vi.fn(),
    onUploadAvatar: vi.fn(),
    onToggleMultiSelect: vi.fn(),
    onToggleSpecialCare: vi.fn(),
    onUnblacklist: vi.fn(),
    ...overrides,
  };
  render(<MainMenu {...props} />);
  return props;
}

describe('MainMenu — 好友关系操作平铺', () => {
  beforeEach(() => cleanup());

  it('好友菜单渲染特别关心 / 拉黑 / 设置备注 / 删除好友', () => {
    renderFriendMenu();
    expect(screen.getByRole('button', { name: /^特别关心$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^拉黑$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置备注/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除好友/ })).toBeInTheDocument();
  });

  it('未特别关心：点击"特别关心"调 onToggleSpecialCare', () => {
    const props = renderFriendMenu({ isFriendSpecialCare: false });
    fireEvent.click(screen.getByRole('button', { name: /^特别关心$/ }));
    expect(props.onToggleSpecialCare).toHaveBeenCalledTimes(1);
  });

  it('已特别关心：显示"取消特别关心"', () => {
    renderFriendMenu({ isFriendSpecialCare: true });
    expect(screen.getByRole('button', { name: /取消特别关心/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^特别关心$/ })).toBeNull();
  });

  it('未拉黑：点击"拉黑"走二次确认视图 confirm-blacklist', () => {
    const props = renderFriendMenu({ isFriendBlacklisted: false });
    fireEvent.click(screen.getByRole('button', { name: /^拉黑$/ }));
    expect(props.onSetView).toHaveBeenCalledWith('confirm-blacklist');
    expect(props.onUnblacklist).not.toHaveBeenCalled();
  });

  it('已拉黑：显示"取消拉黑"，点击调 onUnblacklist（不走确认视图）', () => {
    const props = renderFriendMenu({ isFriendBlacklisted: true });
    expect(screen.queryByRole('button', { name: /^拉黑$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /取消拉黑/ }));
    expect(props.onUnblacklist).toHaveBeenCalledTimes(1);
    expect(props.onSetView).not.toHaveBeenCalledWith('confirm-blacklist');
  });
});
