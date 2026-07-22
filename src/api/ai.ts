/**
 * AI 助手 API 封装
 *
 * 支持 SSE 流式对话（含 Agent Loop 工具调用）和会话管理
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import { resolveForSecureHttp, rediscoverOnFailure } from '../services/discovery';
import { rewriteUrlHost } from '../services/secureFetch';
import { proxyRequestUrl } from '../services/secureProxy';
import type { ApiClient } from './client';
import type {
  AIConversation,
  AIMessage,
  AIConversationsResponse,
} from '../types/chat';

/** secure_http_stream(Rust)经 Channel 推回的事件(对齐 secure_net.rs StreamEvent) */
type SecureStreamEvent =
  | { event: 'open'; status: number }
  | { event: 'chunk'; data: string }
  | { event: 'done' }
  | { event: 'error'; message: string };

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
 * 判定一次 SSE 流式 error 是否为"连接建立阶段失败"(→ 触发 IP 池轮换 failover)。纯函数,便于单测。
 * - `opened=false`:尚未收到 open 事件 = 连接未建立;排除 mid-stream(open 后)读错误(此时切 IP 无意义)。
 * - message 以 '请求失败' 开头:secure_net.rs 的 secure_http_stream **仅**在 `rb.send().await` 失败
 *   (连接建立/TLS 握手/网络错误)时用该前缀;非 2xx 用 body/'HTTP <code>'、mid-stream 用 '流读取失败'
 *   → 均不匹配 → 不对"可达但返错的服务器"(4xx/5xx)误切。
 *   ⚠️ JS↔Rust 前缀约定:改 secure_net.rs 连接失败错误文案(`format!("请求失败: {e}")`)须同步此处。
 */
export function isStreamConnectFailure(opened: boolean, message: string): boolean {
  return !opened && message.startsWith('请求失败');
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

  // SSE 行解析状态(逻辑同原 reader 循环,由 Channel chunk 驱动)
  let buffer = '';
  let eventType = '';

  const dispatchLines = () => {
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
  };

  // 经 Rust secure_http_stream(自签 + 内置 CA)流式;Channel 逐块推回。
  // plugin-http 无法真流式、也不能信任私有 CA(见 SSE 研究结论),故走 Channel。
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let opened = false;

    // 注入直连参数:direct_ip/direct_port → 把 URL 主机改写为该 IP(不发 SNI 绕 ICP),
    // 其余(pin_ca/extra_ca)透传给 secure_http_stream。(变量名避开外层 Promise 的 resolve。)
    // 提前到 channel.onmessage 之前计算:error 分支需读 direct_ip 判定是否触发 IP 池轮换(failover)。
    const inject = resolveForSecureHttp() ?? { pin_ca: true };
    const { direct_ip, direct_port, ...injectRest } = inject;
    const streamUrl = direct_ip && direct_port
      ? rewriteUrlHost(`${baseUrl}/api/ai/chat/stream`, direct_ip, direct_port)
      : `${baseUrl}/api/ai/chat/stream`;

    const channel = new Channel<SecureStreamEvent>();
    channel.onmessage = (msg) => {
      if (settled) { return; }
      switch (msg.event) {
        case 'open':
          opened = true;
          break;
        case 'chunk':
          if (signal?.aborted) { settled = true; resolve(); return; }
          buffer += msg.data;
          dispatchLines();
          break;
        case 'done':
          settled = true;
          if (buffer) { buffer += '\n'; dispatchLines(); }
          resolve();
          break;
        case 'error': {
          settled = true;
          // 连接建立阶段失败(未 open + '请求失败' 前缀)→ 触发 IP 池轮换,让下次 AI 请求切到可达 IP。
          // 判定见 isStreamConnectFailure;fire-and-forget,不阻塞 reject(单飞去重在 rediscoverOnFailure 内)。
          if (direct_ip && isStreamConnectFailure(opened, msg.message)) {
            void rediscoverOnFailure(direct_ip);
          }
          let m = msg.message;
          try {
            m = (JSON.parse(msg.message) as { error?: string }).error ?? msg.message;
          } catch {
            // 非 JSON 错误体 → 用原始 message
          }
          reject(new Error(m));
          break;
        }
      }
    };

    invoke('secure_http_stream', {
      req: {
        method: 'POST',
        url: streamUrl,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
        ...injectRest,
      },
      onEvent: channel,
    }).catch((e: unknown) => {
      if (!settled) {
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * 获取 AI 会话列表
 *
 * client.ts 已解包 ApiResponse.data，直接返回 AIConversationsResponse
 */
export function getAIConversations(
  api: ApiClient,
  options?: { page?: number; perPage?: number },
): Promise<AIConversationsResponse> {
  const params = new URLSearchParams();
  if (options?.page) { params.set('page', String(options.page)); }
  if (options?.perPage) { params.set('per_page', String(options.perPage)); }
  const qs = params.toString();
  return api.get<AIConversationsResponse>(`/api/ai/conversations${qs ? `?${qs}` : ''}`);
}

/**
 * 获取 AI 会话详情（含消息）
 *
 * client.ts 已解包 ApiResponse.data，直接返回 { conversation, messages }
 */
export function getAIConversation(
  api: ApiClient,
  conversationId: string,
): Promise<{ conversation: AIConversation; messages: AIMessage[] }> {
  return api.get<{ conversation: AIConversation; messages: AIMessage[] }>(
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
 * client.ts 已解包 ApiResponse.data，直接返回 AIMessage[]
 */
export function getAIMessages(
  api: ApiClient,
  conversationId: string,
  options?: { limit?: number; before?: string },
): Promise<AIMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) { params.set('limit', String(options.limit)); }
  if (options?.before) { params.set('before', options.before); }
  const qs = params.toString();
  return api.get<AIMessage[]>(
    `/api/ai/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
  );
}

// ============================================================
// 工具调用确认 API
// ============================================================

/** 确认执行待确认的写操作工具，返回工具执行结果 */
export function confirmToolCall(api: ApiClient, pendingId: string): Promise<ToolCallConfirmResult> {
  return api.post<ToolCallConfirmResult>(`/api/ai/tool_calls/${pendingId}/confirm`);
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

  // 经回环安全反代上传 multipart/FormData:webview→http://127.0.0.1:<port>(本地明文回环)→ Rust 反代
  // 钉内置 CA、连源站 IP、不发 SNI、Host=逻辑域名转发到源站。原生 fetch 直连逻辑域名会被 ICP/SNI 拦 +
  // 验不过私有 CA 自签 leaf,故必须经反代;反代逐字节转发请求体(含 multipart 边界),无需 secure_net 支持 multipart。
  const url = proxyRequestUrl(`${baseUrl}/api/ai/voice_profiles`);
  console.warn('[VoiceProfile] 发送 POST 请求 (经回环安全反代)', { url });

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
