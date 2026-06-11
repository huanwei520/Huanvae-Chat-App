/**
 * 黑名单管理 Hook
 *
 * 用于设置内「黑名单」页：加载已拉黑用户列表、取消拉黑。
 * 取消拉黑后同步更新好友 store 的 is_blacklisted 标记（好友列表/资料页即时反映）。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { getBlacklist, removeBlacklist, type BlacklistedUser } from '../api/friends';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { useChatStore } from '../stores';

interface UseBlacklistReturn {
  /** 黑名单列表 */
  list: BlacklistedUser[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 取消拉黑某用户 */
  remove: (userId: string) => Promise<void>;
  /** 正在取消拉黑的用户 ID（null 表示无） */
  removing: string | null;
}

export function useBlacklist(): UseBlacklistReturn {
  const api = useApi();
  const setFriendBlacklisted = useChatStore((s) => s.setFriendBlacklisted);
  const [list, setList] = useState<BlacklistedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getBlacklist(api);
      const items = (Array.isArray(resp) ? resp : []).map((u) => ({
        ...u,
        user_avatar_url: resolveServerAvatarUrl(u.user_avatar_url) || null,
      }));
      setList(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  const remove = useCallback(async (userId: string) => {
    setRemoving(userId);
    setError(null);
    try {
      await removeBlacklist(api, userId);
      setList((prev) => prev.filter((u) => u.user_id !== userId));
      // 同步好友 store：若该用户是好友，资料页/列表标记一并取消
      setFriendBlacklisted(userId, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消拉黑失败');
    } finally {
      setRemoving(null);
    }
  }, [api, setFriendBlacklisted]);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) { return; }
    initRef.current = true;
    refresh();
  }, [refresh]);

  return { list, loading, error, refresh, remove, removing };
}
