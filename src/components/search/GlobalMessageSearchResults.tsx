/**
 * 全局搜索下拉框（独立框 + 三分类）
 *
 * 移动端 MobileChatList 和桌面端 UnifiedList 共用。卡片列表**不再被搜索过滤**，
 * 搜索结果作为独立的下框出现，按以下三段顺序展示：
 *   1. 会话（好友昵称 + 群名）
 *   2. 聊天记录（content_type='text' 的消息命中）
 *   3. 文件（content_type ∈ image/video/file/audio 的命中，content 即文件名）
 *
 * 行为：
 * - 消息和文件命中复用 useGlobalMessageSearch（含 500ms 防抖）
 * - 会话名匹配在前端 friends/groups 内同步过滤
 * - 关键词以 <mark> 高亮
 * - 点击会话项 → onSelectConversation(type, data)
 * - 点击消息/文件项 → onSelectMessage(group, hit)，调用方负责切会话 + 设置 pendingScrollToMessageId
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../common/Avatar';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatMessageTime } from '../../utils/time';
import { friendDisplayName } from '../../utils/friendName';
import { parseFriendIdFromConversationId } from '../../utils/conversationId';
import {
  useGlobalMessageSearch,
  type MessageSearchGroup,
} from '../../hooks/useGlobalMessageSearch';
import type { SearchMessageResult } from '../../db';
import type { Friend, Group } from '../../types/chat';

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
  /** 选中消息或文件项（切会话 + 跳转到该消息） */
  onSelectMessage: (group: MessageSearchGroup, hit: SearchMessageResult) => void;
  /** 当前已知的好友列表（用于会话名匹配 + 头像） */
  friends: Friend[];
  /** 当前已知的群列表（用于会话名匹配 + 头像） */
  groups: Group[];
  /** 当前用户 ID（用于从 conversation_id 反推好友 ID） */
  currentUserId?: string;
  /** 动画布局：桌面（左上角缩放）vs 移动（从上拉出）；默认 desktop */
  layout?: 'desktop' | 'mobile';
}

/** 把文本按 query 切片并高亮匹配子串（不区分大小写） */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) {
    return text;
  }
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark key={idx} className="global-msg-search-mark">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return <>{parts}</>;
}

/** 非文本类型消息加类型图标前缀 */
function decorateContentByType(contentType: string, content: string): string {
  switch (contentType) {
    case 'image':
      return `🖼️ ${content}`;
    case 'video':
      return `🎬 ${content}`;
    case 'file':
      return `📁 ${content}`;
    case 'audio':
      return `🎵 ${content}`;
    default:
      return content;
  }
}

/** 文件类消息的 content_type 集合 */
const FILE_TYPES = new Set(['image', 'video', 'file', 'audio']);

export function GlobalMessageSearchResults({
  query,
  onSelectConversation,
  onSelectMessage,
  friends,
  groups,
  currentUserId,
  layout = 'desktop',
}: GlobalMessageSearchResultsProps) {
  const variants = layout === 'mobile' ? mobileVariants : desktopVariants;
  const { groups: searchGroups, loading, error } = useGlobalMessageSearch(query);

  // 由会话 id 反查 Friend / Group 对象（仅用于消息/文件命中的头像）
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

  // Section 1：会话名匹配（好友昵称 + 群名）
  const matchedFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return friends.filter((f) => friendDisplayName(f).toLowerCase().includes(q));
  }, [friends, query]);
  const matchedGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return groups.filter((g) => g.group_name.toLowerCase().includes(q));
  }, [groups, query]);

  // Section 2/3：把 useGlobalMessageSearch 的命中按 content_type 拆为消息和文件
  const { messageGroups, fileGroups } = useMemo(() => {
    const msg: MessageSearchGroup[] = [];
    const file: MessageSearchGroup[] = [];
    for (const g of searchGroups) {
      const textHits = g.hits.filter((h) => !FILE_TYPES.has(h.message.content_type));
      const fileHits = g.hits.filter((h) => FILE_TYPES.has(h.message.content_type));
      if (textHits.length > 0) {
        msg.push({ ...g, hits: textHits });
      }
      if (fileHits.length > 0) {
        file.push({ ...g, hits: fileHits });
      }
    }
    return { messageGroups: msg, fileGroups: file };
  }, [searchGroups]);

  // 注：query 为空时由外部 AnimatePresence 不渲染本组件（实现退出动画），
  // 此处不再 return null，保留 hook 调用顺序稳定。
  const totalConversations = matchedFriends.length + matchedGroups.length;
  const totalMessages = messageGroups.reduce((n, g) => n + g.hits.length, 0);
  const totalFiles = fileGroups.reduce((n, g) => n + g.hits.length, 0);
  const totalAll = totalConversations + totalMessages + totalFiles;

  const motionProps = {
    variants,
    initial: 'initial',
    animate: 'animate',
    exit: 'exit',
    style: layout === 'desktop' ? { transformOrigin: 'top left' as const } : undefined,
  };

  if (loading) {
    return (
      <motion.div
        className="global-msg-search global-msg-search-loading"
        {...motionProps}
      >
        <LoadingSpinner />
        <span>搜索中...</span>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div className="global-msg-search global-msg-search-error" {...motionProps}>
        <span>{error}</span>
      </motion.div>
    );
  }

  if (totalAll === 0) {
    return (
      <motion.div className="global-msg-search global-msg-search-empty" {...motionProps}>
        <span>未找到包含「{query}」的内容</span>
      </motion.div>
    );
  }

  return (
    <motion.div className="global-msg-search" {...motionProps}>
      {/* Section 1：会话名 */}
      {totalConversations > 0 && (
        <section className="global-msg-search-section">
          <div className="global-msg-search-section-header">
            会话 <span className="global-msg-search-section-count">{totalConversations}</span>
          </div>
          <ul className="global-msg-search-conv-list">
            {matchedFriends.map((f) => (
              <li
                key={`friend-${f.friend_id}`}
                className="global-msg-search-conv-item"
                onClick={() => onSelectConversation('friend', f)}
              >
                <div className="global-msg-search-conv-avatar">
                  <FriendAvatar friend={f} />
                </div>
                <span className="global-msg-search-conv-name">
                  {highlightMatch(friendDisplayName(f), query)}
                </span>
              </li>
            ))}
            {matchedGroups.map((g) => (
              <li
                key={`group-${g.group_id}`}
                className="global-msg-search-conv-item"
                onClick={() => onSelectConversation('group', g)}
              >
                <div className="global-msg-search-conv-avatar">
                  <GroupAvatar group={g} />
                </div>
                <span className="global-msg-search-conv-name">
                  {highlightMatch(g.group_name, query)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Section 2：聊天记录 */}
      {totalMessages > 0 && (
        <section className="global-msg-search-section">
          <div className="global-msg-search-section-header">
            聊天记录 <span className="global-msg-search-section-count">{totalMessages}</span>
          </div>
          {messageGroups.map((group) => renderHitGroup(group, false))}
        </section>
      )}

      {/* Section 3：文件 */}
      {totalFiles > 0 && (
        <section className="global-msg-search-section">
          <div className="global-msg-search-section-header">
            文件 <span className="global-msg-search-section-count">{totalFiles}</span>
          </div>
          {fileGroups.map((group) => renderHitGroup(group, true))}
        </section>
      )}
    </motion.div>
  );

  function renderHitGroup(group: MessageSearchGroup, isFile: boolean) {
    const friendId =
      group.conversationType === 'friend' && currentUserId
        ? parseFriendIdFromConversationId(group.conversationId, currentUserId)
        : null;
    const friend = friendId ? friendMap.get(friendId) : undefined;
    const groupData =
      group.conversationType === 'group' ? groupMap.get(group.conversationId) : undefined;
    return (
      <div key={`${isFile ? 'f' : 'm'}-${group.conversationId}`} className="global-msg-search-group">
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
}
