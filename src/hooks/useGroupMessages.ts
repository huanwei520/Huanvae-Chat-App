/**
 * 群消息 Hook
 *
 * 提供群消息的状态管理和 API 调用
 */

import { useState, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  getGroupMessages,
  sendGroupMessage,
  recallGroupMessage,
  type GroupMessage,
} from '../api/groupMessages';

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
}

export function useGroupMessages(groupId: string | null): UseGroupMessagesReturn {
  const api = useApi();

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // 发送文本消息
  const sendTextMessage = useCallback(
    async (content: string) => {
      if (!groupId || !content.trim()) { return; }

      setSending(true);
      setError(null);

      try {
        const response = await sendGroupMessage(api, {
          group_id: groupId,
          message_content: content.trim(),
          message_type: 'text',
        });

        // 添加新消息到列表（需要构造完整的消息对象）
        const newMessage: GroupMessage = {
          message_uuid: response.data.message_uuid,
          group_id: groupId,
          sender_id: '', // 会在刷新时获取
          sender_nickname: '',
          sender_avatar_url: '',
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
        throw err;
      } finally {
        setSending(false);
      }
    },
    [api, groupId],
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
  };
}
