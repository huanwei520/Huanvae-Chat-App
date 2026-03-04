/**
 * AI 消息管理 Hook
 *
 * 管理 AI 对话的消息列表、SSE 流式发送和历史消息加载。
 * 支持 Agent Loop 工具调用状态实时反馈。
 * conversationId 变化时自动拉取并暴露 conversationTitle 用于卡片预览。
 * 提供会话列表管理：加载、切换、删除、新建会话。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { streamAIMessage, getAIMessages, getAIConversation, getAIConversations, deleteAIConversation } from '../../api/ai';
import type { ApiClient } from '../../api/client';
import type { AIMessage, AIConversation } from '../../types/chat';

/** 工具调用实时状态 */
export interface AIToolStatus {
  name: string;
  status: 'calling' | 'done';
}

/** 过滤掉 tool 角色和仅含 tool_calls 的中间 assistant 消息，只保留用户可见内容 */
function filterVisibleMessages(msgs: AIMessage[]): AIMessage[] {
  return msgs.filter(m => {
    if (m.role === 'tool') { return false; }
    if (m.role === 'assistant' && m.tool_calls?.length && !m.content) { return false; }
    return true;
  });
}

/** 从 API 响应中提取消息数组（兼容 data 直接是数组或 { items: [...] } 两种格式） */
function extractMessages(respData: unknown): AIMessage[] {
  if (Array.isArray(respData)) { return respData; }
  if (respData && typeof respData === 'object' && 'items' in respData) {
    return (respData as { items: AIMessage[] }).items ?? [];
  }
  return [];
}

export interface UseAIMessagesReturn {
  messages: AIMessage[];
  isLoading: boolean;
  isSending: boolean;
  streamingContent: string;
  toolStatus: AIToolStatus | null;
  conversationId: string | null;
  conversationTitle: string | null;
  hasMore: boolean;
  loadMessages: (convId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  conversations: AIConversation[];
  conversationsLoading: boolean;
  loadConversations: () => Promise<void>;
  switchConversation: (convId: string) => Promise<void>;
  deleteConversation: (convId: string) => Promise<void>;
  newConversation: () => void;
}

export function useAIMessages(api: ApiClient | null): UseAIMessagesReturn {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<AIToolStatus | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // conversationId 变化时自动拉取会话标题
  useEffect(() => {
    if (!api || !conversationId) {
      setConversationTitle(null);
      return;
    }
    let cancelled = false;
    getAIConversation(api, conversationId)
      .then(resp => {
        if (!cancelled) {
          setConversationTitle(resp.data.conversation.title);
        }
      })
      .catch(() => { /* 静默失败，标题非关键 */ });
    return () => { cancelled = true; };
  }, [api, conversationId]);

  const loadMessages = useCallback(async (convId: string) => {
    if (!api) { return; }
    setIsLoading(true);
    try {
      const resp = await getAIMessages(api, convId, { limit: 50 });
      const allMsgs = extractMessages(resp.data);
      const visible = filterVisibleMessages(allMsgs);
      setMessages(visible);
      setConversationId(convId);
      setHasMore(false);
    } catch (err) {
      console.error('[AI] 加载消息失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const sendMessage = useCallback(async (content: string) => {
    if (!api || !content.trim()) { return; }

    const userMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsSending(true);
    setStreamingContent('');
    setToolStatus(null);

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    let accumulated = '';

    try {
      await streamAIMessage(
        api,
        content.trim(),
        conversationId ?? undefined,
        {
          onConversationId: (id) => {
            setConversationId(id);
          },
          onContent: (text) => {
            accumulated += text;
            setStreamingContent(accumulated);
          },
          onToolCall: (info) => {
            setToolStatus({ name: info.name, status: 'calling' });
          },
          onToolResult: (info) => {
            setToolStatus({ name: info.name, status: 'done' });
          },
          onError: (error) => {
            console.error('[AI] 流式错误:', error);
          },
          onDone: () => {
            if (accumulated) {
              const assistantMsg: AIMessage = {
                id: `ai-${Date.now()}`,
                role: 'assistant',
                content: accumulated,
                created_at: new Date().toISOString(),
              };
              setMessages(prev => [...prev, assistantMsg]);
            }
            setStreamingContent('');
            setToolStatus(null);
          },
        },
        abortController.signal,
      );
    } catch (err) {
      if (!abortController.signal.aborted) {
        console.error('[AI] 发送失败:', err);
        if (accumulated) {
          const partialMsg: AIMessage = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: accumulated,
            created_at: new Date().toISOString(),
          };
          setMessages(prev => [...prev, partialMsg]);
          setStreamingContent('');
        }
      }
    } finally {
      setIsSending(false);
      setToolStatus(null);
    }
  }, [api, conversationId]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setConversationTitle(null);
    setStreamingContent('');
    setToolStatus(null);
    setHasMore(false);
  }, []);

  const loadConversations = useCallback(async () => {
    if (!api) { return; }
    setConversationsLoading(true);
    try {
      const resp = await getAIConversations(api, { perPage: 50 });
      const data = resp.data;
      const list = Array.isArray(data) ? data : (data?.conversations ?? []);
      setConversations(list);
    } catch (err) {
      console.error('[AI] 加载会话列表失败:', err);
    } finally {
      setConversationsLoading(false);
    }
  }, [api]);

  const switchConversation = useCallback(async (convId: string) => {
    if (convId === conversationId) { return; }
    abortRef.current?.abort();
    setStreamingContent('');
    setToolStatus(null);
    await loadMessages(convId);
  }, [conversationId, loadMessages]);

  const deleteConv = useCallback(async (convId: string) => {
    if (!api) { return; }
    try {
      await deleteAIConversation(api, convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (conversationId === convId) {
        clearMessages();
      }
    } catch (err) {
      console.error('[AI] 删除会话失败:', err);
    }
  }, [api, conversationId, clearMessages]);

  const newConversation = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  return {
    messages,
    isLoading,
    isSending,
    streamingContent,
    toolStatus,
    conversationId,
    conversationTitle,
    hasMore,
    loadMessages,
    sendMessage,
    clearMessages,
    conversations,
    conversationsLoading,
    loadConversations,
    switchConversation,
    deleteConversation: deleteConv,
    newConversation,
  };
}
