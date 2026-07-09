/**
 * MobileContacts 通讯录头像 a11y 测试（可点击头像容器 a11y 修复，点 8）
 *
 * 锁定契约（src/pages/mobile/MobileContacts.tsx `.mobile-contact-avatar`）：
 * - 好友头像恒有 role=button / tabIndex=0 / aria-label=`查看${显示名}资料`
 *   + onKeyDown(Enter/Space)=openProfile + onClick stopPropagation（点头像看资料，
 *   不冒泡到卡片的「进聊天」onClick）+ 键盘焦点环
 * - 群头像无 a11y 交互属性（反向断言）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';
import { MobileContacts } from '../../src/pages/mobile/MobileContacts';
import { useProfileViewStore } from '../../src/stores/profileViewStore';

const friend: Friend = {
  friend_id: 'fa', friend_nickname: 'Amy', friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
  is_blacklisted: false, is_special_care: false,
};
const group: Group = {
  group_id: 'g1', group_name: '群一', group_avatar_url: '', role: 'member',
  unread_count: 0, last_message_content: null, last_message_time: null,
};

function renderContacts() {
  const onSelectTarget = vi.fn();
  const { container } = render(
    <MobileContacts
      friends={[friend]}
      groups={[group]}
      searchQuery=""
      onSelectTarget={onSelectTarget}
      friendsExpanded
      groupsExpanded
      onToggleFriends={vi.fn()}
      onToggleGroups={vi.fn()}
    />,
  );
  return { container, onSelectTarget };
}

function cardByName(container: HTMLElement, name: string): HTMLElement {
  const cards = Array.from(container.querySelectorAll('.mobile-contact-card')) as HTMLElement[];
  const card = cards.find((c) => c.querySelector('.mobile-contact-name')?.textContent === name);
  expect(card).toBeTruthy();
  return card!;
}

function avatarInCard(container: HTMLElement, name: string): HTMLElement {
  const avatar = cardByName(container, name).querySelector('.mobile-contact-avatar');
  expect(avatar).not.toBeNull();
  return avatar as HTMLElement;
}

describe('MobileContacts — 头像 a11y', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    cleanup();
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  it('好友头像具备 role=button / tabIndex=0 / aria-label=查看${显示名}资料', () => {
    const { container } = renderContacts();
    const avatar = avatarInCard(container, 'Amy');
    expect(avatar).toHaveAttribute('role', 'button');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(avatar).toHaveAttribute('aria-label', '查看Amy资料');
  });

  it('群头像无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = renderContacts();
    const avatar = avatarInCard(container, '群一');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('头像点击 → openProfile(id)，stopPropagation 使卡片「进聊天」onSelectTarget 未被调（冒泡断言）', () => {
    const { container, onSelectTarget } = renderContacts();
    fireEvent.click(avatarInCard(container, 'Amy'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('头像 Enter → openProfile(id)，不进聊天', () => {
    const { container, onSelectTarget } = renderContacts();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: 'Enter' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('头像 Space → openProfile(id)', () => {
    const { container } = renderContacts();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: ' ' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
  });

  it('头像无关键（如 a）不触发看资料', () => {
    const { container } = renderContacts();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: 'a' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('好友头像键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { container } = renderContacts();
    const avatar = avatarInCard(container, 'Amy');
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(avatar);
    fireEvent.focus(avatar);
    expect(avatar.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});
