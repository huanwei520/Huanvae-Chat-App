/**
 * 消息同步服务
 *
 * 实现离线优先加载 + 增量同步策略
 */

import type { ApiClient } from '../api/client';
import * as db from '../db';
import type { ConversationType, LocalConversation, LocalMessage } from '../db';

// ============================================================================
// 类型定义
// ============================================================================

/** 同步请求项 */
interface SyncRequestItem {
  conversation_id: string;
  conversation_type: ConversationType;
  last_seq: number;
}

/** 服务器返回的同步消息 */
interface ServerMessage {
  message_uuid: string;
  sender_id: string;
  sender_nickname?: string;
  sender_avatar_url?: string;
  message_content: string;
  message_type: string;
  file_uuid?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  file_hash?: string | null;
  /** 图片宽度（像素），仅图片类型消息有值 */
  image_width?: number | null;
  /** 图片高度（像素），仅图片类型消息有值 */
  image_height?: number | null;
  seq: number;
  reply_to?: string | null;
  send_time: string;
  is_recalled?: boolean;
}

/** 服务器返回的同步结果 */
interface SyncConversationResult {
  conversation_id: string;
  conversation_type: ConversationType;
  messages: ServerMessage[];
  latest_seq: number;
  has_more: boolean;
}

/** 同步响应 */
interface SyncResponse {
  code: number;
  message: string;
  data: {
    conversations: SyncConversationResult[];
  };
}

/** 同步状态 */
export interface SyncState {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  error: string | null;
}

// ============================================================================
// 同步服务类
// ============================================================================

export class SyncService {
  private api: ApiClient;
  private state: SyncState = {
    isSyncing: false,
    lastSyncTime: null,
    error: null,
  };
  private listeners: Set<(state: SyncState) => void> = new Set();

  constructor(api: ApiClient) {
    this.api = api;
  }

  /** 获取同步状态 */
  getState(): SyncState {
    return { ...this.state };
  }

  /** 订阅状态变化 */
  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 通知状态变化 */
  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  /** 更新状态 */
  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  /** 生成消息预览文本 */
  private getMessagePreviewText(messageType: string, content: string): string {
    switch (messageType) {
      case 'text':
        return content;
      case 'image':
        return '[图片]';
      case 'video':
        return '[视频]';
      case 'file':
        return '[文件]';
      default:
        return content || '[消息]';
    }
  }

  /**
   * 执行增量同步
   * @param conversations 需要同步的会话列表（来自本地数据库）
   * @returns 有新消息的会话 ID 列表
   */
  async syncMessages(
    conversations: LocalConversation[],
  ): Promise<{ updatedConversations: string[]; newMessagesCount: number }> {
    if (this.state.isSyncing) {
      return { updatedConversations: [], newMessagesCount: 0 };
    }

    this.updateState({ isSyncing: true, error: null });

    try {
      // 构建同步请求
      const syncRequest: SyncRequestItem[] = conversations.map(conv => ({
        conversation_id: conv.id,
        conversation_type: conv.type,
        last_seq: conv.last_seq,
      }));

      if (syncRequest.length === 0) {
        this.updateState({ isSyncing: false, lastSyncTime: new Date() });
        return { updatedConversations: [], newMessagesCount: 0 };
      }

      // 发送同步请求
      const response = await this.api.post<SyncResponse>('/api/messages/sync', {
        conversations: syncRequest,
      });

      const updatedConversations: string[] = [];
      let newMessagesCount = 0;

      // 处理同步结果 - 兼容两种响应格式
      // 格式1: { code: 0, data: { conversations: [...] } }
      // 格式2: { conversations: [...] } (直接返回数据)
      const syncedConversations = response.data?.conversations ?? (response as unknown as { conversations: SyncConversationResult[] }).conversations ?? [];

      if (!syncedConversations || syncedConversations.length === 0) {
        this.updateState({ isSyncing: false, lastSyncTime: new Date() });
        return { updatedConversations: [], newMessagesCount: 0 };
      }

      for (const convResult of syncedConversations) {
        if (convResult.messages.length > 0) {
          // 调试：检查同步 API 返回的消息是否包含尺寸
          const mediaMessages = convResult.messages.filter(m => m.message_type === 'image' || m.message_type === 'video');
          if (mediaMessages.length > 0) {
            // eslint-disable-next-line no-console
            console.log('%c[Sync] 同步API返回的媒体消息尺寸', 'color: #E91E63; font-weight: bold', {
              conversationId: convResult.conversation_id,
              messages: mediaMessages.map(m => ({
                uuid: m.message_uuid.slice(0, 8),
                type: m.message_type,
                image_width: m.image_width,
                image_height: m.image_height,
                hasWidth: m.image_width !== undefined && m.image_width !== null,
                hasHeight: m.image_height !== undefined && m.image_height !== null,
              })),
            });
          }

          // 转换并保存消息
          const localMessages: Omit<LocalMessage, 'created_at'>[] =
            convResult.messages.map(msg => ({
              message_uuid: msg.message_uuid,
              conversation_id: convResult.conversation_id,
              conversation_type: convResult.conversation_type,
              sender_id: msg.sender_id,
              sender_name: msg.sender_nickname || null,
              sender_avatar: msg.sender_avatar_url || null,
              content: msg.message_content,
              content_type: msg.message_type,
              file_uuid: msg.file_uuid || null,
              file_url: msg.file_url || null,
              file_size: msg.file_size || null,
              file_hash: msg.file_hash || null,
              // 图片尺寸（后端文档：image_width/image_height 仅图片类型有值）
              image_width: msg.image_width ?? null,
              image_height: msg.image_height ?? null,
              seq: msg.seq,
              reply_to: msg.reply_to || null,
              is_recalled: msg.is_recalled || false,
              is_deleted: false,
              send_time: msg.send_time,
            }));

          // eslint-disable-next-line no-await-in-loop
          await db.saveMessages(localMessages);
          newMessagesCount += localMessages.length;
          updatedConversations.push(convResult.conversation_id);

          // 更新会话的最后消息预览（取最后一条消息）
          const lastMsg = convResult.messages[convResult.messages.length - 1];
          if (lastMsg) {
            const previewText = this.getMessagePreviewText(lastMsg.message_type, lastMsg.message_content);
            // eslint-disable-next-line no-await-in-loop
            await db.updateConversationLastMessage(
              convResult.conversation_id,
              previewText,
              lastMsg.send_time,
            );
          }
        }

        // 更新会话的 last_seq
        if (convResult.latest_seq > 0) {
          // eslint-disable-next-line no-await-in-loop
          await db.updateConversationLastSeq(
            convResult.conversation_id,
            convResult.latest_seq,
          );
        }

        // 如果有更多消息，继续同步（分页）
        if (convResult.has_more) {
          // eslint-disable-next-line no-await-in-loop
          await this.syncConversationFully(
            convResult.conversation_id,
            convResult.conversation_type,
            convResult.latest_seq,
          );
        }
      }

      this.updateState({ isSyncing: false, lastSyncTime: new Date() });
      return { updatedConversations, newMessagesCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败';
      console.error('[Sync] 同步失败', error);
      this.updateState({ isSyncing: false, error: errorMessage });
      throw error;
    }
  }

  /**
   * 完整同步单个会话（处理 has_more 分页）
   */
  private async syncConversationFully(
    conversationId: string,
    conversationType: ConversationType,
    lastSeq: number,
  ): Promise<void> {
    let currentSeq = lastSeq;
    let hasMore = true;

    while (hasMore) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.api.post<SyncResponse>('/api/messages/sync', {
        conversations: [
          {
            conversation_id: conversationId,
            conversation_type: conversationType,
            last_seq: currentSeq,
          },
        ],
      });

      // 兼容两种响应格式
      const syncedConvs = response.data?.conversations ?? (response as unknown as { conversations: SyncConversationResult[] }).conversations ?? [];
      const convResult = syncedConvs[0];
      if (!convResult || convResult.messages.length === 0) { break; }

      // 保存消息
      const localMessages: Omit<LocalMessage, 'created_at'>[] =
        convResult.messages.map(msg => ({
          message_uuid: msg.message_uuid,
          conversation_id: conversationId,
          conversation_type: conversationType,
          sender_id: msg.sender_id,
          sender_name: msg.sender_nickname || null,
          sender_avatar: msg.sender_avatar_url || null,
          content: msg.message_content,
          content_type: msg.message_type,
          file_uuid: msg.file_uuid || null,
          file_url: msg.file_url || null,
          file_size: msg.file_size || null,
          file_hash: msg.file_hash || null,
          image_width: msg.image_width ?? null,
          image_height: msg.image_height ?? null,
          seq: msg.seq,
          reply_to: msg.reply_to || null,
          is_recalled: msg.is_recalled || false,
          is_deleted: false,
          send_time: msg.send_time,
        }));

      // eslint-disable-next-line no-await-in-loop
      await db.saveMessages(localMessages);
      currentSeq = convResult.latest_seq;
      hasMore = convResult.has_more;

      // 更新 last_seq
      // eslint-disable-next-line no-await-in-loop
      await db.updateConversationLastSeq(conversationId, currentSeq);

      // 如果没有更多消息了，更新会话的最后消息预览
      if (!hasMore && convResult.messages.length > 0) {
        const lastMsg = convResult.messages[convResult.messages.length - 1];
        const previewText = this.getMessagePreviewText(lastMsg.message_type, lastMsg.message_content);
        // eslint-disable-next-line no-await-in-loop
        await db.updateConversationLastMessage(
          conversationId,
          previewText,
          lastMsg.send_time,
        );
      }
    }
  }

  /**
   * 处理 WebSocket 实时消息
   * @param message WebSocket 推送的新消息
   */
  async handleRealtimeMessage(message: {
    source_type: 'friend' | 'group';
    source_id: string;
    message_uuid: string;
    sender_id: string;
    sender_nickname?: string;
    sender_avatar_url?: string;
    preview: string;
    message_type: string;
    timestamp: string;
    seq?: number;
    file_uuid?: string;
    file_url?: string;
    file_size?: number;
    file_hash?: string;
    /** 图片宽度（像素），仅图片类型消息有值 */
    image_width?: number;
    /** 图片高度（像素），仅图片类型消息有值 */
    image_height?: number;
  }): Promise<void> {
    // 保存消息到本地
    const localMessage: Omit<LocalMessage, 'created_at'> = {
      message_uuid: message.message_uuid,
      conversation_id: message.source_id,
      conversation_type: message.source_type,
      sender_id: message.sender_id,
      sender_name: message.sender_nickname || null,
      sender_avatar: message.sender_avatar_url || null,
      content: message.preview,
      content_type: message.message_type,
      file_uuid: message.file_uuid || null,
      file_url: message.file_url || null,
      file_size: message.file_size || null,
      file_hash: message.file_hash || null,
      image_width: message.image_width ?? null,
      image_height: message.image_height ?? null,
      seq: message.seq || 0,
      reply_to: null,
      is_recalled: false,
      is_deleted: false,
      send_time: message.timestamp,
    };

    await db.saveMessage(localMessage);

    // 更新会话的 last_seq
    if (message.seq) {
      await db.updateConversationLastSeq(message.source_id, message.seq);
    }

  }

  /**
   * 处理消息撤回
   */
  async handleMessageRecalled(messageUuid: string): Promise<void> {
    await db.markMessageRecalled(messageUuid);
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let syncServiceInstance: SyncService | null = null;

export function initSyncService(api: ApiClient): SyncService {
  syncServiceInstance = new SyncService(api);
  return syncServiceInstance;
}

export function getSyncService(): SyncService | null {
  return syncServiceInstance;
}
