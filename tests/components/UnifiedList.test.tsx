/**
 * UnifiedList 会话列表键盘导航测试
 *
 * 覆盖为 .conversation-list 容器新增的键盘支持：
 * - 容器可 Tab 聚焦（tabIndex=0 + role + aria-label）
 * - ↑/↓ 在会话间移动键盘光标（夹紧不循环；首按落在已打开会话或首/末项）
 * - Enter 打开当前光标会话（复用 onSelectTarget）
 * - 方向键 preventDefault（防页面滚动）
 * - 空列表 / 未移动光标 → 安全无操作
 * - 聚焦+方向键后激活项出现高亮类，失焦后清除
 *
 * useLocalConversations 依赖 SessionContext + SQLite，整体 mock 掉以便纯渲染。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, createEvent } from '@testing-library/react';
import type { Friend, Group, ChatTarget } from '../../src/types/chat';
import type { NavTab } from '../../src/components/sidebar/Sidebar';

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
import { useProfileViewStore } from '../../src/stores/profileViewStore';

// add_time 递减，使 friends tab 按时间倒序后顺序 = [f1, f2, f3]
const f1: Friend = { friend_id: 'f1', friend_nickname: '好友一', friend_avatar_url: null, add_time: '2026-03-03T00:00:00Z', approve_reason: null, friend_remark: null, is_blacklisted: false, is_special_care: false };
const f2: Friend = { friend_id: 'f2', friend_nickname: '好友二', friend_avatar_url: null, add_time: '2026-02-02T00:00:00Z', approve_reason: null, friend_remark: null, is_blacklisted: false, is_special_care: false };
const f3: Friend = { friend_id: 'f3', friend_nickname: '好友三', friend_avatar_url: null, add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null, is_blacklisted: false, is_special_care: false };
const FRIENDS = [f1, f2, f3];

const g1: Group = { group_id: 'g1', group_name: '群一', group_avatar_url: '', role: 'member', unread_count: 0, last_message_content: null, last_message_time: '2026-03-03T00:00:00Z' };
const GROUPS = [g1];

interface Opts {
  activeTab?: NavTab;
  friends?: Friend[];
  groups?: Group[];
  selectedTarget?: ChatTarget | null;
}

function renderList(opts: Opts = {}) {
  const onSelectTarget = vi.fn();
  const { container } = render(
    <UnifiedList
      activeTab={opts.activeTab ?? 'friends'}
      friends={opts.friends ?? FRIENDS}
      groups={opts.groups ?? GROUPS}
      friendsLoading={false}
      groupsLoading={false}
      friendsError={null}
      groupsError={null}
      searchQuery=""
      onSearchChange={vi.fn()}
      selectedTarget={opts.selectedTarget ?? null}
      onSelectTarget={onSelectTarget}
      unreadSummary={null}
    />,
  );
  const list = container.querySelector('.conversation-list') as HTMLElement;
  return { container, list, onSelectTarget };
}

describe('UnifiedList 会话列表键盘导航', () => {
  it('列表容器可键盘聚焦并具备角色/标签', () => {
    const { list } = renderList();
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list).toHaveAttribute('role', 'group');
    expect(list).toHaveAttribute('aria-label');
  });

  it('聚焦后 ArrowDown 把光标落到首个会话，Enter 打开它', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'friend', data: f1 });
  });

  it('连按两次 ArrowDown 选到第二个会话', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'friend', data: f2 });
  });

  it('ArrowDown 到底后夹紧在最后一个（不越界、不循环）', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(list, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'friend', data: f3 });
  });

  it('无光标时首按 ArrowUp 落到最后一个会话', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'friend', data: f3 });
  });

  it('有已打开会话时，首按方向键光标落在该会话上', () => {
    const { list, onSelectTarget } = renderList({
      activeTab: 'friends',
      selectedTarget: { type: 'friend', data: f2 },
    });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // 首按显形于 f2，不移动
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'friend', data: f2 });
  });

  it('消息(chat) Tab 下首个光标是置顶 AI 卡片，Enter 打开 AI 会话', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'chat' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledWith({ type: 'ai' });
  });

  it('ArrowDown 调用 preventDefault（防页面滚动）', () => {
    const { list } = renderList();
    fireEvent.focus(list);
    const ev = createEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent(list, ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('未移动光标时直接 Enter 不打开任何会话', () => {
    const { list, onSelectTarget } = renderList();
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('空列表下方向键 / Enter 安全无操作', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends', friends: [], groups: [] });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('聚焦+方向键后激活项出现 kbd 高亮类，失焦后清除', () => {
    const { list, container } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    const active = container.querySelector('.conversation-item--kbd-active');
    expect(active).not.toBeNull();
    expect(active?.getAttribute('data-conv-key')).toBe('friend-f1');
    fireEvent.blur(list);
    expect(container.querySelector('.conversation-item--kbd-active')).toBeNull();
  });

  it('未聚焦时即使有光标也不显示高亮类（焦点门控）', () => {
    const { list, container } = renderList({ activeTab: 'friends' });
    // 不 focus，直接按方向键：activeKey 会被设置，但 isListFocused=false 不应显示环
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(container.querySelector('.conversation-item--kbd-active')).toBeNull();
  });
});

describe('UnifiedList 头像行为（列表内点头像 = 进会话，不再开资料页）', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  function friendAvatar(container: HTMLElement, friendId: string): HTMLElement {
    const el = container.querySelector(`[data-conv-key="friend-${friendId}"] .conv-avatar`);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  }

  it('点好友头像 → 进会话（onSelectTarget 被调），且不开资料页', () => {
    const { container, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.click(friendAvatar(container, 'f1'));
    // 头像不再 stopPropagation → 冒泡到卡片 onClick → handleCardClick → onSelectTarget
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('点头像与点卡片其余部分行为一致（同一 target）', () => {
    const { container, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.click(friendAvatar(container, 'f2'));
    const viaAvatar = onSelectTarget.mock.calls[0]?.[0];
    onSelectTarget.mockClear();

    const card = container.querySelector('[data-conv-key="friend-f2"]') as HTMLElement;
    fireEvent.click(card);
    const viaCard = onSelectTarget.mock.calls[0]?.[0];

    expect(viaAvatar).toBeDefined();
    expect(viaAvatar).toEqual(viaCard);
  });

  it('好友头像不再是独立控件：无 role/tabIndex/aria-label/title', () => {
    const { container } = renderList({ activeTab: 'friends' });
    const avatar = friendAvatar(container, 'f1');
    expect(avatar).not.toHaveAttribute('role');
    expect(avatar).not.toHaveAttribute('tabindex');
    expect(avatar).not.toHaveAttribute('aria-label');
    expect(avatar).not.toHaveAttribute('title');
  });

  it('群卡片头像同样无 role/tabIndex/aria-label', () => {
    const { container } = renderList({ activeTab: 'group', groups: GROUPS });
    const groupAvatar = container.querySelector('[data-conv-key="group-g1"] .conv-avatar') as HTMLElement;
    expect(groupAvatar).not.toBeNull();
    expect(groupAvatar).not.toHaveAttribute('role');
    expect(groupAvatar).not.toHaveAttribute('tabindex');
    expect(groupAvatar).not.toHaveAttribute('aria-label');
  });

  it('a11y 不回退：列表内不存在「可聚焦但按下去没反应」的头像元素', () => {
    const { container } = renderList({ activeTab: 'friends' });
    // 硬要求——头像要么可聚焦且有行为，要么根本不可聚焦。这里选的是后者。
    const focusableAvatars = container.querySelectorAll('.conv-avatar[tabindex], .conv-avatar[role="button"]');
    expect(focusableAvatars.length).toBe(0);
  });

  it('a11y 不回退：卡片自身仍可键盘打开（Tab→↓→Enter 链路未被破坏）', () => {
    const { list, onSelectTarget } = renderList({ activeTab: 'friends' });
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelectTarget).toHaveBeenCalledTimes(1);
  });
});
