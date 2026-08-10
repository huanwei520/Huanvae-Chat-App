/**
 * MobileChatList 会话卡头像 a11y 测试（可点击头像容器 a11y 修复，点 9）
 *
 * 锁定契约（src/pages/mobile/MobileChatList.tsx `.mobile-contact-avatar`）：
 * - v1.1.25 起与桌面 UnifiedList 同口径：**列表内头像不是独立控件**，
 *   点它与点卡片其余部分一样「进会话」，不再开资料页。
 * - 所有分支（好友 / 群 / 置顶 AI）头像都无 role / tabIndex / aria-label / 键盘处理 / 焦点环，
 *   点击直接冒泡到卡片 —— 不存在「能聚焦却按了没反应」的元素。
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

  it('好友卡头像不再是独立控件：无 role / tabIndex / aria-label', () => {
    const { container } = renderChatList();
    const avatar = avatarInCard(container, 'Amy');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
  });

  it('群卡 / 置顶 AI 卡头像同样无 role/tabIndex/aria-label', () => {
    const { container } = renderChatList();
    for (const name of ['群一', 'AI 助手']) {
      const avatar = avatarInCard(container, name);
      expect(avatar).not.toHaveAttribute('role');
      expect(avatar).not.toHaveAttribute('tabindex');
      expect(avatar).not.toHaveAttribute('aria-label');
    }
  });

  it('点好友卡头像 → 进会话（冒泡到卡片），且不开资料页', () => {
    const { container, onSelectTarget } = renderChatList();
    fireEvent.click(avatarInCard(container, 'Amy'));
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a11y 不回退：列表里不存在「可聚焦但没行为」的头像', () => {
    const { container } = renderChatList();
    expect(
      container.querySelectorAll('.mobile-contact-avatar[tabindex], .mobile-contact-avatar[role="button"]').length,
    ).toBe(0);
  });
});
