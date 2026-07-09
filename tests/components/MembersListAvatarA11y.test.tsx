/**
 * MembersList 成员行 a11y 测试（可点击头像容器 a11y 修复）
 *
 * 锁定契约（src/chat/shared/menu/MembersList.tsx `.member-item`）：
 * - 仅可点成员（非自己）挂 role=button / tabIndex=0 / aria-label=`查看${显示名}资料`
 *   + onKeyDown(Enter/Space)=onMemberClick + 键盘焦点环
 * - 自己那行（user_id === currentUserId）无任何 a11y 交互属性（反向断言）
 *
 * MembersList 是纯展示组件（props 驱动），头像用空 user_avatar_url 走 AvatarPlaceholder，
 * 不触发 resolveServerAvatarUrl（避开 secure_proxy 依赖），可直接 render。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MembersList } from '../../src/chat/shared/menu/MembersList';
import type { GroupMember } from '../../src/api/groups';

function makeMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    user_id: 'u2',
    user_nickname: 'Bob',
    user_avatar_url: '',
    role: 'member',
    group_nickname: null,
    joined_at: '2026-01-01T00:00:00Z',
    join_method: 'create',
    muted_until: null,
    ...overrides,
  };
}

const other = makeMember({ user_id: 'u2', user_nickname: 'Bob' });
const self = makeMember({ user_id: 'me', user_nickname: 'Me' });

function renderList() {
  const onMemberClick = vi.fn();
  const onBack = vi.fn();
  const { container } = render(
    <MembersList
      members={[other, self]}
      loadingMembers={false}
      currentUserId="me"
      onBack={onBack}
      onMemberClick={onMemberClick}
    />,
  );
  const items = Array.from(container.querySelectorAll('.member-item')) as HTMLElement[];
  return { container, items, onMemberClick, onBack };
}

describe('MembersList — 成员行 a11y', () => {
  beforeEach(() => {
    cleanup();
  });

  it('可点成员行具备 role=button / tabIndex=0 / aria-label=查看${显示名}资料', () => {
    const { items } = renderList();
    const otherItem = items[0];
    expect(otherItem).toHaveAttribute('role', 'button');
    expect(otherItem).toHaveAttribute('tabindex', '0');
    expect(otherItem).toHaveAttribute('aria-label', '查看Bob资料');
    expect(otherItem.classList.contains('clickable')).toBe(true);
  });

  it('自己那行无 role/tabIndex/aria-label/clickable（反向断言）', () => {
    const { items } = renderList();
    const selfItem = items[1];
    expect(selfItem).not.toHaveAttribute('role');
    expect(selfItem).not.toHaveAttribute('tabindex');
    expect(selfItem).not.toHaveAttribute('aria-label');
    expect(selfItem.classList.contains('clickable')).toBe(false);
  });

  it('可点成员行 Enter → onMemberClick(member)', () => {
    const { items, onMemberClick } = renderList();
    fireEvent.keyDown(items[0], { key: 'Enter' });
    expect(onMemberClick).toHaveBeenCalledTimes(1);
    expect(onMemberClick).toHaveBeenCalledWith(other);
  });

  it('可点成员行 Space → onMemberClick(member)', () => {
    const { items, onMemberClick } = renderList();
    fireEvent.keyDown(items[0], { key: ' ' });
    expect(onMemberClick).toHaveBeenCalledTimes(1);
    expect(onMemberClick).toHaveBeenCalledWith(other);
  });

  it('无关键（如 a）不触发 onMemberClick', () => {
    const { items, onMemberClick } = renderList();
    fireEvent.keyDown(items[0], { key: 'a' });
    expect(onMemberClick).not.toHaveBeenCalled();
  });

  it('可点成员键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { items } = renderList();
    const otherItem = items[0];
    fireEvent.focus(otherItem);
    expect(otherItem.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(otherItem);
    expect(otherItem.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(otherItem);
    fireEvent.focus(otherItem);
    expect(otherItem.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});
