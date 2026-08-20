/**
 * ForwardMessageModal（A 版快捷卡的「转发」形态）
 *
 * 覆盖 A 版规格 ① 顶部固定转发内容预览（单条 / 多条「共 N 条」），
 * 以及 §5 的发送语义：媒体复用 file_uuid、不带 reply_to、不带媒体组三件套、
 * 多条按原顺序逐条发出。
 *
 * 🔴 A 版取舍的机器化守门：面板里**不得**出现附言输入框、
 * **不得**出现「合并转发 / 逐条转发」开关（多做 = 违规）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForwardMessageModal } from '../../src/chat/shared/ForwardMessageModal';
import type { ForwardSource } from '../../src/chat/shared/forwardMessage';

const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => api,
  useSession: () => ({ session: { userId: 'me' } }),
}));

const messagesApi = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/api/messages', () => messagesApi);

const groupApi = vi.hoisted(() => ({ sendGroupMessage: vi.fn() }));
vi.mock('../../src/api/groupMessages', () => groupApi);

const store = vi.hoisted(() => ({
  friends: [{
    friend_id: 'u-lin', friend_nickname: '林知遥', friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
    is_blacklisted: false, is_special_care: false,
  }],
  groups: [{
    group_id: 'g-week', group_name: '前端周会', group_avatar_url: '',
    role: 'owner' as const, unread_count: 0,
    last_message_content: null, last_message_time: null,
  }],
}));
vi.mock('../../src/stores/chatStore', () => ({
  useChatStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const localConversations = vi.hoisted(() => ({
  getFriendPreview: () => undefined,
  getGroupPreview: () => undefined,
}));
vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => localConversations,
}));

function src(over: Partial<ForwardSource> = {}): ForwardSource {
  return {
    message_uuid: 'm1',
    message_content: '明天的评审挪到 15:00，会议室 B。',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    send_time: '2026-08-17T09:42:00Z',
    senderName: '林知遥',
    is_recalled: false,
    ...over,
  };
}

function rowByName(name: string): HTMLElement {
  const hit = Array.from(document.querySelectorAll<HTMLElement>('.share-picker-row'))
    .find((el) => el.querySelector('.share-picker-row-name')?.textContent?.includes(name));
  if (!hit) { throw new Error(`没有找到列表行：${name}`); }
  return hit;
}

describe('ForwardMessageModal', () => {
  beforeEach(() => {
    messagesApi.sendMessage.mockReset().mockResolvedValue({ message_uuid: 'new', send_time: 'now' });
    groupApi.sendGroupMessage.mockReset().mockResolvedValue({ message_uuid: 'new', send_time: 'now', seq: 1 });
  });

  it('渲染：单条转发时预览显示发送者 + 内容摘要', () => {
    render(<ForwardMessageModal messages={[src()]} onClose={vi.fn()} />);

    expect(screen.getByText('转发到')).toBeInTheDocument();
    expect(document.querySelector('.forward-preview-meta b')?.textContent).toBe('林知遥');
    expect(document.querySelector('.forward-preview-text')?.textContent)
      .toBe('明天的评审挪到 15:00，会议室 B。');
    expect(document.querySelector('.forward-preview-count')).toBeNull();
  });

  it('渲染：多条转发时预览给出「共 N 条」+ 第一条摘要', () => {
    render(
      <ForwardMessageModal
        messages={[
          src({ message_uuid: 'a' }),
          src({ message_uuid: 'b', message_type: 'image', message_content: '[图片] a.png', file_uuid: 'f-b' }),
          src({ message_uuid: 'c' }),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(document.querySelector('.forward-preview-count')?.textContent).toBe('共 3 条');
    expect(document.querySelector('.forward-preview-text')?.textContent)
      .toBe('明天的评审挪到 15:00，会议室 B。');
  });

  it('A 版取舍：没有附言输入框，也没有合并/逐条开关', () => {
    render(<ForwardMessageModal messages={[src(), src({ message_uuid: 'b' })]} onClose={vi.fn()} />);

    // 面板里唯一的文本输入是搜索框
    const textInputs = Array.from(document.querySelectorAll('input, textarea'));
    expect(textInputs).toHaveLength(1);
    expect(textInputs[0]).toHaveAttribute('aria-label', '搜索好友、群组');

    expect(screen.queryByText(/附言/)).toBeNull();
    expect(screen.queryByText(/合并转发/)).toBeNull();
    expect(screen.queryByText(/逐条转发/)).toBeNull();
  });

  it('发送：好友走 sendMessage、群走 sendGroupMessage，媒体复用原 file_uuid', async () => {
    const onSent = vi.fn();
    render(
      <ForwardMessageModal
        messages={[src({
          message_type: 'image',
          message_content: '[图片] a.png',
          file_uuid: 'file-uuid-1',
          file_url: 'https://example.invalid/a.png',
          file_size: 1234,
        })]}
        onClose={vi.fn()}
        onSent={onSent}
      />,
    );

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(rowByName('前端周会'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));

    expect(messagesApi.sendMessage).toHaveBeenCalledTimes(1);
    const friendReq = messagesApi.sendMessage.mock.calls[0][1] as Record<string, unknown>;
    expect(friendReq).toEqual({
      receiver_id: 'u-lin',
      message_content: '[图片] a.png',
      message_type: 'image',
      file_uuid: 'file-uuid-1',
      file_url: 'https://example.invalid/a.png',
      file_size: 1234,
    });
    // 逐字断言「没有」这两类字段：带上就是后端 400 / 对方留洞
    expect('reply_to' in friendReq).toBe(false);
    expect('media_group_id' in friendReq).toBe(false);

    expect(groupApi.sendGroupMessage).toHaveBeenCalledTimes(1);
    const groupReq = groupApi.sendGroupMessage.mock.calls[0][1] as Record<string, unknown>;
    expect(groupReq.group_id).toBe('g-week');
    expect(groupReq.file_uuid).toBe('file-uuid-1');
    expect('reply_to' in groupReq).toBe(false);
    expect('media_group_id' in groupReq).toBe(false);
  });

  it('发送：多条按原顺序逐条发出（不是并发乱序）', async () => {
    const order: string[] = [];
    messagesApi.sendMessage.mockImplementation((_api: unknown, req: { message_content: string }) => {
      order.push(req.message_content);
      return Promise.resolve({ message_uuid: 'x', send_time: 'now' });
    });

    render(
      <ForwardMessageModal
        messages={[
          src({ message_uuid: 'a', message_content: '第一条' }),
          src({ message_uuid: 'b', message_content: '第二条' }),
          src({ message_uuid: 'c', message_content: '第三条' }),
        ]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(messagesApi.sendMessage).toHaveBeenCalledTimes(3));
    expect(order).toEqual(['第一条', '第二条', '第三条']);
  });

  it('发送失败：错误摆在面板上，不调 onSent', async () => {
    messagesApi.sendMessage.mockRejectedValue(new Error('后端拒绝了这条'));
    const onSent = vi.fn();
    render(<ForwardMessageModal messages={[src()]} onClose={vi.fn()} onSent={onSent} />);

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('后端拒绝了这条'));
    expect(onSent).not.toHaveBeenCalled();
  });
});
