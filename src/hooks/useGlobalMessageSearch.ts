/**
 * 全局消息搜索 Hook
 *
 * 跨会话搜索消息内容（含文件名 — 因 image/video/file 类型消息的 content 字段存的是文件名）。
 *
 * 行为：
 * - 输入 query 经 500ms 防抖
 * - 调 db.searchMessages 拿命中列表（含会话名 + 头像 + 前后上下文）
 * - 按 conversation_id 分组返回
 * - query 为空时返回空结果，不触发 DB 调用
 *
 * 使用场景：
 * - 移动端 MobileChatList 搜索框
 * - 桌面端 Sidebar / UnifiedList 搜索框
 */

import { useEffect, useState } from 'react';
import { searchMessages, type SearchMessageResult } from '../db';

/** 按会话分组后的搜索结果 */
export interface MessageSearchGroup {
  /** 会话 ID */
  conversationId: string;
  /** 会话类型（friend / group） */
  conversationType: 'friend' | 'group';
  /** 会话名 */
  conversationName: string;
  /** 会话头像 */
  conversationAvatar: string | null;
  /** 该会话内的命中消息列表（按 send_time DESC） */
  hits: SearchMessageResult[];
}

interface UseGlobalMessageSearchReturn {
  /** 按会话分组的命中结果 */
  groups: MessageSearchGroup[];
  /** 是否正在搜索（含防抖等待 + DB 查询） */
  loading: boolean;
  /** 搜索错误 */
  error: string | null;
}

/** 防抖延迟（ms） */
const DEBOUNCE_DELAY = 500;
/** 单次搜索返回的最大命中数 */
const SEARCH_LIMIT = 50;

export function useGlobalMessageSearch(query: string): UseGlobalMessageSearchReturn {
  const [groups, setGroups] = useState<MessageSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const results = await searchMessages(trimmed, SEARCH_LIMIT);
        if (cancelled) { return; }

        // 按 conversation_id 分组
        const grouped = new Map<string, MessageSearchGroup>();
        for (const r of results) {
          const cid = r.message.conversation_id;
          let group = grouped.get(cid);
          if (!group) {
            group = {
              conversationId: cid,
              conversationType: r.message.conversation_type as 'friend' | 'group',
              conversationName: r.conversation_name,
              conversationAvatar: r.conversation_avatar,
              hits: [],
            };
            grouped.set(cid, group);
          }
          group.hits.push(r);
        }

        setGroups(Array.from(grouped.values()));
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '搜索失败');
          setGroups([]);
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
  }, [query]);

  return { groups, loading, error };
}
