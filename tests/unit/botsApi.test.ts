/**
 * Bot API 路径回归测试
 *
 * src/api/bots.ts 的函数都接收一个 ApiClient 并调用 .post/.get/...。
 * 这里用一个最小的 mock ApiClient 断言**请求路径字符串**精确正确——
 * 路径拼写漂移(如 reset-token 误写成 reset_token)是 vitest 能低成本拦下的
 * 一类 bug:后端路由 axum 精确匹配,连字符/下划线不符会 404。
 * 另覆盖纯函数 isBotUserId 的前缀判定边界。
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import {
  createBot,
  listMyBots,
  getBot,
  updateBot,
  deleteBot,
  resetBotToken,
  addBotByUsername,
  isBotUserId,
} from '../../src/api/bots';

/** 最小 mock ApiClient：只实现被测函数用到的方法,记录调用参数 */
function mockApi() {
  const post = vi.fn().mockResolvedValue({});
  const get = vi.fn().mockResolvedValue({});
  const put = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});
  const api = { post, get, put, delete: del } as unknown as ApiClient;
  return { api, post, get, put, del };
}

describe('bots API 请求路径', () => {
  it('createBot 提交到 /api/bots，body 原样传递', () => {
    const { api, post } = mockApi();
    const body = { username: 'my_bot', nickname: '我的机器人', description: '演示' };
    createBot(api, body);
    expect(post).toHaveBeenCalledWith('/api/bots', body);
  });

  it('resetBotToken 打后端连字符路由 /reset-token（非下划线，否则 axum 404）', () => {
    const { api, post } = mockApi();
    resetBotToken(api, 'bot_abc');
    expect(post).toHaveBeenCalledWith('/api/bots/bot_abc/reset-token', {});
  });

  it('addBotByUsername 走 POST /api/friends/add-bot?username=...，body 为 {}', () => {
    const { api, post } = mockApi();
    addBotByUsername(api, 'my_bot');
    // username 字符集 [A-Za-z0-9_] 下 encodeURIComponent 为恒等变换，路径应稳定
    expect(post).toHaveBeenCalledWith('/api/friends/add-bot?username=my_bot', {});
  });

  it('updateBot 走 PUT /api/bots/{id}，body 含 commands 数组', () => {
    const { api, put } = mockApi();
    const body = {
      nickname: '新昵称',
      commands: [{ command: 'help', description: '帮助' }],
    };
    updateBot(api, 'bot_xyz', body);
    expect(put).toHaveBeenCalledWith('/api/bots/bot_xyz', body);
  });

  it('updateBot 隐私字段（message_policy/message_whitelist/is_discoverable）body 整体原样传递', () => {
    const { api, put } = mockApi();
    const body = {
      message_policy: 'whitelist' as const,
      message_whitelist: ['u1', 'u2'],
      is_discoverable: false,
    };
    updateBot(api, 'bot_privacy', body);
    expect(put).toHaveBeenCalledWith('/api/bots/bot_privacy', {
      message_policy: 'whitelist',
      message_whitelist: ['u1', 'u2'],
      is_discoverable: false,
    });
  });

  it('deleteBot 走 DELETE /api/bots/{id}', () => {
    const { api, del } = mockApi();
    deleteBot(api, 'bot_del');
    expect(del).toHaveBeenCalledWith('/api/bots/bot_del');
  });

  it('getBot 走 GET /api/bots/{id}', () => {
    const { api, get } = mockApi();
    getBot(api, 'bot_1');
    expect(get).toHaveBeenCalledWith('/api/bots/bot_1');
  });

  it('listMyBots 走 GET /api/bots', () => {
    const { api, get } = mockApi();
    listMyBots(api);
    expect(get).toHaveBeenCalledWith('/api/bots');
  });
});

describe('isBotUserId 前缀判定', () => {
  it('bot_ 前缀的 ID 判定为 bot', () => {
    expect(isBotUserId('bot_abc123')).toBe(true);
  });

  it('普通用户 ID 判定为非 bot', () => {
    expect(isBotUserId('u_123')).toBe(false);
  });

  it('bot_ 出现在中间不算（必须是前缀）', () => {
    expect(isBotUserId('mybot_1')).toBe(false);
  });

  it('裸 "bot"（无下划线）不算', () => {
    expect(isBotUserId('bot')).toBe(false);
  });

  it('空字符串不算', () => {
    expect(isBotUserId('')).toBe(false);
  });
});
