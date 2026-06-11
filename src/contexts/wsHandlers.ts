/**
 * WebSocket 消息处理器
 *
 * 从 WebSocketContext.tsx 中提取的消息处理逻辑
 * 负责解析和处理各种 WebSocket 消息类型：
 * - connected: 提取 session_id / resumed / reconnect_jitter_ms 返回给 Context
 * - new_message: 保存到本地数据库并更新会话预览
 * - message_recalled: 刷新本地数据库预览并通知 UI 重载
 * - system_notification: 更新待处理计数
 * - message_deleted: 标记本地消息已删除并刷新会话预览
 * - hg_*: HuanvaeGuard 事件（日志记录）
 * - 所有事件的连接级 event_seq 返回给 Context 用于跳号检测
 */

import type {
  UnreadSummary,
  WsServerMessage,
  WsNewMessage,
  WsSystemNotification,
} from '../types/websocket';
import type { PendingNotifications } from './WebSocketContext';
import * as db from '../db';
import { getFriendConversationId } from '../utils/conversationId';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { friendDisplayName } from '../utils/friendName';
import { useChatStore } from '../stores/chatStore';
import {
  notifyNewMessage,
  notifySystemEvent,
  type SystemNotificationType,
} from '../services/notificationService';

// ============================================
// 类型定义
// ============================================

export interface MessageHandlerContext {
  activeChatRef: React.RefObject<{ type: 'friend' | 'group'; id: string } | null>;
  currentUserId: string | null;
  setUnreadSummary: React.Dispatch<React.SetStateAction<UnreadSummary | null>>;
  setPendingNotifications: React.Dispatch<React.SetStateAction<PendingNotifications>>;
  newMessageListeners: React.RefObject<Set<(msg: WsNewMessage) => void>>;
  recalledListeners: React.RefObject<Set<(msg: import('../types/websocket').WsMessageRecalled) => void>>;
  notificationListeners: React.RefObject<Set<(msg: import('../types/websocket').WsSystemNotification) => void>>;
  readSyncListeners: React.RefObject<Set<(msg: import('../types/websocket').WsReadSync) => void>>;
}

/** handleWebSocketMessage 的返回值，供 Context 提取 session recovery 和 seq 信息 */
export interface MessageHandlerResult {
  /** connected 消息中的 session_id */
  sessionId?: string;
  /** connected 消息中的 resumed 标志 */
  resumed?: boolean;
  /** connected 消息中的 reconnect_jitter_ms */
  reconnectJitterMs?: number;
  /** 事件的连接级 seq（用于跳号检测） */
  eventSeq?: number;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 生成消息预览文本
 */
export function getMessagePreviewText(
  messageType: 'text' | 'image' | 'video' | 'file' | 'meeting_invite',
  preview: string,
): string {
  switch (messageType) {
    case 'text':
      return preview;
    case 'image':
      return '[图片]';
    case 'video':
      return '[视频]';
    case 'meeting_invite':
      return '[会议邀请]';
    default:
      return '[文件]';
  }
}

/**
 * 更新好友未读摘要
 */
export function updateFriendUnread(
  summary: UnreadSummary,
  friendId: string,
  previewText: string,
  timestamp: string,
  incrementCount: boolean,
): UnreadSummary {
  const newSummary = { ...summary };
  const idx = newSummary.friend_unreads.findIndex(u => u.friend_id === friendId);

  if (idx >= 0) {
    newSummary.friend_unreads = [...newSummary.friend_unreads];
    newSummary.friend_unreads[idx] = {
      ...newSummary.friend_unreads[idx],
      unread_count: incrementCount
        ? newSummary.friend_unreads[idx].unread_count + 1
        : newSummary.friend_unreads[idx].unread_count,
      last_message_preview: previewText,
      last_message_time: timestamp,
    };
  } else {
    newSummary.friend_unreads = [
      ...newSummary.friend_unreads,
      {
        friend_id: friendId,
        unread_count: incrementCount ? 1 : 0,
        last_message_preview: previewText,
        last_message_time: timestamp,
      },
    ];
  }

  // 重新计算总数
  newSummary.total_count =
    newSummary.friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
    newSummary.group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

  return newSummary;
}

/**
 * 更新群聊未读摘要
 */
export function updateGroupUnread(
  summary: UnreadSummary,
  groupId: string,
  previewText: string,
  timestamp: string,
  incrementCount: boolean,
): UnreadSummary {
  const newSummary = { ...summary };
  const idx = newSummary.group_unreads.findIndex(u => u.group_id === groupId);

  if (idx >= 0) {
    newSummary.group_unreads = [...newSummary.group_unreads];
    newSummary.group_unreads[idx] = {
      ...newSummary.group_unreads[idx],
      unread_count: incrementCount
        ? newSummary.group_unreads[idx].unread_count + 1
        : newSummary.group_unreads[idx].unread_count,
      last_message_preview: previewText,
      last_message_time: timestamp,
    };
  } else {
    newSummary.group_unreads = [
      ...newSummary.group_unreads,
      {
        group_id: groupId,
        unread_count: incrementCount ? 1 : 0,
        last_message_preview: previewText,
        last_message_time: timestamp,
      },
    ];
  }

  // 重新计算总数
  newSummary.total_count =
    newSummary.friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
    newSummary.group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

  return newSummary;
}

/**
 * 刷新 unreadSummary 中指定会话的消息预览（仅更新已存在的条目）
 *
 * 用于消息删除/撤回后，将卡片上的预览同步为新的最新消息。
 * 不会新增条目，避免为无未读数的会话创建空记录。
 */
export function refreshPreviewInSummary(
  setUnreadSummary: React.Dispatch<React.SetStateAction<UnreadSummary | null>>,
  targetType: 'friend' | 'group',
  targetId: string,
  preview: string,
  timestamp: string,
): void {
  setUnreadSummary(prev => {
    if (!prev) { return prev; }

    if (targetType === 'friend') {
      const idx = prev.friend_unreads.findIndex(u => u.friend_id === targetId);
      if (idx < 0) { return prev; }
      const updated = { ...prev, friend_unreads: [...prev.friend_unreads] };
      updated.friend_unreads[idx] = {
        ...updated.friend_unreads[idx],
        last_message_preview: preview,
        last_message_time: timestamp,
      };
      return updated;
    }

    const idx = prev.group_unreads.findIndex(u => u.group_id === targetId);
    if (idx < 0) { return prev; }
    const updated = { ...prev, group_unreads: [...prev.group_unreads] };
    updated.group_unreads[idx] = {
      ...updated.group_unreads[idx],
      last_message_preview: preview,
      last_message_time: timestamp,
    };
    return updated;
  });
}

/**
 * 保存 WebSocket 推送的新消息到本地数据库
 * @param msg WebSocket 消息
 * @param currentUserId 当前用户 ID，用于生成正确的 conversation_id
 */
async function saveMessageToLocal(msg: WsNewMessage, currentUserId: string | null): Promise<void> {
  if (!currentUserId) {
    console.warn('[WS] 无法保存消息：currentUserId 未设置');
    return;
  }

  try {
    // 根据消息类型生成正确的 conversation_id
    // 好友消息：conv-user1-user2 格式（按字典序排序）
    // 群消息：group_id
    const conversationId = msg.source_type === 'friend'
      ? getFriendConversationId(currentUserId, msg.source_id)
      : msg.source_id;

    // 构建本地消息对象
    // 使用 content（完整内容）而非 preview（预览）
    const localMessage: Omit<db.LocalMessage, 'created_at'> = {
      message_uuid: msg.message_uuid,
      conversation_id: conversationId,
      conversation_type: msg.source_type,
      sender_id: msg.sender_id,
      sender_name: msg.sender_nickname || null,
      sender_avatar: resolveServerAvatarUrl(msg.sender_avatar_url) || null,
      content: msg.content || msg.preview || '',
      content_type: msg.message_type,
      file_uuid: msg.file_uuid || null,
      file_url: msg.file_url || null,
      file_size: msg.file_size || null,
      file_hash: msg.file_hash || null,
      image_width: msg.image_width ?? null,
      image_height: msg.image_height ?? null,
      seq: msg.seq || 0,
      reply_to: null,
      is_recalled: false,
      is_deleted: false,
      send_time: msg.timestamp,
    };

    await db.saveMessage(localMessage);

    // 更新会话的 last_seq
    if (msg.seq) {
      await db.updateConversationLastSeq(conversationId, msg.seq);
    }

    // 更新会话的最后消息预览
    const previewText = getMessagePreviewText(msg.message_type, msg.content || msg.preview || '');
    await db.updateConversationLastMessage(conversationId, previewText, msg.timestamp);

  } catch (error) {
    console.error('[WS] 保存消息到本地失败:', error);
    throw error;
  }
}

/**
 * 创建初始未读摘要
 * @param incrementCount - 是否增加未读计数（新消息时为 true，发送消息时为 false）
 */
export function createInitialUnreadSummary(
  targetType: 'friend' | 'group',
  targetId: string,
  previewText: string,
  timestamp: string,
  incrementCount: boolean = false,
): UnreadSummary {
  const unreadCount = incrementCount ? 1 : 0;

  if (targetType === 'friend') {
    return {
      total_count: unreadCount,
      friend_unreads: [{
        friend_id: targetId,
        unread_count: unreadCount,
        last_message_preview: previewText,
        last_message_time: timestamp,
      }],
      group_unreads: [],
    };
  }
  return {
    total_count: unreadCount,
    friend_unreads: [],
    group_unreads: [{
      group_id: targetId,
      unread_count: unreadCount,
      last_message_preview: previewText,
      last_message_time: timestamp,
    }],
  };
}

/**
 * 处理 WebSocket 消息
 *
 * @returns 返回 session recovery 和 seq 信息供 Context 使用，解析失败返回 null
 */
export function handleWebSocketMessage(
  data: string,
  ctx: MessageHandlerContext,
): MessageHandlerResult | null {
  try {
    const msg = JSON.parse(data) as WsServerMessage;
    const result: MessageHandlerResult = {};

    // 提取连接级 event_seq（所有消息类型都携带，与业务 seq 分离）
    if (msg.event_seq !== undefined) {
      result.eventSeq = msg.event_seq;
    }

    switch (msg.type) {
      case 'connected':
        ctx.setUnreadSummary(msg.unread_summary);
        if (msg.session_id) {
          result.sessionId = msg.session_id;
        }
        if (msg.resumed !== undefined) {
          result.resumed = msg.resumed;
        }
        if (msg.reconnect_jitter_ms !== undefined) {
          result.reconnectJitterMs = msg.reconnect_jitter_ms;
        }
        break;

      case 'new_message': {
        const previewText = getMessagePreviewText(msg.message_type, msg.content || msg.preview || '');

        // 检查是否是当前活跃的聊天
        const isActiveChat = ctx.activeChatRef.current &&
          ctx.activeChatRef.current.type === msg.source_type &&
          ctx.activeChatRef.current.id === msg.source_id;

        // 是否增加未读计数：非活跃聊天时增加
        const shouldIncrement = !isActiveChat;

        // 更新未读计数和消息预览
        ctx.setUnreadSummary(prev => {
          // 修复：当 prev 为 null 时，创建初始未读摘要
          if (!prev) {
            return createInitialUnreadSummary(
              msg.source_type,
              msg.source_id,
              previewText,
              msg.timestamp,
              shouldIncrement,
            );
          }

          if (msg.source_type === 'friend') {
            return updateFriendUnread(
              prev,
              msg.source_id,
              previewText,
              msg.timestamp,
              shouldIncrement,
            );
          }
          return updateGroupUnread(
            prev,
            msg.source_id,
            previewText,
            msg.timestamp,
            shouldIncrement,
          );
        });

        // 异步保存消息到本地数据库（DB 层自动触发预览刷新）
        console.warn(`[WS-Debug] new_message received: "${(msg.content || msg.preview || '').slice(0, 20)}" seq=${msg.seq}`);
        saveMessageToLocal(msg, ctx.currentUserId).then(() => {
          console.warn(`[WS-Debug] saveMessageToLocal DONE: "${(msg.content || msg.preview || '').slice(0, 20)}"`);
        }).catch(err => {
          console.error('[WS] 保存消息到本地失败:', err);
        });

        // 发送系统通知（非自己发送的消息）
        if (msg.sender_id !== ctx.currentUserId) {
          // 群消息使用"群聊"作为标题，好友消息无群名
          const groupName = msg.source_type === 'group' ? '群聊' : undefined;

          // 私聊新消息：用本地好友备注/昵称解析发送者名 + 取特别关心标记（强提醒）
          let senderName = msg.sender_nickname || msg.sender_id;
          let isSpecialCare = false;
          if (msg.source_type === 'friend') {
            const friend = useChatStore.getState().friends.find(
              (f) => f.friend_id === msg.sender_id,
            );
            if (friend) {
              senderName = friendDisplayName(friend);
              isSpecialCare = friend.is_special_care;
            }
          }

          notifyNewMessage({
            sourceType: msg.source_type,
            sourceId: msg.source_id,
            senderName,
            groupName,
            messageType: msg.message_type,
            content: msg.content || msg.preview || '',
            activeChat: ctx.activeChatRef.current,
            isSpecialCare,
          }).catch(err => {
            console.warn('[WS] 发送通知失败:', err);
          });
        }

        // 通知监听器
        ctx.newMessageListeners.current.forEach(cb => cb(msg));
        break;
      }

      case 'message_recalled':
        db.markMessageRecalled(msg.message_uuid).then(async () => {
          const conversationId = msg.source_type === 'friend'
            ? getFriendConversationId(ctx.currentUserId ?? '', msg.source_id)
            : msg.source_id;
          await db.refreshConversationPreview(conversationId);
        }).catch(err => {
          console.error('[WS] 标记消息撤回或刷新预览失败:', err);
        });
        ctx.recalledListeners.current.forEach(cb => cb(msg));
        break;

      case 'read_sync':
        // 通知监听器更新发送方的已读显示（私聊"已读/未读"、群聊"N 人已读"）
        ctx.readSyncListeners.current.forEach(cb => cb(msg));
        break;

      case 'system_notification':
        // 根据通知类型更新待处理通知计数
        switch (msg.notification_type) {
          case 'friend_request':
            ctx.setPendingNotifications(prev => ({
              ...prev,
              friendRequests: prev.friendRequests + 1,
            }));
            break;
          case 'group_invite':
            ctx.setPendingNotifications(prev => ({
              ...prev,
              groupInvites: prev.groupInvites + 1,
            }));
            break;
          case 'group_join_request':
            ctx.setPendingNotifications(prev => ({
              ...prev,
              groupJoinRequests: prev.groupJoinRequests + 1,
            }));
            break;
        }

        // 发送系统通知
        sendSystemNotification(msg);

        // 通知所有监听器
        ctx.notificationListeners.current.forEach(cb => cb(msg));
        break;

      case 'heartbeat':
        // 服务器心跳，保持连接活跃
        break;

      case 'error':
        console.error('[WebSocket] 服务端错误:', msg.code, msg.message);
        break;

      case 'message_deleted':
        db.markMessageDeleted(msg.message_uuid).then(async () => {
          const conversationId = msg.source_type === 'friend'
            ? getFriendConversationId(ctx.currentUserId ?? '', msg.source_id)
            : msg.source_id;
          await db.refreshConversationPreview(conversationId);
        }).catch(err => {
          console.error('[WS] 删除消息或刷新预览失败:', err);
        });
        break;

      case 'hg_topology_changed':
      case 'hg_node_migrated':
      case 'hg_group_toggled':
      case 'hg_obfs_config_changed':
      case 'hg_device_status_changed':
        // HuanvaeGuard 事件：仅冒泡到 Rust，前端无需处理
        break;
    }

    return result;
  } catch (err) {
    console.error('[WebSocket] 解析消息失败:', err);
    return null;
  }
}

// ============================================
// 系统通知处理
// ============================================

/**
 * 支持发送通知的系统通知类型
 */
const NOTIFIABLE_TYPES: SystemNotificationType[] = [
  'friend_request',
  'friend_request_approved',
  'friend_request_rejected',
  'friend_deleted',
  'group_invite',
  'group_join_request',
  'group_join_approved',
  'group_removed',
  'group_disbanded',
  'group_notice_updated',
];

/**
 * 发送系统通知
 */
function sendSystemNotification(msg: WsSystemNotification): void {
  // 检查是否是需要通知的类型
  if (!NOTIFIABLE_TYPES.includes(msg.notification_type as SystemNotificationType)) {
    return;
  }

  // 转换数据格式
  const data: Record<string, string | number | undefined> = {};
  const rawData = msg.data as Record<string, unknown>;

  // 提取常用字段
  if (rawData.from_id) { data.from_id = String(rawData.from_id); }
  if (rawData.from_nickname) { data.from_nickname = String(rawData.from_nickname); }
  if (rawData.friend_id) { data.from_id = String(rawData.friend_id); }
  if (rawData.friend_nickname) { data.from_nickname = String(rawData.friend_nickname); }
  if (rawData.group_id) { data.group_id = String(rawData.group_id); }
  if (rawData.group_name) { data.group_name = String(rawData.group_name); }
  if (rawData.inviter_id) { data.inviter_id = String(rawData.inviter_id); }
  if (rawData.inviter_nickname) { data.inviter_nickname = String(rawData.inviter_nickname); }
  if (rawData.applicant_id) { data.applicant_id = String(rawData.applicant_id); }
  if (rawData.applicant_nickname) { data.applicant_nickname = String(rawData.applicant_nickname); }

  notifySystemEvent({
    type: msg.notification_type as SystemNotificationType,
    data,
  }).catch(err => {
    console.warn('[WS] 发送系统通知失败:', err);
  });
}
