/**
 * WebSocket 消息类型定义
 *
 * 基于后端 API 文档定义
 *
 * 支持的消息类型：
 * - connected: 连接成功，返回未读消息摘要
 * - new_message: 新消息通知
 * - message_recalled: 消息撤回通知
 * - read_sync: 已读同步通知
 * - system_notification: 系统通知（好友/群聊相关）
 * - heartbeat: 心跳
 * - error: 错误消息
 *
 * 系统通知类型（notification_type）：
 * 第一批：friend_request, friend_request_approved/rejected,
 *        group_invite, group_join_request/approved,
 *        group_removed, group_disbanded, group_notice_updated
 * 第二批（2025-12-21）：friend_deleted, owner_transferred,
 *        admin_set/removed, member_muted/unmuted,
 *        group_info_updated, group_avatar_updated, group_member_joined
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
 *
 * 根据后端文档 (2025-12-23 更新):
 * - `content`: 消息完整内容
 * - `seq`: 会话内序列号（用于增量同步）
 * - `file_uuid`/`file_url`/`file_size`/`file_hash`: 文件类消息字段
 */
export interface WsNewMessage {
  type: 'new_message';
  source_type: 'friend' | 'group';
  source_id: string;
  message_uuid: string;
  sender_id: string;
  sender_nickname: string;
  sender_avatar_url?: string;
  /** 消息完整内容 */
  content: string;
  /** 消息预览（兼容旧版本，可能为空） */
  preview?: string;
  message_type: 'text' | 'image' | 'video' | 'file';
  /** 会话内序列号（用于增量同步） */
  seq: number;
  timestamp: string;
  /** 文件 UUID（仅文件类消息） */
  file_uuid?: string;
  /** 文件访问 URL（仅文件类消息） */
  file_url?: string;
  /** 文件大小（字节，仅文件类消息） */
  file_size?: number;
  /** 文件哈希（用于本地文件链接，仅上传接口发送时提供） */
  file_hash?: string;
  /** 图片宽度（像素），仅图片类型消息有值 */
  image_width?: number;
  /** 图片高度（像素），仅图片类型消息有值 */
  image_height?: number;
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
    // 第一批通知类型
    | 'friend_request'
    | 'friend_request_approved'
    | 'friend_request_rejected'
    | 'group_invite'
    | 'group_join_request'
    | 'group_join_approved'
    | 'group_removed'
    | 'group_disbanded'
    | 'group_notice_updated'
    // 第二批通知类型（2025-12-21 新增）
    | 'friend_deleted'
    | 'owner_transferred'
    | 'admin_set'
    | 'admin_removed'
    | 'member_muted'
    | 'member_unmuted'
    | 'group_info_updated'
    | 'group_avatar_updated'
    | 'group_member_joined';
  data: Record<string, unknown>;
}

/**
 * 好友申请通过通知数据
 */
export interface FriendApprovedData {
  friend_id: string;
  friend_nickname: string;
  friend_avatar_url: string;
  add_time: string;
}

/**
 * 入群申请通过通知数据
 */
export interface GroupJoinApprovedData {
  group_id: string;
  group_name: string;
  group_avatar_url: string;
  role: 'owner' | 'admin' | 'member';
  approved_by?: string;
}

/**
 * 被移出群聊/群解散通知数据
 */
export interface GroupRemovedData {
  group_id: string;
  group_name: string;
  removed_by?: string;
  disbanded_by?: string;
  reason?: string;
}

/**
 * 好友被删除通知数据
 */
export interface FriendDeletedData {
  friend_id: string;
  friend_nickname: string;
  deleted_at: string;
}

/**
 * 群主转让通知数据
 */
export interface OwnerTransferredData {
  group_id: string;
  group_name: string;
  old_owner_id: string;
  old_owner_nickname: string;
  new_owner_id: string;
  new_owner_nickname: string;
  transferred_at: string;
}

/**
 * 管理员变更通知数据（设置/取消）
 */
export interface AdminChangedData {
  group_id: string;
  group_name: string;
  target_user_id: string;
  target_nickname: string;
  operator_id: string;
  operator_nickname: string;
  set_at?: string;
  removed_at?: string;
}

/**
 * 成员禁言通知数据
 */
export interface MemberMutedData {
  group_id: string;
  group_name: string;
  target_user_id: string;
  target_nickname: string;
  operator_id: string;
  operator_nickname: string;
  mute_until: string;
  reason?: string;
  muted_at: string;
}

/**
 * 成员解除禁言通知数据
 */
export interface MemberUnmutedData {
  group_id: string;
  group_name: string;
  target_user_id: string;
  target_nickname: string;
  operator_id: string;
  operator_nickname: string;
  unmuted_at: string;
}

/**
 * 群信息更新通知数据
 */
export interface GroupInfoUpdatedData {
  group_id: string;
  group_name: string;
  new_name: string | null;
  new_description: string | null;
  operator_id: string;
  operator_nickname: string;
  updated_at: string;
}

/**
 * 群头像更新通知数据
 */
export interface GroupAvatarUpdatedData {
  group_id: string;
  group_name: string;
  new_avatar_url: string;
  operator_id: string;
  operator_nickname: string;
  updated_at: string;
}

/**
 * 新成员加入通知数据
 */
export interface GroupMemberJoinedData {
  group_id: string;
  group_name: string;
  new_member_id: string;
  new_member_nickname: string;
  new_member_avatar_url: string;
  join_method: string;
  joined_at: string;
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
