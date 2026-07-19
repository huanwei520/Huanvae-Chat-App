/**
 * 缺陷②「点击带红点会话 → 列表顺序不变 + 红点徽标消失」组件级回归
 * （L2：jsdom + mock，非真机像素验证）
 *
 * chat tab 排序改为纯时间降序后，点击带红点卡片清未读（unread N→0）不应改变
 * 列表顺序（与微信一致：红点仅作徽标，不参与排序）。本测试在真实 UnifiedList
 * 渲染输出（DOM）层面验证两点：
 *  ① 清未读前后 DOM 卡片顺序（data-conv-key）完全一致 → 证明清未读不重排
 *  ② 被清卡片的 .conv-unread 徽标从 visible（文本 '5'）变 hidden（文本 ''）
 *
 * 非恒真论证：若把 chat tab 排序改回未读优先（compareByUnreadThenTimeDesc），
 * 「时间居中但有未读」的 mid 卡初始会被提到队首，清未读后跌回时间序中段 →
 * 断言① 的顺序数组在清未读前后不一致（且初始也非纯时间序）→ 整体比对 FAIL。
 * 即本测试只在「chat tab 纯时间降序」时通过，删掉改回未读优先会让断言① FAIL。
 *
 * mock 体系沿用 tests/components/GroupUnreadSummaryOnly.test.tsx 同款
 * useLocalConversations mock（UnifiedList 唯一直接依赖的 hook）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Friend } from '../../src/types/chat';
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

function friend(id: string, nickname: string, addTime: string): Friend {
  return {
    friend_id: id,
    friend_nickname: nickname,
    friend_avatar_url: '',
    add_time: addTime,
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  };
}

// 三张好友卡，add_time 控制时间序（UnifiedList 无本地 preview 时 lastMessageTime
// 回退 friend.add_time）。mid 时间居中且带未读 —— 关键卡：未读优先排序会把它提到
// 队首，纯时间排序则保持在中间。
const FRIENDS: Friend[] = [
  friend('new', '新会话', '2026-03-05T10:00:00Z'),
  friend('mid', '中间会话', '2026-03-03T10:00:00Z'),
  friend('old', '旧会话', '2026-03-01T10:00:00Z'),
];

/** mid 好友的未读数随入参变化，其余卡始终无未读 */
function summary(midUnread: number): UnreadSummary {
  return {
    total_count: midUnread,
    friend_unreads: [
      { friend_id: 'mid', unread_count: midUnread, last_message_preview: null, last_message_time: null },
    ],
    group_unreads: [],
  };
}

function chatTree(unreadSummary: UnreadSummary) {
  return (
    <UnifiedList
      activeTab="chat"
      friends={FRIENDS}
      groups={[]}
      friendsLoading={false}
      groupsLoading={false}
      friendsError={null}
      groupsError={null}
      searchQuery=""
      onSearchChange={vi.fn()}
      selectedTarget={null}
      onSelectTarget={vi.fn()}
      unreadSummary={unreadSummary}
    />
  );
}

/** 读出 DOM 中卡片渲染顺序（data-conv-key，含置顶 AI 卡） */
function domOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-conv-key]'))
    .map((n) => n.dataset.convKey!);
}

describe('chat tab 点击带红点卡 → 顺序不变 + 徽标消失（缺陷②组件级回归）', () => {
  it('清未读（mid unread 5→0）不改变 DOM 卡片顺序，且 mid 徽标 visible→hidden', () => {
    const { container, rerender } = render(chatTree(summary(5)));

    // 初始：mid 带未读 5，徽标可见且文本为 '5'
    const orderBefore = domOrder(container);
    const midBadgeBefore = container.querySelector('[data-conv-key="friend-mid"] .conv-unread')!;
    expect(midBadgeBefore.classList.contains('visible')).toBe(true);
    expect(midBadgeBefore.textContent).toBe('5');

    // 纯时间降序：AI 置顶，其后 new(03-05) > mid(03-03) > old(03-01)
    expect(orderBefore).toEqual(['ai-assistant', 'friend-new', 'friend-mid', 'friend-old']);

    // 模拟点击 mid 卡 → markRead → 该卡未读归零（其余不变）
    rerender(chatTree(summary(0)));

    // 断言①：清未读前后 DOM 卡片顺序完全一致（清未读不重排）
    const orderAfter = domOrder(container);
    expect(orderAfter).toEqual(orderBefore);

    // 断言②：mid 徽标从可见变隐藏、文本清空
    const midBadgeAfter = container.querySelector('[data-conv-key="friend-mid"] .conv-unread')!;
    expect(midBadgeAfter.classList.contains('hidden')).toBe(true);
    expect(midBadgeAfter.textContent).toBe('');
  });
});
