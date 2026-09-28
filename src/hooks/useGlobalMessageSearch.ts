/**
 * 全局消息搜索 Hook
 *
 * 跨会话搜索消息内容（含文件名 — 因 image/video/file 类型消息的 content 字段存的是文件名）。
 *
 * 行为：
 * - 输入 query 经 500ms 防抖
 * - **循环分页**调 db.searchMessages（单轨 LIKE + LIMIT/OFFSET）拉全量：
 *   某页返回数 < 页大小即到底。曾经是一条 LIMIT 50 截断——中文关键词在旧双轨制
 *   （FTS 优先）下本就漏检、再叠 50 条硬顶，命中列表既漏又断；现在后端单轨 LIKE
 *   修掉漏检，这里循环翻页把命中拉全，totalHits 如实交给调用方
 * - 已见 message_uuid 去重：翻页期间有新消息以更优排序键落库时，OFFSET 窗口会整体
 *   后移、页边界可能重复给同一条 —— 去重保证 totalHits 与展示不重不漏
 * - 按 conversation_id 分组返回
 * - query 为空时返回空结果，不触发 DB 调用
 * - 可选 filter 原样透传给 `db_search_messages`，让 content_type 过滤发生在 **SQL 层**
 *   （全局搜索的六分类页签用它；不传 = 不限类型，与改造前行为一致）
 *
 * 使用场景：
 * - 移动端 MobileChatList 搜索框
 * - 桌面端 Sidebar / UnifiedList 搜索框
 */

import { useEffect, useState } from 'react';
import { searchMessages, type MessageSearchFilter, type SearchMessageResult } from '../db';

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
  /** 命中总数（去重后，全量拉取的结果，不再截断成前 50 条） */
  totalHits: number;
  /** 是否触达防御性上限被截断（见 `GLOBAL_SEARCH_MAX_HITS`；正常数据量下恒为 false） */
  truncated: boolean;
}

/** 防抖延迟（ms） */
const DEBOUNCE_DELAY = 500;

/**
 * 单页拉取条数
 *
 * 导出给调用方做展示口径参考。终止条件是「某页返回数 < 页大小」，
 * 页大小越大单次查询越重、往返越少；200 对本仓消息量级是折中值。
 */
export const GLOBAL_SEARCH_PAGE_SIZE = 200;

/**
 * 防御性总量上限
 *
 * 终止条件本是「某页返回数 < 页大小」，但若后端异常（每页都恰好满页）会让循环
 * 永不终止，故设一道上限兜底；触顶时 `truncated = true`，调用方据此如实提示
 * 「未显示全部」，不假装后面没有了。
 */
export const GLOBAL_SEARCH_MAX_HITS = 10000;

export function useGlobalMessageSearch(
  query: string,
  filter?: MessageSearchFilter,
): UseGlobalMessageSearchReturn {
  const [groups, setGroups] = useState<MessageSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHits, setTotalHits] = useState(0);
  const [truncated, setTruncated] = useState(false);

  // filter 是对象：调用方若每次 render 新建一个，直接进 deps 会让 effect 每帧重跑、
  // 防抖永远等不到头。故以**序列化后的值**进 deps（内容相等即不重查），
  // 真正下发的对象在 effect 内由该 key 反解 —— 不依赖调用方记得 useMemo。
  const filterKey = JSON.stringify(filter ?? null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups([]);
      setLoading(false);
      setError(null);
      setTotalHits(0);
      setTruncated(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const activeFilter = JSON.parse(filterKey) as MessageSearchFilter | null;

    const timer = setTimeout(async () => {
      try {
        // 循环分页拉全量：某页返回数 < 页大小 = 到底了；
        // 防御上限兜住「后端每页都满页」的病理情形，防循环失控。
        const seen = new Set<string>();
        const all: SearchMessageResult[] = [];
        let hitCap = false;
        for (let offset = 0; ; offset += GLOBAL_SEARCH_PAGE_SIZE) {
          if (cancelled) {
            return;
          }
          // eslint-disable-next-line no-await-in-loop -- 串行是刻意的：分页必须按 offset 逐页拉（下一页 offset 依赖当前页是否拉满），并行无意义还打乱取消语义
          const page = await searchMessages(
            trimmed,
            GLOBAL_SEARCH_PAGE_SIZE,
            activeFilter ?? undefined,
            offset,
          );
          if (cancelled) {
            return;
          }
          for (const r of page) {
            const uuid = r.message.message_uuid;
            if (seen.has(uuid)) {
              continue;
            }
            seen.add(uuid);
            all.push(r);
          }
          if (page.length < GLOBAL_SEARCH_PAGE_SIZE) {
            break;
          }
          if (all.length >= GLOBAL_SEARCH_MAX_HITS) {
            hitCap = true;
            break;
          }
        }
        if (cancelled) {
          return;
        }

        // 按 conversation_id 分组
        const grouped = new Map<string, MessageSearchGroup>();
        for (const r of all) {
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
        setTotalHits(all.length);
        setTruncated(hitCap);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '搜索失败');
          setGroups([]);
          setTotalHits(0);
          setTruncated(false);
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
  }, [query, filterKey]);

  return { groups, loading, error, totalHits, truncated };
}
