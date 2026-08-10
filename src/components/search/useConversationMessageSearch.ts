/**
 * 会话内消息搜索 Hook
 *
 * 在**单个会话**（好友私聊 / bot / 群聊，三者本地库同构）内按关键词 + 分类搜消息。
 * 与全局搜索（useGlobalMessageSearch，跨会话 + 按会话分组）的区别：
 * - 结果是**平铺**的（同一会话内无需再分组）
 * - 多一层 content_type 分类过滤，且过滤在 **SQL 层**做（见 messageCategory.ts 注释）
 *
 * 行为：
 * - query 经 500ms 防抖（与全局搜索一致）
 * - 切换分类页签**不再等防抖**（关键词没变，只是换过滤条件）
 * - query 为空 / conversationId 为空时返回空结果，不触发 DB 调用
 */

import { useEffect, useState } from 'react';
import { searchMessages, type SearchMessageResult } from '../../db';
import { categoryToSearchFilter, type MessageCategory } from './messageCategory';

/** 关键词防抖延迟（ms） */
const DEBOUNCE_DELAY = 500;
/** 单次搜索返回的最大命中数 */
export const CONVERSATION_SEARCH_LIMIT = 100;

interface UseConversationMessageSearchReturn {
  /** 命中列表（按 send_time DESC） */
  hits: SearchMessageResult[];
  /** 是否正在搜索（含防抖等待 + DB 查询） */
  loading: boolean;
  /** 搜索错误 */
  error: string | null;
}

export function useConversationMessageSearch(
  conversationId: string | null,
  query: string,
  category: MessageCategory,
): UseConversationMessageSearchReturn {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [hits, setHits] = useState<SearchMessageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 第一段：关键词防抖（只跟 query 走，切分类不重置计时）
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  // 第二段：真正查库（关键词 / 分类 / 会话任一变化即重查）
  useEffect(() => {
    if (!debouncedQuery || !conversationId) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    let cancelled = false;

    searchMessages(debouncedQuery, CONVERSATION_SEARCH_LIMIT, {
      conversation_id: conversationId,
      ...categoryToSearchFilter(category),
    })
      .then((results) => {
        if (cancelled) { return; }
        setHits(results);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) { return; }
        setError(e instanceof Error ? e.message : '搜索失败');
        setHits([]);
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, debouncedQuery, category]);

  return { hits, loading, error };
}
