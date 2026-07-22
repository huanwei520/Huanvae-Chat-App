/**
 * 顶置架（Conversation Shelf）API 路径回归测试
 *
 * src/api/shelf.ts 的函数都接收一个 ApiClient 并调用 .get/.post/.delete/.patch。
 * 这里用一个最小的 mock ApiClient 断言**请求路径字符串 + body** 精确正确——
 * 路径由 shelfBase(scope, scopeKey) 拼接，scope/scopeKey 都过 encodeURIComponent。
 * scopeKey 里的冒号（bot 会话 = "{userId}:{botUserId}"）必须被编码成 %3A，
 * 否则 axum 路由段解析会歧义。这类漂移 vitest 能低成本拦下。
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import {
  getShelf,
  pinToShelf,
  unpinFromShelf,
  reorderShelf,
} from '../../src/api/shelf';

/** 最小 mock ApiClient：只实现被测函数用到的方法，记录调用参数 */
function mockApi() {
  const get = vi.fn().mockResolvedValue({});
  const post = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});
  const patch = vi.fn().mockResolvedValue({});
  const api = { get, post, delete: del, patch } as unknown as ApiClient;
  return { api, get, post, del, patch };
}

describe('shelf API 请求路径', () => {
  it('getShelf(bot): scopeKey 内冒号必须 percent-encode 成 %3A', () => {
    const { api, get } = mockApi();
    getShelf(api, 'bot', 'u1:bot_x');
    expect(get).toHaveBeenCalledWith('/api/conversations/bot/u1%3Abot_x/shelf');
  });

  it('getShelf(group): 无特殊字符的 scopeKey 路径稳定', () => {
    const { api, get } = mockApi();
    getShelf(api, 'group', 'g1');
    expect(get).toHaveBeenCalledWith('/api/conversations/group/g1/shelf');
  });

  it('pinToShelf 不带 note 时 body.note 补 null', () => {
    const { api, post } = mockApi();
    pinToShelf(api, 'group', 'g1', { message_uuid: 'm1' });
    expect(post).toHaveBeenCalledWith('/api/conversations/group/g1/shelf', {
      message_uuid: 'm1',
      note: null,
    });
  });

  it('pinToShelf 带 note 时原样透传（不被 null 覆盖）', () => {
    const { api, post } = mockApi();
    pinToShelf(api, 'group', 'g1', { message_uuid: 'm1', note: '进度' });
    expect(post).toHaveBeenCalledWith('/api/conversations/group/g1/shelf', {
      message_uuid: 'm1',
      note: '进度',
    });
  });

  it('unpinFromShelf 走 DELETE .../shelf/{itemId}', () => {
    const { api, del } = mockApi();
    unpinFromShelf(api, 'group', 'g1', 'item1');
    expect(del).toHaveBeenCalledWith('/api/conversations/group/g1/shelf/item1');
  });

  it('reorderShelf 走 PATCH .../shelf/order，body = { ordered_item_ids }', () => {
    const { api, patch } = mockApi();
    reorderShelf(api, 'group', 'g1', ['a', 'b']);
    expect(patch).toHaveBeenCalledWith('/api/conversations/group/g1/shelf/order', {
      ordered_item_ids: ['a', 'b'],
    });
  });
});
