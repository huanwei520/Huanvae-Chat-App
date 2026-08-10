/**
 * 会话内消息查找 Hook（Telegram 式：先列出，再按关键词收窄）
 *
 * 在**单个会话**（好友私聊 / bot / 群聊，三者本地库同构）内按分类浏览消息，关键词可选。
 *
 * ## 与全局搜索（useGlobalMessageSearch）的区别
 * - 结果**平铺**（同一会话内无需再按会话分组）
 * - 多一层 content_type 分类过滤，且过滤在 **SQL 层**做（见 messageCategory.ts 注释）
 * - **关键词不是必填**：点「全部 / 图片 / 视频 / 文件」任一分类即按时间倒序列出该类全部，
 *   输入关键词只是在同一分类结果里再收窄
 *
 * ## 为什么必须分页，而不是一次取回
 * 一个会话的消息可以是几万条，「全部」分类一次性取回既拖垮 DB 调用也让 React 渲染
 * 上万个节点。故走 `limit/offset` 分页：首屏一页，滚到底 / 点「加载更多」再取下一页。
 * `hasMore` 的判据是**本页拿满了 PAGE_SIZE**（拿不满 = 已到底），不额外查一次 count。
 *
 * ## 竞态
 * 会话 / 关键词 / 分类三者任一变化都会重查；用自增 requestId 作 token，只有最后一次
 * 请求的响应能写状态 —— 单纯的 `cancelled` 布尔在「首屏与 loadMore 并发」时不够用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listConversationMessages, type LocalMessage } from '../../db';
import { categoryToSearchFilter, type MessageCategory } from './messageCategory';

/** 关键词防抖延迟（ms，与全局搜索一致） */
const DEBOUNCE_DELAY = 500;

/** 每页条数 */
export const CONVERSATION_PAGE_SIZE = 30;

interface UseConversationMessageSearchReturn {
  /** 当前已加载的消息（按 send_time DESC） */
  items: LocalMessage[];
  /** 首屏加载中（含防抖等待窗）—— 列表整体处于「还没有内容」状态 */
  loading: boolean;
  /** 追加下一页中 */
  loadingMore: boolean;
  /** 出错信息 */
  error: string | null;
  /** 是否还有下一页 */
  hasMore: boolean;
  /** 追加下一页（已在加载 / 已到底时为空操作） */
  loadMore: () => void;
}

export function useConversationMessageSearch(
  conversationId: string | null,
  query: string,
  category: MessageCategory,
): UseConversationMessageSearchReturn {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<LocalMessage[]>([]);
  // 初值就是 true：首屏查询在 mount effect 里发起，而 useEffect 排在绘制之后 ——
  // 初值给 false 会让「该分类暂无内容」的空态先闪一帧再被结果替换
  const [loading, setLoading] = useState(() => conversationId !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  /** 请求令牌：只有最后一次发出的请求能写状态 */
  const requestIdRef = useRef(0);
  /** loadMore 读它算 offset，避免把 items 塞进 useCallback 依赖导致回调每次变 */
  const itemsRef = useRef<LocalMessage[]>([]);
  itemsRef.current = items;

  // 第一段：关键词防抖（只跟 query 走，切分类不重置计时）
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // 清空关键词 = 回到「按分类列全部」的浏览态，无需等防抖
      setDebouncedQuery('');
      return undefined;
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  // 第二段：取首屏（会话 / 关键词 / 分类任一变化即重来，页码归零）
  useEffect(() => {
    if (!conversationId) {
      setItems([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);

    listConversationMessages({
      conversationId,
      query: debouncedQuery || undefined,
      limit: CONVERSATION_PAGE_SIZE,
      offset: 0,
      filter: categoryToSearchFilter(category),
    })
      .then((rows) => {
        if (requestIdRef.current !== requestId) { return; }
        setItems(rows);
        setHasMore(rows.length === CONVERSATION_PAGE_SIZE);
        setError(null);
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) { return; }
        setError(e instanceof Error ? e.message : '查找失败');
        setItems([]);
        setHasMore(false);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) { setLoading(false); }
      });

    return undefined;
  }, [conversationId, debouncedQuery, category]);

  const loadMore = useCallback(() => {
    if (!conversationId || !hasMore || loading || loadingMore) { return; }

    const requestId = ++requestIdRef.current;
    setLoadingMore(true);

    listConversationMessages({
      conversationId,
      query: debouncedQuery || undefined,
      limit: CONVERSATION_PAGE_SIZE,
      offset: itemsRef.current.length,
      filter: categoryToSearchFilter(category),
    })
      .then((rows) => {
        if (requestIdRef.current !== requestId) { return; }
        setItems((prev) => [...prev, ...rows]);
        setHasMore(rows.length === CONVERSATION_PAGE_SIZE);
        setError(null);
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) { return; }
        setError(e instanceof Error ? e.message : '加载更多失败');
        setHasMore(false);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) { setLoadingMore(false); }
      });
  }, [conversationId, debouncedQuery, category, hasMore, loading, loadingMore]);

  return { items, loading, loadingMore, error, hasMore, loadMore };
}
