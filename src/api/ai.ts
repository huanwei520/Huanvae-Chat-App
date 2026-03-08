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

/** 写操作工具待确认事件 */
export interface AIToolCallPendingEvent {
  pending_id: string;
  /** 后端实际返回 `name` 字段（文档标注为 tool_name） */
  name: string;
  arguments: string;
  expires_at: string;
}

/** 工具确认 API 响应 */
export interface ToolCallConfirmResult {
  pending_id: string;
  tool_name: string;
  success: boolean;
  result: Record<string, unknown>;
}

/** AI 处理阶段状态 */
export type AIStatus = 'thinking' | 'reasoning' | 'responding' | 'tool_calling' | 'waiting_confirmation';

/** SSE 事件回调 */
export interface AIStreamCallbacks {
  onConversationId?: (id: string) => void;
  onStatus?: (status: AIStatus) => void;
  onReasoning?: (text: string) => void;
  onContent?: (text: string) => void;
  onToolCall?: (info: AIToolCallEvent) => void;
  onToolCallPending?: (info: AIToolCallPendingEvent) => void;
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
  if (!reader) { throw new Error('响应体不可读'); }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) { break; }

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
            case 'status':
              callbacks.onStatus?.(data as AIStatus);
              break;
            case 'reasoning':
              callbacks.onReasoning?.(data || '\n');
              break;
            case 'content':
              callbacks.onContent?.(data || '\n');
              break;
            case 'tool_call':
              try { callbacks.onToolCall?.(JSON.parse(data)); } catch { /* ignore */ }
              break;
            case 'tool_call_pending':
              try { callbacks.onToolCallPending?.(JSON.parse(data)); } catch { /* ignore */ }
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
  if (options?.page) { params.set('page', String(options.page)); }
  if (options?.perPage) { params.set('per_page', String(options.perPage)); }
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
  if (options?.limit) { params.set('limit', String(options.limit)); }
  if (options?.before) { params.set('before', options.before); }
  const qs = params.toString();
  return api.get<{ data: AIMessage[] }>(
    `/api/ai/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
  );
}

// ============================================================
// 工具调用确认 API
// ============================================================

/** 确认执行待确认的写操作工具，返回工具执行结果 */
export async function confirmToolCall(api: ApiClient, pendingId: string): Promise<ToolCallConfirmResult> {
  const resp = await api.post<{ data: ToolCallConfirmResult }>(`/api/ai/tool_calls/${pendingId}/confirm`);
  return resp.data;
}

/** 拒绝执行待确认的写操作工具 */
export async function rejectToolCall(api: ApiClient, pendingId: string): Promise<void> {
  await api.post<void>(`/api/ai/tool_calls/${pendingId}/reject`);
}

// ============================================================
// 声音配置（声音克隆）API
// ============================================================

/** 声音配置信息 */
export interface VoiceProfile {
  profile_id: string;
  voice_name: string;
  speaker_id: string;
  system_prompt: string | null;
  is_default: boolean;
  created_at: string;
}

/**
 * 上传声音（创建声音配置）
 *
 * 使用 FormData 上传参考音频，后端基于 IndexTTS-2 生成声音配置。
 * 音频建议 5-30 秒清晰人声 WAV 文件。
 */
export async function createVoiceProfile(
  api: ApiClient,
  voiceName: string,
  audioBlob: Blob,
  audioFileName: string,
  systemPrompt?: string,
): Promise<VoiceProfile> {
  const baseUrl = api.getBaseUrl();
  const token = api.getAccessToken();

  console.warn('[VoiceProfile] 开始上传声音配置', {
    voiceName,
    audioFileName,
    blobSize: audioBlob.size,
    blobType: audioBlob.type,
  });

  const audioFile = new File([audioBlob], audioFileName, { type: 'audio/wav' });
  console.warn('[VoiceProfile] File 对象已创建', {
    fileName: audioFile.name,
    fileSize: audioFile.size,
    fileType: audioFile.type,
  });

  const formData = new FormData();
  formData.append('voice_name', voiceName);
  formData.append('audio', audioFile);
  if (systemPrompt) {
    formData.append('system_prompt', systemPrompt);
  }

  const url = `${baseUrl}/api/ai/voice_profiles`;
  console.warn('[VoiceProfile] 发送 POST 请求 (使用原生 fetch)', { url });

  // 必须使用原生 fetch，Tauri plugin-http 的 fetch 不能正确序列化 FormData
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });

  console.warn('[VoiceProfile] 收到响应', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
  });

  if (!response.ok) {
    const rawText = await response.text();
    console.error('[VoiceProfile] 上传失败，响应体:', rawText);
    let errMsg = `上传失败 (${response.status})`;
    try {
      const errJson = JSON.parse(rawText);
      errMsg = errJson.message || errJson.detail || errJson.error || errMsg;
    } catch { /* not JSON */ }
    throw new Error(errMsg);
  }

  const result = await response.json() as VoiceProfile;
  console.warn('[VoiceProfile] 上传成功', result);
  return result;
}

/** 获取声音配置列表 */
// eslint-disable-next-line require-await
export async function getVoiceProfiles(api: ApiClient): Promise<VoiceProfile[]> {
  return api.get<VoiceProfile[]>('/api/ai/voice_profiles');
}

/** 设为默认声音 */
export async function setDefaultVoiceProfile(api: ApiClient, profileId: string): Promise<void> {
  await api.put<void>(`/api/ai/voice_profiles/${profileId}/default`);
}

/** 删除声音配置 */
export async function deleteVoiceProfile(api: ApiClient, profileId: string): Promise<void> {
  await api.delete<void>(`/api/ai/voice_profiles/${profileId}`);
}

/** 更新声音配置的 system_prompt（自定义语音人设） */
export async function updateVoiceProfilePrompt(
  api: ApiClient,
  profileId: string,
  systemPrompt: string | null,
): Promise<void> {
  await api.put<void>(`/api/ai/voice_profiles/${profileId}/prompt`, {
    system_prompt: systemPrompt,
  });
}
