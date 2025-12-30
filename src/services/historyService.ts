/**
 * 历史消息加载服务
 *
 * 用于从服务器加载全部聊天记录并保存到本地数据库
 * 支持好友和群聊两种类型
 */

import type { ApiClient } from '../api/client';
import * as db from '../db';
import { getMessages } from '../api/messages';
import { getGroupMessages, type GroupMessage } from '../api/groupMessages';
import { getFriendConversationId } from '../utils/conversationId';
import type { Message } from '../types/chat';

// 每批次加载的消息数量
const BATCH_SIZE = 100;

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
        await db.saveMessages(localMessages);
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

        const messages = response.data?.messages || [];

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        // 转换并保存到本地数据库（群聊的 conversation_id 就是 group_id）
        const localMessages = messages.map((msg: GroupMessage) => ({
          message_uuid: msg.message_uuid,
          conversation_id: conversationId,
          conversation_type: 'group' as const,
          sender_id: msg.sender_id,
          sender_name: msg.sender_nickname || null,
          sender_avatar: msg.sender_avatar_url || null,
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
        await db.saveMessages(localMessages);
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
