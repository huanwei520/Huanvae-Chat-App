/**
 * 消息管理 Hook
 */

import { useState, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { getMessages, sendMessage, recallMessage } from '../api/messages';
import type { Message, MessageType } from '../types/chat';

export function useMessages(friendId: string | null) {
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // 用于追踪当前好友 ID
  const currentFriendId = useRef<string | null>(null);

  /** 加载最新消息 */
  const loadMessages = useCallback(async (limit = 50) => {
    if (!friendId) {
      return;
    }

    // 如果切换了好友，重置状态
    if (currentFriendId.current !== friendId) {
      setMessages([]);
      setHasMore(true);
      currentFriendId.current = friendId;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await getMessages(api, friendId, { limit });
      setMessages(response.messages);
      setHasMore(response.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, friendId]);

  /** 加载更多历史消息 */
  const loadMoreMessages = useCallback(async (limit = 50) => {
    if (!friendId || !hasMore || messages.length === 0) {
      return;
    }

    setLoadingMore(true);

    try {
      const oldestMessage = messages[messages.length - 1];
      const response = await getMessages(api, friendId, {
        beforeTime: oldestMessage.send_time,
        limit,
      });

      setMessages((prev) => [...prev, ...response.messages]);
      setHasMore(response.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [api, friendId, hasMore, messages]);

  /** 发送文本消息 */
  const sendTextMessage = useCallback(async (content: string) => {
    if (!friendId || !content.trim()) {
      return null;
    }

    setSending(true);
    setError(null);

    try {
      const response = await sendMessage(api, {
        receiver_id: friendId,
        message_content: content,
        message_type: 'text',
      });

      // 重新加载消息以获取完整的消息对象
      await loadMessages();

      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSending(false);
    }
  }, [api, friendId, loadMessages]);

  /** 发送媒体消息 */
  const sendMediaMessage = useCallback(async (
    content: string,
    messageType: MessageType,
    fileUuid?: string,
    fileUrl?: string,
    fileSize?: number,
  ) => {
    if (!friendId) {
      return null;
    }

    setSending(true);
    setError(null);

    try {
      const response = await sendMessage(api, {
        receiver_id: friendId,
        message_content: content,
        message_type: messageType,
        file_uuid: fileUuid,
        file_url: fileUrl,
        file_size: fileSize,
      });

      await loadMessages();
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSending(false);
    }
  }, [api, friendId, loadMessages]);

  /** 撤回消息 */
  const recall = useCallback(async (messageUuid: string) => {
    try {
      await recallMessage(api, messageUuid);
      // 从本地列表移除
      setMessages((prev) => prev.filter((m) => m.message_uuid !== messageUuid));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [api]);

  /** 刷新消息 */
  const refresh = useCallback(() => {
    return loadMessages();
  }, [loadMessages]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    sending,
    loadMessages,
    loadMoreMessages,
    sendTextMessage,
    sendMediaMessage,
    recall,
    refresh,
  };
}
