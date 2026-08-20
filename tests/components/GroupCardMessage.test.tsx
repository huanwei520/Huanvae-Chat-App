/**
 * GroupCardMessage（接收侧：把 group_card 消息渲染成卡片）
 *
 * 三种终态必须**互不相同**（契约 backend-docs/groups/群聊管理.md §八）：
 * - `/public` 404          ⇒ 失效态「群聊不存在或已解散」，且**不可点**
 * - JSON.parse 失败 / 缺键 ⇒ 同一个失效态，且**不发请求**、不炸气泡
 * - 正常                   ⇒ 群名 + 成员数，点击走已有落地路径 useGroupDetailStore.open(groupId)
 *
 * 另断一条边界：非 404 的拉取失败（断网）**不算失效** —— 那是「暂时看不到资料」，
 * 卡片仍可点进详情页重试。把它并进失效态等于谎报「群没了」。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

const groupsApiMock = vi.hoisted(() => ({ getPublicGroupInfo: vi.fn() }));
vi.mock('../../src/api/groups', () => groupsApiMock);

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { GroupCardMessage } from '../../src/chat/shared/GroupCardMessage';
import { ApiError } from '../../src/api/client';
import { useGroupDetailStore } from '../../src/stores';

const GID = '550e8400-e29b-41d4-a716-446655440000';

function publicInfo(overrides: Record<string, unknown> = {}) {
  return {
    group_id: GID,
    group_name: '前端周会',
    group_avatar_url: null,
    group_description: null,
    creator_id: 'owner1',
    created_at: '2026-01-01T00:00:00Z',
    status: 'active',
    member_count: 42,
    ...overrides,
  };
}

describe('GroupCardMessage', () => {
  beforeEach(() => {
    cleanup();
    groupsApiMock.getPublicGroupInfo.mockReset();
    useGroupDetailStore.setState({ groupId: null });
  });

  it('正常：凭 group_id 现拉 /public，渲染群名 + 成员数', async () => {
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(publicInfo());

    render(<GroupCardMessage messageContent={`{"group_id":"${GID}"}`} />);

    expect(await screen.findByText('前端周会')).toBeInTheDocument();
    expect(screen.getByText('42 位成员')).toBeInTheDocument();
    expect(groupsApiMock.getPublicGroupInfo).toHaveBeenCalledWith(mockApi, GID);
  });

  it('正常：点击整卡打开群详情面板（复用已有落地路径，不自己写加群逻辑）', async () => {
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(publicInfo());

    render(<GroupCardMessage messageContent={`{"group_id":"${GID}"}`} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看群聊 前端周会' }));

    expect(useGroupDetailStore.getState().groupId).toBe(GID);
  });

  it('/public 返回 404：渲染失效态「群聊不存在或已解散」，且卡片不可点', async () => {
    groupsApiMock.getPublicGroupInfo.mockRejectedValue(new ApiError(404, '群聊不存在'));

    render(<GroupCardMessage messageContent={`{"group_id":"${GID}"}`} />);

    expect(await screen.findByText('群聊不存在或已解散')).toBeInTheDocument();
    // 失效态不是「加载中」也不是空白
    expect(screen.queryByText('加载中...')).toBeNull();
    // 不可点：整卡不再是 button，点了也不会打开详情
    expect(screen.queryByRole('button')).toBeNull();
    expect(useGroupDetailStore.getState().groupId).toBeNull();
  });

  it.each([
    ['非法 JSON', '这不是 json'],
    ['缺 group_id', '{"gid":"x"}'],
    ['根是数组', '[]'],
  ])('内容解析失败（%s）：走失效态、不炸气泡、且不发请求', (_label, content) => {
    expect(() => render(<GroupCardMessage messageContent={content} />)).not.toThrow();

    expect(screen.getByText('群聊不存在或已解散')).toBeInTheDocument();
    expect(groupsApiMock.getPublicGroupInfo).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('非 404 的拉取失败：显示「群信息加载失败」而不是失效态，卡片仍可点进详情重试', async () => {
    groupsApiMock.getPublicGroupInfo.mockRejectedValue(new ApiError(500, '服务器开小差'));

    render(<GroupCardMessage messageContent={`{"group_id":"${GID}"}`} />);

    expect(await screen.findByText('群信息加载失败')).toBeInTheDocument();
    // 🔴 与 404 的分界：这里**不**说「群聊不存在或已解散」
    expect(screen.queryByText('群聊不存在或已解散')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看群聊' }));
    await waitFor(() => expect(useGroupDetailStore.getState().groupId).toBe(GID));
  });
});
