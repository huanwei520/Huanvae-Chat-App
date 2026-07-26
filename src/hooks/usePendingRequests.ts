/**
 * 待通过申请管理 Hook（桌面 PendingRequestsPanel / 移动 MobileAddPage 共用）
 *
 * 挂载即并行加载四类（收到的好友申请 / 收到的群邀请 / 我发出的好友申请 / 我发出的加群申请），
 * 经 buildPendingItems 合并成单一时间倒序列表；对外暴露 同意/拒绝/接受/拒绝邀请 四个动作
 * （动作成功即从列表移除该行）。合并 + 加载纯逻辑在 pendingRequests.ts。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApi, useSession } from '../contexts/SessionContext';
import { approveFriendRequest, rejectFriendRequest, type PendingRequest } from '../api/friends';
import {
  acceptGroupInvitation,
  declineGroupInvitation,
  type GroupInvitation,
  type Group,
} from '../api/groups';
import { resolveServerAvatarUrl } from '../utils/avatar';
import {
  buildPendingItems,
  loadPendingSources,
  type PendingItem,
  type PendingSources,
} from '../components/unified/pendingRequests';

interface UsePendingRequestsOptions {
  /** 通过一条好友申请后刷新好友列表 */
  onFriendAdded?: () => void;
  /** 接受一条群邀请后增量添加群 */
  addGroup?: (group: Group) => void;
}

interface UsePendingRequestsReturn {
  /** 四类合并后的单一时间倒序列表 */
  items: PendingItem[];
  loading: boolean;
  /** 操作错误（3s 自动清除） */
  error: string | null;
  approveFriend: (r: PendingRequest) => Promise<void>;
  rejectFriend: (r: PendingRequest) => Promise<void>;
  acceptInvite: (inv: GroupInvitation) => Promise<void>;
  declineInvite: (inv: GroupInvitation) => Promise<void>;
}

const EMPTY_SOURCES: PendingSources = {
  friendRequests: [],
  groupInvites: [],
  sentFriendReqs: [],
  sentJoinReqs: [],
};

export function usePendingRequests(
  { onFriendAdded, addGroup }: UsePendingRequestsOptions = {},
): UsePendingRequestsReturn {
  const api = useApi();
  const { session } = useSession();

  const [sources, setSources] = useState<PendingSources>(EMPTY_SOURCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setSources(await loadPendingSources(api));
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 操作错误 3s 自动清除
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const items = useMemo(() => buildPendingItems(sources), [sources]);

  const approveFriend = useCallback(
    async (r: PendingRequest) => {
      if (!session) {
        return;
      }
      try {
        await approveFriendRequest(api, session.userId, r.request_user_id);
        setSources((prev) => ({
          ...prev,
          friendRequests: prev.friendRequests.filter((x) => x.request_id !== r.request_id),
        }));
        onFriendAdded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [api, session, onFriendAdded],
  );

  const rejectFriend = useCallback(
    async (r: PendingRequest) => {
      if (!session) {
        return;
      }
      try {
        await rejectFriendRequest(api, session.userId, r.request_user_id);
        setSources((prev) => ({
          ...prev,
          friendRequests: prev.friendRequests.filter((x) => x.request_id !== r.request_id),
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [api, session],
  );

  const acceptInvite = useCallback(
    async (inv: GroupInvitation) => {
      try {
        await acceptGroupInvitation(api, inv.request_id);
        setSources((prev) => ({
          ...prev,
          groupInvites: prev.groupInvites.filter((x) => x.request_id !== inv.request_id),
        }));
        addGroup?.({
          group_id: inv.group_id,
          group_name: inv.group_name,
          group_avatar_url: resolveServerAvatarUrl(inv.group_avatar_url) || '',
          role: 'member',
          unread_count: 0,
          last_message_content: null,
          last_message_time: null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [api, addGroup],
  );

  const declineInvite = useCallback(
    async (inv: GroupInvitation) => {
      try {
        await declineGroupInvitation(api, inv.request_id);
        setSources((prev) => ({
          ...prev,
          groupInvites: prev.groupInvites.filter((x) => x.request_id !== inv.request_id),
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [api],
  );

  return { items, loading, error, approveFriend, rejectFriend, acceptInvite, declineInvite };
}
