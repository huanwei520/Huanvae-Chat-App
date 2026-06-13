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
  isReadPositionsLoaded,
  getReadPositionsSnapshot,
  getReadPosition,
  noteMessageSeq,
  noteRead,
  seedReadPositions,
} from './readPositions';
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
  /** 发送 resync_read_positions（重连追平已读位置，Tier-1 自愈） */
  sendResyncReadPositions: (positions: import('../types/websocket').WsReadPosition[]) => void;
  /** connected 处理后：补发离线/假活期间暂存的 mark_read（服务端 GREATEST 合并，重发幂等） */
  flushPendingMarkReads: () => void;
  /** connected 处理后：当前打开的会话执行一次完整 markRead 兜底（人停在会话里时 HTTP sync
   *  上屏的消息不会被 connected 快照把红点推回；与读位纠正并存，不互斥） */
  markActiveChatRead: () => void;
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
 * 群消息的发送者是否「对我已折叠」——即该消息在群里会被渲染成折叠占位、内容隐藏。
 * 折叠有两个来源（与 GroupMessageBubble 的折叠判定一致）：
 *  - D6 群内屏蔽：发送者在本群被我屏蔽（groupMessageBlocks）→ 始终折叠
 *  - 好友拉黑：发送者是我拉黑的好友，且消息发送时间晚于拉黑时间点（friendBlacklistTimes）
 * 折叠的消息既然在列表里隐藏成占位，就不应再弹系统通知（否则自相矛盾）。
 * 拉黑判定以 friendBlacklistTimes 为单一真值源（拉黑写入、取消拉黑由 chatStore 删除该条，
 * 与 is_blacklisted 保持同步），故无需再查 friends[].is_blacklisted。纯函数，便于单测。
 */
export function isGroupSenderFolded(
  groupBlocks: string[] | undefined,
  friendBlacklistTimes: Record<string, string>,
  senderId: string,
  sendTime: string,
): boolean {
  if ((groupBlocks ?? []).includes(senderId)) { return true; }
  const blacklistTime = friendBlacklistTimes[senderId];
  return !!blacklistTime && new Date(sendTime).getTime() >= new Date(blacklistTime).getTime();
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
 * 把 summary 中指定会话的未读数清 0（只清零，不增加、不新建条目），并重算 total_count。
 *
 * markRead 本地清零与 read_sync 自读消费共用。纯函数，便于单测。
 */
export function clearUnreadEntry(
  summary: UnreadSummary,
  targetType: 'friend' | 'group',
  targetId: string,
): UnreadSummary {
  const friend_unreads = targetType === 'friend'
    ? summary.friend_unreads.map(u => (u.friend_id === targetId ? { ...u, unread_count: 0 } : u))
    : summary.friend_unreads;
  const group_unreads = targetType === 'group'
    ? summary.group_unreads.map(u => (u.group_id === targetId ? { ...u, unread_count: 0 } : u))
    : summary.group_unreads;

  const total_count =
    friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
    group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

  return { total_count, friend_unreads, group_unreads };
}

/**
 * 用本地持久化的 per 会话已读位置，判定 connected 快照里哪些会话本地已读 + 算需回传的位置（Tier-1 自愈）。
 *
 * 真值口径迁移后：红点真值在服务端按 last-read-seq 派生；客户端把本地已读位置持久化，
 * 重连时①判定本地已读会话（覆盖**所有**会话，取代旧的 active-only 兜底
 * mergeConnectedSnapshotWithActiveRead）②回传 resync_read_positions 让服务端 GREATEST
 * 合并、修复抖断丢失的 mark_read（见后端 unread_service::merge_read_positions）。
 *
 * 判定规则：某会话本地 last_read_seq >= last_seq（已读完本地已收的最新一条，且 last_seq>0）
 * → 视为已读，加入 readXxxIds（由 mergeReadCorrectionIntoLatest 清 0），并把该位置加入 resync。
 * 若服务端其实有更新的消息（本地还没收到），它随后经 new_message 重新累加未读，红点正确重现。
 *
 * 纯函数（不碰 DB / 网络），便于单测。只产出"决策"（哪些会话已读 + resync），
 * 不直接构造纠正后的 summary —— 应用由 mergeReadCorrectionIntoLatest 合并进【最新】state 完成。
 */
export function computeConnectedReadCorrection(
  snapshot: UnreadSummary,
  conversations: ReadonlyArray<Pick<db.LocalConversation, 'id' | 'last_seq' | 'last_read_seq'>>,
  currentUserId: string | null,
): {
  resyncPositions: import('../types/websocket').WsReadPosition[];
  /** 被判定为本地已读、应清零的好友/群 id（供 mergeReadCorrectionIntoLatest 合并进最新 state） */
  readFriendIds: Set<string>;
  readGroupIds: Set<string>;
} {
  const byId = new Map(conversations.map(c => [c.id, c]));
  const resyncPositions: import('../types/websocket').WsReadPosition[] = [];
  const readFriendIds = new Set<string>();
  const readGroupIds = new Set<string>();

  const isLocallyRead = (convId: string): { read: boolean; seq: number } => {
    const conv = byId.get(convId);
    if (!conv || conv.last_seq <= 0 || conv.last_read_seq < conv.last_seq) {
      return { read: false, seq: conv?.last_read_seq ?? 0 };
    }
    return { read: true, seq: conv.last_read_seq };
  };

  for (const u of snapshot.friend_unreads) {
    if (!currentUserId) { continue; }
    const { read, seq } = isLocallyRead(getFriendConversationId(currentUserId, u.friend_id));
    if (read) {
      resyncPositions.push({ target_type: 'friend', target_id: u.friend_id, last_read_seq: seq });
      readFriendIds.add(u.friend_id);
    }
  }

  for (const u of snapshot.group_unreads) {
    const { read, seq } = isLocallyRead(u.group_id);
    if (read) {
      resyncPositions.push({ target_type: 'group', target_id: u.group_id, last_read_seq: seq });
      readGroupIds.add(u.group_id);
    }
  }

  return { resyncPositions, readFriendIds, readGroupIds };
}

/**
 * 把 connected 已读纠正合并进【最新】unreadSummary（而非陈旧快照），杜绝 clobber。
 *
 * 背景：connected 的纠正要 await db.getConversations()（数十 ms），这期间登录补发的
 * new_message 会把未读 +1。若用快照算出的 corrected 整体覆盖最新 state，这些增量会被
 * 回退 → 列表排序"上下抽搐"。本函数改为：以最新 state 为基，仅清那些【自快照以来未变化】
 * 的已读会话（unread_count + last_message_time 都与快照一致才清）；若某会话期间有新消息/
 * 标记把它改了，保留最新值（该未读是真实的，不能清）。
 *
 * 纯函数，便于单测。
 */
export function mergeReadCorrectionIntoLatest(
  latest: UnreadSummary,
  snapshot: UnreadSummary,
  readFriendIds: ReadonlySet<string>,
  readGroupIds: ReadonlySet<string>,
): UnreadSummary {
  const snapFriend = new Map(snapshot.friend_unreads.map(u => [u.friend_id, u]));
  const snapGroup = new Map(snapshot.group_unreads.map(u => [u.group_id, u]));

  const unchangedSince = (
    cur: { unread_count: number; last_message_time: string | null },
    snap: { unread_count: number; last_message_time: string | null } | undefined,
  ): boolean =>
    snap !== undefined &&
    snap.unread_count === cur.unread_count &&
    snap.last_message_time === cur.last_message_time;

  const friend_unreads = latest.friend_unreads.map(u => {
    if (u.unread_count === 0 || !readFriendIds.has(u.friend_id)) { return u; }
    return unchangedSince(u, snapFriend.get(u.friend_id)) ? { ...u, unread_count: 0 } : u;
  });

  const group_unreads = latest.group_unreads.map(u => {
    if (u.unread_count === 0 || !readGroupIds.has(u.group_id)) { return u; }
    return unchangedSince(u, snapGroup.get(u.group_id)) ? { ...u, unread_count: 0 } : u;
  });

  const total_count =
    friend_unreads.reduce((s, u) => s + u.unread_count, 0) +
    group_unreads.reduce((s, u) => s + u.unread_count, 0);

  return { total_count, friend_unreads, group_unreads };
}

/**
 * 异步：读本地会话已读位置 → 把已读纠正合并进【最新】unreadSummary + 回传 resync_read_positions。
 *
 * 前置：connected handler 已【同步】把服务端快照写入 UI（立基线、红点立刻显示、不丢 S0）。
 * 本函数随后用 mergeReadCorrectionIntoLatest 仅清"自快照以来未变化的已读会话"——
 * await db.getConversations() 间隙到达的 new_message 增量一律保留，杜绝陈旧快照覆盖导致的排序抽搐。
 *
 * prev 为 null（期间断连/登出已置空）则不复活；DB 读失败仅记日志、保留已同步的快照基线。
 */
async function applyConnectedReadCorrection(
  snapshot: UnreadSummary,
  ctx: MessageHandlerContext,
): Promise<void> {
  try {
    const conversations = await db.getConversations();
    // 顺手灌入读位内存 Map（单调合并）：下次 connected 即可走同步一步纠正路径
    seedReadPositions(conversations);
    const { resyncPositions, readFriendIds, readGroupIds } = computeConnectedReadCorrection(
      snapshot,
      conversations,
      ctx.currentUserId,
    );
    ctx.setUnreadSummary(prev =>
      prev ? mergeReadCorrectionIntoLatest(prev, snapshot, readFriendIds, readGroupIds) : prev,
    );
    if (resyncPositions.length > 0) {
      ctx.sendResyncReadPositions(resyncPositions);
    }
  } catch (error) {
    console.error('[WS] connected 已读位置纠正失败，保留已同步的服务端快照:', error);
  }
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
        if (isReadPositionsLoaded()) {
          // 读位内存 Map 已载入 → 同步算好「快照 ∖ 本地已读」一步 setUnreadSummary：
          // 消灭「基线（unread>0）→ 纠正（清 0）」两个可见中间态（V 型翻转 → 卡片抽搐）。
          // mergeReadCorrectionIntoLatest(snap, snap, ...) 即"无并发增量时应用纠正"。
          const { resyncPositions, readFriendIds, readGroupIds } = computeConnectedReadCorrection(
            msg.unread_summary,
            getReadPositionsSnapshot(),
            ctx.currentUserId,
          );
          ctx.setUnreadSummary(
            mergeReadCorrectionIntoLatest(msg.unread_summary, msg.unread_summary, readFriendIds, readGroupIds),
          );
          if (resyncPositions.length > 0) {
            ctx.sendResyncReadPositions(resyncPositions);
          }
        } else {
          // 冷启动竞态（Map 未载入）：维持两段式 —— 先【同步】立基线（红点立刻显示、不丢快照），
          // 再【异步】读 db 纠正（functional merge 防陈旧快照 clobber），并顺手灌入 Map。
          ctx.setUnreadSummary(msg.unread_summary);
          void applyConnectedReadCorrection(msg.unread_summary, ctx);
        }
        // 当前打开的会话兜底标读：发 WS 帧 + 本地清零 + advance（人停在会话里时
        // 重连 HTTP sync 上屏的消息读位也被推进，红点不再被快照推回）。
        ctx.markActiveChatRead();
        // 补发离线/假活期间暂存的 mark_read（服务端读位 GREATEST 合并，重发无害）。
        ctx.flushPendingMarkReads();
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

        // 读位内存 Map 同步抬 last_seq（落库由 saveMessageToLocal 异步完成，Map 先行，
        // 保证同帧内的 markRead/read_sync 判定用到最新 last_seq）
        if (ctx.currentUserId && msg.seq) {
          noteMessageSeq(
            msg.source_type === 'friend'
              ? getFriendConversationId(ctx.currentUserId, msg.source_id)
              : msg.source_id,
            msg.seq,
          );
        }

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
        saveMessageToLocal(msg, ctx.currentUserId).catch(err => {
          console.error('[WS] 保存消息到本地失败:', err);
        });

        // 发送系统通知（非自己发送的消息）
        if (msg.sender_id !== ctx.currentUserId) {
          // 折叠的发送者（D6 群内屏蔽 / 好友拉黑后发的）其群消息在列表里渲染成折叠占位、
          // 内容隐藏，不应再弹系统通知，否则与「已折叠」自相矛盾。私聊拉黑由后端双向静默丢弃、
          // 根本不产生 WS 事件，故无需在此判私聊（M2）。
          const senderFolded = msg.source_type === 'group' && isGroupSenderFolded(
            useChatStore.getState().groupMessageBlocks[msg.source_id],
            useChatStore.getState().friendBlacklistTimes,
            msg.sender_id,
            msg.timestamp,
          );

          if (!senderFolded) {
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
            } else if (msg.source_type === 'group') {
              // 群消息：发送者若在本群被我特别关心，则强提醒（通知标题带 ⭐，M3）。
              // 关心集进群时由 getGroupSpecialCares 加载进 store；未打开过的群无此信息则不强提醒。
              const cared = useChatStore.getState().groupSpecialCares[msg.source_id] ?? [];
              isSpecialCare = cared.includes(msg.sender_id);
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

      case 'read_sync': {
        // 多端自读消费（reader = 本人，帧来自本人其他设备的 mark_read）：推进本地读位 + 清本机红点。
        // 服务端推给本人其他设备的自读帧，source_id 是"接收者视角的会话对端"
        // （私聊 = friend_id、群 = group_id），与 new_message 语义一致，可直接拼本地 conversationId。
        if (ctx.currentUserId && msg.reader_id === ctx.currentUserId && msg.seq !== undefined) {
          const conversationId = msg.source_type === 'friend'
            ? getFriendConversationId(ctx.currentUserId, msg.source_id)
            : msg.source_id;
          const localPos = getReadPosition(conversationId);
          // 内存 Map 写穿 + DB 持久化（显式 seq：只推进 last_read_seq，不碰 last_seq 同步游标）
          noteRead(conversationId, msg.seq);
          void db.advanceConversationRead(conversationId, msg.seq).catch(err => {
            console.error('[WS] read_sync 自读推进本地读位失败:', err);
          });
          // 别端已读到 >= 本地已收最新 → 该会话红点清 0（只清零，绝不增加/出现负数）；
          // 读位落后（本地还有别端没读的更新消息）则不动，留给下次 connected 纠正。
          if (localPos && msg.seq >= localPos.last_seq) {
            const { source_type, source_id } = msg;
            ctx.setUnreadSummary(prev => (prev ? clearUnreadEntry(prev, source_type, source_id) : prev));
          }
        }
        // 通知监听器更新发送方的已读显示（私聊"已读/未读"、群聊"N 人已读"）—— 原行为保留
        ctx.readSyncListeners.current.forEach(cb => cb(msg));
        break;
      }

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
