/**
 * AI 助手 API 封装
 *
 * 支持 SSE 流式对话（含 Agent Loop 工具调用）和会话管理
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { ApiClient } from './client';
import type {
  AIConversation,
  AIMessage,
  AIConversationsResponse,
} from '../types/chat';

/** 工具调用信息 */
export interface AIToolCallEvent {
  id: string;
  name: string;
  arguments: string;
}

/** 工具执行结果 */
export interface AIToolResultEvent {
  name: string;
  success: boolean;
}

/** SSE 事件回调 */
export interface AIStreamCallbacks {
  onConversationId?: (id: string) => void;
  onContent?: (text: string) => void;
  onToolCall?: (info: AIToolCallEvent) => void;
  onToolResult?: (info: AIToolResultEvent) => void;
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

/**
 * 发送 AI 对话（SSE 流式）
 *
 * 支持完整的 Agent Loop：AI 可在对话中自动调用工具，
 * 通过 tool_call / tool_result 事件实时反馈工具执行状态，
 * 工具执行完成后 AI 继续流式输出最终回复。
 */
export async function streamAIMessage(
  api: ApiClient,
  message: string,
  conversationId: string | undefined,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = api.getBaseUrl();
  const token = api.getAccessToken();

  const response = await fetch(`${baseUrl}/api/ai/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('响应体不可读');

  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ') || (eventType === 'content' && line === 'data:')) {
          const data = line.startsWith('data: ') ? line.slice(6) : '';
          switch (eventType) {
            case 'conversation_id':
              callbacks.onConversationId?.(data);
              break;
            case 'content':
              // SSE 行分隔符会吞掉内容中的 \n，表现为空 data；此时还原为换行
              callbacks.onContent?.(data || '\n');
              break;
            case 'tool_call':
              try { callbacks.onToolCall?.(JSON.parse(data)); } catch { /* ignore */ }
              break;
            case 'tool_result':
              try { callbacks.onToolResult?.(JSON.parse(data)); } catch { /* ignore */ }
              break;
            case 'usage':
              try { callbacks.onUsage?.(JSON.parse(data)); } catch { /* ignore */ }
              break;
            case 'error':
              callbacks.onError?.(data);
              break;
            case 'done':
              callbacks.onDone?.();
              break;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 获取 AI 会话列表
 */
export function getAIConversations(
  api: ApiClient,
  options?: { page?: number; perPage?: number },
): Promise<{ data: AIConversationsResponse }> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', String(options.page));
  if (options?.perPage) params.set('per_page', String(options.perPage));
  const qs = params.toString();
  return api.get<{ data: AIConversationsResponse }>(`/api/ai/conversations${qs ? `?${qs}` : ''}`);
}

/**
 * 获取 AI 会话详情（含消息）
 */
export function getAIConversation(
  api: ApiClient,
  conversationId: string,
): Promise<{ data: { conversation: AIConversation; messages: AIMessage[] } }> {
  return api.get<{ data: { conversation: AIConversation; messages: AIMessage[] } }>(
    `/api/ai/conversations/${conversationId}`,
  );
}

/**
 * 删除 AI 会话
 */
export function deleteAIConversation(
  api: ApiClient,
  conversationId: string,
): Promise<void> {
  return api.delete<void>(`/api/ai/conversations/${conversationId}`);
}

/**
 * 获取 AI 会话消息列表
 *
 * 后端返回格式: { success, code, data: AIMessage[] }
 */
export function getAIMessages(
  api: ApiClient,
  conversationId: string,
  options?: { limit?: number; before?: string },
): Promise<{ data: AIMessage[] }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const qs = params.toString();
  return api.get<{ data: AIMessage[] }>(
    `/api/ai/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
  );
}
