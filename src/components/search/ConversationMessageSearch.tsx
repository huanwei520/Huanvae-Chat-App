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
 * ## 结果的两种版式
 *
 * 「图片」/「视频」分类 → **正方形九宫格封面**（每行 3 个，`aspect-ratio: 1/1` +
 * `object-fit: cover`）；其余分类（全部 / 文字 / 文件 / 群成员）保持列表行。
 * 分界线是「这一屏有没有正文可显示」——同一套行也渲染文字命中，文字命中没有封面可放。
 *
 * ## 定位通路（现在挂在**右键 / 长按菜单**上，不再是点一下就跳）
 *
 * 写 chatStore.pendingScrollToMessageId，复用**全仓唯一**那条消息定位通路
 * （useMainPage 的定位 effect：补历史直到目标进窗口 → `scrollMessageIntoView` 手动改
 * 目标容器自己的 scrollTop → 高亮 → 失败写 messageJumpNotice），并调 onJump 让调用方
 * 收起侧边面板，好让被定位的消息真的露出来。
 * 🔴 定位**绝不用 `scrollIntoView`**：它沿祖先链冒泡，会把整个 App 外壳一起顶上去
 * （见 src/chat/shared/scrollMessageIntoView.ts 与 .claude/rules/common.md 同名条目）。
 *
 * 单条命中项的版式与交互（左键打开 / 右键·长按定位）全在 ConversationSearchHit。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { MenuHeader } from '../../chat/shared/menu/MenuHeader';
import { useChatStore } from '../../stores';
import type { LocalMessage } from '../../db';
import type { GroupMember } from '../../api/groups';
import { groupMemberDisplayName } from '../../utils/groupRemark';
import { ConversationSearchHit } from './ConversationSearchHit';
import { MESSAGE_CATEGORY_TABS, type MessageCategory } from './messageCategory';
import { useConversationMessageSearch } from './useConversationMessageSearch';

/** 距列表底部多少 px 内触发自动取下一页 */
const SCROLL_LOAD_THRESHOLD = 120;

interface ConversationMessageSearchProps {
  /** 当前会话 ID（好友：conv-{a}-{b}；群：group_id） */
  conversationId: string;
  /** 返回主菜单 */
  onBack: () => void;
  /** 已选中某条结果并写入定位请求 —— 调用方据此收起侧边面板 */
  onJump: () => void;
  /**
   * 群成员列表；**仅群聊传**。传了才出现「群成员」页签
   * （好友会话只有两个人，按人过滤没有意义）。
   */
  members?: GroupMember[];
  /** D7 群内私有备注（user_id → 备注名）：显示名优先用备注，与成员网格同口径 */
  memberRemarks?: Record<string, string>;
}

export function ConversationMessageSearch({
  conversationId,
  onBack,
  onJump,
  members,
  memberRemarks,
}: ConversationMessageSearchProps) {
  const [query, setQuery] = useState('');
  /** 「群成员」页签选中的成员；null = 还停在成员选择列表 */
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);
  const [category, setCategory] = useState<MessageCategory>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);

  const isMemberTab = category === 'member';
  const { items, loading, loadingMore, error, hasMore, loadMore } =
    useConversationMessageSearch(
      conversationId,
      query,
      // 成员页签下不再按类型过滤：用户要看的是「这个人说过什么」的全部
      isMemberTab ? 'all' : category,
      isMemberTab ? selectedMember?.user_id ?? null : null,
    );

  // 展开即聚焦输入框（列表已经有内容了，键盘用户可以直接收窄）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleLocate = useCallback(
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
  // 图片 / 视频分类走九宫格封面；其余分类（含群成员，此时 category === 'member'）仍是列表行
  const isCoverGrid = category === 'image' || category === 'video';

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
        {/* 「群成员」仅群聊出现：好友会话只有两个人，按人过滤没有意义 */}
        {members && members.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={category === 'member'}
            className={`conv-msg-search-tab${category === 'member' ? ' conv-msg-search-tab--active' : ''}`}
            onClick={() => {
              setCategory('member');
              // 回到成员选择：换页签时不保留上次选中的人，避免「点进群成员却直接是某人的记录」
              setSelectedMember(null);
            }}
          >
            群成员
          </button>
        )}
      </div>

      {/* 已选成员：显示「正在看谁」+ 换人入口。没有这条，用户无从知道当前结果被谁过滤着 */}
      {isMemberTab && selectedMember && (
        <div className="conv-msg-search-member-bar">
          <span className="conv-msg-search-member-name">
            {groupMemberDisplayName(memberRemarks?.[selectedMember.user_id], selectedMember.user_nickname)}
          </span>
          <button
            type="button"
            className="subtle-btn"
            onClick={() => setSelectedMember(null)}
          >
            换人
          </button>
        </div>
      )}

      {/* 成员页签且还没选人：先出成员列表，选了才查记录。
          这一分支要**整个替换**结果区（含 loading / 空态），否则会同时显示成员列表和
          「该分类暂无内容」——用户会以为这个人没说过话。 */}
      {isMemberTab && !selectedMember ? (
        <ul className="conv-msg-search-member-list">
          {members?.map((m) => (
            <li key={m.user_id}>
              <button
                type="button"
                className="conv-msg-search-member-item"
                onClick={() => setSelectedMember(m)}
              >
                {groupMemberDisplayName(memberRemarks?.[m.user_id], m.user_nickname)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
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
            <ul
              className={`conv-msg-search-list${isCoverGrid ? ' conv-msg-search-list--grid' : ''}`}
              onScroll={handleScroll}
            >
              {items.map((message) => (
                <ConversationSearchHit
                  key={message.message_uuid}
                  message={message}
                  query={trimmedQuery}
                  layout={isCoverGrid ? 'cover' : 'row'}
                  onLocate={handleLocate}
                />
              ))}

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
        </>
      )}
    </div>
  );
}
