/**
 * MemberActions（群成员操作面板）测试
 *
 * 锁定契约（M1 统一操作面板）：
 * - 人人可用项始终显示：看资料 / 特别关心 / 屏蔽此人消息 / 设置备注
 * - 管理操作（设管理员/禁言/移出）仅 canModerate=true 时显示；设管理员另需 isOwner
 * - 特别关心/屏蔽按当前状态显示「取消」文案
 * - 各项点击触发对应回调
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemberActions } from '../../src/chat/shared/menu/MemberActions';
import type { GroupMember } from '../../src/api/groups';

function makeMember(o: Partial<GroupMember> = {}): GroupMember {
  return {
    user_id: 'u2', user_nickname: 'Bob', user_avatar_url: null,
    role: 'member', group_nickname: null, muted_until: null, joined_at: '',
    ...o,
  } as GroupMember;
}

const noop = () => {};

function renderActions(props: Partial<ComponentProps<typeof MemberActions>> = {}) {
  return render(
    <MemberActions
      member={makeMember()}
      isOwner={false}
      loading={false}
      canModerate={false}
      isSpecialCared={false}
      isBlocked={false}
      onBack={noop}
      onViewProfile={noop}
      onToggleSpecialCare={noop}
      onToggleBlock={noop}
      onSetRemark={noop}
      onToggleAdmin={noop}
      onMute={noop}
      onUnmute={noop}
      onKick={noop}
      {...props}
    />,
  );
}

describe('MemberActions', () => {
  it('人人可用项始终显示：看资料/特别关心/屏蔽/设置备注', () => {
    renderActions();
    expect(screen.getByText('看资料')).toBeInTheDocument();
    expect(screen.getByText('特别关心')).toBeInTheDocument();
    expect(screen.getByText('屏蔽此人消息')).toBeInTheDocument();
    expect(screen.getByText('设置备注')).toBeInTheDocument();
  });

  it('canModerate=false → 不显示任何管理操作（即便 isOwner）', () => {
    renderActions({ canModerate: false, isOwner: true });
    expect(screen.queryByText('移出群聊')).toBeNull();
    expect(screen.queryByText('禁言')).toBeNull();
    expect(screen.queryByText('设为管理员')).toBeNull();
  });

  it('canModerate=true + isOwner → 显示设管理员/禁言/移出', () => {
    renderActions({ canModerate: true, isOwner: true });
    expect(screen.getByText('设为管理员')).toBeInTheDocument();
    expect(screen.getByText('禁言')).toBeInTheDocument();
    expect(screen.getByText('移出群聊')).toBeInTheDocument();
  });

  it('canModerate=true 但非 owner → 有禁言/移出，无设管理员', () => {
    renderActions({ canModerate: true, isOwner: false });
    expect(screen.queryByText('设为管理员')).toBeNull();
    expect(screen.getByText('禁言')).toBeInTheDocument();
    expect(screen.getByText('移出群聊')).toBeInTheDocument();
  });

  it('已特别关心/已屏蔽 → 显示「取消」文案', () => {
    renderActions({ isSpecialCared: true, isBlocked: true });
    expect(screen.getByText('取消特别关心')).toBeInTheDocument();
    expect(screen.getByText('取消屏蔽消息')).toBeInTheDocument();
    expect(screen.queryByText('特别关心')).toBeNull();
    expect(screen.queryByText('屏蔽此人消息')).toBeNull();
  });

  it('点击各项触发对应回调', () => {
    const onViewProfile = vi.fn();
    const onToggleSpecialCare = vi.fn();
    const onToggleBlock = vi.fn();
    const onSetRemark = vi.fn();
    renderActions({ onViewProfile, onToggleSpecialCare, onToggleBlock, onSetRemark });
    fireEvent.click(screen.getByText('看资料'));
    fireEvent.click(screen.getByText('特别关心'));
    fireEvent.click(screen.getByText('屏蔽此人消息'));
    fireEvent.click(screen.getByText('设置备注'));
    expect(onViewProfile).toHaveBeenCalledTimes(1);
    expect(onToggleSpecialCare).toHaveBeenCalledTimes(1);
    expect(onToggleBlock).toHaveBeenCalledTimes(1);
    expect(onSetRemark).toHaveBeenCalledTimes(1);
  });
});
