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

// 私聊已读位置初始快照已并入消息同步管线（POST /api/messages/sync 的 read_positions），
// 原独立端点 GET /api/messages/{friend_id}/read-positions 已从后端移除。消费方
// useFriendReadReceipt 改为读本地 conversations.peer_last_read_seq + 订阅 sync 快照转发。

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
    { message_uuid: messageUuid },
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

/**
 * 卡片交互回调：不透明 action_id + 可选 value 中继给发卡 bot（非取回执行 URL）。
 * delivered=false 表示命中重复 nonce（幂等跳过，仍是成功）。
 */
export function interactWithCard(
  api: ApiClient,
  req: { message_uuid: string; action_id: string; value?: unknown; nonce?: string },
): Promise<{ delivered: boolean }> {
  return api.post<{ delivered: boolean }>('/api/messages/interact', {
    message_uuid: req.message_uuid,
    action_id: req.action_id,
    value: req.value ?? null,
    nonce: req.nonce ?? null,
  });
}
