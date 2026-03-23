/**
 * 小程序管理 Hook
 *
 * 管理小程序列表、CRUD、发布、容器操作的状态
 *
 * 模式参考 useFiles 的扁平 useState 模式（小程序数据无需持久化到本地数据库）
 *
 * 提供两个视图：
 * - explore：浏览已发布的公共小程序
 * - mine：管理自己创建的小程序
 */

import { useState, useCallback, useEffect } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  listPublishedMiniApps,
  listMyMiniApps,
  createMiniApp,
  updateMiniApp,
  deleteMiniApp,
  publishMiniApp,
  unpublishMiniApp,
  startContainer,
  stopContainer,
  restartContainer,
  getContainerInfo,
  resetSSHPassword,
  type MiniApp,
  type MiniAppStatus,
  type CreateMiniAppRequest,
  type UpdateMiniAppRequest,
  type CreateMiniAppResponse,
  type MiniAppContainer,
} from '../api/miniapps';

export type MiniAppTab = 'explore' | 'mine';

interface UseMiniAppsReturn {
  /** 当前 tab */
  tab: MiniAppTab;
  /** 切换 tab */
  setTab: (tab: MiniAppTab) => void;
  /** 当前展示的列表 */
  apps: MiniApp[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 搜索关键词 */
  searchQuery: string;
  /** 设置搜索关键词 */
  setSearchQuery: (q: string) => void;
  /** 刷新当前列表 */
  refresh: () => Promise<void>;

  /** 创建小程序 */
  create: (data: CreateMiniAppRequest) => Promise<CreateMiniAppResponse | null>;
  /** 更新小程序 */
  update: (id: string, data: UpdateMiniAppRequest) => Promise<boolean>;
  /** 删除小程序 */
  remove: (id: string) => Promise<boolean>;
  /** 发布 */
  publish: (id: string) => Promise<boolean>;
  /** 取消发布 */
  unpublish: (id: string) => Promise<boolean>;
  /** 启动容器 */
  start: (id: string) => Promise<boolean>;
  /** 停止容器 */
  stop: (id: string) => Promise<boolean>;
  /** 重启容器 */
  restart: (id: string) => Promise<boolean>;
  /** 获取容器信息 */
  containerInfo: (id: string) => Promise<MiniAppContainer | null>;
  /** 重置 SSH 密码 */
  resetPassword: (id: string) => Promise<string | null>;

  /** 操作中的 app id（用于按钮 loading 态） */
  operatingId: string | null;
}

export function useMiniApps(): UseMiniAppsReturn {
  const api = useApi();

  const [tab, setTabRaw] = useState<MiniAppTab>('explore');
  const [publishedApps, setPublishedApps] = useState<MiniApp[]>([]);
  const [myApps, setMyApps] = useState<MiniApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPublishedMiniApps(api);
      setPublishedApps(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载已发布小程序失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMyMiniApps(api);
      setMyApps(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载我的小程序失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  const refresh = useCallback(async () => {
    if (tab === 'explore') {
      await loadPublished();
    } else {
      await loadMine();
    }
  }, [tab, loadPublished, loadMine]);

  const setTab = useCallback(
    (t: MiniAppTab) => {
      setTabRaw(t);
      setSearchQuery('');
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredApps = (tab === 'explore' ? publishedApps : myApps).filter(
    (app) => {
      if (!searchQuery) {
        return true;
      }
      const q = searchQuery.toLowerCase();
      return (
        app.display_name.toLowerCase().includes(q) ||
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q)
      );
    },
  );

  const withOp = useCallback(
    async <T>(id: string, fn: () => Promise<T>): Promise<T | null> => {
      setOperatingId(id);
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (data: CreateMiniAppRequest) => {
      setOperatingId('__creating__');
      try {
        const result = await createMiniApp(api, data);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '创建失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api, refresh],
  );

  const update = useCallback(
    async (id: string, data: UpdateMiniAppRequest) => {
      const r = await withOp(id, () => updateMiniApp(api, id, data));
      return r !== null;
    },
    [api, withOp],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => deleteMiniApp(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const publish = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => publishMiniApp(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const unpublishFn = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => unpublishMiniApp(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const start = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => startContainer(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const stop = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => stopContainer(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const restart = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => restartContainer(api, id));
      return r !== null;
    },
    [api, withOp],
  );

  const containerInfoFn = useCallback(
    (id: string) => {
      return withOp(id, () => getContainerInfo(api, id));
    },
    [api, withOp],
  );

  const resetPasswordFn = useCallback(
    async (id: string) => {
      const r = await withOp(id, () => resetSSHPassword(api, id));
      return r ? r.new_password : null;
    },
    [api, withOp],
  );

  return {
    tab,
    setTab,
    apps: filteredApps,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    refresh,
    create,
    update,
    remove,
    publish,
    unpublish: unpublishFn,
    start,
    stop,
    restart,
    containerInfo: containerInfoFn,
    resetPassword: resetPasswordFn,
    operatingId,
  };
}

export type { MiniApp, MiniAppStatus, CreateMiniAppRequest, CreateMiniAppResponse, MiniAppContainer };
