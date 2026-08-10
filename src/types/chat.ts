/**
 * 聊天相关类型定义
 *
 * 调用服务器格式使用下划线 "_"
 */

/** 好友信息（服务器返回格式） */
export interface Friend {
  friend_id: string;
  friend_nickname: string;
  friend_avatar_url: string | null;
  add_time: string;
  approve_reason: string | null;
  /** 好友备注名（仅自己可见；未设置为 null）。本地缓存不持久化，由服务器刷新提供 */
  friend_remark: string | null;
  /** 当前用户是否已拉黑此好友。本地缓存不持久化（默认 false），由服务器刷新提供 */
  is_blacklisted: boolean;
  /** 当前用户是否特别关心此好友。本地缓存不持久化（默认 false），由服务器刷新提供 */
  is_special_care: boolean;
}

/** 好友列表响应（client.ts 已解包 ApiResponse.data，这里直接是数组） */
export type FriendsResponse = Friend[];

/** 消息类型 */
export type MessageType = 'text' | 'image' | 'video' | 'file' | 'meeting_invite' | 'card';

/** 消息发送状态 */
export type MessageSendStatus = 'sending' | 'sent' | 'failed';

/** 消息 */
export interface Message {
  message_uuid: string;
  sender_id: string;
  receiver_id: string;
  message_content: string;
  message_type: MessageType;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  file_hash: string | null;
  /** 媒体宽度（像素），图片/视频类型消息有值 */
  image_width?: number | null;
  /** 媒体高度（像素），图片/视频类型消息有值 */
  image_height?: number | null;
  /** 引用回复：被引用的原消息 message_uuid（migration 036 起私聊也支持；无引用为 null）。
   *  撤回不清空；被引用消息被彻底删除时后端自动置 null（DB ON DELETE SET NULL） */
  reply_to?: string | null;
  /** 媒体组（相册）ID —— 组内各项共享同一值，由客户端生成；非组内消息为 null。撤回不清空 */
  media_group_id?: string | null;
  /** 组内位次（0-based）；index=0 那条的 message_content 即整组 caption */
  media_group_index?: number | null;
  /** 组的期望总数（2..10）；每一项都冗余带，收到任意一条即可预留整组高度 */
  media_group_count?: number | null;
  send_time: string;
  /** 序列号（用于增量同步） */
  seq?: number;
  /** 内容修订号（可交互卡片 patch 单调游标；REST DTO 返回，非卡片恒 0；本地 DB-first 路径不填） */
  rev?: number;
  /** 是否已撤回 — 与 GroupMessage 镜像。true 时 MessageBubble 渲染「消息已撤回」占位，
   * 不再按 message_type 走文件/图片/视频/文本分支 */
  is_recalled: boolean;
  /** 消息发送状态（仅客户端使用） */
  sendStatus?: MessageSendStatus;
  /** 客户端稳定 ID，用于 React key（避免 UUID 变化导致重新渲染） */
  clientId?: string;
}

/** 消息列表响应 */
export interface MessagesResponse {
  messages: Message[];
  has_more: boolean;
}

/** 发送消息请求 */
export interface SendMessageRequest {
  receiver_id: string;
  message_content: string;
  message_type: MessageType;
  file_uuid?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  /** 引用回复：被引用的原消息 message_uuid。必须存在且属于同一会话，否则后端 400。 */
  reply_to?: string | null;
  /** 媒体组（相册）三件套 —— 三者同生同灭，与群端点对称。
   *  成组项**必须同时带 `file_uuid`**（转发/重发已上传的文件），否则后端 400；
   *  `media_group_count` 取值 2..10，`media_group_index` 取值 0..count-1。
   *  另一条建相册的路径是 storage 上传链路（新上传的图逐项建消息）。 */
  media_group_id?: string | null;
  media_group_index?: number | null;
  media_group_count?: number | null;
}

/** 发送消息响应 */
export interface SendMessageResponse {
  message_uuid: string;
  send_time: string;
  /** 后端分配的真实消息序号；乐观消息须回写此值，否则 seq=0 会让已读回执虚显"已读" */
  seq: number;
}

/** 会话（用于 UI 展示） */
export interface Conversation {
  friend: Friend;
  lastMessage: Message | null;
  unreadCount: number;
}

// ============================================
// 群聊相关类型
// ============================================

/** 群聊基本信息 */
export interface Group {
  group_id: string;
  group_name: string;
  group_avatar_url: string;
  role: 'owner' | 'admin' | 'member';
  unread_count: number | null;
  last_message_content: string | null;
  last_message_time: string | null;
}

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
  /** 媒体宽度（像素），图片/视频类型消息有值 */
  image_width?: number | null;
  /** 媒体高度（像素），图片/视频类型消息有值 */
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
}

/** 聊天目标类型 */
export type ChatTarget =
  | { type: 'friend'; data: Friend }
  // bot 好友（friend_id 带 bot_ 前缀）：数据形态与消息链路与好友一致，仅 UI 呈现区分
  | { type: 'bot'; data: Friend }
  | { type: 'group'; data: Group }
  | { type: 'ai'; conversationId?: string };

// ============================================
// AI 助手相关类型
// ============================================

/** AI 消息角色 */
export type AIMessageRole = 'user' | 'assistant' | 'tool';

/** AI 消息 */
export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string | null;
  reasoning?: string | null;
  tool_calls?: unknown[] | null;
  tool_name?: string | null;
  model?: string | null;
  /** 流中断/服务错误信息（仅前端本地使用） */
  error?: string | null;
  created_at: string;
}

/** 会议邀请消息内容结构（JSON.parse message_content 后的类型） */
export interface MeetingInvitePayload {
  room_id: string;
  password: string;
  room_name: string;
  creator_name: string;
  creator_avatar: string;
}

/** AI 会话信息 */
export interface AIConversation {
  id: string;
  title: string;
  message_count: number;
  total_tokens: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

/** AI 会话列表响应 */
export interface AIConversationsResponse {
  conversations: AIConversation[];
  total: number;
  page: number;
  per_page: number;
}

/** AI 待确认的写操作工具调用（Agent 确认机制） */
export interface PendingToolCall {
  id: string;
  conversation_id: string;
  tool_name: string;
  arguments: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  created_at: string;
  expires_at: string;
}

/** AI 消息历史中的消息信息 */
export interface AIMessageInfo {
  id: string;
  role: string;
  content: string | null;
  reasoning: string | null;
  tool_calls: unknown | null;
  tool_name: string | null;
  model: string | null;
  created_at: string;
}
