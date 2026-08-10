/**
 * 会话内消息查找视图（侧边设置面板 ChatMenuPanel 的一个 view，不是独立入口）
 *
 * 覆盖三种会话：好友私聊 / bot / 群聊（本地库同构，只是 conversation_id 不同来源）；
 * AI 会话不落本地 messages 表，故调用方不挂载本视图。
 *
 * ## 交互（Telegram 式：先列出，再收窄）
 *
 * 点「全部 / 文字 / 图片 / 视频 / 文件」任一分类 → **立刻**按时间倒序列出该分类全部内容，
 * **不需要先输入关键词**；输入关键词只是在已列出的结果里再过滤。
 * 图片 / 视频给缩略图，文件给图标 + 文件名 + 大小，文字给高亮正文。
 *
 * ## 为什么滚动加载而不是一次性渲染
 *
 * 一个会话可以有几万条消息，「全部」分类一次取回会同时拖垮 DB 调用与 React 渲染。
 * 故 hook 走 limit/offset 分页（见 useConversationMessageSearch），本组件提供两个
 * 触发口：滚到底自动取下一页（顺手），以及列表末尾一颗「加载更多」按钮
 * （确定性入口 —— 键盘可达，且当首屏没铺满容器、根本滚不动时仍能继续取）。
 *
 * ## 点击结果的定位通路
 *
 * 写 chatStore.pendingScrollToMessageId，复用**全仓唯一**那条消息定位通路
 * （useMainPage 的定位 effect：补历史直到目标进窗口 → `scrollMessageIntoView` 手动改
 * 目标容器自己的 scrollTop → 高亮 → 失败写 messageJumpNotice），并调 onJump 让调用方
 * 收起侧边面板，好让被定位的消息真的露出来。
 * 🔴 定位**绝不用 `scrollIntoView`**：它沿祖先链冒泡，会把整个 App 外壳一起顶上去
 * （见 src/chat/shared/scrollMessageIntoView.ts 与 .claude/rules/common.md 同名条目）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { MenuHeader } from '../../chat/shared/menu/MenuHeader';
import { formatMessageTime } from '../../utils/time';
import { formatFileSize } from '../../utils/format';
import { useChatStore } from '../../stores';
import type { LocalMessage } from '../../db';
import { highlightMatch } from './highlightMatch';
import { ConversationSearchMedia } from './ConversationSearchMedia';
import {
  MESSAGE_CATEGORY_TABS,
  contentTypeBadge,
  contentTypeToCategory,
  type MessageCategory,
} from './messageCategory';
import { useConversationMessageSearch } from './useConversationMessageSearch';

/** 距列表底部多少 px 内触发自动取下一页 */
const SCROLL_LOAD_THRESHOLD = 120;

/** 文档类结果的行首图标（与消息气泡里的文件图标同款） */
function DocumentIcon() {
  return (
    <svg
      className="conv-msg-search-thumb conv-msg-search-thumb--doc"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

interface ConversationMessageSearchProps {
  /** 当前会话 ID（好友：conv-{a}-{b}；群：group_id） */
  conversationId: string;
  /** 返回主菜单 */
  onBack: () => void;
  /** 已选中某条结果并写入定位请求 —— 调用方据此收起侧边面板 */
  onJump: () => void;
}

export function ConversationMessageSearch({
  conversationId,
  onBack,
  onJump,
}: ConversationMessageSearchProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MessageCategory>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);

  const { items, loading, loadingMore, error, hasMore, loadMore } =
    useConversationMessageSearch(conversationId, query, category);

  // 展开即聚焦输入框（列表已经有内容了，键盘用户可以直接收窄）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (message: LocalMessage) => {
      // 交给全仓唯一那条定位通路（补历史 → scrollMessageIntoView 手动 scrollTop → 高亮 /
      // 失败提示），不在此另起第二套滚动机制
      setPendingScrollToMessageId(message.message_uuid);
      onJump();
    },
    [setPendingScrollToMessageId, onJump],
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLUListElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_LOAD_THRESHOLD) {
        loadMore();
      }
    },
    [loadMore],
  );

  const trimmedQuery = query.trim();
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div className="conv-msg-search">
      <MenuHeader title="查找聊天记录" onBack={onBack} />

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
          placeholder="在当前会话中查找"
          aria-label="在当前会话中查找消息"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onBack();
            }
          }}
        />
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
          <span>加载中...</span>
        </div>
      )}
      {!loading && error && (
        <div className="conv-msg-search-status conv-msg-search-status--error">{error}</div>
      )}
      {showEmpty && (
        <div className="conv-msg-search-status">
          {trimmedQuery ? `未找到包含「${trimmedQuery}」的消息` : '该分类暂无内容'}
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="conv-msg-search-list" onScroll={handleScroll}>
          {items.map((message) => {
            const badge = contentTypeBadge(message.content_type);
            const kind = contentTypeToCategory(message.content_type);
            return (
              <li
                key={message.message_uuid}
                className="conv-msg-search-hit"
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(message)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(message);
                  }
                }}
              >
                {(kind === 'image' || kind === 'video') && (
                  <ConversationSearchMedia message={message} />
                )}
                {kind === 'file' && <DocumentIcon />}
                <div className="conv-msg-search-hit-body">
                  <div className="conv-msg-search-hit-meta">
                    <span className="conv-msg-search-hit-sender">
                      {message.sender_name ?? message.sender_id}
                    </span>
                    <span className="conv-msg-search-hit-time">
                      {formatMessageTime(message.send_time)}
                    </span>
                    {badge && <span className="conv-msg-search-hit-badge">{badge}</span>}
                  </div>
                  <div className="conv-msg-search-hit-content">
                    {highlightMatch(message.content, trimmedQuery)}
                  </div>
                  {kind !== 'text' && message.file_size !== null && (
                    <div className="conv-msg-search-hit-size">
                      {formatFileSize(message.file_size)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}

          <li className="conv-msg-search-foot">
            {loadingMore && (
              <span className="conv-msg-search-status">
                <LoadingSpinner />
                <span>加载中...</span>
              </span>
            )}
            {!loadingMore && hasMore && (
              <button type="button" className="conv-msg-search-more" onClick={loadMore}>
                加载更多
              </button>
            )}
            {!loadingMore && !hasMore && (
              <span className="conv-msg-search-end">没有更多了</span>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}
