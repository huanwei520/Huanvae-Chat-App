/**
 * 历史消息加载服务
 *
 * 用于从服务器加载全部聊天记录并保存到本地数据库
 * 支持好友和群聊两种类型
 *
 * ## 关键约束
 * 保存历史消息必须使用 `db.saveMessagesSkipExisting`，不可用 saveMessages。
 * 理由：历史接口回的是**服务端视角的整行**，而本地那一行带着服务端不下发、本文件也
 * 构造不出来的状态 —— 最直接的是 `is_deleted`（"仅本机删除"，服务端根本没有这个概念，
 * 本文件对每一行都只会填 false）。若用 INSERT OR REPLACE 整行覆盖，用户在本机删掉的
 * 消息会被历史加载**原样复活**。历史加载要的是「补缺 + 回填」，不是「以服务端为准重写」。
 *
 * ⚠️ 这里曾写「GET `/api/messages` 响应不包含 is_recalled 字段」—— **那句是错的**：
 * 契约 backend-docs/messages/好友消息.md 明写该字段**恒返回**。据此写死 `is_recalled: false`
 * 的那处代码已在 2026-08-21 改回原样落库（见下方 loadAllHistoryMessages 里的注释）。
 *
 * 历史加载的语义是"补本地缺失的消息 + 回填从未写过的引用/相册四列"：
 * 已存在的行只被 `COALESCE` 补 reply_to / media_group_id / media_group_index /
 * media_group_count 这四列（本地非空值优先），content / seq / is_recalled / is_deleted
 * 等其余列一律以本地状态为准。
 *
 * ## 更新日志
 * - 2026-01-22: 修复外键约束失败问题，保存消息前确保会话存在
 * - 2026-05-10: 切换到 saveMessagesSkipExisting，保护本地撤回状态不被历史覆盖
 * - 2026-08-12: Rust 侧由 INSERT OR IGNORE 改为 ON CONFLICT DO UPDATE（只补空的四列）——
 *   本文件因此不再是"已存在行原样跳过"，历史加载同时承担存量脏行的引用/相册列回填
 *   （成因见 src-tauri/src/db/messages.rs save_messages_skip_existing 的文档注释）
 * - 2026-08-21: 好友分支的 is_recalled 由写死 false 改为原样落库；同批订正本文件头部
 *   那句「响应不包含 is_recalled」的错误陈述（它正是当初写死 false 的依据）
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
        // 走 saveMessagesSkipExisting：本地缺失的整行插入；本地已有的行只被 COALESCE 补
        // 引用/相册四列，is_recalled=1 等本地状态列不会被覆盖。
        // 🔴 is_recalled 必须从服务端原样落库：契约 backend-docs/messages/好友消息.md
        // 「is_recalled | bool | 是否已撤回，**恒返回**」，且 true 时 message_content 已被
        // 服务端替换成字面量「[消息已撤回]」。本地写死 false 的后果不是少个标记，而是
        // 本地库里没有的那些历史消息（换设备/清库后全量拉历史）被插成未撤回 ⇒
        // MessageBubble 不走撤回占位分支，把「[消息已撤回]」当普通文本气泡渲染出来。
        // 群分支（下方）一直是对的，两个分支曾经不一致。
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
          image_width: msg.image_width ?? null,
          image_height: msg.image_height ?? null,
          seq: msg.seq || 0,
          // 引用回复与相册三件套必须从服务端消息原样落库：
          // 消息列表是 DB-first 的，这里丢了，历史加载出来的消息就没有引用块、
          // 相册也会散成 N 条独立图片（private reply 自 migration 036 起后端已支持）
          reply_to: msg.reply_to ?? null,
          media_group_id: msg.media_group_id ?? null,
          media_group_index: msg.media_group_index ?? null,
          media_group_count: msg.media_group_count ?? null,
          is_recalled: msg.is_recalled ?? false,
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
        // 走 saveMessagesSkipExisting：本地缺失的整行插入；本地已有的行只被 COALESCE 补
        // 引用/相册四列，is_recalled=1 等本地状态列不会被覆盖
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
          image_width: msg.image_width ?? null,
          image_height: msg.image_height ?? null,
          seq: msg.seq,
          // 同上：群聊引用回复自 v1.1.25 起就有，但历史加载一直写死 null ⇒
          // 从历史读出来的群消息引用块渲染不出来。一并修正。
          reply_to: msg.reply_to ?? null,
          media_group_id: msg.media_group_id ?? null,
          media_group_index: msg.media_group_index ?? null,
          media_group_count: msg.media_group_count ?? null,
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
