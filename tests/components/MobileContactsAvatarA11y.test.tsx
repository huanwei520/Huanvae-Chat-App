/**
 * MobileContacts 通讯录头像 a11y 测试（可点击头像容器 a11y 修复，点 8）
 *
 * 锁定契约（src/pages/mobile/MobileContacts.tsx `.mobile-contact-avatar`）：
 * - v1.1.25 起与桌面 UnifiedList 同口径：**列表内头像不是独立控件**，
 *   点它与点卡片其余部分一样「进会话」，不再开资料页。
 * - 因此头像无 role / tabIndex / aria-label / 键盘处理 / 焦点环，
 *   点击直接冒泡到卡片 onClick —— 也就不存在「能聚焦却按了没反应」的元素。
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

  it('好友头像不再是独立控件：无 role / tabIndex / aria-label', () => {
    const { container } = renderContacts();
    const avatar = avatarInCard(container, 'Amy');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('群头像同样无 role/tabIndex/aria-label', () => {
    const { container } = renderContacts();
    const avatar = avatarInCard(container, '群一');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('点好友头像 → 进会话（冒泡到卡片），且不开资料页', () => {
    const { container, onSelectTarget } = renderContacts();
    fireEvent.click(avatarInCard(container, 'Amy'));
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('点头像与点卡片其余部分产生同一个 target', () => {
    const { container, onSelectTarget } = renderContacts();
    fireEvent.click(avatarInCard(container, 'Amy'));
    const viaAvatar = onSelectTarget.mock.calls[0]?.[0];
    onSelectTarget.mockClear();
    const card = avatarInCard(container, 'Amy').closest('.mobile-contact-card') as HTMLElement;
    fireEvent.click(card);
    expect(viaAvatar).toBeDefined();
    expect(viaAvatar).toEqual(onSelectTarget.mock.calls[0]?.[0]);
  });

  it('a11y 不回退：列表里不存在「可聚焦但没行为」的头像', () => {
    const { container } = renderContacts();
    expect(
      container.querySelectorAll('.mobile-contact-avatar[tabindex], .mobile-contact-avatar[role="button"]').length,
    ).toBe(0);
  });
});
