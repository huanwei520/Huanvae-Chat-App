/**
 * ConversationShelf 常驻窄条测试
 *
 * 三档权限入口显隐（判定真值在服务端，前端入口仅 UX）：
 * - bot 会话：有条目才显（canManage=false，空架不占位）
 * - 群主（role=owner）：canManage=true，空架也显（可上架入口）
 * - 群成员（role!=owner）：canManage=false，空架不显
 * - 好友 1:1：resolveShelf=null → 不显、且不发 getShelf
 * 以及：点窄条 → 展开 ShelfCardOverlay（此处 stub 掉浮层，只验开合）
 *
 * useApi/useSession 用 hoisted 稳定引用，避免 effect 依赖抖动导致重复 fetch/无限渲染。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({}));
const sessionMock = vi.hoisted(() => ({ session: { userId: 'u1' } }));
vi.mock('../../src/contexts/SessionContext', async (orig) => ({
  ...(await orig()),
  useApi: () => apiMock,
  useSession: () => sessionMock,
}));

const shelfApiMock = vi.hoisted(() => ({ getShelf: vi.fn() }));
vi.mock('../../src/api/shelf', async (orig) => ({
  ...(await orig()),
  getShelf: shelfApiMock.getShelf,
}));

// 隔离：stub 掉浮层，只观测 open
vi.mock('../../src/chat/shared/ShelfCardOverlay', () => ({
  ShelfCardOverlay: (p: { open: boolean }) => (p.open ? <div data-testid="shelf-overlay" /> : null),
}));

import { ConversationShelf } from '../../src/chat/shared/ConversationShelf';
import { useShelfStore } from '../../src/stores/shelfStore';
import type { ShelfItem } from '../../src/api/shelf';
import type { ChatTarget, Friend, Group } from '../../src/types/chat';

function makeItem(overrides: Partial<ShelfItem> = {}): ShelfItem {
  return {
    item_id: 'i1',
    message_uuid: 'm1',
    pinned_by: 'bot_x',
    note: null,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const botFriend: Friend = {
  friend_id: 'bot_x',
  friend_nickname: 'B',
  friend_avatar_url: null,
  add_time: '',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
};

function makeGroup(role: Group['role']): Group {
  return {
    group_id: 'g1',
    group_name: 'G',
    group_avatar_url: '',
    role,
    unread_count: null,
    last_message_content: null,
    last_message_time: null,
  };
}

const botTarget: ChatTarget = { type: 'bot', data: botFriend };
const groupOwner: ChatTarget = { type: 'group', data: makeGroup('owner') };
const groupMember: ChatTarget = { type: 'group', data: makeGroup('member') };
const friendTarget: ChatTarget = {
  type: 'friend',
  data: { ...botFriend, friend_id: 'u2' },
};

beforeEach(() => {
  useShelfStore.getState().clear();
  shelfApiMock.getShelf.mockReset();
});

describe('ConversationShelf', () => {
  it('bot 会话有条目 → 窄条显示，count 为条目数', async () => {
    shelfApiMock.getShelf.mockResolvedValue({ items: [makeItem({ position: 0 })] });
    render(<ConversationShelf chatTarget={botTarget} />);

    await waitFor(() => expect(screen.getByText('顶置')).toBeInTheDocument());
    expect(document.querySelector('.conversation-shelf-count')).toHaveTextContent('1');
  });

  it('bot 会话无条目 → 不显示（canManage=false，空架不占位）', async () => {
    shelfApiMock.getShelf.mockResolvedValue({ items: [] });
    render(<ConversationShelf chatTarget={botTarget} />);

    await waitFor(() => expect(shelfApiMock.getShelf).toHaveBeenCalled());
    expect(screen.queryByText('顶置')).toBeNull();
  });

  it('群主无条目 → 立即显示窄条（canManage=true 有上架入口）', () => {
    shelfApiMock.getShelf.mockResolvedValue({ items: [] });
    render(<ConversationShelf chatTarget={groupOwner} />);

    expect(screen.getByText('顶置')).toBeInTheDocument();
  });

  it('群成员无条目 → 不显示（canManage=false）', async () => {
    shelfApiMock.getShelf.mockResolvedValue({ items: [] });
    render(<ConversationShelf chatTarget={groupMember} />);

    await waitFor(() => expect(shelfApiMock.getShelf).toHaveBeenCalled());
    expect(screen.queryByText('顶置')).toBeNull();
  });

  it('好友 1:1 → 不显示且不发 getShelf（resolveShelf=null）', () => {
    render(<ConversationShelf chatTarget={friendTarget} />);

    expect(screen.queryByText('顶置')).toBeNull();
    expect(shelfApiMock.getShelf).not.toHaveBeenCalled();
  });

  it('点击窄条 → 展开 ShelfCardOverlay', async () => {
    shelfApiMock.getShelf.mockResolvedValue({ items: [makeItem({ position: 0 })] });
    render(<ConversationShelf chatTarget={botTarget} />);

    await waitFor(() => expect(screen.getByText('顶置')).toBeInTheDocument());
    expect(screen.queryByTestId('shelf-overlay')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /顶置/ }));
    expect(screen.getByTestId('shelf-overlay')).toBeInTheDocument();
  });
});
