/**
 * UnifiedList 消息(chat) Tab 空状态触发测试（块 1792465686977-647uggj7-1 testharness 层）
 *
 * 锁定的行为变更：AI 助手固定置顶卡移除前，chat Tab 因「总有 AI 卡」被豁免空状态
 * 覆盖层（原代码 `filteredCards.length === 0 && activeTab !== 'chat'`）；卡片移除后
 * 豁免条件一并删除——chat Tab 无会话时必须正常渲染「暂无会话」空状态，且列表内
 * 不得再出现任何固定 AI 卡（防回弹双断言）。
 *
 * 非恒真论证：若空状态豁免回彈（`activeTab !== 'chat'` 条件回归），getByText('暂无会话')
 * 查不到节点 → 断言① FAIL；若固定 AI 卡回彈，querySelector('[data-conv-key="ai-assistant"]')
 * 非 null → 断言② FAIL。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UnreadSummary } from '../../src/types/websocket';

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

import { UnifiedList } from '../../src/components/unified/UnifiedList';

const EMPTY_SUMMARY: UnreadSummary = {
  total_count: 0,
  friend_unreads: [],
  group_unreads: [],
};

describe('UnifiedList chat Tab 空状态（AI 固定卡移除后的豁免删除）', () => {
  it('chat Tab 且 0 会话：渲染「暂无会话」空状态覆盖层，且无固定 AI 卡', () => {
    const { container } = render(
      <UnifiedList
        activeTab="chat"
        friends={[]}
        groups={[]}
        friendsLoading={false}
        groupsLoading={false}
        friendsError={null}
        groupsError={null}
        searchQuery=""
        onSearchChange={vi.fn()}
        selectedTarget={null}
        onSelectTarget={vi.fn()}
        unreadSummary={EMPTY_SUMMARY}
      />,
    );

    // ① 豁免已删：chat Tab 空列表渲染空状态文案
    expect(screen.getByText('暂无会话')).toBeInTheDocument();
    // ② 防回弹：列表内不存在固定 AI 卡
    expect(container.querySelector('[data-conv-key="ai-assistant"]')).toBeNull();
  });
});
