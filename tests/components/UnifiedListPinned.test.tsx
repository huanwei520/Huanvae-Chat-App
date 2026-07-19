/**
 * UnifiedList 会话置顶（pin）组件级回归
 *
 * 覆盖三点（真实组件渲染，mock 体系沿用 UnifiedListBotCard.test.tsx 同款
 * useLocalConversations / SessionContext mock；db 模块用 importOriginal 局部覆写
 * setConversationPinned，避免破坏树内其他 db 消费方）：
 *  ① chat tab 置顶分层：置顶卡（时间更旧）排在所有未置顶卡之前
 *  ② 置顶卡渲染 .conv-pin-flag 图钉标识，未置顶卡不渲染
 *  ③ 右键卡片弹出置顶菜单，点「置顶 / 取消置顶」调用 db.setConversationPinned
 *     且参数正确（好友卡 conv id 经 getFriendConversationId 生成、群卡直用 group_id）
 *
 * 非恒真论证：① 若排序退回纯时间降序（compareByTimeDesc），置顶的 alice
 * （2026-01-01）会落到 bob（2026-03-01）/ g1（2026-02-01）之后 → 断言① FAIL。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatTarget, Friend, Group } from '../../src/types/chat';
import type { UnreadSummary } from '../../src/types/websocket';

vi.mock('../../src/hooks/useLocalConversations', () => {
  // alice：置顶但时间最旧；bob：未置顶时间最新；g1：未置顶时间居中
  const friendPreviews: Record<string, unknown> = {
    alice: {
      conversationId: 'conv-alice-me',
      lastMessage: '旧消息',
      lastMessageTime: '2026-01-01T00:00:00Z',
      lastSeq: 1,
      isPinned: true,
    },
    bob: {
      conversationId: 'conv-bob-me',
      lastMessage: '新消息',
      lastMessageTime: '2026-03-01T00:00:00Z',
      lastSeq: 2,
      isPinned: false,
    },
  };
  const groupPreviews: Record<string, unknown> = {
    g1: {
      conversationId: 'g1',
      lastMessage: '群消息',
      lastMessageTime: '2026-02-01T00:00:00Z',
      lastSeq: 3,
      isPinned: false,
    },
  };
  return {
    useLocalConversations: () => ({
      getFriendPreview: (id: string) => friendPreviews[id],
      getGroupPreview: (id: string) => groupPreviews[id],
      initialized: true,
    }),
  };
});

// UnifiedList 直接消费 useSession（置顶菜单需 userId 生成好友会话 ID），无 Provider 会 throw
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: 'me' } }),
  useApi: () => ({}),
}));

const setConversationPinnedMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/db')>()),
  setConversationPinned: setConversationPinnedMock,
}));

// 必须在 vi.mock 之后导入被测组件
import { UnifiedList } from '../../src/components/unified/UnifiedList';

function friend(id: string, nickname: string): Friend {
  return {
    friend_id: id,
    friend_nickname: nickname,
    friend_avatar_url: '',
    add_time: '2026-01-01T00:00:00Z',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  };
}

const FRIENDS: Friend[] = [friend('alice', 'Alice'), friend('bob', 'Bob')];

const GROUPS: Group[] = [
  {
    group_id: 'g1',
    group_name: '群一',
    group_avatar_url: '',
    role: 'member',
    unread_count: 0,
    last_message_content: null,
    last_message_time: null,
  },
];

const EMPTY_SUMMARY: UnreadSummary = {
  total_count: 0,
  friend_unreads: [],
  group_unreads: [],
};

function renderList(onSelectTarget: (target: ChatTarget) => void = vi.fn()) {
  return render(
    <UnifiedList
      activeTab="chat"
      friends={FRIENDS}
      groups={GROUPS}
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

beforeEach(() => {
  setConversationPinnedMock.mockReset();
});

describe('UnifiedList 会话置顶', () => {
  it('置顶卡（时间最旧）排在所有未置顶卡之前，未置顶层保持时间降序', () => {
    const { container } = renderList();

    const keys = Array.from(container.querySelectorAll('[data-conv-key]')).map(
      (el) => (el as HTMLElement).dataset.convKey,
    );
    // AI 卡固定置顶第一位；alice 置顶分层在前（尽管 2026-01-01 最旧）；
    // 未置顶层 bob(2026-03-01) > g1(2026-02-01) 时间降序
    expect(keys).toEqual(['ai-assistant', 'friend-alice', 'friend-bob', 'group-g1']);
  });

  it('置顶卡渲染 conv-pin-flag 图钉标识，未置顶卡不渲染', () => {
    const { container } = renderList();

    const pinnedCard = container.querySelector('[data-conv-key="friend-alice"]')!;
    expect(pinnedCard.querySelector('.conv-pin-flag')).not.toBeNull();
    expect(pinnedCard.querySelector('.conv-pin-flag')!.getAttribute('title')).toBe('已置顶');

    const unpinnedCard = container.querySelector('[data-conv-key="friend-bob"]')!;
    expect(unpinnedCard.querySelector('.conv-pin-flag')).toBeNull();
  });

  it('右键未置顶好友卡 → 菜单「置顶」→ setConversationPinned(convId, friend, 名字, true)', () => {
    const { container } = renderList();

    fireEvent.contextMenu(container.querySelector('[data-conv-key="friend-bob"]')!);
    // bob 未置顶 → 菜单文案「置顶」
    const pinBtn = screen.getByText('置顶');
    fireEvent.click(pinBtn);

    // 好友会话 ID = conv-{smaller}-{larger}（'bob' < 'me'）
    expect(setConversationPinnedMock).toHaveBeenCalledTimes(1);
    expect(setConversationPinnedMock).toHaveBeenLastCalledWith('conv-bob-me', 'friend', 'Bob', true);
  });

  it('右键已置顶好友卡 → 菜单「取消置顶」→ setConversationPinned(..., false)', () => {
    const { container } = renderList();

    fireEvent.contextMenu(container.querySelector('[data-conv-key="friend-alice"]')!);
    const unpinBtn = screen.getByText('取消置顶');
    fireEvent.click(unpinBtn);

    expect(setConversationPinnedMock).toHaveBeenCalledTimes(1);
    expect(setConversationPinnedMock).toHaveBeenLastCalledWith('conv-alice-me', 'friend', 'Alice', false);
  });

  it('右键群卡 → 置顶：conv id 直用 group_id、类型 group', () => {
    const { container } = renderList();

    fireEvent.contextMenu(container.querySelector('[data-conv-key="group-g1"]')!);
    fireEvent.click(screen.getByText('置顶'));

    expect(setConversationPinnedMock).toHaveBeenCalledTimes(1);
    expect(setConversationPinnedMock).toHaveBeenLastCalledWith('g1', 'group', '群一', true);
  });

  it('AI 卡片不挂右键菜单（无本地会话行，不参与置顶）', () => {
    const { container } = renderList();

    fireEvent.contextMenu(container.querySelector('[data-conv-key="ai-assistant"]')!);
    expect(screen.queryByText('置顶')).toBeNull();
    expect(screen.queryByText('取消置顶')).toBeNull();
    expect(setConversationPinnedMock).not.toHaveBeenCalled();
  });
});
