/**
 * MemberGrid —— 群成员头像网格（侧边面板第一组，微信式）
 *
 * 覆盖：
 * 1. 头像 + 昵称都渲染出来（不是只有头像）
 * 2. **折叠态只把前 N 个渲染进 DOM**（不是全渲染再 CSS 隐藏 —— 大群会造上千节点）
 * 3. 超出才出现「查看更多」，点击后展开全部
 * 4. 点成员 → onSelect 拿到那个成员（这是"点头像看资料"的入口，和会话列表卡片头像
 *    「点了进会话、不跳资料」是两码事，别混）
 * 5. 显示名口径：私有备注 > 群昵称 > 用户昵称；自己那格标「我」
 * 6. 加载中 / 无成员 的状态文案
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemberGrid, MEMBER_GRID_COLLAPSED_COUNT } from '../../src/chat/shared/menu/MemberGrid';
import type { GroupMember } from '../../src/api/groups';

const buildMember = (id: string, overrides: Partial<GroupMember> = {}): GroupMember => ({
  user_id: id,
  user_nickname: `用户${id}`,
  // 后端契约里该字段非空，没设头像时下发空串 → 组件降级到 AvatarPlaceholder
  user_avatar_url: '',
  group_nickname: null,
  role: 'member',
  joined_at: '2026-05-01T00:00:00Z',
  join_method: 'search_direct',
  muted_until: null,
  ...overrides,
});

const manyMembers = (n: number) => Array.from({ length: n }, (_, i) => buildMember(`u${i}`));

function renderGrid(overrides: Partial<React.ComponentProps<typeof MemberGrid>> = {}) {
  const onSelect = vi.fn();
  const view = render(
    <MemberGrid members={[]} loading={false} onSelect={onSelect} {...overrides} />,
  );
  return { ...view, onSelect };
}

describe('MemberGrid — 群成员头像网格', () => {
  beforeEach(() => cleanup());

  it('渲染头像格与昵称，并在组标题上带人数', () => {
    renderGrid({ members: [buildMember('a'), buildMember('b')] });

    expect(screen.getByText('群成员 (2)')).toBeInTheDocument();
    expect(screen.getByText('用户a')).toBeInTheDocument();
    expect(screen.getByText('用户b')).toBeInTheDocument();
    expect(document.querySelectorAll('.member-grid-item')).toHaveLength(2);
    expect(document.querySelectorAll('.member-grid-avatar')).toHaveLength(2);
  });

  it('未超出固定数额时不出现「查看更多」', () => {
    renderGrid({ members: manyMembers(MEMBER_GRID_COLLAPSED_COUNT) });

    expect(document.querySelectorAll('.member-grid-item')).toHaveLength(
      MEMBER_GRID_COLLAPSED_COUNT,
    );
    expect(screen.queryByRole('button', { name: /查看更多/ })).toBeNull();
  });

  it('超出：折叠态只把前 N 个渲染进 DOM（不是渲染完再隐藏）', () => {
    renderGrid({ members: manyMembers(MEMBER_GRID_COLLAPSED_COUNT + 25) });

    expect(document.querySelectorAll('.member-grid-item')).toHaveLength(
      MEMBER_GRID_COLLAPSED_COUNT,
    );
    // 第 N+1 个成员压根不在 DOM 里 —— CSS 隐藏方案在这条会 FAIL
    expect(screen.queryByText(`用户u${MEMBER_GRID_COLLAPSED_COUNT}`)).toBeNull();
    expect(screen.getByRole('button', { name: /查看更多（25）/ })).toBeInTheDocument();
  });

  it('点「查看更多」展开全部，按钮随之消失', () => {
    const total = MEMBER_GRID_COLLAPSED_COUNT + 3;
    renderGrid({ members: manyMembers(total) });

    fireEvent.click(screen.getByRole('button', { name: /查看更多/ }));

    expect(document.querySelectorAll('.member-grid-item')).toHaveLength(total);
    expect(screen.getByText(`用户u${total - 1}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看更多/ })).toBeNull();
  });

  it('点成员 → onSelect 收到该成员（打开资料的入口）', () => {
    const { onSelect } = renderGrid({ members: [buildMember('a'), buildMember('b')] });

    fireEvent.click(screen.getByRole('button', { name: '查看用户b资料' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'b' }));
  });

  it('显示名：私有备注 > 群昵称 > 用户昵称；自己那格标「我」', () => {
    renderGrid({
      members: [
        buildMember('a', { group_nickname: '群里的A' }),
        buildMember('b', { group_nickname: '群里的B' }),
        buildMember('me'),
      ],
      remarks: { b: '我备注的B' },
      currentUserId: 'me',
    });

    expect(screen.getByText('群里的A')).toBeInTheDocument();
    expect(screen.getByText('我备注的B')).toBeInTheDocument();
    expect(screen.queryByText('群里的B')).toBeNull();
    expect(screen.getByText(/用户me \(我\)/)).toBeInTheDocument();
  });

  it('加载中 / 无成员：给状态文案而不是静默空白', () => {
    const { unmount } = renderGrid({ members: [], loading: true });
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    unmount();

    renderGrid({ members: [], loading: false });
    expect(screen.getByText('暂无成员')).toBeInTheDocument();
  });
});
