/**
 * MobileChatList 固定 AI 置顶卡移除回归测试（块 1792465686977-647uggj7-1 testharness 层）
 *
 * 锁定契约：src/pages/mobile/MobileChatList.tsx 原列表顶部「AI 助手置顶卡（始终渲染，
 * 不受好友/群聊数据影响）」已删除——任何数据形态下列表内都不得出现 AI 卡或 'AI 助手'
 * 文案节点；有好友时列表只有真实会话卡，点击走好友会话（type 'friend'）而非 'ai'。
 *
 * 非恒真论证：若固定 AI 卡回彈（无条件渲染分支回归），①queryByText('AI 助手') 非 null、
 * ②空数据形态卡片数 >0 均 FAIL；若点击路由误指 AI，③type 断言 FAIL。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    getFriendPreview: () => ({ lastMessage: 'hi', lastMessageTime: '2026-03-03T00:00:00Z' }),
    getGroupPreview: () => undefined,
    initialized: true,
  }),
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: 'me' } }),
}));
vi.mock('../../src/update/components/MobileDownloadCard', () => ({ MobileDownloadCard: () => null }));
vi.mock('../../src/components/search/GlobalMessageSearchResults', () => ({ GlobalMessageSearchResults: () => null }));

import { MobileChatList } from '../../src/pages/mobile/MobileChatList';

const friend: Friend = {
  friend_id: 'fa', friend_nickname: 'Amy', friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
  is_blacklisted: false, is_special_care: false,
};

function renderList(friends: Friend[], groups: Group[] = []) {
  const onSelectTarget = vi.fn();
  const { container } = render(
    <MobileChatList
      friends={friends}
      groups={groups}
      searchQuery=""
      onSelectTarget={onSelectTarget}
      unreadSummary={null}
    />,
  );
  return { container, onSelectTarget };
}

describe('MobileChatList 无固定 AI 置顶卡', () => {
  it('有好友时：列表无「AI 助手」节点，唯一卡片是真实好友卡', () => {
    const { container } = renderList([friend]);

    expect(screen.queryByText('AI 助手')).toBeNull();
    const cards = container.querySelectorAll('.mobile-contact-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('Amy');
  });

  it('空好友空群（旧版此处恒渲染 AI 卡）：列表 0 卡且无「AI 助手」节点', () => {
    const { container } = renderList([], []);

    expect(screen.queryByText('AI 助手')).toBeNull();
    expect(container.querySelectorAll('.mobile-contact-card')).toHaveLength(0);
  });

  it('点好友卡 → onSelectTarget 收到 type "friend"（不再路由到 AI）', () => {
    const { onSelectTarget } = renderList([friend]);

    fireEvent.click(screen.getByText('Amy'));
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
    const arg = onSelectTarget.mock.calls[0][0] as { type: string };
    expect(arg.type).toBe('friend');
    expect(arg.type).not.toBe('ai');
  });
});
