/**
 * AI 消息管理 Hook
 *
 * 管理 AI 对话的消息列表、SSE 流式发送和历史消息加载。
 * 支持 Agent Loop 工具调用状态实时反馈。
 * conversationId 变化时自动拉取并暴露 conversationTitle 用于卡片预览。
 * 提供会话列表管理：加载、切换、删除、新建会话。
 *
 * Agent 工具确认机制：
 * - 写操作工具通过 tool_call_pending 事件暂停 SSE 流
 * - 前端展示确认弹窗，用户选择确认/拒绝
 * - 调用 confirmToolCall/rejectToolCall API 后 SSE 流继续
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  streamAIMessage,
  getAIMessages,
  getAIConversation,
  getAIConversations,
  deleteAIConversation,
  confirmToolCall as apiConfirmToolCall,
  rejectToolCall as apiRejectToolCall,
} from '../../api/ai';
import type { AIToolCallPendingEvent, AIStatus } from '../../api/ai';
import type { ApiClient } from '../../api/client';
import type { AIMessage, AIConversation } from '../../types/chat';

/** 工具调用实时状态 */
export interface AIToolStatus {
  name: string;
  status: 'calling' | 'done' | 'pending_confirm';
}

/** 待确认的写操作工具调用（前端状态） */
export interface AIPendingToolCall {
  pendingId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expiresAt: string;
}

export { type AIStatus } from '../../api/ai';

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
  streamingReasoning: string;
  toolStatus: AIToolStatus | null;
  aiStatus: AIStatus | null;
  pendingToolCall: AIPendingToolCall | null;
  conversationId: string | null;
  conversationTitle: string | null;
  hasMore: boolean;
  loadMessages: (convId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => void;
  clearMessages: () => void;
  confirmPendingTool: () => Promise<void>;
  rejectPendingTool: () => Promise<void>;
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
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [toolStatus, setToolStatus] = useState<AIToolStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [pendingToolCall, setPendingToolCall] = useState<AIPendingToolCall | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserContentRef = useRef<string | null>(null);

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

    const trimmed = content.trim();
    lastUserContentRef.current = trimmed;

    const userMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsSending(true);
    setStreamingContent('');
    setStreamingReasoning('');
    setToolStatus(null);
    setAiStatus(null);
    setPendingToolCall(null);

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    let accumulated = '';
    let accumulatedReasoning = '';
    let streamError = '';

    try {
      await streamAIMessage(
        api,
        trimmed,
        conversationId ?? undefined,
        {
          onConversationId: (id) => {
            setConversationId(id);
          },
          onStatus: (status) => {
            setAiStatus(status);
          },
          onReasoning: (text) => {
            accumulatedReasoning += text;
            setStreamingReasoning(accumulatedReasoning);
          },
          onContent: (text) => {
            accumulated += text;
            setStreamingContent(accumulated);
          },
          onToolCall: (info) => {
            setToolStatus({ name: info.name, status: 'calling' });
          },
          onToolCallPending: (info: AIToolCallPendingEvent) => {
            setToolStatus({ name: info.tool_name, status: 'pending_confirm' });
            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(info.arguments); } catch { /* ignore */ }
            setPendingToolCall({
              pendingId: info.pending_id,
              toolName: info.tool_name,
              arguments: parsedArgs,
              expiresAt: info.expires_at,
            });
          },
          onToolResult: (info) => {
            setToolStatus({ name: info.name, status: 'done' });
            setPendingToolCall(null);
          },
          onError: (error) => {
            console.error('[AI] 流式错误:', error);
            streamError = error;
          },
          onDone: () => {
            const assistantMsg: AIMessage = {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: accumulated || null,
              reasoning: accumulatedReasoning || null,
              error: streamError || null,
              created_at: new Date().toISOString(),
            };

            if (accumulated || streamError) {
              setMessages(prev => [...prev, assistantMsg]);
            }
            setStreamingContent('');
            setStreamingReasoning('');
            setToolStatus(null);
            setAiStatus(null);
            setPendingToolCall(null);
          },
        },
        abortController.signal,
      );
    } catch (err) {
      if (!abortController.signal.aborted) {
        console.error('[AI] 发送失败:', err);
        const errorMsg = err instanceof Error ? err.message : '网络请求失败';
        const partialMsg: AIMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: accumulated || null,
          error: errorMsg,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, partialMsg]);
        setStreamingContent('');
        setStreamingReasoning('');
      }
    } finally {
      setIsSending(false);
      setToolStatus(null);
      setAiStatus(null);
    }
  }, [api, conversationId]);

  const retryLastMessage = useCallback(() => {
    const lastContent = lastUserContentRef.current;
    if (!lastContent) { return; }

    // 移除最后一条出错的 assistant 消息和对应的 user 消息
    setMessages(prev => {
      const copy = [...prev];
      // 移除末尾的 assistant 错误消息
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        copy.pop();
      }
      // 移除末尾的 user 消息
      if (copy.length > 0 && copy[copy.length - 1].role === 'user') {
        copy.pop();
      }
      return copy;
    });

    sendMessage(lastContent);
  }, [sendMessage]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setConversationTitle(null);
    setStreamingContent('');
    setStreamingReasoning('');
    setToolStatus(null);
    setAiStatus(null);
    setPendingToolCall(null);
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
    setStreamingReasoning('');
    setToolStatus(null);
    setAiStatus(null);
    setPendingToolCall(null);
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

  const confirmPendingTool = useCallback(async () => {
    if (!api || !pendingToolCall) { return; }
    try {
      await apiConfirmToolCall(api, pendingToolCall.pendingId);
      setPendingToolCall(null);
    } catch (err) {
      console.error('[AI] 确认工具调用失败:', err);
    }
  }, [api, pendingToolCall]);

  const rejectPendingTool = useCallback(async () => {
    if (!api || !pendingToolCall) { return; }
    try {
      await apiRejectToolCall(api, pendingToolCall.pendingId);
      setPendingToolCall(null);
      setToolStatus(null);
    } catch (err) {
      console.error('[AI] 拒绝工具调用失败:', err);
    }
  }, [api, pendingToolCall]);

  const newConversation = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  return {
    messages,
    isLoading,
    isSending,
    streamingContent,
    streamingReasoning,
    toolStatus,
    aiStatus,
    pendingToolCall,
    conversationId,
    conversationTitle,
    hasMore,
    loadMessages,
    sendMessage,
    retryLastMessage,
    clearMessages,
    confirmPendingTool,
    rejectPendingTool,
    conversations,
    conversationsLoading,
    loadConversations,
    switchConversation,
    deleteConversation: deleteConv,
    newConversation,
  };
}
