/**
 * WebSocket 消息类型定义
 *
 * 基于 test-web 实现和后端 API 文档
 */

// ============================================
// 服务器 → 客户端消息
// ============================================

/**
 * 连接成功消息
 */
export interface WsConnectedMessage {
  type: 'connected';
  unread_summary: UnreadSummary;
}

/**
 * 未读消息摘要
 */
export interface UnreadSummary {
  total_count: number;
  friend_unreads: FriendUnread[];
  group_unreads: GroupUnread[];
}

export interface FriendUnread {
  friend_id: string;
  unread_count: number;
  last_message_preview: string | null;
  last_message_time: string | null;
}

export interface GroupUnread {
  group_id: string;
  unread_count: number;
  last_message_preview: string | null;
  last_message_time: string | null;
}

/**
 * 新消息通知
 */
export interface WsNewMessage {
  type: 'new_message';
  source_type: 'friend' | 'group';
  source_id: string;
  message_uuid: string;
  sender_id: string;
  sender_nickname: string;
  sender_avatar_url?: string; // 发送者头像（可选，后端可能返回）
  preview: string;
  message_type: 'text' | 'image' | 'video' | 'file';
  timestamp: string;
}

/**
 * 消息撤回通知
 */
export interface WsMessageRecalled {
  type: 'message_recalled';
  source_type: 'friend' | 'group';
  source_id: string;
  message_uuid: string;
  recalled_by: string;
}

/**
 * 已读同步通知
 */
export interface WsReadSync {
  type: 'read_sync';
  source_type: 'friend' | 'group';
  source_id: string;
  reader_id: string;
  read_at: string;
}

/**
 * 系统通知
 */
export interface WsSystemNotification {
  type: 'system_notification';
  notification_type:
    | 'friend_request'
    | 'friend_request_approved'
    | 'friend_request_rejected'
    | 'group_invite'
    | 'group_join_request'
    | 'group_join_approved'
    | 'group_removed'
    | 'group_disbanded'
    | 'group_notice_updated';
  data: Record<string, unknown>;
}

/**
 * 心跳消息
 */
export interface WsHeartbeat {
  type: 'heartbeat';
}

/**
 * 错误消息
 */
export interface WsError {
  type: 'error';
  code: number;
  message: string;
}

/**
 * 所有服务器消息类型
 */
export type WsServerMessage =
  | WsConnectedMessage
  | WsNewMessage
  | WsMessageRecalled
  | WsReadSync
  | WsSystemNotification
  | WsHeartbeat
  | WsError;

// ============================================
// 客户端 → 服务器消息
// ============================================

/**
 * 标记已读消息
 */
export interface WsMarkRead {
  type: 'mark_read';
  target_type: 'friend' | 'group';
  target_id: string;
}

/**
 * Ping 消息（心跳）
 */
export interface WsPing {
  type: 'ping';
}

/**
 * 所有客户端消息类型
 */
export type WsClientMessage = WsMarkRead | WsPing;

// ============================================
// WebSocket 状态
// ============================================

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  unreadSummary: UnreadSummary | null;
}
