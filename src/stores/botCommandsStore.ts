/**
 * Bot 指令缓存 Store (Zustand)
 *
 * 进 bot 会话时拉取该 bot 的命令集（getBotCommands / N1 只读端点），按 bot_user_id 分桶。
 * 供斜杠命令面板消费；命令文案是服务端下发数据，前端只渲染。
 */

import { create } from 'zustand';
import type { BotCommand } from '../api/bots';
import { getBotCommands } from '../api/bots';
import type { ApiClient } from '../api/client';

interface BotCommandsState {
  /** 各 bot 的命令集，key = bot_user_id */
  commandsByBot: Record<string, BotCommand[]>;
}

interface BotCommandsActions {
  /**
   * 拉取并缓存某 bot 的命令集。
   * 失败（含 404 同形：无权限/不存在）视为"无可见命令" → 存空数组、不上抛：
   * 命令面板据此不弹（与设计的 404 同形隐私语义一致，非静默吞真错）。
   */
  fetch: (api: ApiClient, botUserId: string) => Promise<void>;
  /** 全部清空（登出/切账号） */
  clear: () => void;
}

export type BotCommandsStore = BotCommandsState & BotCommandsActions;

export const useBotCommandsStore = create<BotCommandsStore>((set) => ({
  commandsByBot: {},

  fetch: async (api, botUserId) => {
    try {
      const res = await getBotCommands(api, botUserId);
      set((state) => ({ commandsByBot: { ...state.commandsByBot, [botUserId]: res.commands } }));
    } catch {
      set((state) => ({ commandsByBot: { ...state.commandsByBot, [botUserId]: [] } }));
    }
  },

  clear: () => set({ commandsByBot: {} }),
}));
