/**
 * 会话内消息查找面板（桌面 ChatPanel + 移动 MobileChatView 共用）
 *
 * 覆盖三种会话：好友私聊 / bot / 群聊（本地库同构，只是 conversation_id 不同来源）；
 * AI 会话不落本地 messages 表，故调用方不挂载本面板。
 *
 * 结构：搜索框 → 四类 + 全部页签 → 结果计数 → 平铺命中列表。
 * 分类过滤在 SQL 层做（见 messageCategory.ts），因此每个页签都是该分类下的完整前 N 条，
 * 不会出现"文字命中太多把图片挤没"的问题。
 *
 * 点击命中 → 写 chatStore.pendingScrollToMessageId，复用**全仓唯一那条**消息定位通路
 * （useMainPage 的定位 effect：补历史直到目标进窗口 → `scrollMessageIntoView` 手动改
 * 目标容器自己的 scrollTop → 高亮 → 失败写 messageJumpNotice）。
 * 🔴 定位**绝不用 `scrollIntoView`**：它沿祖先链冒泡，会把整个 App 外壳一起顶上去
 * （见 src/chat/shared/scrollMessageIntoView.ts 与 .claude/rules/common.md 同名条目）。
 * 也刻意**不另起**第二套滚动机制——群聊回复引用点击已立过同样的规矩。
 *
 * 挂载位置刻意在顶栏与消息列表**之间**（flex 兄弟节点），不是浮在
 * `.chat-messages-container`（overflow:auto）里——绝对定位浮层会锚到内容顶而非视口顶，
 * 用户滚到下面时就看不见了（见 .claude/rules/common.md 同名条目）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatMessageTime } from '../../utils/time';
import { useChatStore } from '../../stores';
import type { SearchMessageResult } from '../../db';
import { highlightMatch } from './highlightMatch';
import {
  MESSAGE_CATEGORY_TABS,
  contentTypeBadge,
  type MessageCategory,
} from './messageCategory';
import { useConversationMessageSearch } from './useConversationMessageSearch';

/** 面板展开/收起：桌面与移动同款（从顶栏下沿向下展开） */
const panelVariants = {
  initial: { height: 0, opacity: 0 },
  animate: {
    height: 'auto' as const,
    opacity: 1,
    transition: { type: 'spring' as const, damping: 26, stiffness: 300 },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

interface ConversationMessageSearchProps {
  /** 当前会话 ID（好友：conv-{a}-{b}；群：group_id） */
  conversationId: string;
  /** 关闭面板 */
  onClose: () => void;
  /** 布局（仅影响尺寸，样式在 search.css 里区分） */
  layout?: 'desktop' | 'mobile';
}

export function ConversationMessageSearch({
  conversationId,
  onClose,
  layout = 'desktop',
}: ConversationMessageSearchProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MessageCategory>('all');
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);

  const { hits, loading, error } = useConversationMessageSearch(conversationId, query, category);

  // 展开即聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (hit: SearchMessageResult) => {
      const uuid = hit.message.message_uuid;
      setActiveUuid(uuid);
      // 交给全仓唯一那条定位通路（补历史 → scrollMessageIntoView 手动 scrollTop → 高亮 /
      // 失败提示），不在此另起第二套滚动机制
      setPendingScrollToMessageId(uuid);
    },
    [setPendingScrollToMessageId],
  );

  const hasQuery = query.trim().length > 0;
  const isEmpty = hasQuery && !loading && !error && hits.length === 0;

  return (
    <motion.div
      className={`conv-msg-search conv-msg-search--${layout}`}
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="conv-msg-search-inner">
        <div className="conv-msg-search-bar">
          <svg
            className="conv-msg-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className="conv-msg-search-input"
            type="text"
            value={query}
            placeholder="在当前会话中查找消息"
            aria-label="在当前会话中查找消息"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <button
            type="button"
            className="conv-msg-search-close"
            onClick={onClose}
            aria-label="关闭会话内查找"
            title="关闭"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="conv-msg-search-tabs" role="tablist" aria-label="消息类型">
          {MESSAGE_CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={category === tab.key}
              className={`conv-msg-search-tab${category === tab.key ? ' conv-msg-search-tab--active' : ''}`}
              onClick={() => setCategory(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="conv-msg-search-status">
            <LoadingSpinner />
            <span>查找中...</span>
          </div>
        )}
        {!loading && error && (
          <div className="conv-msg-search-status conv-msg-search-status--error">{error}</div>
        )}
        {!loading && !error && hits.length > 0 && (
          <div className="conv-msg-search-count">{hits.length} 条结果</div>
        )}
        {isEmpty && (
          <div className="conv-msg-search-status">未找到包含「{query.trim()}」的消息</div>
        )}

        {!loading && !error && hits.length > 0 && (
          <ul className="conv-msg-search-list">
            {hits.map((hit) => {
              const badge = contentTypeBadge(hit.message.content_type);
              const isActive = activeUuid === hit.message.message_uuid;
              return (
                <li
                  key={hit.message.message_uuid}
                  className={`conv-msg-search-hit${isActive ? ' conv-msg-search-hit--active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(hit)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(hit);
                    }
                  }}
                >
                  <div className="conv-msg-search-hit-meta">
                    <span className="conv-msg-search-hit-sender">
                      {hit.message.sender_name ?? hit.message.sender_id}
                    </span>
                    <span className="conv-msg-search-hit-time">
                      {formatMessageTime(hit.message.send_time)}
                    </span>
                    {badge && <span className="conv-msg-search-hit-badge">{badge}</span>}
                  </div>
                  <div className="conv-msg-search-hit-content">
                    {highlightMatch(hit.message.content, query.trim())}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
