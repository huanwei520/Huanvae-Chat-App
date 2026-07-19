/**
 * 历史消息加载服务
 *
 * 用于从服务器加载全部聊天记录并保存到本地数据库
 * 支持好友和群聊两种类型
 *
 * ## 关键约束
 * 保存历史消息必须使用 `db.saveMessagesSkipExisting`（INSERT OR IGNORE），不可用 saveMessages。
 * 理由：好友消息接口 GET `/api/messages` 响应不包含 is_recalled 字段
 * （见 backend-docs/messages/好友消息.md 字段说明），若用 INSERT OR REPLACE 覆盖，
 * 会把本地已撤回消息（is_recalled=1）误覆盖回 0，UI 退化为"普通对方消息形态"。
 *
 * 历史加载的语义就是"补本地缺失的消息"，已存在的消息以本地状态为准。
 *
 * ## 更新日志
 * - 2026-01-22: 修复外键约束失败问题，保存消息前确保会话存在
 * - 2026-05-10: 切换到 saveMessagesSkipExisting，保护本地撤回状态不被历史覆盖
 */

import type { ApiClient } from '../api/client';
import * as db from '../db';
import { getMessages } from '../api/messages';
import { getGroupMessages, type GroupMessage } from '../api/groupMessages';
import { getFriendConversationId } from '../utils/conversationId';
import { resolveServerAvatarUrl } from '../utils/avatar';
import type { Message } from '../types/chat';

// 每批次加载的消息数量
const BATCH_SIZE = 100;

/**
 * 确保会话记录存在
 *
 * 在保存消息之前调用，避免外键约束失败
 */
async function ensureConversationExists(
  conversationId: string,
  targetType: 'friend' | 'group',
  targetId: string,
): Promise<void> {
  const existing = await db.getConversation(conversationId);
  if (!existing) {
    // 创建一个基本的会话记录
    await db.saveConversation({
      id: conversationId,
      type: targetType,
      name: targetId, // 临时使用 ID 作为名称，后续会被正确更新
      avatar_url: null,
      last_message: null,
      last_message_time: null,
      last_seq: 0,
      unread_count: 0,
      is_muted: false,
      updated_at: new Date().toISOString(),
    });
    console.warn('[HistoryService] 创建会话记录:', conversationId);
  }
}

/**
 * 加载全部历史消息
 *
 * @param api - API 客户端
 * @param targetId - 好友 ID 或群组 ID
 * @param targetType - 'friend' 或 'group'
 * @param currentUserId - 当前用户 ID（用于生成好友会话 ID）
 * @param onProgress - 进度回调
 */
export async function loadAllHistoryMessages(
  api: ApiClient,
  targetId: string,
  targetType: 'friend' | 'group',
  currentUserId: string,
  onProgress: (progress: string) => void,
): Promise<{ totalLoaded: number }> {
  let totalLoaded = 0;
  let hasMore = true;
  let beforeTime: string | undefined;

  // 生成正确的 conversation_id
  const conversationId = targetType === 'friend'
    ? getFriendConversationId(currentUserId, targetId)
    : targetId;

  onProgress('正在连接服务器...');

  // 确保会话记录存在，避免外键约束失败
  await ensureConversationExists(conversationId, targetType, targetId);

  while (hasMore) {
    try {
      if (targetType === 'friend') {
        // 加载好友消息
        // eslint-disable-next-line no-await-in-loop
        const response = await getMessages(api, targetId, {
          beforeTime,
          limit: BATCH_SIZE,
        });

        const messages = response.messages || [];

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        // 转换并保存到本地数据库（使用正确的 conversation_id）
        // is_recalled 用 INSERT OR IGNORE 路径：本地已有的消息（含 is_recalled=1）不会被覆盖；
        // 仅对本地缺失的消息插入；GET /api/messages 不返回 is_recalled，仅作初始值占位
        const localMessages = messages.map((msg: Message) => ({
          message_uuid: msg.message_uuid,
          conversation_id: conversationId,
          conversation_type: 'friend' as const,
          sender_id: msg.sender_id,
          sender_name: null,
          sender_avatar: null,
          content: msg.message_content,
          content_type: msg.message_type,
          file_uuid: msg.file_uuid,
          file_url: msg.file_url,
          file_size: msg.file_size,
          file_hash: msg.file_hash,
          image_width: msg.image_width ?? null,
          image_height: msg.image_height ?? null,
          seq: msg.seq || 0,
          reply_to: null,
          is_recalled: false,
          is_deleted: false,
          send_time: msg.send_time,
        }));

        // eslint-disable-next-line no-await-in-loop
        await db.saveMessagesSkipExisting(localMessages);
        totalLoaded += messages.length;

        // 更新进度
        onProgress(`已加载 ${totalLoaded} 条消息...`);

        // 获取最早的消息时间作为下一批次的起点
        if (messages.length > 0) {
          beforeTime = messages[messages.length - 1].send_time;
        }

        // 判断是否还有更多
        hasMore = messages.length >= BATCH_SIZE;

      } else {
        // 加载群聊消息
        // eslint-disable-next-line no-await-in-loop
        const response = await getGroupMessages(api, targetId, {
          beforeTime,
          limit: BATCH_SIZE,
        });

        const messages = response.messages || [];

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        // 转换并保存到本地数据库（群聊的 conversation_id 就是 group_id）
        // 用 INSERT OR IGNORE 路径：本地已有的消息（含 is_recalled=1）不会被覆盖
        const localMessages = messages.map((msg: GroupMessage) => ({
          message_uuid: msg.message_uuid,
          conversation_id: conversationId,
          conversation_type: 'group' as const,
          sender_id: msg.sender_id,
          sender_name: msg.sender_nickname || null,
          sender_avatar: resolveServerAvatarUrl(msg.sender_avatar_url) || null,
          content: msg.message_content,
          content_type: msg.message_type,
          file_uuid: msg.file_uuid,
          file_url: msg.file_url,
          file_size: msg.file_size,
          file_hash: msg.file_hash,
          image_width: msg.image_width ?? null,
          image_height: msg.image_height ?? null,
          seq: msg.seq,
          reply_to: null,
          is_recalled: msg.is_recalled || false,
          is_deleted: false,
          send_time: msg.send_time,
        }));

        // eslint-disable-next-line no-await-in-loop
        await db.saveMessagesSkipExisting(localMessages);
        totalLoaded += messages.length;

        // 更新进度
        onProgress(`已加载 ${totalLoaded} 条消息...`);

        // 获取最早的消息时间作为下一批次的起点
        if (messages.length > 0) {
          beforeTime = messages[messages.length - 1].send_time;
        }

        // 判断是否还有更多
        hasMore = messages.length >= BATCH_SIZE;
      }

      // 添加小延迟，避免请求过快
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(resolve => {
        setTimeout(resolve, 100);
      });

    } catch (err) {
      console.error('[HistoryService] 加载失败:', err);
      throw err;
    }
  }

  onProgress(`完成！共加载 ${totalLoaded} 条消息`);

  // 更新会话的最后同步序列号（使用正确的 conversation_id）
  const latestMessage = await db.getLatestMessage(conversationId);
  if (latestMessage) {
    await db.updateConversationLastSeq(conversationId, latestMessage.seq);
  }

  return { totalLoaded };
}
