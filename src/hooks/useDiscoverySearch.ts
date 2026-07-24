/**
 * 服务端发现搜索 Hook
 *
 * 调后端统一发现接口，一次搜出「人 / 群 / bot」三类结果。
 *
 * 行为：
 * - 输入 query 经 500ms 防抖
 * - 调 searchDiscovery(api, keyword)（不传 limit，服务端默认每类 20 条）
 * - 头像在数据边界解析：webview 的 <img> 用系统信任验不过私有 CA 自签 leaf，
 *   故在此处经 resolveServerAvatarUrl 收口成可显示 URL，显示点只消费已解析值
 *   （与 useFriends / useGroups 构建对象时解析头像同理）
 * - query 去空后为空时返回空结果，不触发 API 调用
 *
 * 与本地 useGlobalMessageSearch 互补：
 * - 本地 useGlobalMessageSearch 搜「会话 / 聊天记录 / 文件名」（走 SQLite）
 * - 本 hook 搜「服务端发现的人 / 群 / bot」（走后端 /api/discovery/search）
 * 两者独立降级：本 hook 出错只影响发现结果，本地搜索不受影响。
 */

import { useEffect, useState } from 'react';
import { searchDiscovery } from '../api/discovery';
import { useApi } from '../contexts/SessionContext';
import { resolveServerAvatarUrl } from '../utils/avatar';

/** 发现搜索命中的普通用户视图模型（头像已解析） */
export interface DiscoveryPerson {
  userId: string;
  nickname: string;
  /** 已经 resolveServerAvatarUrl 收口的可显示头像 URL；无头像为 null */
  avatarUrl: string | null;
  isFriend: boolean;
}

/** 发现搜索命中的群视图模型（头像已解析） */
export interface DiscoveryGroup {
  groupId: string;
  groupName: string;
  /** 已经 resolveServerAvatarUrl 收口的可显示头像 URL；无头像为 null */
  avatarUrl: string | null;
  memberCount: number;
  joinMode: string;
  isMember: boolean;
}

/** 发现搜索命中的 bot 视图模型（头像已解析） */
export interface DiscoveryBot {
  botUserId: string;
  username: string;
  nickname: string;
  /** 已经 resolveServerAvatarUrl 收口的可显示头像 URL；无头像为 null */
  avatarUrl: string | null;
  isFriend: boolean;
}

interface UseDiscoverySearchReturn {
  people: DiscoveryPerson[];
  groups: DiscoveryGroup[];
  bots: DiscoveryBot[];
  /** 是否正在搜索（含防抖等待 + 请求） */
  loading: boolean;
  /** 搜索错误 */
  error: string | null;
}

/** 防抖延迟（ms） */
const DEBOUNCE_DELAY = 500;

export function useDiscoverySearch(query: string): UseDiscoverySearchReturn {
  const api = useApi();
  const [people, setPeople] = useState<DiscoveryPerson[]>([]);
  const [groups, setGroups] = useState<DiscoveryGroup[]>([]);
  const [bots, setBots] = useState<DiscoveryBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPeople([]);
      setGroups([]);
      setBots([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const results = await searchDiscovery(api, trimmed);
        if (cancelled) { return; }

        // 数据边界解析头像：显示点只消费已解析的 avatarUrl
        setPeople(results.people.map((card) => ({
          userId: card.user_id,
          nickname: card.nickname,
          avatarUrl: resolveServerAvatarUrl(card.avatar_url),
          isFriend: card.is_friend,
        })));
        setGroups(results.groups.map((card) => ({
          groupId: card.group_id,
          groupName: card.group_name,
          avatarUrl: resolveServerAvatarUrl(card.avatar_url),
          memberCount: card.member_count,
          joinMode: card.join_mode,
          isMember: card.is_member,
        })));
        setBots(results.bots.map((card) => ({
          botUserId: card.bot_user_id,
          username: card.username,
          nickname: card.nickname,
          avatarUrl: resolveServerAvatarUrl(card.avatar_url),
          isFriend: card.is_friend,
        })));
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '搜索失败');
          setPeople([]);
          setGroups([]);
          setBots([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  return { people, groups, bots, loading, error };
}
