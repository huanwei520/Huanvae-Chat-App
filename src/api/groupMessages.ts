/**
 * 群消息 API 封装
 *
 * 基于文档: Huanvae-Chat-Docs/group_messages/群消息.md
 */

import type { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** 群消息类型 */
export type GroupMessageType = 'text' | 'image' | 'video' | 'file' | 'system';

/** 群消息 */
export interface GroupMessage {
  message_uuid: string;
  group_id: string;
  sender_id: string;
  sender_nickname: string;
  sender_avatar_url: string;
  message_content: string;
  message_type: GroupMessageType;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  reply_to: string | null;
  send_time: string;
  is_recalled: boolean;
}

/** 群消息列表响应 */
export interface GroupMessagesResponse {
  success: boolean;
  code: number;
  data: {
    messages: GroupMessage[];
    has_more: boolean;
  };
}

/** 发送群消息请求 */
export interface SendGroupMessageRequest {
  group_id: string;
  message_content: string;
  message_type: GroupMessageType;
  file_uuid?: string;
  file_url?: string;
  file_size?: number;
  reply_to?: string;
}

/** 发送群消息响应 */
export interface SendGroupMessageResponse {
  success: boolean;
  code: number;
  data: {
    message_uuid: string;
    send_time: string;
  };
}

// ============================================
// API 函数
// ============================================

/**
 * 获取群消息列表
 */
export function getGroupMessages(
  api: ApiClient,
  groupId: string,
  options?: {
    beforeTime?: string;
    limit?: number;
  },
): Promise<GroupMessagesResponse> {
  const params = new URLSearchParams();
  params.append('group_id', groupId);

  if (options?.beforeTime) {
    params.append('before_time', options.beforeTime);
  }
  if (options?.limit) {
    params.append('limit', options.limit.toString());
  }

  return api.get<GroupMessagesResponse>(`/api/group_messages?${params.toString()}`);
}

/**
 * 发送群消息
 */
export function sendGroupMessage(
  api: ApiClient,
  data: SendGroupMessageRequest,
): Promise<SendGroupMessageResponse> {
  return api.post<SendGroupMessageResponse>('/api/group_messages', data as Record<string, unknown>);
}

/**
 * 删除群消息（仅自己不可见）
 */
export function deleteGroupMessage(
  api: ApiClient,
  messageUuid: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete<{ success: boolean; message: string }>(
    '/api/group_messages/delete',
    { message_uuid: messageUuid },
  );
}

/**
 * 撤回群消息（所有人不可见）
 */
export function recallGroupMessage(
  api: ApiClient,
  messageUuid: string,
): Promise<{ success: boolean; message: string }> {
  return api.post('/api/group_messages/recall', { message_uuid: messageUuid });
}
