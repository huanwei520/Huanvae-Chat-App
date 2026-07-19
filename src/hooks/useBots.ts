/**
 * 机器人管理 Hook
 *
 * 管理"我的 bot"列表、创建/删除/重置 token、按 username 加 bot 好友的状态。
 * 模式镜像 useMiniApps 的扁平 useState + withOp 约定（错误进 error state，操作返回 null 表失败）。
 *
 * token 语义：create / resetToken 的返回值含明文 token，仅此一次可见 ——
 * 调用方（BotsModal / MobileBotsPage）只把它放进 SecretDisplay 展示态，关闭即清空，不落盘不打日志。
 */

import { useState, useCallback, useEffect } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  createBot,
  listMyBots,
  updateBot,
  deleteBot,
  resetBotToken,
  addBotByUsername,
  type BotInfo,
  type CreateBotRequest,
  type UpdateBotRequest,
  type CreateBotResponse,
  type AddBotResponse,
} from '../api/bots';

interface UseBotsReturn {
  /** 我的 bot 列表 */
  bots: BotInfo[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息（列表加载失败 / 操作失败的后端 message） */
  error: string | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 创建 bot；成功返回含明文 token 的响应（仅此一次），失败返回 null 并置 error */
  create: (data: CreateBotRequest) => Promise<CreateBotResponse | null>;
  /** 更新 bot（含隐私字段）；成功返回更新后的 BotInfo 并刷新列表，失败返回 null 并置 error */
  update: (botUserId: string, data: UpdateBotRequest) => Promise<BotInfo | null>;
  /** 删除 bot（token 与加好友入口即刻失效） */
  remove: (botUserId: string) => Promise<boolean>;
  /** 重置 token；成功返回新明文 token（仅此一次），失败返回 null 并置 error */
  resetToken: (botUserId: string) => Promise<string | null>;
  /** 按 username 添加 bot 好友（恒 auto_accept）；失败返回 null 并置 error */
  addByUsername: (username: string) => Promise<AddBotResponse | null>;
  /** 操作中的 bot id（'__creating__' / '__adding__' / bot_user_id，用于按钮 loading 态） */
  operatingId: string | null;
}

export function useBots(): UseBotsReturn {
  const api = useApi();

  const [bots, setBots] = useState<BotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMyBots(api);
      setBots(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载机器人列表失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (data: CreateBotRequest) => {
      setOperatingId('__creating__');
      setError(null);
      try {
        const result = await createBot(api, data);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '创建机器人失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api, refresh],
  );

  const update = useCallback(
    async (botUserId: string, data: UpdateBotRequest) => {
      setOperatingId(botUserId);
      setError(null);
      try {
        const result = await updateBot(api, botUserId, data);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新机器人失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (botUserId: string) => {
      setOperatingId(botUserId);
      setError(null);
      try {
        await deleteBot(api, botUserId);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除机器人失败');
        return false;
      } finally {
        setOperatingId(null);
      }
    },
    [api, refresh],
  );

  const resetToken = useCallback(
    async (botUserId: string) => {
      setOperatingId(botUserId);
      setError(null);
      try {
        const result = await resetBotToken(api, botUserId);
        return result.token;
      } catch (e) {
        setError(e instanceof Error ? e.message : '重置 Token 失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api],
  );

  const addByUsername = useCallback(
    async (username: string) => {
      setOperatingId('__adding__');
      setError(null);
      try {
        return await addBotByUsername(api, username);
      } catch (e) {
        setError(e instanceof Error ? e.message : '添加机器人好友失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api],
  );

  return {
    bots,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    resetToken,
    addByUsername,
    operatingId,
  };
}
