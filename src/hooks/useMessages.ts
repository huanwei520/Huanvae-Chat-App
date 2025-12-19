/**
 * 消息管理 Hook
 *
 * 提供私聊消息的状态管理和 API 调用
 * 支持通过 WebSocket 实时插入新消息
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useApi, useSession } from '../contexts/SessionContext';
import { getMessages, sendMessage, recallMessage } from '../api/messages';
import type { Message, MessageType } from '../types/chat';
import type { WsNewMessage, WsMessageRecalled } from '../types/websocket';

export function useMessages(friendId: string | null) {
  const api = useApi();
  const { session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // 用于追踪当前好友 ID
  const currentFriendId = useRef<string | null>(null);

  // 切换好友时重置消息
  useEffect(() => {
    if (friendId !== currentFriendId.current) {
      setMessages([]);
      setHasMore(true);
      currentFriendId.current = friendId;
    }
  }, [friendId]);

  /** 加载最新消息 */
  const loadMessages = useCallback(async (limit = 50) => {
    if (!friendId) {
      return;
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

  /**
   * 发送文本消息
   */
  const sendTextMessage = useCallback(async (content: string): Promise<void> => {
    if (!friendId || !content.trim() || !session) return;

    setSending(true);
    setError(null);

    try {
      const response = await sendMessage(api, {
        receiver_id: friendId,
        message_content: content,
        message_type: 'text',
      });

      // 构建消息对象并添加到列表
      const newMessage: Message = {
        message_uuid: response.message_uuid,
        sender_id: session.userId,
        receiver_id: friendId,
        message_content: content,
        message_type: 'text',
        file_uuid: null,
        file_url: null,
        file_size: null,
        send_time: response.send_time,
      };

      setMessages((prev) => [newMessage, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [api, friendId, session]);

  /** 发送媒体消息（乐观更新） */
  const sendMediaMessage = useCallback(async (
    content: string,
    messageType: MessageType,
    fileUuid?: string,
    fileUrl?: string,
    fileSize?: number,
  ) => {
    if (!friendId || !session) {
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

      // 乐观更新：立即将新消息插入到列表头部
      const newMessage: Message = {
        message_uuid: response.message_uuid,
        sender_id: session.userId,
        receiver_id: friendId,
        message_content: content,
        message_type: messageType,
        file_uuid: fileUuid ?? null,
        file_url: fileUrl ?? null,
        file_size: fileSize ?? null,
        send_time: response.send_time,
      };

      setMessages((prev) => [newMessage, ...prev]);

      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSending(false);
    }
  }, [api, friendId, session]);

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

  /** 从本地列表移除消息（不调用 API） */
  const removeMessage = useCallback((messageUuid: string) => {
    setMessages((prev) => prev.filter((m) => m.message_uuid !== messageUuid));
  }, []);

  /**
   * 处理 WebSocket 新消息通知
   * 将新消息实时插入到消息列表头部
   */
  const handleNewMessage = useCallback((wsMsg: WsNewMessage) => {
    // 只处理当前好友的消息
    if (wsMsg.source_type !== 'friend' || wsMsg.source_id !== friendId) {
      return;
    }

    // 检查消息是否已存在（避免重复）
    setMessages((prev) => {
      if (prev.some((m) => m.message_uuid === wsMsg.message_uuid)) {
        return prev;
      }

      // 将 WebSocket 消息转换为 Message 类型
      const newMessage: Message = {
        message_uuid: wsMsg.message_uuid,
        sender_id: wsMsg.sender_id,
        receiver_id: session?.userId ?? '',
        message_content: wsMsg.preview, // WebSocket 消息的 preview 就是消息内容
        message_type: wsMsg.message_type,
        file_uuid: null, // WebSocket 通知不包含文件信息，需要时可以加载
        file_url: null,
        file_size: null,
        send_time: wsMsg.timestamp,
      };

      return [newMessage, ...prev];
    });
  }, [friendId, session?.userId]);

  /**
   * 处理 WebSocket 消息撤回通知
   */
  const handleMessageRecalled = useCallback((wsMsg: WsMessageRecalled) => {
    // 只处理当前好友的消息
    if (wsMsg.source_type !== 'friend' || wsMsg.source_id !== friendId) {
      return;
    }

    // 从列表中移除被撤回的消息
    setMessages((prev) => prev.filter((m) => m.message_uuid !== wsMsg.message_uuid));
  }, [friendId]);

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
    removeMessage,
    // WebSocket 事件处理方法
    handleNewMessage,
    handleMessageRecalled,
  };
}
