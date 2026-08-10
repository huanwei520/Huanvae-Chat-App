/**
 * 好友消息 API 封装单元测试（src/api/messages.ts）
 *
 * 用假 ApiClient（get/post/put/delete/patch 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/query/body 调用 api.get/post/delete，并返回解包后的数据；
 *   - 缺省：options 缺省时 URL 不带对应 query；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as messages from '../../src/api/messages';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe('好友消息 API 封装 (api/messages)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- getMessages ----

  it('getMessages 正常：仅 friend_id，无分页 query', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    const out = await messages.getMessages(api, '42');
    expect(api.get).toHaveBeenCalledWith('/api/messages?friend_id=42');
    expect(out).toEqual({ messages: [], has_more: false });
  });

  it('getMessages 正常：beforeTime + limit 都拼入 query（冒号编码为 %3A）', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: true });
    await messages.getMessages(api, '42', {
      beforeTime: '2026-01-01T00:00:00Z',
      limit: 50,
    });
    expect(api.get).toHaveBeenCalledWith(
      '/api/messages?friend_id=42&before_time=2026-01-01T00%3A00%3A00Z&limit=50',
    );
  });

  it('getMessages 缺省：只传 limit 时 URL 不带 before_time', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    await messages.getMessages(api, '7', { limit: 20 });
    expect(api.get).toHaveBeenCalledWith('/api/messages?friend_id=7&limit=20');
  });

  it('getMessages 缺省：只传 beforeTime 时 URL 不带 limit', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    await messages.getMessages(api, '7', { beforeTime: '2026-01-01T00:00:00Z' });
    expect(api.get).toHaveBeenCalledWith(
      '/api/messages?friend_id=7&before_time=2026-01-01T00%3A00%3A00Z',
    );
  });

  it('getMessages 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('get-msg-fail'));
    await expect(messages.getMessages(api, '42')).rejects.toThrow('get-msg-fail');
  });

  // ---- sendMessage ----

  it('sendMessage 正常：全字段原样进 body 并返回响应', async () => {
    api.post.mockResolvedValue({ message_uuid: 'u1', send_time: '2026-01-01T00:00:00Z' });
    const out = await messages.sendMessage(api, {
      receiver_id: '42',
      message_content: 'hello',
      message_type: 'image',
      file_uuid: 'f-uuid',
      file_url: 'https://example.com/f.png',
      file_size: 1024,
      reply_to: 'orig-uuid-1',
    });
    expect(api.post).toHaveBeenCalledWith('/api/messages', {
      receiver_id: '42',
      message_content: 'hello',
      message_type: 'image',
      file_uuid: 'f-uuid',
      file_url: 'https://example.com/f.png',
      file_size: 1024,
      reply_to: 'orig-uuid-1',
      media_group_id: null,
      media_group_index: null,
      media_group_count: null,
    });
    expect(out).toEqual({ message_uuid: 'u1', send_time: '2026-01-01T00:00:00Z' });
  });

  it('sendMessage 契约：缺省 file 字段时 body 中为显式 null（?? null 归一化）', async () => {
    api.post.mockResolvedValue({ message_uuid: 'u2', send_time: '2026-01-01T00:00:01Z' });
    await messages.sendMessage(api, {
      receiver_id: '42',
      message_content: 'text only',
      message_type: 'text',
    });
    expect(api.post).toHaveBeenCalledWith('/api/messages', {
      receiver_id: '42',
      message_content: 'text only',
      message_type: 'text',
      file_uuid: null,
      file_url: null,
      file_size: null,
      reply_to: null,
      media_group_id: null,
      media_group_index: null,
      media_group_count: null,
    });
  });

  // 媒体组三件套同生同灭：成组时三者都要原样进 body，缺任何一个后端都不认这条是相册项
  it('sendMessage 契约：媒体组三件套原样透传（index=0 是整组配文那条）', async () => {
    api.post.mockResolvedValue({ message_uuid: 'u3', send_time: '2026-01-01T00:00:02Z' });
    await messages.sendMessage(api, {
      receiver_id: '42',
      message_content: '整组配文',
      message_type: 'image',
      file_uuid: 'f-1',
      media_group_id: 'grp-1',
      media_group_index: 0,
      media_group_count: 3,
    });

    expect(api.post).toHaveBeenLastCalledWith('/api/messages', expect.objectContaining({
      media_group_id: 'grp-1',
      media_group_index: 0,
      media_group_count: 3,
    }));
  });

  it('sendMessage 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('send-fail'));
    await expect(
      messages.sendMessage(api, {
        receiver_id: '42',
        message_content: 'x',
        message_type: 'text',
      }),
    ).rejects.toThrow('send-fail');
  });

  // ---- deleteMessage ----

  it('deleteMessage 正常：DELETE /api/messages/delete 带 message_uuid body', async () => {
    api.delete.mockResolvedValue({ success: true, message: 'ok' });
    const out = await messages.deleteMessage(api, 'msg-uuid-1');
    expect(api.delete).toHaveBeenCalledWith('/api/messages/delete', {
      message_uuid: 'msg-uuid-1',
    });
    expect(out).toEqual({ success: true, message: 'ok' });
  });

  it('deleteMessage 异常：api.delete 抛错时向上抛', async () => {
    api.delete.mockRejectedValue(new Error('del-fail'));
    await expect(messages.deleteMessage(api, 'msg-uuid-1')).rejects.toThrow('del-fail');
  });

  // ---- recallMessage ----

  it('recallMessage 正常：POST /api/messages/recall 带 message_uuid body', async () => {
    api.post.mockResolvedValue({ success: true, message: 'recalled' });
    const out = await messages.recallMessage(api, 'msg-uuid-2');
    expect(api.post).toHaveBeenCalledWith('/api/messages/recall', {
      message_uuid: 'msg-uuid-2',
    });
    expect(out).toEqual({ success: true, message: 'recalled' });
  });

  it('recallMessage 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('recall-fail'));
    await expect(messages.recallMessage(api, 'msg-uuid-2')).rejects.toThrow('recall-fail');
  });
});
