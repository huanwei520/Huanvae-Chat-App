/**
 * 群消息 Hook
 *
 * 提供群消息的状态管理和 API 调用
 * 支持通过 WebSocket 实时插入新消息
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useApi, useSession } from '../contexts/SessionContext';
import {
  getGroupMessages,
  sendGroupMessage,
  recallGroupMessage,
  type GroupMessage,
} from '../api/groupMessages';
import type { WsNewMessage, WsMessageRecalled } from '../types/websocket';

interface UseGroupMessagesReturn {
  messages: GroupMessage[];
  loading: boolean;
  hasMore: boolean;
  sending: boolean;
  error: string | null;
  loadMessages: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendTextMessage: (content: string) => Promise<void>;
  recall: (messageUuid: string) => Promise<void>;
  removeMessage: (messageUuid: string) => void;
  // WebSocket 事件处理方法
  handleNewMessage: (wsMsg: WsNewMessage) => void;
  handleMessageRecalled: (wsMsg: WsMessageRecalled) => void;
}

export function useGroupMessages(groupId: string | null): UseGroupMessagesReturn {
  const api = useApi();
  const { session } = useSession();

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用于追踪当前群组 ID
  const currentGroupId = useRef<string | null>(null);

  // 切换群组时重置消息
  useEffect(() => {
    if (groupId !== currentGroupId.current) {
      setMessages([]);
      setHasMore(false);
      currentGroupId.current = groupId;
    }
  }, [groupId]);

  // 加载消息
  const loadMessages = useCallback(async () => {
    if (!groupId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await getGroupMessages(api, groupId, { limit: 50 });
      setMessages(response.data?.messages || []);
      setHasMore(response.data?.has_more || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载消息失败');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [api, groupId]);

  // 加载更多历史消息
  const loadMoreMessages = useCallback(async () => {
    if (!groupId || !hasMore || messages.length === 0) { return; }

    const oldestMessage = messages[messages.length - 1];
    if (!oldestMessage) { return; }

    try {
      const response = await getGroupMessages(api, groupId, {
        beforeTime: oldestMessage.send_time,
        limit: 50,
      });
      setMessages((prev) => [...prev, ...(response.data?.messages || [])]);
      setHasMore(response.data?.has_more || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多消息失败');
    }
  }, [api, groupId, hasMore, messages]);

  /**
   * 发送文本消息
   */
  const sendTextMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!groupId || !content.trim() || !session) return;

      setSending(true);
      setError(null);

      try {
        const response = await sendGroupMessage(api, {
          group_id: groupId,
          message_content: content.trim(),
          message_type: 'text',
        });

        // 构建消息对象并添加到列表
        const newMessage: GroupMessage = {
          message_uuid: response.data.message_uuid,
          group_id: groupId,
          sender_id: session.userId,
          sender_nickname: session.profile.user_nickname,
          sender_avatar_url: session.profile.user_avatar_url ?? '',
          message_content: content.trim(),
          message_type: 'text',
          file_uuid: null,
          file_url: null,
          file_size: null,
          reply_to: null,
          send_time: response.data.send_time,
          is_recalled: false,
        };

        setMessages((prev) => [newMessage, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发送失败');
      } finally {
        setSending(false);
      }
    },
    [api, groupId, session],
  );

  // 撤回消息
  const recall = useCallback(
    async (messageUuid: string) => {
      try {
        await recallGroupMessage(api, messageUuid);
        // 更新本地消息状态
        setMessages((prev) =>
          prev.map((msg) =>
            msg.message_uuid === messageUuid
              ? { ...msg, is_recalled: true, message_content: '[消息已撤回]' }
              : msg,
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : '撤回失败');
        throw err;
      }
    },
    [api],
  );

  /** 从本地列表移除消息（不调用 API） */
  const removeMessage = useCallback((messageUuid: string) => {
    setMessages((prev) => prev.filter((m) => m.message_uuid !== messageUuid));
  }, []);

  /**
   * 处理 WebSocket 新消息通知
   * 将新消息实时插入到消息列表头部
   */
  const handleNewMessage = useCallback((wsMsg: WsNewMessage) => {
    // 只处理当前群组的消息
    if (wsMsg.source_type !== 'group' || wsMsg.source_id !== groupId) {
      return;
    }

    // 检查消息是否已存在（避免重复）
    setMessages((prev) => {
      if (prev.some((m) => m.message_uuid === wsMsg.message_uuid)) {
        return prev;
      }

      // 将 WebSocket 消息转换为 GroupMessage 类型
      const newMessage: GroupMessage = {
        message_uuid: wsMsg.message_uuid,
        group_id: wsMsg.source_id,
        sender_id: wsMsg.sender_id,
        sender_nickname: wsMsg.sender_nickname,
        sender_avatar_url: '', // WebSocket 通知不包含头像，可以后续加载
        message_content: wsMsg.preview, // WebSocket 消息的 preview 就是消息内容
        message_type: wsMsg.message_type,
        file_uuid: null,
        file_url: null,
        file_size: null,
        reply_to: null,
        send_time: wsMsg.timestamp,
        is_recalled: false,
      };

      return [newMessage, ...prev];
    });
  }, [groupId]);

  /**
   * 处理 WebSocket 消息撤回通知
   */
  const handleMessageRecalled = useCallback((wsMsg: WsMessageRecalled) => {
    // 只处理当前群组的消息
    if (wsMsg.source_type !== 'group' || wsMsg.source_id !== groupId) {
      return;
    }

    // 更新消息为已撤回状态
    setMessages((prev) =>
      prev.map((m) =>
        m.message_uuid === wsMsg.message_uuid
          ? { ...m, is_recalled: true, message_content: '[消息已撤回]' }
          : m,
      ),
    );
  }, [groupId]);

  return {
    messages,
    loading,
    hasMore,
    sending,
    error,
    loadMessages,
    loadMoreMessages,
    sendTextMessage,
    recall,
    removeMessage,
    // WebSocket 事件处理方法
    handleNewMessage,
    handleMessageRecalled,
  };
}
