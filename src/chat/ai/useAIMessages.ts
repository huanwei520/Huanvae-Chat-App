/**
 * AI 消息管理 Hook
 *
 * 管理 AI 对话的消息列表、SSE 流式发送和历史消息加载。
 * 支持 Agent Loop 工具调用状态实时反馈。
 * conversationId 变化时自动拉取并暴露 conversationTitle 用于卡片预览。
 * 提供会话列表管理：加载、切换、删除、新建会话。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { streamAIMessage, getAIMessages, getAIConversation, getAIConversations, deleteAIConversation, confirmToolCall, rejectToolCall } from '../../api/ai';
import type { ApiClient } from '../../api/client';
import type { AIMessage, AIConversation } from '../../types/chat';
import type { AIToolCallPendingEvent, ToolCallConfirmResult } from '../../api/ai';

/** 工具调用实时状态 */
export interface AIToolStatus {
  name: string;
  status: 'calling' | 'done';
}

/** 待确认的写操作工具调用 */
export interface AIPendingToolCall {
  pendingId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expiresAt: string;
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
  streamingReasoning: string;
  toolStatus: AIToolStatus | null;
  pendingToolCall: AIPendingToolCall | null;
  conversationId: string | null;
  conversationTitle: string | null;
  hasMore: boolean;
  loadMessages: (convId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => void;
  clearMessages: () => void;
  handleConfirmToolCall: (pendingId: string) => Promise<void>;
  handleRejectToolCall: (pendingId: string) => Promise<void>;
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
          setConversationTitle(resp.conversation.title);
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
      const allMsgs = extractMessages(resp);
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
            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(info.arguments); } catch { /* ignore */ }
            setPendingToolCall({
              pendingId: info.pending_id,
              toolName: info.name,
              arguments: parsedArgs,
              expiresAt: info.expires_at,
            });
            // tool_call_pending 后不再需要显示 toolStatus，用 pendingToolCall 卡片代替
            setToolStatus(null);
          },
          onToolResult: (info) => {
            // 只有非 pending 的工具（只读工具自动执行）才会在这里收到 result
            // pending 工具的结果在 confirm/reject 回调中处理
            setToolStatus({ name: info.name, status: 'done' });
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
            // 注意：不要在这里清除 pendingToolCall！
            // tool_call_pending 后 done 会立即触发，但用户还需要在卡片上确认/拒绝
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

  /**
   * 确认工具调用后，自动发起新的 SSE 流请求让 AI 基于工具结果继续回复。
   * 发送一条特殊的"continuation"消息，让 AI 知道工具已执行成功。
   */
  const continuateAfterToolCall = useCallback(async (
    result: ToolCallConfirmResult,
    action: 'confirmed' | 'rejected',
  ) => {
    if (!api || !conversationId) { return; }
    // 构造通知消息让 AI 继续回复
    const notifyMsg = action === 'confirmed'
      ? `[系统通知] 用户已确认执行工具「${result.tool_name}」，执行${result.success ? '成功' : '失败'}。请基于执行结果继续回复。`
      : `[系统通知] 用户拒绝了工具「${result.tool_name}」的执行。请告知用户操作已取消。`;

    setIsSending(true);
    setStreamingContent('');
    setStreamingReasoning('');
    setToolStatus(null);

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    let accumulated = '';
    let accumulatedReasoning = '';

    try {
      await streamAIMessage(
        api,
        notifyMsg,
        conversationId,
        {
          onConversationId: () => { /* 已有 conversationId */ },
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
            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(info.arguments); } catch { /* ignore */ }
            setPendingToolCall({
              pendingId: info.pending_id,
              toolName: info.name,
              arguments: parsedArgs,
              expiresAt: info.expires_at,
            });
            setToolStatus(null);
          },
          onToolResult: (info) => {
            setToolStatus({ name: info.name, status: 'done' });
          },
          onDone: () => {
            if (accumulated) {
              const assistantMsg: AIMessage = {
                id: `ai-${Date.now()}`,
                role: 'assistant',
                content: accumulated,
                reasoning: accumulatedReasoning || null,
                created_at: new Date().toISOString(),
              };
              setMessages(prev => [...prev, assistantMsg]);
            }
            setStreamingContent('');
            setStreamingReasoning('');
            setToolStatus(null);
          },
          onError: (error) => {
            console.error('[AI] 工具确认后续流错误:', error);
          },
        },
        abortController.signal,
      );
    } catch (err) {
      console.error('[AI] 工具确认后续请求失败:', err);
    } finally {
      setIsSending(false);
    }
  }, [api, conversationId]);

  const handleConfirmTC = useCallback(async (pendingId: string) => {
    if (!api) { return; }
    try {
      const result = await confirmToolCall(api, pendingId);
      setPendingToolCall(null);
      // 自动触发 AI 继续回复
      await continuateAfterToolCall(result, 'confirmed');
    } catch (err) {
      console.error('[AI] 确认工具调用失败:', err);
    }
  }, [api, continuateAfterToolCall]);

  const handleRejectTC = useCallback(async (pendingId: string) => {
    if (!api) { return; }
    // 保存当前 pending 信息用于后续通知
    const currentPending = pendingToolCall;
    try {
      await rejectToolCall(api, pendingId);
      setPendingToolCall(null);
      // 自动触发 AI 告知用户操作已取消
      await continuateAfterToolCall(
        {
          pending_id: pendingId,
          tool_name: currentPending?.toolName ?? '未知操作',
          success: false,
          result: {},
        },
        'rejected',
      );
    } catch (err) {
      console.error('[AI] 拒绝工具调用失败:', err);
    }
  }, [api, continuateAfterToolCall, pendingToolCall]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setConversationTitle(null);
    setStreamingContent('');
    setStreamingReasoning('');
    setToolStatus(null);
    setPendingToolCall(null);
    setHasMore(false);
  }, []);

  const loadConversations = useCallback(async () => {
    if (!api) { return; }
    setConversationsLoading(true);
    try {
      const resp = await getAIConversations(api, { perPage: 50 });
      const list = Array.isArray(resp) ? resp : (resp?.conversations ?? []);
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
    streamingReasoning,
    toolStatus,
    pendingToolCall,
    conversationId,
    conversationTitle,
    hasMore,
    loadMessages,
    sendMessage,
    retryLastMessage,
    clearMessages,
    handleConfirmToolCall: handleConfirmTC,
    handleRejectToolCall: handleRejectTC,
    conversations,
    conversationsLoading,
    loadConversations,
    switchConversation,
    deleteConversation: deleteConv,
    newConversation,
  };
}
