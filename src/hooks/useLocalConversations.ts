/**
 * 本地会话管理 Hook
 *
 * 提供本地会话数据，用于显示消息预览等信息
 * 当 WebSocket 的 unreadSummary 没有某个会话的数据时，使用本地数据作为 fallback
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import * as db from '../db';
import { getFriendConversationId } from '../utils/conversationId';

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
  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 获取好友的消息预览 */
  getFriendPreview: (friendId: string) => ConversationPreview | undefined;
  /** 获取群组的消息预览 */
  getGroupPreview: (groupId: string) => ConversationPreview | undefined;
}

export function useLocalConversations(): UseLocalConversationsReturn {
  const { session } = useSession();
  const [previews, setPreviews] = useState<ConversationPreviews>({
    friends: new Map(),
    groups: new Map(),
  });
  const [loading, setLoading] = useState(false);

  // 加载本地会话数据
  const loadConversations = useCallback(async () => {
    if (!session) {
      return;
    }

    setLoading(true);

    try {
      const conversations = await db.getConversations();
      const friendPreviews = new Map<string, ConversationPreview>();
      const groupPreviews = new Map<string, ConversationPreview>();

      for (const conv of conversations) {
        let lastMessage = conv.last_message;
        let lastMessageTime = conv.last_message_time;

        // 如果会话没有 last_message，从消息表获取最新消息
        if (!lastMessage) {
          try {
            const latestMsg = await db.getLatestMessage(conv.id);
            if (latestMsg) {
              lastMessage = latestMsg.content_type === 'text'
                ? latestMsg.content
                : latestMsg.content_type === 'image'
                  ? '[图片]'
                  : latestMsg.content_type === 'video'
                    ? '[视频]'
                    : '[文件]';
              lastMessageTime = latestMsg.send_time;
            }
          } catch {
            // 忽略错误
          }
        }

        const preview: ConversationPreview = {
          conversationId: conv.id,
          lastMessage,
          lastMessageTime,
          lastSeq: conv.last_seq,
        };

        if (conv.type === 'friend') {
          // 从 conversation_id 提取 friend_id
          // 格式: conv-{user1}-{user2}
          const parts = conv.id.split('-');
          if (parts.length === 3) {
            const [, id1, id2] = parts;
            // friend_id 是不等于当前用户的那个
            const friendId = id1 === session.userId ? id2 : id1;
            friendPreviews.set(friendId, preview);
          }
        } else {
          // 群组的 conversation_id 就是 group_id
          groupPreviews.set(conv.id, preview);
        }
      }

      setPreviews({
        friends: friendPreviews,
        groups: groupPreviews,
      });

      console.log('[LocalConv] 加载本地会话预览:', {
        friends: friendPreviews.size,
        groups: groupPreviews.size,
      });
    } catch (err) {
      console.warn('[LocalConv] 加载本地会话失败:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  // 初始化加载 + 定时刷新
  useEffect(() => {
    if (!session) {
      return;
    }

    // 初始加载
    loadConversations();

    // 每 5 秒刷新一次（确保获取最新的消息预览）
    const intervalId = setInterval(() => {
      loadConversations();
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [session, loadConversations]);

  // 获取好友预览
  const getFriendPreview = useCallback(
    (friendId: string) => previews.friends.get(friendId),
    [previews.friends],
  );

  // 获取群组预览
  const getGroupPreview = useCallback(
    (groupId: string) => previews.groups.get(groupId),
    [previews.groups],
  );

  return {
    previews,
    loading,
    refresh: loadConversations,
    getFriendPreview,
    getGroupPreview,
  };
}

