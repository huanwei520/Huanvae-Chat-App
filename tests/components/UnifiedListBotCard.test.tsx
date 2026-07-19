/**
 * UnifiedList bot 卡片渲染 + 点击分派回归
 *
 * 覆盖两点（真实组件渲染，mock 体系沿用 ChatTabClickNoReorder.test.tsx 同款
 * useLocalConversations mock）：
 *  ① bot 好友卡（friend_id 带 bot_ 前缀）渲染 "Bot" 徽标（.bot-badge），
 *     普通好友卡不渲染
 *  ② 点击 bot 卡 → onSelectTarget 收到 { type: 'bot' }；点击普通好友卡 →
 *     { type: 'friend' }（bot 目标绝不能被分派成 friend/group）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ChatTarget, Friend } from '../../src/types/chat';
import type { UnreadSummary } from '../../src/types/websocket';

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    getFriendPreview: () => undefined,
    getGroupPreview: () => undefined,
    initialized: true,
  }),
}));

// UnifiedList 直接消费 useSession（置顶菜单需 userId 生成好友会话 ID），无 Provider 会 throw
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: 'me' } }),
  useApi: () => ({}),
}));

// 必须在 vi.mock 之后导入被测组件
import { UnifiedList } from '../../src/components/unified/UnifiedList';

function friend(id: string, nickname: string): Friend {
  return {
    friend_id: id,
    friend_nickname: nickname,
    friend_avatar_url: '',
    add_time: '2026-07-01T10:00:00Z',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  };
}

const FRIENDS: Friend[] = [
  friend('alice', '普通好友'),
  friend('bot_abc', '天气 Bot'),
];

const EMPTY_SUMMARY: UnreadSummary = {
  total_count: 0,
  friend_unreads: [],
  group_unreads: [],
};

function renderList(onSelectTarget: (target: ChatTarget) => void) {
  return render(
    <UnifiedList
      activeTab="friends"
      friends={FRIENDS}
      groups={[]}
      friendsLoading={false}
      groupsLoading={false}
      friendsError={null}
      groupsError={null}
      searchQuery=""
      onSearchChange={vi.fn()}
      selectedTarget={null}
      onSelectTarget={onSelectTarget}
      unreadSummary={EMPTY_SUMMARY}
    />,
  );
}

describe('UnifiedList bot 卡片', () => {
  it('bot 好友卡渲染 Bot 徽标，普通好友卡不渲染', () => {
    const { container } = renderList(vi.fn());

    const botCard = container.querySelector('[data-conv-key="bot-bot_abc"]')!;
    expect(botCard).not.toBeNull();
    const badge = botCard.querySelector('.bot-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Bot');

    const friendCard = container.querySelector('[data-conv-key="friend-alice"]')!;
    expect(friendCard).not.toBeNull();
    expect(friendCard.querySelector('.bot-badge')).toBeNull();
  });

  it('点击 bot 卡分派 type "bot"，点击普通好友卡分派 type "friend"', () => {
    const onSelectTarget = vi.fn<(target: ChatTarget) => void>();
    const { container } = renderList(onSelectTarget);

    fireEvent.click(container.querySelector('[data-conv-key="bot-bot_abc"]')!);
    expect(onSelectTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'bot',
        data: expect.objectContaining({ friend_id: 'bot_abc' }),
      }),
    );

    fireEvent.click(container.querySelector('[data-conv-key="friend-alice"]')!);
    expect(onSelectTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'friend',
        data: expect.objectContaining({ friend_id: 'alice' }),
      }),
    );
    expect(onSelectTarget).toHaveBeenCalledTimes(2);
  });
});
