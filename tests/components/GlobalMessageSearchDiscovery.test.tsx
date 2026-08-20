/**
 * GlobalMessageSearchResults 的「服务端发现区」测试
 *
 * 改造成六分类页签之后，发现结果不再是三段并列，而是**分别挂在三个实体页签下**：
 * people → 用户页签、groups → 群聊页签、bots → 机器人页签。
 * 本文件仍聚焦发现区本身（渲染 / 计数 / 点击回调 / 出错降级），页签切换与消息类页签
 * 由 GlobalMessageSearchTabs.test.tsx 覆盖。
 *
 * mock：
 * - useGlobalMessageSearch → 稳定空结果（本地区无命中），隔离出发现区行为。
 *   🔴 同模块的 GLOBAL_SEARCH_LIMIT 也要在工厂里导出：被测组件 import 了它，
 *   漏掉会报 "No export is defined on the mock"（见 .claude/rules/frontend-test.md）。
 * - useDiscoverySearch → vi.fn，每个用例用 mockReturnValue 注入固定发现结果（引用稳定）
 *
 * 🔴 查询用词：段头固定叫「发现」，而「用户 / 群聊 / 机器人」现在是**页签**文案。
 * 所以定位页签一律 getByRole('tab', ...)，别用 getByText —— 后者会同时命中页签与段内文字。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const localSearchReturn = vi.hoisted(() => ({ groups: [], loading: false, error: null }));
vi.mock('../../src/hooks/useGlobalMessageSearch', () => ({
  useGlobalMessageSearch: () => localSearchReturn,
  GLOBAL_SEARCH_LIMIT: 50,
}));

const mockUseDiscoverySearch = vi.hoisted(() => vi.fn());
vi.mock('../../src/hooks/useDiscoverySearch', () => ({
  useDiscoverySearch: (q: string) => mockUseDiscoverySearch(q),
}));

import { GlobalMessageSearchResults } from '../../src/components/search/GlobalMessageSearchResults';

function renderResults() {
  const props = {
    query: 'x',
    friends: [],
    groups: [],
    onSelectConversation: vi.fn(),
    onSelectMessage: vi.fn(),
    onSelectDiscoveryPerson: vi.fn(),
    onSelectDiscoveryBot: vi.fn(),
    onSelectDiscoveryGroup: vi.fn(),
  };
  render(<GlobalMessageSearchResults {...props} />);
  return props;
}

function openTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

const FULL_RESULTS = {
  people: [
    { userId: 'u1', nickname: 'Alice', avatarUrl: null, isFriend: false },
    { userId: 'u2', nickname: 'Bob', avatarUrl: null, isFriend: true },
  ],
  groups: [
    {
      groupId: 'g1',
      groupName: 'GroupOne',
      avatarUrl: null,
      memberCount: 3,
      isMember: false,
    },
  ],
  bots: [
    {
      botUserId: 'bot_1',
      username: 'weatherbot',
      nickname: 'WeatherBot',
      avatarUrl: null,
      isFriend: false,
    },
  ],
  loading: false,
  error: null,
};

describe('GlobalMessageSearchResults · 发现区', () => {
  beforeEach(() => {
    cleanup();
    mockUseDiscoverySearch.mockReset();
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('用户页签：people 渲染在「发现」段里，计数正确，且不混进群 / bot', () => {
    mockUseDiscoverySearch.mockReturnValue(FULL_RESULTS);
    renderResults();
    openTab('用户');

    const discHeader = screen.getByText('发现');
    expect(within(discHeader).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // 「已是好友」元信息只跟着 isFriend 为真的那一行
    expect(screen.getByText('已是好友')).toBeInTheDocument();
    // 别的两类不该出现在用户页签
    expect(screen.queryByText('GroupOne')).toBeNull();
    expect(screen.queryByText('WeatherBot')).toBeNull();
  });

  it('群聊页签：groups 渲染在「发现」段里，带成员数元信息，且不混进用户 / bot', () => {
    mockUseDiscoverySearch.mockReturnValue(FULL_RESULTS);
    renderResults();
    openTab('群聊');

    const discHeader = screen.getByText('发现');
    expect(within(discHeader).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('GroupOne')).toBeInTheDocument();
    expect(screen.getByText(/3 人/)).toBeInTheDocument();
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('WeatherBot')).toBeNull();
  });

  it('机器人页签：bots 渲染在「发现」段里，行带 BotBadge，且不混进用户 / 群', () => {
    mockUseDiscoverySearch.mockReturnValue(FULL_RESULTS);
    renderResults();
    openTab('机器人');

    const discHeader = screen.getByText('发现');
    expect(within(discHeader).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('WeatherBot')).toBeInTheDocument();
    expect(screen.getByText('Bot')).toHaveClass('bot-badge');
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('GroupOne')).toBeNull();
  });

  it('点击发现行触发对应回调（用户 / 机器人 / 群聊，含精确参数）', () => {
    mockUseDiscoverySearch.mockReturnValue(FULL_RESULTS);
    const props = renderResults();

    openTab('用户');
    fireEvent.click(screen.getByText('Alice'));
    expect(props.onSelectDiscoveryPerson).toHaveBeenCalledWith('u1');

    openTab('机器人');
    fireEvent.click(screen.getByText('WeatherBot'));
    expect(props.onSelectDiscoveryBot).toHaveBeenCalledWith('bot_1', 'weatherbot');

    openTab('群聊');
    fireEvent.click(screen.getByText('GroupOne'));
    expect(props.onSelectDiscoveryGroup).toHaveBeenCalledWith('g1');
  });

  it('发现搜索出错：实体页签显示「发现搜索失败」提示，且不落到空态', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: 'boom',
    });
    renderResults();
    openTab('用户');

    expect(screen.getByText(/发现搜索失败/)).toBeInTheDocument();
    expect(screen.queryByText(/未找到包含/)).toBeNull();
  });

  it('本地与发现都为空且都不在加载 / 出错：显示该页签自己的空态', () => {
    // localSearchReturn 默认空；useDiscoverySearch 默认空（beforeEach 已设）
    renderResults();
    openTab('用户');
    expect(screen.getByText('未找到包含「x」的用户')).toBeInTheDocument();
  });
});
