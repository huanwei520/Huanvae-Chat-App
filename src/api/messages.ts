/**
 * 消息 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';
import type {
  MessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '../types/chat';

/**
 * 获取消息列表
 *
 * @param api - API 客户端
 * @param friendId - 好友 ID
 * @param options - 分页选项
 */
export function getMessages(
  api: ApiClient,
  friendId: string,
  options?: {
    beforeTime?: string;
    limit?: number;
  },
): Promise<MessagesResponse> {
  const params = new URLSearchParams({ friend_id: friendId });

  if (options?.beforeTime) {
    params.set('before_time', options.beforeTime);
  }

  if (options?.limit) {
    params.set('limit', String(options.limit));
  }

  return api.get<MessagesResponse>(`/api/messages?${params}`);
}

/**
 * 发送消息
 */
export function sendMessage(
  api: ApiClient,
  request: SendMessageRequest,
): Promise<SendMessageResponse> {
  return api.post<SendMessageResponse>('/api/messages', {
    receiver_id: request.receiver_id,
    message_content: request.message_content,
    message_type: request.message_type,
    file_uuid: request.file_uuid ?? null,
    file_url: request.file_url ?? null,
    file_size: request.file_size ?? null,
  });
}

/**
 * 删除消息
 */
export function deleteMessage(
  api: ApiClient,
  messageUuid: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete<{ success: boolean; message: string }>(
    '/api/messages/delete',
    { body: { message_uuid: messageUuid } } as never,
  );
}

/**
 * 撤回消息（2分钟内）
 */
export function recallMessage(
  api: ApiClient,
  messageUuid: string,
): Promise<{ success: boolean; message: string }> {
  return api.post<{ success: boolean; message: string }>(
    '/api/messages/recall',
    { message_uuid: messageUuid },
  );
}
