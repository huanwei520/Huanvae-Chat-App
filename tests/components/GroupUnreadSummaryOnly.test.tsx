/**
 * 群未读「只认 WS unreadSummary」回归测试（L2：jsdom + mock，非真机验证）
 *
 * 防回归契约：后端未读已迁移「按 last-read-seq 派生」口径，派生为 0 的群在
 * connected 快照里没有条目；REST 群列表的 group.unread_count 是旧计数器列，
 * 与派生口径分叉。卡片未读取值必须为 `unread?.unread_count ?? 0`，
 * 不得回退 group.unread_count —— 否则群红点显示陈旧值且点击清不掉。
 *
 * 覆盖桌面 UnifiedList 与移动端 MobileChatList 两个消费方。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';
import type { UnreadSummary } from '../../src/types/websocket';

const wsMocks = vi.hoisted(() => ({
  getGroupUnread: vi.fn<(groupId: string) => number>(() => 0),
}));

const groupsApiMocks = vi.hoisted(() => ({
  getMyGroups: vi.fn(),
  getGroupInvitations: vi.fn(),
}));

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    getFriendPreview: () => undefined,
    getGroupPreview: () => undefined,
    initialized: true,
  }),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: 'me' } }),
  useApi: () => ({}),
}));

vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ getGroupUnread: wsMocks.getGroupUnread }),
}));

vi.mock('../../src/api/groups', () => ({
  getMyGroups: groupsApiMocks.getMyGroups,
  createGroup: vi.fn(),
  joinGroupByCode: vi.fn(),
  getGroupInvitations: groupsApiMocks.getGroupInvitations,
  acceptGroupInvitation: vi.fn(),
  declineGroupInvitation: vi.fn(),
}));

vi.mock('../../src/update/components/MobileDownloadCard', () => ({
  MobileDownloadCard: () => null,
}));

vi.mock('../../src/components/search/GlobalMessageSearchResults', () => ({
  GlobalMessageSearchResults: () => null,
}));

// 必须在 vi.mock 之后导入被测组件
import { UnifiedList } from '../../src/components/unified/UnifiedList';
import { MobileChatList } from '../../src/pages/mobile/MobileChatList';

// REST 字段 unread_count=5（陈旧计数器值），用于验证显示层不消费它
const staleGroup: Group = {
  group_id: 'g1',
  group_name: '测试群',
  group_avatar_url: '',
  role: 'member',
  unread_count: 5,
  last_message_content: '最后一条群消息',
  last_message_time: '2026-03-01T10:00:00Z',
};

/** summary 已连接但无该群条目（派生未读为 0 的群在快照里没有条目） */
const summaryWithoutGroup: UnreadSummary = {
  total_count: 0,
  friend_unreads: [],
  group_unreads: [],
};

/** summary 中有该群条目（派生未读 3） */
const summaryWithGroup: UnreadSummary = {
  total_count: 3,
  friend_unreads: [],
  group_unreads: [
    { group_id: 'g1', unread_count: 3, last_message_preview: null, last_message_time: null },
  ],
};

const FRIENDS: Friend[] = [];

function renderUnifiedList(unreadSummary: UnreadSummary | null) {
  return render(
    <UnifiedList
      activeTab="chat"
      friends={FRIENDS}
      groups={[staleGroup]}
      friendsLoading={false}
      groupsLoading={false}
      friendsError={null}
      groupsError={null}
      searchQuery=""
      onSearchChange={vi.fn()}
      selectedTarget={null}
      onSelectTarget={vi.fn()}
      unreadSummary={unreadSummary}
    />,
  );
}

describe('UnifiedList 群未读只认 unreadSummary', () => {
  it('summary 无该群条目 + group.unread_count=5 → 红点隐藏、不显示 5', () => {
    const { container } = renderUnifiedList(summaryWithoutGroup);
    const groupCard = container.querySelector('[data-conv-key="group-g1"]')!;
    const badge = groupCard.querySelector('.conv-unread')!;
    expect(badge.classList.contains('hidden')).toBe(true);
    expect(badge.textContent).toBe('');
  });

  it('summary 为 null（WS 未连上）→ 同样不回退 REST 值', () => {
    const { container } = renderUnifiedList(null);
    const badge = container.querySelector('[data-conv-key="group-g1"] .conv-unread')!;
    expect(badge.classList.contains('hidden')).toBe(true);
    expect(badge.textContent).toBe('');
  });

  it('summary 有该群条目 unread_count=3 → 红点显示 3（非 REST 的 5）', () => {
    const { container } = renderUnifiedList(summaryWithGroup);
    const badge = container.querySelector('[data-conv-key="group-g1"] .conv-unread')!;
    expect(badge.classList.contains('visible')).toBe(true);
    expect(badge.textContent).toBe('3');
  });
});

function renderMobileChatList(unreadSummary: UnreadSummary | null) {
  return render(
    <MobileChatList
      friends={FRIENDS}
      groups={[staleGroup]}
      searchQuery=""
      onSelectTarget={vi.fn()}
      unreadSummary={unreadSummary}
    />,
  );
}

describe('MobileChatList 群未读只认 unreadSummary', () => {
  it('summary 无该群条目 + group.unread_count=5 → 卡片仍显示但无未读徽标', () => {
    const { getByText } = renderMobileChatList(summaryWithoutGroup);
    // 卡片因 lastMessage（REST last_message_content 回退）仍显示
    const card = getByText('测试群').closest('.mobile-contact-card')!;
    // 不渲染未读徽标（unreadCount=0 时徽标分支不渲染），更不显示 REST 的 5
    expect(within(card as HTMLElement).queryByText('5')).toBeNull();
  });

  it('summary 有该群条目 unread_count=3 → 徽标显示 3（非 REST 的 5）', () => {
    const { getByText } = renderMobileChatList(summaryWithGroup);
    const card = getByText('测试群').closest('.mobile-contact-card')!;
    expect(within(card as HTMLElement).getByText('3')).toBeDefined();
    expect(within(card as HTMLElement).queryByText('5')).toBeNull();
  });
});
