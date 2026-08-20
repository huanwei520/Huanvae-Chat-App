/**
 * 消息同步服务
 *
 * 实现离线优先加载 + 增量同步策略
 */

import type { ApiClient } from '../api/client';
import * as db from '../db';
import type { ConversationType, LocalConversation, LocalMessage } from '../db';
import { conversationPreviewText } from '../chat/shared/messagePreviewText';

// ============================================================================
// 类型定义
// ============================================================================

/** 同步请求项 */
interface SyncRequestItem {
  conversation_id: string;
  conversation_type: ConversationType;
  last_seq: number;
  /**
   * 是否随本会话附带已读位置快照（默认 false）。**仅对"正在打开的那个会话"置 true**——
   * 群快照含全员昵称/头像/时间，启动批量同步逐会话附带会导致带宽爆炸（见 backend-docs 契约）。
   */
  with_read_positions?: boolean;
}

/** 单聊已读位置快照（sync 响应 read_positions；缺省一方按 0） */
export interface SyncFriendReadPositions {
  my_last_read_seq: number;
  peer_last_read_seq: number;
}

/** 群成员已读位置项（sync 响应 read_positions.positions[]；avatar_url 为后端原始值） */
export interface SyncGroupReadPositionEntry {
  user_id: string;
  last_read_seq: number;
  display_name: string;
  avatar_url: string | null;
  last_read_at: string | null;
}

/** 群聊已读位置快照（sync 响应 read_positions；与 GET /read-positions 同形） */
export interface SyncGroupReadPositions {
  positions: SyncGroupReadPositionEntry[];
  member_count: number;
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
  // file_hash：2026-08-16 起后端接收面（含本 sync 端点）不再下发，本地改走两层键
  // （file_uuid 快路径 → file_uuid_hash → file_mappings），故此处不再声明也不再接。
  /** 图片宽度（像素），仅图片类型消息有值 */
  image_width?: number | null;
  /** 图片高度（像素），仅图片类型消息有值 */
  image_height?: number | null;
  seq: number;
  reply_to?: string | null;
  /** 媒体组（相册）三件套：sync 端点同样下发，不接就会在增量同步路径上丢分组 */
  media_group_id?: string | null;
  media_group_index?: number | null;
  media_group_count?: number | null;
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
  /**
   * 已读位置快照（仅当请求该会话置 with_read_positions:true 时出现）。
   * 形状随 conversation_type 而异：friend → SyncFriendReadPositions；group → SyncGroupReadPositions。
   */
  read_positions?: SyncFriendReadPositions | SyncGroupReadPositions;
}

/** 同步响应 */
/** client.ts 已解包 ApiResponse.data */
interface SyncResponse {
  conversations: SyncConversationResult[];
}

/**
 * 存量字段回填的回溯窗口（条）
 *
 * 服务端 sync 单会话一批上限 100 条（`sync_service.rs SYNC_LIMIT`），取同值即一次请求打满一批。
 */
const BACKFILL_WINDOW = 100;

/**
 * 把服务端同步消息映射成本地行
 *
 * **本仓踩过的坑就在这个函数存在的理由里**：同一份映射原先在增量同步、分页续拉两处各抄一遍，
 * 谁漏一个字段谁那条路径就静默丢字段（reply_to / 相册三件套都这么丢过）。收成一处后
 * "加一个字段"只有一个地方要改。
 */
function toLocalMessage(
  msg: ServerMessage,
  conversationId: string,
  conversationType: ConversationType,
): Omit<LocalMessage, 'created_at'> {
  return {
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
    image_width: msg.image_width ?? null,
    image_height: msg.image_height ?? null,
    seq: msg.seq,
    reply_to: msg.reply_to || null,
    media_group_id: msg.media_group_id ?? null,
    media_group_index: msg.media_group_index ?? null,
    media_group_count: msg.media_group_count ?? null,
    is_recalled: msg.is_recalled || false,
    is_deleted: false,
    send_time: msg.send_time,
  };
}

/** 该条服务端消息是否带着「本地存量行可能缺失」的那几列（都没有就不值得回写一次） */
function hasBackfillableFields(msg: ServerMessage): boolean {
  return Boolean(msg.reply_to) || Boolean(msg.media_group_id);
}

/** 同步状态 */
export interface SyncState {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  error: string | null;
}

// ============================================================================
// 会话同步落库通知（模块级，跨 SyncService 实例存活）
// ============================================================================

/**
 * 某会话经 HTTP 增量同步写入了新消息时的通知（latestSeq = 该会话同步后的最新 seq）。
 *
 * 用途：activeChat 标读补刀 —— 人停在会话里时 sync 上屏的消息不会有人 markRead，
 * 红点会挂死。由 WebSocketContext 注入监听器（判定是否 activeChat 并 markRead），
 * service 层不直接依赖 React context。
 */
export type SyncedConversationListener = (
  conversationId: string,
  conversationType: ConversationType,
  latestSeq: number,
) => void;

let syncedConversationListener: SyncedConversationListener | null = null;

export function setSyncedConversationListener(listener: SyncedConversationListener | null): void {
  syncedConversationListener = listener;
}

/** 通知会话同步落库（syncMessages 内部调用；export 供 L2 测试直接驱动接线） */
export function notifySyncedConversation(
  conversationId: string,
  conversationType: ConversationType,
  latestSeq: number,
): void {
  syncedConversationListener?.(conversationId, conversationType, latestSeq);
}

// ============================================================================
// 已读位置快照转发通道（sync 快照 → 已读回执 hook）
// ============================================================================

/**
 * 打开会话的增量同步（with_read_positions:true）随响应带回该会话已读位置快照时的通知。
 *
 * 用途：把"进入会话首拉已读快照"并入消息同步管线——原独立端点首拉（单聊已移除、群 GET 保留）
 * 造成"清空 → 异步拉取 → 弹入"的两阶段闪。改由 syncService 收到 read_positions 后转发给
 * 已读回执 hook（useGroup/FriendReadReceipt 订阅），hook 侧解析头像 + 落库 + setState 校准。
 *
 * service 层只转发原始快照、不落库、不解析头像（保持与消息处理一致的"服务端字段直转"）；
 * 头像收口与本地持久化归 hook（唯一数据边界，见 secure-display-routing 契约）。
 */
export type ConversationReadPositions =
  | { type: 'friend'; conversationId: string; data: SyncFriendReadPositions }
  | { type: 'group'; conversationId: string; data: SyncGroupReadPositions };

export type ReadPositionsListener = (payload: ConversationReadPositions) => void;

const readPositionsListeners = new Set<ReadPositionsListener>();

/** 订阅已读位置快照转发（已读回执 hook 用；返回退订函数） */
export function subscribeReadPositions(listener: ReadPositionsListener): () => void {
  readPositionsListeners.add(listener);
  return () => {
    readPositionsListeners.delete(listener);
  };
}

/** 转发已读位置快照（syncMessages 内部调用；export 供 L2 测试直接驱动） */
export function notifyReadPositions(payload: ConversationReadPositions): void {
  readPositionsListeners.forEach((listener) => listener(payload));
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
  /**
   * 本次进程内已做过「存量字段回填」的会话（见 {@link backfillLegacyFields}）。
   * 回填是幂等的，加这层只是别每次同步都白发一个请求。
   */
  private backfilledConversations: Set<string> = new Set();

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

  /**
   * 生成消息预览文本。
   *
   * 🔴 整套映射（含「未知类型绝不回落 content 原文」这条不变量）在
   * {@link conversationPreviewText} —— 与 db/index.ts 的「撤回/删除后刷新预览」**同一份表**。
   * 这里原先是一份独立的 switch，`default: return content` 让离线同步回来的
   * `meeting_invite` 把 content 里的 `password` 直接印在会话列表上。
   */
  private getMessagePreviewText(messageType: string, content: string): string {
    return conversationPreviewText(messageType, content);
  }

  /**
   * 执行增量同步
   * @param conversations 需要同步的会话列表（来自本地数据库）
   * @param opts.withReadPositions 是否让请求携带 with_read_positions:true 附带已读位置快照。
   *        **仅"打开会话那次单会话同步"传 true**（携带的群快照随成员数增长，启动批量同步传
   *        true 会带宽爆炸）；批量同步（useInitialSync）不传。响应 read_positions 经
   *        notifyReadPositions 转发给已读回执 hook。
   * @returns 有新消息的会话 ID 列表
   */
  async syncMessages(
    conversations: LocalConversation[],
    opts?: { withReadPositions?: boolean },
  ): Promise<{ updatedConversations: string[]; newMessagesCount: number }> {
    if (this.state.isSyncing) {
      return { updatedConversations: [], newMessagesCount: 0 };
    }

    this.updateState({ isSyncing: true, error: null });

    const withReadPositions = opts?.withReadPositions === true;

    try {
      // 构建同步请求
      const syncRequest: SyncRequestItem[] = conversations.map(conv => ({
        conversation_id: conv.id,
        conversation_type: conv.type,
        last_seq: conv.last_seq,
        ...(withReadPositions ? { with_read_positions: true } : {}),
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

      const syncedConversations = response.conversations ?? [];

      if (!syncedConversations || syncedConversations.length === 0) {
        this.updateState({ isSyncing: false, lastSyncTime: new Date() });
        return { updatedConversations: [], newMessagesCount: 0 };
      }

      // 用入参 conversations 构建一个 last_seq 索引，用于客户端二次过滤
      // 防止"同步返回了实际已存在于本地的消息"触发 saveMessages → schedulePreviewNotify
      // 导致登录后会话列表无意义重排（PREVIEW_CHANGED_EVENT 重新拉预览，
      // framer-motion layout="position" 检测到新数组引用进行测量后跑动画）
      const localLastSeqByConvId = new Map(conversations.map(c => [c.id, c.last_seq]));

      for (const convResult of syncedConversations) {
        // 仅保留 seq > 本地 last_seq 的消息；服务端理应已按 last_seq 过滤，
        // 这里是防御性兜底（若服务端 bug / 客户端 last_seq 漂移仍能保护）
        const localLastSeq = localLastSeqByConvId.get(convResult.conversation_id) ?? 0;
        const newMessages = convResult.messages.filter(m => m.seq > localLastSeq);

        if (newMessages.length > 0) {
          // 调试：检查同步 API 返回的消息是否包含尺寸
          const mediaMessages = newMessages.filter(m => m.message_type === 'image' || m.message_type === 'video');
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

          // 转换并保存消息（仅真正的新消息）
          const localMessages: Omit<LocalMessage, 'created_at'>[] = newMessages.map(msg =>
            toLocalMessage(msg, convResult.conversation_id, convResult.conversation_type));

          // eslint-disable-next-line no-await-in-loop
          await db.saveMessages(localMessages);
          newMessagesCount += localMessages.length;
          updatedConversations.push(convResult.conversation_id);

          // 更新会话的最后消息预览（用过滤后的最新消息）
          const lastMsg = newMessages[newMessages.length - 1];
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
        let finalSeq = convResult.latest_seq;
        if (convResult.has_more) {
          // eslint-disable-next-line no-await-in-loop
          finalSeq = await this.syncConversationFully(
            convResult.conversation_id,
            convResult.conversation_type,
            convResult.latest_seq,
          );
        }

        // 该会话有新消息落库 → 通知接线方（activeChat 标读补刀，见 SyncedConversationListener）
        if (newMessages.length > 0) {
          notifySyncedConversation(
            convResult.conversation_id,
            convResult.conversation_type,
            finalSeq,
          );
        }

        // 该会话带回已读位置快照（with_read_positions 请求）→ 转发给已读回执 hook 校准。
        // 与"有无新消息"无关：即便无新消息，已读位置仍可能推进，需照常转发。
        if (convResult.read_positions) {
          if (convResult.conversation_type === 'group') {
            notifyReadPositions({
              type: 'group',
              conversationId: convResult.conversation_id,
              data: convResult.read_positions as SyncGroupReadPositions,
            });
          } else {
            notifyReadPositions({
              type: 'friend',
              conversationId: convResult.conversation_id,
              data: convResult.read_positions as SyncFriendReadPositions,
            });
          }
        }
      }

      // 存量字段回填：与上面的增量同步无关，失败不影响本次同步结果（内部自吞异常）
      await this.backfillLegacyFields(conversations);

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
   * 存量行的 `reply_to` / 相册三件套回填（每会话每进程一次）
   *
   * ## 为什么必须有这一步
   * 这四个字段曾在**所有**接收侧写入路径上被写死 `null`（wsHandlers 实时推送 /
   * historyService 历史加载 / 本方法上面的增量同步），2026-08-10 才逐条修好。
   * 但修好的只是"之后写进来的"——**已经躺在本地 SQLite 里的行永远是 NULL**：
   * 增量同步只拉 `seq > last_seq` 不会回头，历史加载对已存在行是跳过的。
   *
   * 消息列表是 DB-first 的（`useLocal*Messages` 走 `db.getMessages`），
   * 于是用户看到的是：**别人回复自己的历史消息没有引用块，自己发的却有**
   * （自己发的走 `sendMessage` 本地直写，v1.1.25 起就一直带着 reply_to）。
   * 桌面端看起来正常只是因为它的数据目录跟着可执行文件走（`user_data.rs get_app_root`），
   * 换一次构建就是一个全新的库、全量重新同步；手机升级 APK 不动 app 数据，脏行原地留着。
   *
   * ## 做法
   * 用一个**回溯窗口**再问一次同一个 sync 端点（`last_seq - BACKFILL_WINDOW`），
   * 把落在窗口内、已经在本地存在的那段交给 `db.saveMessagesSkipExisting`
   * —— 它对已存在行只 `COALESCE` 补这四列（Rust 侧 `save_messages_skip_existing`），
   * content / seq / is_recalled / is_deleted 一律不动。
   *
   * 单独发一次请求而不是把主同步请求的 `last_seq` 直接调小：服务端 sync 单会话上限 100 条，
   * 调小起点会把真正的新消息挤出这一批。
   */
  private async backfillLegacyFields(conversations: LocalConversation[]): Promise<void> {
    const targets = conversations.filter(
      conv => conv.last_seq > 0 && !this.backfilledConversations.has(conv.id),
    );
    if (targets.length === 0) {
      return;
    }
    targets.forEach(conv => this.backfilledConversations.add(conv.id));

    try {
      const response = await this.api.post<SyncResponse>('/api/messages/sync', {
        conversations: targets.map(conv => ({
          conversation_id: conv.id,
          conversation_type: conv.type,
          last_seq: Math.max(0, conv.last_seq - BACKFILL_WINDOW),
        })),
      });

      const lastSeqById = new Map(targets.map(conv => [conv.id, conv.last_seq]));

      for (const convResult of response.conversations ?? []) {
        const localLastSeq = lastSeqById.get(convResult.conversation_id) ?? 0;
        // 只处理"本地理应已有"的那一段；seq > last_seq 的是新消息，归上面的主同步管，
        // 在这里再写一遍会重复触发预览通知 / 会话列表重排。
        const legacy = convResult.messages.filter(
          m => m.seq <= localLastSeq && hasBackfillableFields(m),
        );
        if (legacy.length === 0) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await db.saveMessagesSkipExisting(
          legacy.map(msg => toLocalMessage(msg, convResult.conversation_id, convResult.conversation_type)),
        );
      }
    } catch (error) {
      // 回填是尽力而为的修复动作，失败只记日志：主同步已经成功，不该被它拖崩
      console.warn('[Sync] 存量字段回填失败（不影响本次同步）', error);
    }
  }

  /**
   * 完整同步单个会话（处理 has_more 分页）
   * @returns 同步结束后该会话的最新 seq
   */
  private async syncConversationFully(
    conversationId: string,
    conversationType: ConversationType,
    lastSeq: number,
  ): Promise<number> {
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

      const syncedConvs = response.conversations ?? [];
      const convResult = syncedConvs[0];
      if (!convResult || convResult.messages.length === 0) { break; }

      // 防御性过滤：仅保留 seq > currentSeq 的消息，避免重复保存触发预览事件
      const newMessages = convResult.messages.filter(m => m.seq > currentSeq);
      if (newMessages.length === 0) {
        // 服务端返回了不超过 currentSeq 的消息，无需写入；推进 has_more / currentSeq
        currentSeq = convResult.latest_seq;
        hasMore = convResult.has_more;
        continue;
      }

      // 保存消息
      const localMessages: Omit<LocalMessage, 'created_at'>[] = newMessages.map(msg =>
        toLocalMessage(msg, conversationId, conversationType));

      // eslint-disable-next-line no-await-in-loop
      await db.saveMessages(localMessages);
      currentSeq = convResult.latest_seq;
      hasMore = convResult.has_more;

      // 更新 last_seq
      // eslint-disable-next-line no-await-in-loop
      await db.updateConversationLastSeq(conversationId, currentSeq);

      // 如果没有更多消息了，更新会话的最后消息预览（用过滤后的新消息）
      if (!hasMore && newMessages.length > 0) {
        const lastMsg = newMessages[newMessages.length - 1];
        const previewText = this.getMessagePreviewText(lastMsg.message_type, lastMsg.message_content);
        // eslint-disable-next-line no-await-in-loop
        await db.updateConversationLastMessage(
          conversationId,
          previewText,
          lastMsg.send_time,
        );
      }
    }

    return currentSeq;
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

export function destroySyncService(): void {
  syncServiceInstance = null;
}
