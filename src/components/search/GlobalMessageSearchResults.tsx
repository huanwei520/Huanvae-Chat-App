/**
 * 全局搜索下拉框（六分类页签：消息 · 视频 · 图片 · 用户 · 群聊 · 机器人）
 *
 * 移动端 MobileChatList 和桌面端 Main 共用（只差 layout prop）。卡片列表**不再被搜索过滤**，
 * 搜索结果作为独立的浮层出现。
 *
 * ## 六个页签 = 原来六段的重切，不是六样新东西
 *
 * 改造前是六段并列（会话 / 聊天记录 / 文件 + 用户 / 群聊 / 机器人）。现在按分类切成页签：
 *
 * | 页签 | 吃掉原来的 | 取数 |
 * |---|---|---|
 * | 消息 | 「聊天记录」段 + 「文件」段里的 file / audio | 本地 SQLite，SQL 层排掉 image/video |
 * | 视频 | 「文件」段里的 video | 本地 SQLite，SQL 层只留 video，九宫格封面 |
 * | 图片 | 「文件」段里的 image | 本地 SQLite，SQL 层只留 image，九宫格封面 |
 * | 用户 | 「会话」段里的非 bot 好友 + 「用户」段 | 本地昵称子串 + 服务端 people |
 * | 群聊 | 「会话」段里的群 + 「群聊」段 | 本地群名子串 + 服务端 groups |
 * | 机器人 | 「会话」段里的 bot 好友 + 「机器人」段 | 本地 isBotUserId 分流 + 服务端 bots |
 *
 * 原来六段一条不剩、全部有归宿。分类定义在纯函数模块 globalSearchTabs.ts。
 *
 * ## 两条取数通路，各自独立降级（一个 loading / 出错不影响另一个）
 *
 * - **本地**（useGlobalMessageSearch → SQLite）：只在消息 / 视频 / 图片三个页签上跑。
 *   切页签时带着**该页签自己的 filter** 重查一次 —— 过滤下推到 SQL 层，于是每个页签各自
 *   拿满 limit。改造前是三类抢同一个 50 条池子再前端拆，「图片」很容易被文字命中挤空。
 * - **发现**（useDiscoverySearch → 后端 /api/discovery/search）：一次调用返回人/群/bot 三类，
 *   依赖只有 query、**不随页签重查** —— 在用户 / 群聊 / 机器人之间切换不该重新发请求。
 *
 * ## 其它
 *
 * - 关键词以 <mark> 高亮；点会话项 → onSelectConversation；点消息/媒体项 → onSelectMessage
 *   （调用方负责切会话 + 设置 pendingScrollToMessageId）
 * - 图片 / 视频页签复用会话内查找那套九宫格命中项 ConversationSearchHit（layout="cover"），
 *   媒体 src 因此天然经 useFileCache → 反代收口点，不会裸喂后端地址
 * - 发现头像已在 useDiscoverySearch 数据边界经 resolveServerAvatarUrl 解析，显示点直接 <img src>
 * - 本链路**没有翻页**（`db_search_messages` 无 offset，发现接口无 offset）：命中触顶时
 *   显式提示"只显示前 N 条"，不假装后面没有了
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../common/Avatar';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import { BotBadge } from '../common/BotBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatMessageTime } from '../../utils/time';
import { friendDisplayName } from '../../utils/friendName';
import { parseFriendIdFromConversationId } from '../../utils/conversationId';
import { isBotUserId } from '../../api/bots';
import {
  useGlobalMessageSearch,
  GLOBAL_SEARCH_LIMIT,
  type MessageSearchGroup,
} from '../../hooks/useGlobalMessageSearch';
import { useDiscoverySearch } from '../../hooks/useDiscoverySearch';
import type { SearchMessageResult } from '../../db';
import type { Friend, Group } from '../../types/chat';
import { highlightMatch } from './highlightMatch';
import { ConversationSearchHit } from './ConversationSearchHit';
import {
  GLOBAL_SEARCH_TABS,
  GLOBAL_SEARCH_TAB_LABEL,
  DEFAULT_GLOBAL_SEARCH_TAB,
  isMessageTab,
  tabToSearchFilter,
  tabEmptyText,
  type GlobalSearchTab,
} from './globalSearchTabs';

/** 桌面端动画：从搜索框左上角缩放展开/收回 */
const desktopVariants = {
  initial: { scale: 0, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring' as const, damping: 24, stiffness: 280 },
  },
  exit: {
    scale: 0,
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

/** 移动端动画：从顶部向下拉出/收回 */
const mobileVariants = {
  initial: { y: '-100%', opacity: 0 },
  animate: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, damping: 26, stiffness: 280 },
  },
  exit: {
    y: '-100%',
    opacity: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

interface GlobalMessageSearchResultsProps {
  /** 搜索关键词（非空时才生效） */
  query: string;
  /** 选中会话项（直接打开会话，不跳转到具体消息） */
  onSelectConversation: (type: 'friend' | 'group', data: Friend | Group) => void;
  /** 选中消息或媒体项（切会话 + 跳转到该消息） */
  onSelectMessage: (group: MessageSearchGroup, hit: SearchMessageResult) => void;
  /** 当前已知的好友列表（用于会话名匹配 + 头像） */
  friends: Friend[];
  /** 当前已知的群列表（用于会话名匹配 + 头像） */
  groups: Group[];
  /** 当前用户 ID（用于从 conversation_id 反推好友 ID） */
  currentUserId?: string;
  /** 动画布局：桌面（左上角缩放）vs 移动（从上拉出）；默认 desktop */
  layout?: 'desktop' | 'mobile';
  /** 点击发现的「用户」项 → 打开个人详情弹窗 */
  onSelectDiscoveryPerson?: (userId: string) => void;
  /** 点击发现的「bot」项 → 打开个人详情弹窗（带 bot username 供 addBotByUsername） */
  onSelectDiscoveryBot?: (botUserId: string, username: string) => void;
  /** 点击发现的「群聊」项 → 打开群详情弹窗 */
  onSelectDiscoveryGroup?: (groupId: string) => void;
}

/** 非文本类型消息加类型图标前缀（「消息」页签里混着文档 / 语音，靠它一眼分辨） */
function decorateContentByType(contentType: string, content: string): string {
  switch (contentType) {
    case 'file':
      return `📁 ${content}`;
    case 'audio':
      return `🎵 ${content}`;
    default:
      return content;
  }
}

/** 实体页签（用户 / 群聊 / 机器人）里「会话」段的一行 */
interface LocalConvRow {
  key: string;
  name: string;
  avatar: React.ReactNode;
  /** 机器人行加 BOT 徽章 */
  showBotBadge?: boolean;
  onClick: () => void;
}

export function GlobalMessageSearchResults({
  query,
  onSelectConversation,
  onSelectMessage,
  friends,
  groups,
  currentUserId,
  layout = 'desktop',
  onSelectDiscoveryPerson,
  onSelectDiscoveryBot,
  onSelectDiscoveryGroup,
}: GlobalMessageSearchResultsProps) {
  const variants = layout === 'mobile' ? mobileVariants : desktopVariants;
  const [tab, setTab] = useState<GlobalSearchTab>(DEFAULT_GLOBAL_SEARCH_TAB);

  const onMessageTab = isMessageTab(tab);
  const messageFilter = useMemo(() => tabToSearchFilter(tab) ?? undefined, [tab]);
  // 实体页签不查消息表：query 传空串即整条链路短路（hook 内不发 DB 调用）
  const {
    groups: searchGroups,
    loading: localLoading,
    error: localError,
  } = useGlobalMessageSearch(onMessageTab ? query : '', messageFilter);
  // 服务端发现搜索：与本地搜索独立降级（把 groups 重命名为 discGroups，避开 groups 这个 prop）
  const {
    people,
    groups: discGroups,
    bots,
    loading: discoveryLoading,
    error: discoveryError,
  } = useDiscoverySearch(query);

  // 由会话 id 反查 Friend / Group 对象（仅用于消息/媒体命中的头像）
  const friendMap = useMemo(() => {
    const m = new Map<string, Friend>();
    friends.forEach((f) => m.set(f.friend_id, f));
    return m;
  }, [friends]);
  const groupMap = useMemo(() => {
    const m = new Map<string, Group>();
    groups.forEach((g) => m.set(g.group_id, g));
    return m;
  }, [groups]);

  // 本地会话名匹配：好友按 bot 与否分流进「机器人」/「用户」两个页签
  // （bot 在数据模型里就是一行普通 Friend，靠后端分配的 bot_ 前缀 user_id 判别，
  //  不是靠昵称猜 —— 见 src/api/bots.ts isBotUserId）
  const { matchedUsers, matchedBots } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { matchedUsers: [] as Friend[], matchedBots: [] as Friend[] };
    }
    const hit = friends.filter((f) => friendDisplayName(f).toLowerCase().includes(q));
    return {
      matchedUsers: hit.filter((f) => !isBotUserId(f.friend_id)),
      matchedBots: hit.filter((f) => isBotUserId(f.friend_id)),
    };
  }, [friends, query]);
  const matchedGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return groups.filter((g) => g.group_name.toLowerCase().includes(q));
  }, [groups, query]);

  // 注：query 为空时由外部 AnimatePresence 不渲染本组件（实现退出动画），
  // 此处不再 return null，保留 hook 调用顺序稳定。
  const totalHits = searchGroups.reduce((n, g) => n + g.hits.length, 0);

  const motionProps = {
    variants,
    initial: 'initial',
    animate: 'animate',
    exit: 'exit',
    style: layout === 'desktop' ? { transformOrigin: 'top left' as const } : undefined,
  };

  return (
    <motion.div className="global-msg-search" {...motionProps}>
      <div className="global-msg-search-tabs" role="tablist" aria-label="搜索分类">
        {GLOBAL_SEARCH_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`global-msg-search-tab${tab === t.key ? ' global-msg-search-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="global-msg-search-body">
        {onMessageTab ? renderMessageTab() : renderEntityTab()}
      </div>
    </motion.div>
  );

  /** 消息 / 视频 / 图片：本地 SQLite 命中，按会话分组 */
  function renderMessageTab() {
    if (localLoading) {
      return (
        <div className="global-msg-search-disc-status">
          <LoadingSpinner />
          <span>搜索{GLOBAL_SEARCH_TAB_LABEL[tab]}中...</span>
        </div>
      );
    }
    if (localError) {
      return (
        <div className="global-msg-search-disc-status global-msg-search-disc-status--error">
          <span>{localError}</span>
        </div>
      );
    }
    if (totalHits === 0) {
      return <div className="global-msg-search-empty">{tabEmptyText(tab, query)}</div>;
    }
    const isCoverGrid = tab === 'image' || tab === 'video';
    return (
      <>
        {searchGroups.map((group) =>
          isCoverGrid ? renderCoverGroup(group) : renderHitGroup(group),
        )}
        {totalHits >= GLOBAL_SEARCH_LIMIT && (
          <div className="global-msg-search-foot">
            仅显示最近 {GLOBAL_SEARCH_LIMIT} 条，输入更精确的关键词可继续收窄
          </div>
        )}
      </>
    );
  }

  /** 用户 / 群聊 / 机器人：本地会话名命中 + 服务端发现命中 */
  function renderEntityTab() {
    let localRows: LocalConvRow[];
    let discoverySection: React.ReactNode;
    let discoveryCount: number;

    if (tab === 'user') {
      localRows = matchedUsers.map((f) => ({
        key: `friend-${f.friend_id}`,
        name: friendDisplayName(f),
        avatar: <FriendAvatar friend={f} />,
        onClick: () => onSelectConversation('friend', f),
      }));
      discoveryCount = people.length;
      discoverySection = renderDiscoverySection(
        people.length,
        people.map((p) => (
          <li
            key={`disc-person-${p.userId}`}
            className="global-msg-search-conv-item"
            onClick={() => onSelectDiscoveryPerson?.(p.userId)}
          >
            <div className="global-msg-search-conv-avatar">
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt={p.nickname} />
              ) : (
                <AvatarPlaceholder name={p.nickname} fontSize={11} />
              )}
            </div>
            <span className="global-msg-search-conv-name">{highlightMatch(p.nickname, query)}</span>
            {p.isFriend && <span className="global-msg-search-disc-meta">已是好友</span>}
          </li>
        )),
      );
    } else if (tab === 'group') {
      localRows = matchedGroups.map((g) => ({
        key: `group-${g.group_id}`,
        name: g.group_name,
        avatar: <GroupAvatar group={g} />,
        onClick: () => onSelectConversation('group', g),
      }));
      discoveryCount = discGroups.length;
      discoverySection = renderDiscoverySection(
        discGroups.length,
        discGroups.map((g) => (
          <li
            key={`disc-group-${g.groupId}`}
            className="global-msg-search-conv-item"
            onClick={() => onSelectDiscoveryGroup?.(g.groupId)}
          >
            <div className="global-msg-search-conv-avatar">
              {g.avatarUrl ? (
                <img src={g.avatarUrl} alt={g.groupName} />
              ) : (
                <AvatarPlaceholder name={g.groupName} fontSize={11} />
              )}
            </div>
            <span className="global-msg-search-conv-name">{highlightMatch(g.groupName, query)}</span>
            <span className="global-msg-search-disc-meta">
              {g.memberCount} 人{g.isMember ? ' · 已加入' : ''}
            </span>
          </li>
        )),
      );
    } else {
      localRows = matchedBots.map((f) => ({
        key: `bot-${f.friend_id}`,
        name: friendDisplayName(f),
        avatar: <FriendAvatar friend={f} />,
        showBotBadge: true,
        onClick: () => onSelectConversation('friend', f),
      }));
      discoveryCount = bots.length;
      discoverySection = renderDiscoverySection(
        bots.length,
        bots.map((b) => (
          <li
            key={`disc-bot-${b.botUserId}`}
            className="global-msg-search-conv-item"
            onClick={() => onSelectDiscoveryBot?.(b.botUserId, b.username)}
          >
            <div className="global-msg-search-conv-avatar">
              {b.avatarUrl ? (
                <img src={b.avatarUrl} alt={b.nickname} />
              ) : (
                <AvatarPlaceholder name={b.nickname} fontSize={11} />
              )}
            </div>
            <span className="global-msg-search-conv-name">
              {highlightMatch(b.nickname, query)}
              <BotBadge />
            </span>
            {b.isFriend && <span className="global-msg-search-disc-meta">已添加</span>}
          </li>
        )),
      );
    }

    // 空态：本地与发现都没有、且发现区既不在加载也没出错（本地区是内存过滤，无加载态）
    const isEmpty =
      localRows.length === 0 && discoveryCount === 0 && !discoveryLoading && !discoveryError;

    return (
      <>
        {localRows.length > 0 && (
          <section className="global-msg-search-section">
            <div className="global-msg-search-section-header">
              会话 <span className="global-msg-search-section-count">{localRows.length}</span>
            </div>
            <ul className="global-msg-search-conv-list">
              {localRows.map((row) => (
                <li key={row.key} className="global-msg-search-conv-item" onClick={row.onClick}>
                  <div className="global-msg-search-conv-avatar">{row.avatar}</div>
                  <span className="global-msg-search-conv-name">
                    {highlightMatch(row.name, query)}
                    {row.showBotBadge && <BotBadge />}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {discoveryLoading && (
          <div className="global-msg-search-disc-status">
            <LoadingSpinner />
            <span>搜索{GLOBAL_SEARCH_TAB_LABEL[tab]}中...</span>
          </div>
        )}
        {!discoveryLoading && discoveryError && (
          <div className="global-msg-search-disc-status global-msg-search-disc-status--error">
            <span>发现搜索失败：{discoveryError}</span>
          </div>
        )}
        {!discoveryLoading && !discoveryError && discoverySection}

        {isEmpty && <div className="global-msg-search-empty">{tabEmptyText(tab, query)}</div>}
      </>
    );
  }

  /** 发现区一段（服务端完全匹配的结果），段头固定叫「发现」以与页签名区分 */
  function renderDiscoverySection(count: number, rows: React.ReactNode) {
    if (count === 0) {
      return null;
    }
    return (
      <section className="global-msg-search-section">
        <div className="global-msg-search-section-header">
          发现 <span className="global-msg-search-section-count">{count}</span>
        </div>
        <ul className="global-msg-search-conv-list">{rows}</ul>
      </section>
    );
  }

  /** 命中分组的会话头（消息页签与媒体页签共用） */
  function renderGroupHeader(group: MessageSearchGroup) {
    const friendId =
      group.conversationType === 'friend' && currentUserId
        ? parseFriendIdFromConversationId(group.conversationId, currentUserId)
        : null;
    const friend = friendId ? friendMap.get(friendId) : undefined;
    const groupData =
      group.conversationType === 'group' ? groupMap.get(group.conversationId) : undefined;
    return (
      <div className="global-msg-search-group-header">
        <div className="global-msg-search-group-avatar">
          {friend && <FriendAvatar friend={friend} />}
          {groupData && <GroupAvatar group={groupData} />}
          {!friend && !groupData && (
            <AvatarPlaceholder name={group.conversationName} fontSize={11} />
          )}
        </div>
        <span className="global-msg-search-group-name">{group.conversationName}</span>
        <span className="global-msg-search-group-count">{group.hits.length}</span>
      </div>
    );
  }

  /** 「消息」页签：文字 / 文档 / 语音命中，列表行 */
  function renderHitGroup(group: MessageSearchGroup) {
    return (
      <div key={`m-${group.conversationId}`} className="global-msg-search-group">
        {renderGroupHeader(group)}
        <ul className="global-msg-search-hits">
          {group.hits.map((hit) => (
            <li
              key={hit.message.message_uuid}
              className="global-msg-search-hit"
              onClick={() => onSelectMessage(group, hit)}
            >
              <div className="global-msg-search-content">
                {highlightMatch(
                  decorateContentByType(hit.message.content_type, hit.message.content),
                  query,
                )}
              </div>
              <div className="global-msg-search-meta">
                {hit.message.sender_name ?? hit.message.sender_id}
                <span className="global-msg-search-meta-sep">·</span>
                {formatMessageTime(hit.message.send_time)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /**
   * 「图片」/「视频」页签：正方形九宫格封面
   *
   * 直接复用会话内查找那套命中项 —— 它只吃一条 LocalMessage、与"哪个会话"无关，
   * 且媒体 src 走 useFileCache（内部已过 resolveDisplayUrl 反代收口点）。
   * onLocate 在这里接到 onSelectMessage：全局搜索是跨会话的，定位前必须先切会话。
   */
  function renderCoverGroup(group: MessageSearchGroup) {
    return (
      <div key={`c-${group.conversationId}`} className="global-msg-search-group">
        {renderGroupHeader(group)}
        <ul className="global-msg-search-grid">
          {group.hits.map((hit) => (
            <ConversationSearchHit
              key={hit.message.message_uuid}
              message={hit.message}
              query={query.trim()}
              layout="cover"
              onLocate={() => onSelectMessage(group, hit)}
            />
          ))}
        </ul>
      </div>
    );
  }
}
