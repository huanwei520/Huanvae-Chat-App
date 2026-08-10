/**
 * WebSocket 消息类型定义
 *
 * 基于后端 API 文档定义
 *
 * 支持的消息类型：
 * - connected: 连接成功，返回未读消息摘要、session_id、resumed 标志
 * - new_message: 新消息通知（含会话内 seq）
 * - message_recalled: 消息撤回通知
 * - message_deleted: 消息删除通知（个人删除，同步其他设备）
 * - read_sync: 已读同步通知
 * - system_notification: 系统通知（好友/群聊相关）
 * - heartbeat: 心跳
 * - error: 错误消息
 * - hg_*: HuanvaeGuard 相关通知（拓扑/节点/群组/混淆/设备状态）
 *
 * 连接恢复机制（2026-03 新增）：
 * - connected 消息包含 session_id，客户端需保存
 * - 重连时 URL 带 session_id + last_seq，服务端自动重放缺失事件
 * - resumed=true 时无需手动 sync，resumed=false 时需要增量同步
 * - 所有 WS 推送事件包含递增 event_seq，客户端检测跳号时触发 sync
 *
 * 系统通知类型（notification_type）：
 * 第一批：friend_request, friend_request_approved/rejected,
 *        group_invite, group_join_request/approved,
 *        group_removed, group_disbanded, group_notice_updated
 * 第二批（2025-12-21）：friend_deleted, owner_transferred,
 *        admin_set/removed, member_muted/unmuted,
 *        group_info_updated, group_avatar_updated, group_member_joined
 */

import type { ShelfItem } from '../api/shelf';

// ============================================
// 服务器 → 客户端消息
// ============================================

/**
 * 连接成功消息
 *
 * 服务端在 WS 握手完成后推送，包含：
 * - unread_summary: 未读消息摘要
 * - session_id: 连接会话标识，重连时需携带以恢复会话
 * - resumed: 是否为会话恢复（true 时服务端自动重放缺失事件，客户端无需手动 sync）
 * - reconnect_jitter_ms: 建议的重连抖动上限（毫秒），防止雷群效应
 */
export interface WsConnectedMessage {
  type: 'connected';
  unread_summary: UnreadSummary;
  /** 连接会话 ID，重连时传回以恢复会话 */
  session_id?: string;
  /** 是否为会话恢复（true = 服务端重放缺失事件，无需手动 sync） */
  resumed?: boolean;
  /** 建议的重连抖动上限（毫秒） */
  reconnect_jitter_ms?: number;
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
  friend_nickname?: string;
  /** 好友备注名（仅自己可见；未设置时缺省）。会话列表用 备注||昵称 显示 */
  friend_remark?: string;
  friend_avatar?: string;
  unread_count: number;
  last_message_preview: string | null;
  last_message_type?: string;
  last_message_time: string | null;
}

export interface GroupUnread {
  group_id: string;
  group_name?: string;
  group_avatar?: string;
  unread_count: number;
  last_message_preview: string | null;
  last_message_type?: string;
  last_sender_nickname?: string;
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
  message_type: 'text' | 'image' | 'video' | 'file' | 'meeting_invite' | 'card';
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
  /** 引用回复：被引用的原消息 message_uuid（私聊与群聊同形；后端 migration 036 起下发） */
  reply_to?: string | null;
  /** 媒体组（相册）ID —— 组内各项共享同一值 */
  media_group_id?: string | null;
  /** 组内位次（0-based）；index=0 那条的 content 即整组 caption */
  media_group_index?: number | null;
  /** 组的期望总数（2..10） */
  media_group_count?: number | null;
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
  /** 已读到的消息序列号（reader 在该会话/群的 last-read-seq）：私聊用于"我发的消息对方是否已读"、群聊用于"N 人已读"。私聊与群聊均携带 */
  seq?: number;
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
  timestamp: string;
}

/**
 * 错误消息
 */
export interface WsError {
  type: 'error';
  code: string;
  message: string;
}

/**
 * 消息删除通知（个人删除，仅同步删除者的其他设备）
 */
export interface WsMessageDeleted {
  type: 'message_deleted';
  source_type: 'friend' | 'group';
  source_id: string;
  message_uuid: string;
}

/**
 * HuanvaeGuard 拓扑变更通知
 */
export interface WsHgTopologyChanged {
  type: 'hg_topology_changed';
  device_id: string;
  added: string[];
  removed: string[];
}

/**
 * HuanvaeGuard 节点迁移通知
 */
export interface WsHgNodeMigrated {
  type: 'hg_node_migrated';
  device_id: string;
  from_node: string;
  to_node: string;
}

/**
 * HuanvaeGuard 群组拓扑开关变更
 */
export interface WsHgGroupToggled {
  type: 'hg_group_toggled';
  group_id: string;
  is_active: boolean;
}

/**
 * HuanvaeGuard 混淆参数变更通知
 */
export interface WsHgObfsConfigChanged {
  type: 'hg_obfs_config_changed';
  obfs_hash: string;
}

/**
 * HuanvaeGuard 设备在线状态变更通知
 */
export interface WsHgDeviceStatusChanged {
  type: 'hg_device_status_changed';
  device_id: string;
  status: string;
}

/**
 * 好友在线状态增量推送（顶层消息类型，字段平铺，不嵌套在 notification_type/data 里）。
 *
 * 好友上线（0→1 活跃连接）或下线（最后一条断开）时服务端隐式推送（无需订阅）。
 * 上线时 last_seen_at 缺省；下线时附最后在线时刻。
 */
export interface WsPresenceUpdate {
  type: 'presence_update';
  user_id: string;
  online: boolean;
  last_seen_at?: string;
}

/**
 * 顶置架引用增量推送。帧只含条目引用（无卡片内容；内容走 message/cardLiveStore 通道）。
 * 镜像服务端 `shelf_updated` 帧。event_seq 由连接层统一注入，本接口不声明。
 */
export interface WsShelfUpdated {
  type: 'shelf_updated';
  scope: 'bot' | 'group';
  scope_key: string;
  items: ShelfItem[];
}

/**
 * 已发消息内容更新（可交互卡片 live 刷新）。镜像服务端 `message_updated` 帧。
 * event_seq 由连接层统一注入（见 WsServerMessage 交叉类型），故本接口不声明。
 */
export interface WsMessageUpdated {
  type: 'message_updated';
  source_type: 'friend' | 'group';
  source_id: string;
  message_uuid: string;
  /** 更新后的完整消息内容（卡片 schema JSON 串） */
  content: string;
  /** 消息类型（当前恒为 card） */
  message_type: string;
  /** 单调递增内容修订号（幂等/顺序游标） */
  rev: number;
  /** 会话内序列号（保持不变，供定位原消息） */
  seq: number;
  timestamp: string;
}

/**
 * 所有服务器消息类型
 *
 * 所有事件包含连接级递增 event_seq 字段（用于跳号检测）。
 * 客户端应追踪 event_seq，发现跳号时触发增量同步。
 */
export type WsServerMessage = (
  | WsConnectedMessage
  | WsNewMessage
  | WsMessageRecalled
  | WsMessageDeleted
  | WsReadSync
  | WsSystemNotification
  | WsPresenceUpdate
  | WsMessageUpdated
  | WsShelfUpdated
  | WsHeartbeat
  | WsError
  | WsHgTopologyChanged
  | WsHgNodeMigrated
  | WsHgGroupToggled
  | WsHgObfsConfigChanged
  | WsHgDeviceStatusChanged
) & {
  /** 连接级事件序列号（递增），用于跳号检测 */
  event_seq?: number;
};

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
 * 单个会话的已读位置（resync_read_positions 的元素）
 */
export interface WsReadPosition {
  target_type: 'friend' | 'group';
  target_id: string;
  last_read_seq: number;
}

/**
 * 重连追平已读位置（Tier-1 自愈）
 *
 * 收到 connected 后回传本地持久化的 per 会话 last_read_seq，服务端用 GREATEST 单调合并，
 * 修复抖断时丢失的 mark_read。幂等，可在每次连接/恢复时发送。
 */
export interface WsResyncReadPositions {
  type: 'resync_read_positions';
  positions: WsReadPosition[];
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
export type WsClientMessage = WsMarkRead | WsResyncReadPositions | WsPing;

// ============================================
// WebSocket 状态
// ============================================

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  unreadSummary: UnreadSummary | null;
}
