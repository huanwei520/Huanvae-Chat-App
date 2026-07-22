/**
 * Bot 指令缓存 Store (botCommandsStore) 测试
 *
 * 覆盖 fetch 的两条分支（getBotCommands mock）：
 * - 成功：把 res.commands 存入 commandsByBot[botUserId]
 * - 失败（含 404 同形隐私语义）：存空数组、不上抛
 * 以及 clear 清空。
 *
 * getBotCommands 经 vi.hoisted + vi.mock 替换（vi.mock 被提升到 import 之上，
 * 工厂引用的外层变量必须用 vi.hoisted 同步提升）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';

const botsMock = vi.hoisted(() => ({ getBotCommands: vi.fn() }));
vi.mock('../../src/api/bots', () => botsMock);

import { useBotCommandsStore } from '../../src/stores/botCommandsStore';

/** getBotCommands 已被 mock，api 不会被真实使用 */
const api = {} as ApiClient;

beforeEach(() => {
  useBotCommandsStore.getState().clear();
  botsMock.getBotCommands.mockReset();
});

describe('botCommandsStore.fetch', () => {
  it('成功：把 res.commands 存入 commandsByBot[botUserId]', async () => {
    const commands = [{ command: 'status', description: '状态' }];
    botsMock.getBotCommands.mockResolvedValue({ commands });

    await useBotCommandsStore.getState().fetch(api, 'bot_1');

    expect(useBotCommandsStore.getState().commandsByBot['bot_1']).toEqual(commands);
  });

  it('失败（404 同形/拒绝）：存空数组、不上抛', async () => {
    botsMock.getBotCommands.mockRejectedValue(new Error('404'));

    await useBotCommandsStore.getState().fetch(api, 'bot_2');

    expect(useBotCommandsStore.getState().commandsByBot['bot_2']).toEqual([]);
  });
});

describe('botCommandsStore.clear', () => {
  it('清空 commandsByBot', async () => {
    botsMock.getBotCommands.mockResolvedValue({
      commands: [{ command: 'help', description: '帮助' }],
    });
    await useBotCommandsStore.getState().fetch(api, 'bot_1');
    expect(Object.keys(useBotCommandsStore.getState().commandsByBot).length).toBe(1);

    useBotCommandsStore.getState().clear();
    expect(useBotCommandsStore.getState().commandsByBot).toEqual({});
  });
});
