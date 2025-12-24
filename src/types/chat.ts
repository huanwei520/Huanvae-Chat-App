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
}

/** 好友列表响应 */
export interface FriendsResponse {
  items: Friend[];
}

/** 消息类型 */
export type MessageType = 'text' | 'image' | 'video' | 'file';

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
  send_time: string;
  /** 序列号（用于增量同步） */
  seq?: number;
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
}

/** 发送消息响应 */
export interface SendMessageResponse {
  message_uuid: string;
  send_time: string;
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
  file_hash: string | null;
  reply_to: string | null;
  send_time: string;
  is_recalled: boolean;
}

/** 聊天目标类型 */
export type ChatTarget =
  | { type: 'friend'; data: Friend }
  | { type: 'group'; data: Group };