/**
 * 黑名单管理面板测试
 *
 * 覆盖：
 * - 加载并展示黑名单项（昵称 / @id）
 * - 空状态显示"暂无拉黑用户"
 * - 取消拉黑需二次确认 → 调用 removeBlacklist + 移除行 + 同步好友 store 标记
 * - 加载失败显示错误 + 重试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useChatStore } from '../../src/stores/chatStore';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
}));

const mockGetBlacklist = vi.hoisted(() => vi.fn());
const mockRemoveBlacklist = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/friends', () => ({
  getBlacklist: mockGetBlacklist,
  removeBlacklist: mockRemoveBlacklist,
}));

import { BlacklistPanel } from '../../src/components/settings/BlacklistPanel';

describe('BlacklistPanel', () => {
  beforeEach(() => {
    cleanup();
    mockGetBlacklist.mockReset();
    mockRemoveBlacklist.mockReset();
    mockRemoveBlacklist.mockResolvedValue(undefined);
    useChatStore.setState({ friends: [] });
  });

  it('加载并展示黑名单项（昵称 + @id）', async () => {
    mockGetBlacklist.mockResolvedValue([
      { user_id: 'u1', user_nickname: '老王', user_avatar_url: null, created_at: '2026-06-01T00:00:00Z' },
    ]);
    render(<BlacklistPanel onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText('老王')).toBeInTheDocument());
    expect(screen.getByText('@u1')).toBeInTheDocument();
  });

  it('空列表显示占位文案', async () => {
    mockGetBlacklist.mockResolvedValue([]);
    render(<BlacklistPanel onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('暂无拉黑用户')).toBeInTheDocument());
  });

  it('取消拉黑需二次确认，确认后调用 removeBlacklist 并移除行 + 同步 store', async () => {
    // 该用户同时也是好友且被标记拉黑，验证取消后 store 同步置 false
    useChatStore.setState({
      friends: [{
        friend_id: 'u2', friend_nickname: '小李', friend_avatar_url: null,
        add_time: '', approve_reason: null, is_blacklisted: true,
      }],
    });
    mockGetBlacklist.mockResolvedValue([
      { user_id: 'u2', user_nickname: '小李', user_avatar_url: null, created_at: '2026-06-01T00:00:00Z' },
    ]);
    render(<BlacklistPanel onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('小李')).toBeInTheDocument());

    // 第一步：点"取消拉黑"出现确认（未调 API）
    fireEvent.click(screen.getByRole('button', { name: /取消拉黑/ }));
    expect(mockRemoveBlacklist).not.toHaveBeenCalled();

    // 第二步：确认 → 调 API + 行移除 + store 同步
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    await waitFor(() => expect(mockRemoveBlacklist).toHaveBeenCalledWith(mockApi, 'u2'));
    await waitFor(() => expect(screen.queryByText('小李')).toBeNull());
    expect(useChatStore.getState().friends[0].is_blacklisted).toBe(false);
  });

  it('加载失败显示错误与重试', async () => {
    mockGetBlacklist.mockRejectedValueOnce(new Error('网络异常'));
    render(<BlacklistPanel onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('网络异常')).toBeInTheDocument());

    // 重试成功 → 显示列表项
    mockGetBlacklist.mockResolvedValue([
      { user_id: 'u3', user_nickname: '阿强', user_avatar_url: null, created_at: '2026-06-01T00:00:00Z' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => expect(screen.getByText('@u3')).toBeInTheDocument());
  });
});
