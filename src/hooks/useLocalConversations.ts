/**
 * 本地会话管理 Hook
 *
 * 通过 db_get_conversation_previews（SQL JOIN）一次性查出每个会话的最新消息，
 * 替代原先的 N+1 查询（getConversations + 逐条 getLatestMessage）。
 *
 * 数据更新策略：事件驱动，由外部在消息变更时调用 refresh()。
 * 不再使用 5 秒定时轮询。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { parseFriendIdFromConversationId } from '../utils/conversationId';
import * as db from '../db';

const PREVIEW_CHANGED_EVENT = 'conversation-previews-changed';

/**
 * 手动触发预览刷新（备用）。
 * 常规场景已由 db/index.ts 的写入防抖自动触发，无需手动调用。
 */
export function notifyPreviewsChanged(): void {
  window.dispatchEvent(new CustomEvent(PREVIEW_CHANGED_EVENT));
}

/** 会话预览信息 */
export interface ConversationPreview {
  conversationId: string;
  lastMessage: string | null;
  lastMessageTime: string | null;
  lastSeq: number;
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
};

/** 将 content_type + content 转为用户可读的预览文本 */
function toPreviewText(contentType: string | null, content: string | null): string | null {
  if (!contentType || content === null) { return null; }
  return CONTENT_TYPE_MAP[contentType] ?? content;
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
        const preview: ConversationPreview = {
          conversationId: row.id,
          lastMessage: toPreviewText(row.msg_content_type, row.msg_content),
          lastMessageTime: row.msg_send_time,
          lastSeq: row.last_seq,
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
