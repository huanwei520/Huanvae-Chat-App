/**
 * MobileChatList 会话卡头像 a11y 测试（可点击头像容器 a11y 修复，点 9）
 *
 * 锁定契约（src/pages/mobile/MobileChatList.tsx `.mobile-contact-avatar`）：
 * - 仅好友分支头像挂 role=button / tabIndex=0 / aria-label=`查看${name}资料`
 *   + onKeyDown(Enter/Space)=openProfile + onClick stopPropagation + 键盘焦点环
 * - 群分支头像无 a11y 交互属性（反向断言）；置顶 AI 卡头像同样无 a11y
 *
 * 依赖本地会话预览 / 会话上下文 / 下载卡 / 搜索浮层，均 mock 掉，只保留卡片结构；
 * getFriendPreview / getGroupPreview 返回 lastMessage 让好友/群卡通过 activeCards 过滤显示。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    getFriendPreview: () => ({ lastMessage: 'hi', lastMessageTime: '2026-03-03T00:00:00Z' }),
    getGroupPreview: () => ({ lastMessage: 'yo', lastMessageTime: '2026-02-02T00:00:00Z' }),
    initialized: true,
  }),
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: 'me' } }),
}));
vi.mock('../../src/update/components/MobileDownloadCard', () => ({ MobileDownloadCard: () => null }));
vi.mock('../../src/components/search/GlobalMessageSearchResults', () => ({ GlobalMessageSearchResults: () => null }));

import { MobileChatList } from '../../src/pages/mobile/MobileChatList';
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

function renderChatList() {
  const onSelectTarget = vi.fn();
  const { container } = render(
    <MobileChatList
      friends={[friend]}
      groups={[group]}
      searchQuery=""
      onSelectTarget={onSelectTarget}
      unreadSummary={null}
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

describe('MobileChatList — 会话卡头像 a11y', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    cleanup();
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  it('好友卡头像具备 role=button / tabIndex=0 / aria-label=查看${name}资料', () => {
    const { container } = renderChatList();
    const avatar = avatarInCard(container, 'Amy');
    expect(avatar).toHaveAttribute('role', 'button');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(avatar).toHaveAttribute('aria-label', '查看Amy资料');
  });

  it('群卡头像无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = renderChatList();
    const avatar = avatarInCard(container, '群一');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('置顶 AI 卡头像无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = renderChatList();
    const avatar = avatarInCard(container, 'AI 助手');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('好友卡头像点击 → openProfile(id)，stopPropagation 使「进聊天」onSelectTarget 未被调（冒泡断言）', () => {
    const { container, onSelectTarget } = renderChatList();
    fireEvent.click(avatarInCard(container, 'Amy'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('好友卡头像 Enter → openProfile(id)，不进聊天', () => {
    const { container, onSelectTarget } = renderChatList();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: 'Enter' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('好友卡头像 Space → openProfile(id)', () => {
    const { container } = renderChatList();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: ' ' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('fa');
  });

  it('好友卡头像无关键（如 a）不触发看资料', () => {
    const { container } = renderChatList();
    fireEvent.keyDown(avatarInCard(container, 'Amy'), { key: 'a' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('好友卡头像键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { container } = renderChatList();
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
