/**
 * 本地会话管理 Hook
 *
 * 通过 db_get_conversation_previews（SQL JOIN）一次性查出每个会话的最新消息，
 * 替代原先的 N+1 查询（getConversations + 逐条 getLatestMessage）。
 *
 * 数据更新策略：事件驱动，由外部在消息变更时调用 refresh()。
 * 不再使用 5 秒定时轮询。
 *
 * 预览文本的发送者前缀（`昵称: ` / `我: `）在**本 hook 内**统一派生，
 * 只对群聊生效；两个消费方（桌面 UnifiedList、移动 MobileChatList）都直接渲染
 * lastMessage 字符串，故两端呈现由构造保证一致，不存在各自拼接漂移的可能。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { parseFriendIdFromConversationId } from '../utils/conversationId';
import { GROUP_CARD_PREVIEW_TEXT } from '../chat/shared/groupCard';
import * as db from '../db';

const PREVIEW_CHANGED_EVENT = 'conversation-previews-changed';

/** 会话预览信息 */
export interface ConversationPreview {
  conversationId: string;
  /**
   * 卡片预览文本。**群聊**已带发送者前缀（`昵称: 内容` / `我: 内容`，见 groupSenderPrefix）；
   * 单聊/bot 为纯内容。桌面 UnifiedList 与移动 MobileChatList 同吃这一份，天然两端一致。
   */
  lastMessage: string | null;
  lastMessageTime: string | null;
  lastSeq: number;
  /** 本地置顶状态（conversations.is_pinned，由 setConversationPinned 维护） */
  isPinned: boolean;
}

/** 按目标ID索引的预览信息 */
export interface ConversationPreviews {
  friends: Map<string, ConversationPreview>;
  groups: Map<string, ConversationPreview>;
}

interface UseLocalConversationsReturn {
  /** 会话预览数据 */
  previews: ConversationPreviews;
  /** 加载状态 */
  loading: boolean;
  /** 首次加载是否完成（用于等待本地数据就绪后再渲染卡片） */
  initialized: boolean;
  /** 刷新数据（事件驱动，由外部调用） */
  refresh: () => Promise<void>;
  /** 获取好友的消息预览 */
  getFriendPreview: (friendId: string) => ConversationPreview | undefined;
  /** 获取群组的消息预览 */
  getGroupPreview: (groupId: string) => ConversationPreview | undefined;
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  image: '[图片]',
  video: '[视频]',
  file: '[文件]',
  meeting_invite: '[会议邀请]',
  // 缺这条 ⇒ toPreviewText 回落到 content 原文 = 会话列表里显示裸 JSON
  group_card: GROUP_CARD_PREVIEW_TEXT,
};

/** 将 content_type + content 转为用户可读的预览文本 */
function toPreviewText(contentType: string | null, content: string | null): string | null {
  if (!contentType || content === null) { return null; }
  return CONTENT_TYPE_MAP[contentType] ?? content;
}

/**
 * 群聊预览的发送者前缀（`昵称: ` / `我: `），无法归属时返回空串。
 *
 * 仅群聊调用 —— 单聊/bot 会话里发送者只有两个人，前缀是纯噪音。
 * - 系统消息（入群/退群等）本身已含主语且无真实发送者 → 不加前缀
 * - 自己发的 → 「我: 」（多人会话里「最后说话的是不是我」本身就是有效信息，
 *   与 Telegram「You:」/ QQ「我:」一致；不加前缀则无法与"昵称缺失的他人消息"区分）
 * - 发送者不可辨（未带昵称的同步路径写入 sender_name=null）→ 不加前缀，
 *   而非退化成裸用户 ID（ID 对用户无意义，且会挤掉本就有限的预览宽度）
 */
function groupSenderPrefix(row: db.ConversationWithPreview, currentUserId: string): string {
  if (row.msg_content_type === 'system') { return ''; }
  if (row.msg_sender_id === currentUserId) { return '我: '; }
  if (row.msg_sender_name) { return `${row.msg_sender_name}: `; }
  return '';
}

export function useLocalConversations(): UseLocalConversationsReturn {
  const { session } = useSession();
  const [previews, setPreviews] = useState<ConversationPreviews>({
    friends: new Map(),
    groups: new Map(),
  });
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const initializedRef = useRef(false);
  // 单调请求序号：并发重读时丢弃陈旧响应，防止先发后至的结果覆盖最新结果
  const requestSeqRef = useRef(0);

  const loadConversations = useCallback(async () => {
    if (!session) { return; }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const rows = await db.getConversationPreviews();
      // 期间有更新的请求发起 → 本次结果已陈旧，丢弃（由最新请求落地）
      if (seq !== requestSeqRef.current) { return; }
      const friendPreviews = new Map<string, ConversationPreview>();
      const groupPreviews = new Map<string, ConversationPreview>();

      for (const row of rows) {
        const isGroup = row.type !== 'friend';
        const previewText = toPreviewText(row.msg_content_type, row.msg_content);
        const preview: ConversationPreview = {
          conversationId: row.id,
          // 群聊卡片带发送者前缀（多人会话里"谁最后说话"是关键信息）；单聊不带
          lastMessage: isGroup && previewText !== null
            ? groupSenderPrefix(row, session.userId) + previewText
            : previewText,
          lastMessageTime: row.msg_send_time,
          lastSeq: row.last_seq,
          isPinned: row.is_pinned,
        };

        if (row.type === 'friend') {
          // 统一走工具解析（用户 ID 可含连字符，不能按 '-' split 计数）
          const friendId = parseFriendIdFromConversationId(row.id, session.userId);
          if (friendId) {
            friendPreviews.set(friendId, preview);
          }
        } else {
          groupPreviews.set(row.id, preview);
        }
      }

      setPreviews({ friends: friendPreviews, groups: groupPreviews });

      if (!initializedRef.current) {
        initializedRef.current = true;
        setInitialized(true);
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) { return; }
      console.error('加载本地会话失败:', err);
      if (!initializedRef.current) {
        initializedRef.current = true;
        setInitialized(true);
      }
    } finally {
      // 仍有更新的请求在途时保持 loading，由最新请求收尾
      if (seq === requestSeqRef.current) { setLoading(false); }
    }
  }, [session]);

  useEffect(() => {
    if (!session) { return; }
    loadConversations();

    const handleChanged = () => {
      loadConversations();
    };
    window.addEventListener(PREVIEW_CHANGED_EVENT, handleChanged);
    return () => { window.removeEventListener(PREVIEW_CHANGED_EVENT, handleChanged); };
  }, [session, loadConversations]);

  const getFriendPreview = useCallback(
    (friendId: string) => previews.friends.get(friendId),
    [previews.friends],
  );

  const getGroupPreview = useCallback(
    (groupId: string) => previews.groups.get(groupId),
    [previews.groups],
  );

  return {
    previews,
    loading,
    initialized,
    refresh: loadConversations,
    getFriendPreview,
    getGroupPreview,
  };
}
