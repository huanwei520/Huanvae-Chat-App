/**
 * GlobalMessageSearchResults 的「服务端发现区」测试（群聊 / 用户 / 机器人 三段）
 *
 * 本文件聚焦发现区渲染与点击回调；本地区（会话/聊天记录/文件）由 useGlobalMessageSearch 覆盖，
 * 这里把它 mock 成空，隔离出发现区行为。
 *
 * mock：
 * - useGlobalMessageSearch → 稳定空结果（本地区无命中）
 * - useDiscoverySearch → vi.fn，每个用例用 mockReturnValue 注入固定发现结果（引用稳定）
 *
 * 覆盖：
 * - 三段头 群聊/用户/机器人 + 计数；bot 行带 BotBadge
 * - 点击用户/机器人/群聊行 → onSelectDiscoveryPerson/Bot/Group 精确参数
 * - 发现出错 → 「发现搜索失败」提示
 * - 本地 + 发现都空且都不在加载/出错 → 「未找到」提示
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const localSearchReturn = vi.hoisted(() => ({ groups: [], loading: false, error: null }));
vi.mock('../../src/hooks/useGlobalMessageSearch', () => ({
  useGlobalMessageSearch: () => localSearchReturn,
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

describe('GlobalMessageSearchResults · 发现区', () => {
  beforeEach(() => {
    cleanup();
    mockUseDiscoverySearch.mockReset();
    mockUseDiscoverySearch.mockReturnValue({ people: [], groups: [], bots: [], loading: false, error: null });
  });

  it('发现结果：渲染 群聊/用户/机器人 段头与计数，bot 行带 BotBadge', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [
        { userId: 'u1', nickname: 'Alice', avatarUrl: null, isFriend: false },
        { userId: 'u2', nickname: 'Bob', avatarUrl: null, isFriend: true },
      ],
      groups: [
        { groupId: 'g1', groupName: 'GroupOne', avatarUrl: null, memberCount: 3, joinMode: 'open', isMember: false },
      ],
      bots: [
        { botUserId: 'bot_1', username: 'weatherbot', nickname: 'WeatherBot', avatarUrl: null, isFriend: false },
      ],
      loading: false,
      error: null,
    });
    renderResults();

    const groupHeader = screen.getByText('群聊');
    const userHeader = screen.getByText('用户');
    const botHeader = screen.getByText('机器人');
    expect(groupHeader).toBeInTheDocument();
    expect(userHeader).toBeInTheDocument();
    expect(botHeader).toBeInTheDocument();

    // 计数：用户 2、群聊 1、机器人 1（各自段头内定位，避免误命中别段的相同数字）
    expect(within(userHeader).getByText('2')).toBeInTheDocument();
    expect(within(groupHeader).getByText('1')).toBeInTheDocument();
    expect(within(botHeader).getByText('1')).toBeInTheDocument();

    // 行内容
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('GroupOne')).toBeInTheDocument();
    expect(screen.getByText('WeatherBot')).toBeInTheDocument();

    // bot 段带 BotBadge
    expect(screen.getByText('Bot')).toHaveClass('bot-badge');
  });

  it('点击发现行触发对应回调（用户/机器人/群聊，含精确参数）', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [{ userId: 'u1', nickname: 'Alice', avatarUrl: null, isFriend: false }],
      groups: [
        { groupId: 'g1', groupName: 'GroupOne', avatarUrl: null, memberCount: 3, joinMode: 'open', isMember: false },
      ],
      bots: [
        { botUserId: 'bot_1', username: 'weatherbot', nickname: 'WeatherBot', avatarUrl: null, isFriend: false },
      ],
      loading: false,
      error: null,
    });
    const props = renderResults();

    fireEvent.click(screen.getByText('Alice'));
    expect(props.onSelectDiscoveryPerson).toHaveBeenCalledWith('u1');

    fireEvent.click(screen.getByText('WeatherBot'));
    expect(props.onSelectDiscoveryBot).toHaveBeenCalledWith('bot_1', 'weatherbot');

    fireEvent.click(screen.getByText('GroupOne'));
    expect(props.onSelectDiscoveryGroup).toHaveBeenCalledWith('g1');
  });

  it('发现搜索出错：显示「发现搜索失败」提示', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: 'boom',
    });
    renderResults();

    expect(screen.getByText(/发现搜索失败/)).toBeInTheDocument();
    // 出错态不应显示"未找到"
    expect(screen.queryByText(/未找到包含/)).toBeNull();
  });

  it('本地与发现都为空且都不在加载/出错：显示未找到提示', () => {
    // localSearchReturn 默认空；useDiscoverySearch 默认空（beforeEach 已设）
    renderResults();
    expect(screen.getByText('未找到包含「x」的内容')).toBeInTheDocument();
  });
});
