/**
 * ShareGroupCardModal（发送侧：把一个群以 group_card 发给好友 / 发进群）
 *
 * 覆盖两件事：
 * 1. **请求体形状**——`message_type: 'group_card'` + `message_content` 只有 group_id 一个键
 *    （反向断言：多一个键后端就是 400）；好友走 sendMessage、群走 sendGroupMessage，
 *    且群路径的 `group_id` 是**承载会话**的群，不是被分享的那个群（契约 §八，两者极易写反）。
 * 2. **错误三态给三种不同文案**——400 / 403 / 404，尤其 403 要说清是「你在那个群的权限不够」。
 *
 * 选人 UI 整个来自 ShareTargetPicker（本单一行都没改它），其行为由
 * tests/components/ShareTargetPicker.test.tsx 覆盖，这里只走「选一个 → 发」。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

const messagesApi = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/api/messages', () => messagesApi);

const groupMessagesApi = vi.hoisted(() => ({ sendGroupMessage: vi.fn() }));
vi.mock('../../src/api/groupMessages', () => groupMessagesApi);

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

const store = vi.hoisted(() => ({
  friends: [{
    friend_id: 'u-lin', friend_nickname: '林知遥', friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
    is_blacklisted: false, is_special_care: false,
  }],
  groups: [{
    group_id: 'g-host', group_name: '承载会话的群', group_avatar_url: '',
    role: 'member' as const, unread_count: 0,
    last_message_content: null, last_message_time: null,
  }],
}));
vi.mock('../../src/stores/chatStore', () => ({
  useChatStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    getFriendPreview: () => undefined,
    getGroupPreview: () => undefined,
  }),
}));

import { ShareGroupCardModal } from '../../src/chat/shared/ShareGroupCardModal';
import { ApiError } from '../../src/api/client';
import type { GroupInfo } from '../../src/api/groups';

/** 被分享的那个群（与「承载会话的群」故意取不同 id，好把两者写反的情况钉出来） */
const SHARED: GroupInfo = {
  group_id: 'g-shared',
  group_name: '被分享的群',
  group_avatar_url: null,
  group_description: null,
  creator_id: 'owner1',
  created_at: '2026-01-01T00:00:00Z',
  status: 'active',
  member_count: 42,
};

function rowByName(name: string): HTMLElement {
  const hit = Array.from(document.querySelectorAll<HTMLElement>('.share-picker-row'))
    .find((el) => el.querySelector('.share-picker-row-name')?.textContent?.includes(name));
  if (!hit) { throw new Error(`没有找到列表行：${name}`); }
  return hit;
}

async function shareTo(name: string) {
  render(<ShareGroupCardModal group={SHARED} onClose={vi.fn()} />);
  fireEvent.click(rowByName(name));
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

/** 面板上摆出来的报错文案 */
function panelError(): string {
  return document.querySelector('.share-picker-error')?.textContent ?? '';
}

describe('ShareGroupCardModal', () => {
  beforeEach(() => {
    cleanup();
    messagesApi.sendMessage.mockReset().mockResolvedValue({ message_uuid: 'm1', send_time: 't', seq: 1 });
    groupMessagesApi.sendGroupMessage.mockReset().mockResolvedValue({ message_uuid: 'm1', send_time: 't', seq: 1 });
  });

  it('预览区展示被分享群的群名与成员数（所见即所得，与接收侧同一张脸）', () => {
    render(<ShareGroupCardModal group={SHARED} onClose={vi.fn()} />);

    const preview = document.querySelector('.share-picker-preview');
    expect(preview?.textContent).toContain('被分享的群');
    expect(preview?.textContent).toContain('42 位成员');
    expect(screen.getByRole('dialog', { name: '分享群名片' })).toBeInTheDocument();
  });

  it('发给好友：sendMessage 的 message_type 是 group_card，content 只有 group_id 一个键', async () => {
    await shareTo('林知遥');

    await waitFor(() => expect(messagesApi.sendMessage).toHaveBeenCalledTimes(1));
    const [, req] = messagesApi.sendMessage.mock.calls[0];
    expect(req.receiver_id).toBe('u-lin');
    expect(req.message_type).toBe('group_card');

    // 🔴 反向断言：封闭 schema —— 有且仅有 group_id
    const payload = JSON.parse(req.message_content) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['group_id']);
    expect(payload.group_id).toBe('g-shared');
    for (const forbidden of ['group_name', 'group_avatar_url', 'member_count']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('发进群：sendGroupMessage 的 group_id 是【承载会话】的群，被分享的群只在 content 里', async () => {
    await shareTo('承载会话的群');

    await waitFor(() => expect(groupMessagesApi.sendGroupMessage).toHaveBeenCalledTimes(1));
    const [, req] = groupMessagesApi.sendGroupMessage.mock.calls[0];
    expect(req.group_id).toBe('g-host');
    expect(req.message_type).toBe('group_card');
    expect(JSON.parse(req.message_content)).toEqual({ group_id: 'g-shared' });
    // 两者写反是这条链最容易犯的错，正反各钉一次
    expect(req.group_id).not.toBe('g-shared');
  });

  it('403：文案说清是「你在该群的权限不够」，不冒充网络错误', async () => {
    messagesApi.sendMessage.mockRejectedValue(new ApiError(403, '无权分享该群卡片'));
    await shareTo('林知遥');

    await waitFor(() => expect(panelError()).toContain('权限不够'));
    expect(panelError()).not.toContain('网络');
    expect(panelError()).not.toContain('解散');
  });

  it('404：文案说清被分享的群不存在 / 已解散', async () => {
    messagesApi.sendMessage.mockRejectedValue(new ApiError(404, '群聊不存在'));
    await shareTo('林知遥');

    await waitFor(() => expect(panelError()).toContain('解散'));
    expect(panelError()).not.toContain('权限不够');
  });

  it('400：文案说清是内容不被接受，与另外两态互不相同', async () => {
    messagesApi.sendMessage.mockRejectedValue(new ApiError(400, '群卡片内容只允许 group_id 一个字段'));
    await shareTo('林知遥');

    await waitFor(() => expect(panelError()).toContain('不被服务器接受'));
    expect(panelError()).not.toContain('权限不够');
    expect(panelError()).not.toContain('解散');
  });

  it('拿不到状态码（网络层失败）：回落到原始错误文案，不猜成三态之一', async () => {
    messagesApi.sendMessage.mockRejectedValue(new Error('连接超时'));
    await shareTo('林知遥');

    await waitFor(() => expect(panelError()).toContain('连接超时'));
    expect(panelError()).not.toContain('权限不够');
  });
});
