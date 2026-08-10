/**
 * 群消息 API 封装
 *
 * 基于文档: Huanvae-Chat-Docs/group_messages/群消息.md
 */

import type { ApiClient } from './client';
import type { MessageSendStatus } from '../types/chat';

// ============================================
// 类型定义
// ============================================

/** 群消息类型 */
export type GroupMessageType = 'text' | 'image' | 'video' | 'file' | 'system' | 'meeting_invite' | 'card';

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
  file_hash: string | null;
  /** 图片宽度（像素），仅图片类型消息有值 */
  image_width?: number | null;
  /** 图片高度（像素），仅图片类型消息有值 */
  image_height?: number | null;
  reply_to: string | null;
  /** 媒体组（相册）ID —— 组内各项共享同一值，由客户端生成；非组内消息为 null。撤回不清空 */
  media_group_id?: string | null;
  /** 组内位次（0-based）；index=0 那条的 message_content 即整组 caption */
  media_group_index?: number | null;
  /** 组的期望总数（2..10）；每一项都冗余带，收到任意一条即可预留整组高度 */
  media_group_count?: number | null;
  send_time: string;
  is_recalled: boolean;
  /** 消息序号（用于增量同步） */
  seq: number;
  /** 消息发送状态（仅客户端使用） */
  sendStatus?: MessageSendStatus;
  /** 客户端稳定 ID，用于 React key（避免 UUID 变化导致重新渲染） */
  clientId?: string;
}

/** 群消息列表响应（client.ts 已解包 ApiResponse.data）
 *
 * ⚠️ 媒体组「分页不切组」：后端取满 limit 后若边界那条属于某个相册，会**续取该组剩余项**
 * （最多再取 9 条）⇒ `messages.length` 可能 > 请求的 limit。客户端不要断言 `<= limit`。 */
export interface GroupMessagesResponse {
  messages: GroupMessage[];
  has_more: boolean;
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
  /** 媒体组（相册）三件套 —— 要么全给要么全不给，后端强制校验（违反 400）。
   *  count ∈ 2..10；index ∈ 0..count-1；同组须同 sender 同群、count 一致、index 不重复；
   *  image 与 video 可同组，file 只能与 file 同组。 */
  media_group_id?: string;
  media_group_index?: number;
  media_group_count?: number;
}

/** 发送群消息响应（client.ts 已解包 ApiResponse.data） */
export interface SendGroupMessageResponse {
  message_uuid: string;
  send_time: string;
  /** 后端分配的真实消息序号；乐观消息须回写此值，否则 seq=0 会让"N 人已读"虚显 */
  seq: number;
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
  return api.post<SendGroupMessageResponse>('/api/group_messages', data as unknown as Record<string, unknown>);
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
