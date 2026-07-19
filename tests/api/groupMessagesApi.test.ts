/**
 * 群消息 API 封装单元测试（src/api/groupMessages.ts）
 *
 * 用假 ApiClient（get/post/put/delete/patch 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/query/body 调用 api.get/post/delete，并返回解包后的数据；
 *   - 缺省：options 缺省时 URL 不带对应 query；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as groupMessages from '../../src/api/groupMessages';

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

describe('群消息 API 封装 (api/groupMessages)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- getGroupMessages ----

  it('getGroupMessages 正常：仅 group_id，无分页 query', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    const out = await groupMessages.getGroupMessages(api, 'g-1');
    expect(api.get).toHaveBeenCalledWith('/api/group_messages?group_id=g-1');
    expect(out).toEqual({ messages: [], has_more: false });
  });

  it('getGroupMessages 正常：beforeTime + limit 依次 append（冒号编码为 %3A）', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: true });
    await groupMessages.getGroupMessages(api, 'g-1', {
      beforeTime: '2026-01-01T00:00:00Z',
      limit: 50,
    });
    expect(api.get).toHaveBeenCalledWith(
      '/api/group_messages?group_id=g-1&before_time=2026-01-01T00%3A00%3A00Z&limit=50',
    );
  });

  it('getGroupMessages 缺省：只传 limit 时 URL 不带 before_time', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    await groupMessages.getGroupMessages(api, 'g-2', { limit: 20 });
    expect(api.get).toHaveBeenCalledWith('/api/group_messages?group_id=g-2&limit=20');
  });

  it('getGroupMessages 缺省：只传 beforeTime 时 URL 不带 limit', async () => {
    api.get.mockResolvedValue({ messages: [], has_more: false });
    await groupMessages.getGroupMessages(api, 'g-2', {
      beforeTime: '2026-01-01T00:00:00Z',
    });
    expect(api.get).toHaveBeenCalledWith(
      '/api/group_messages?group_id=g-2&before_time=2026-01-01T00%3A00%3A00Z',
    );
  });

  it('getGroupMessages 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('get-gm-fail'));
    await expect(groupMessages.getGroupMessages(api, 'g-1')).rejects.toThrow('get-gm-fail');
  });

  // ---- sendGroupMessage ----

  it('sendGroupMessage 正常：data 原样透传（必填字段）并返回响应', async () => {
    api.post.mockResolvedValue({ message_uuid: 'u1', send_time: '2026-01-01T00:00:00Z', seq: 3 });
    const out = await groupMessages.sendGroupMessage(api, {
      group_id: 'g-1',
      message_content: 'hello group',
      message_type: 'text',
    });
    expect(api.post).toHaveBeenCalledWith('/api/group_messages', {
      group_id: 'g-1',
      message_content: 'hello group',
      message_type: 'text',
    });
    expect(out).toEqual({ message_uuid: 'u1', send_time: '2026-01-01T00:00:00Z', seq: 3 });
  });

  it('sendGroupMessage 契约：可选 reply_to/file_* 字段原样出现在 body（无 null 归一化）', async () => {
    api.post.mockResolvedValue({ message_uuid: 'u2', send_time: '2026-01-01T00:00:01Z', seq: 4 });
    await groupMessages.sendGroupMessage(api, {
      group_id: 'g-1',
      message_content: 'pic',
      message_type: 'image',
      file_uuid: 'f-uuid',
      file_url: 'https://example.com/p.png',
      file_size: 2048,
      reply_to: 'reply-uuid',
    });
    expect(api.post).toHaveBeenCalledWith('/api/group_messages', {
      group_id: 'g-1',
      message_content: 'pic',
      message_type: 'image',
      file_uuid: 'f-uuid',
      file_url: 'https://example.com/p.png',
      file_size: 2048,
      reply_to: 'reply-uuid',
    });
  });

  it('sendGroupMessage 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('send-gm-fail'));
    await expect(
      groupMessages.sendGroupMessage(api, {
        group_id: 'g-1',
        message_content: 'x',
        message_type: 'text',
      }),
    ).rejects.toThrow('send-gm-fail');
  });

  // ---- deleteGroupMessage ----

  it('deleteGroupMessage 正常：DELETE /api/group_messages/delete 带 message_uuid body', async () => {
    api.delete.mockResolvedValue({ success: true, message: 'ok' });
    const out = await groupMessages.deleteGroupMessage(api, 'gm-uuid-1');
    expect(api.delete).toHaveBeenCalledWith('/api/group_messages/delete', {
      message_uuid: 'gm-uuid-1',
    });
    expect(out).toEqual({ success: true, message: 'ok' });
  });

  it('deleteGroupMessage 异常：api.delete 抛错时向上抛', async () => {
    api.delete.mockRejectedValue(new Error('del-gm-fail'));
    await expect(groupMessages.deleteGroupMessage(api, 'gm-uuid-1')).rejects.toThrow(
      'del-gm-fail',
    );
  });

  // ---- recallGroupMessage ----

  it('recallGroupMessage 正常：POST /api/group_messages/recall 带 message_uuid body', async () => {
    api.post.mockResolvedValue({ success: true, message: 'recalled' });
    const out = await groupMessages.recallGroupMessage(api, 'gm-uuid-2');
    expect(api.post).toHaveBeenCalledWith('/api/group_messages/recall', {
      message_uuid: 'gm-uuid-2',
    });
    expect(out).toEqual({ success: true, message: 'recalled' });
  });

  it('recallGroupMessage 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('recall-gm-fail'));
    await expect(groupMessages.recallGroupMessage(api, 'gm-uuid-2')).rejects.toThrow(
      'recall-gm-fail',
    );
  });
});
