/**
 * 本地数据库服务 - 通过 Tauri Commands 调用 Rust 后端
 *
 * 所有数据库操作都在 Rust 后端执行，前端只负责调用和数据传递。
 * 影响会话预览的写入操作完成后自动触发防抖通知，驱动卡片列表刷新。
 */

import { invoke } from '@tauri-apps/api/core';
import { noteMessageSeq, noteRead } from '../contexts/readPositions';

// ============================================================================
// 预览变更防抖通知（带写入屏障）
// ============================================================================

const PREVIEW_CHANGED_EVENT = 'conversation-previews-changed';
let _pendingWrites = 0;
let _previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 防抖触发会话预览变更事件（150ms）。
 * 同时检测是否还有进行中的 DB 写入：若有则跳过本次触发，
 * 等待最后一个写入完成后重新调度，确保查询拿到完整数据。
 */
function schedulePreviewNotify(): void {
  if (_previewDebounceTimer) {
    clearTimeout(_previewDebounceTimer);
  }
  _previewDebounceTimer = setTimeout(() => {
    _previewDebounceTimer = null;
    if (_pendingWrites > 0) {
      // 仍有写入在途：跳过本次触发，等最后一个写入完成后重新调度，确保查询拿到完整数据
      return;
    }
    window.dispatchEvent(new CustomEvent(PREVIEW_CHANGED_EVENT));
  }, 150);
}

// ============================================================================
// 类型定义
// ============================================================================

/** 会话类型 */
export type ConversationType = 'friend' | 'group';

/** 本地会话记录 */
export interface LocalConversation {
  id: string;
  type: ConversationType;
  name: string;
  avatar_url: string | null;
  last_message: string | null;
  last_message_time: string | null;
  last_seq: number;
  unread_count: number;
  /** 本地已读位置（per 会话单调推进，仅 advanceConversationRead 维护；saveConversation 不携带） */
  last_read_seq: number;
  is_muted: boolean;
  is_pinned: boolean;
  updated_at: string;
  synced_at: string | null;
}

/** 本地消息记录 */
export interface LocalMessage {
  message_uuid: string;
  conversation_id: string;
  conversation_type: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  content: string;
  content_type: string;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  file_hash: string | null;
  /** 图片宽度（像素），仅图片类型消息有值 */
  image_width: number | null;
  /** 图片高度（像素），仅图片类型消息有值 */
  image_height: number | null;
  seq: number;
  reply_to: string | null;
  /** 媒体组（相册）ID —— 组内各项共享同一值；非组内消息为 null。
   *  必须本地持久化：消息列表是 DB-first 的，不落库的话重启 / 切会话 / 离线加载后
   *  相册会散成 N 条独立图片。 */
  media_group_id: string | null;
  /** 组内位次（0-based）；index=0 那条的 content 即整组 caption */
  media_group_index: number | null;
  /** 组的期望总数（2..10）；跨分页只加载到一部分时靠它预留占位 */
  media_group_count: number | null;
  is_recalled: boolean;
  is_deleted: boolean;
  send_time: string;
  created_at: string | null;
}

/** 会话预览（JOIN messages 表的最新消息，一次查询完成） */
export interface ConversationWithPreview {
  id: string;
  type: ConversationType;
  name: string;
  avatar_url: string | null;
  last_seq: number;
  unread_count: number;
  is_muted: boolean;
  is_pinned: boolean;
  updated_at: string;
  msg_content: string | null;
  msg_content_type: string | null;
  msg_send_time: string | null;
  /** 最新消息发送者 ID（群聊卡片预览前缀判「是不是我」用） */
  msg_sender_id: string | null;
  /** 最新消息发送者昵称（群聊卡片预览前缀用；未带昵称的同步路径为 null） */
  msg_sender_name: string | null;
}

/** 消息搜索结果（含会话上下文 + 前后相邻消息预览） */
/**
 * 消息搜索过滤条件（镜像 Rust `db::MessageSearchFilter`，字段名保持 snake_case）
 *
 * 字段收的是**原始 content_type 值**（`text` / `image` / `video` / `file` / `card` …），
 * 业务分类 → content_type 的映射在前端 `components/search/messageCategory.ts` 里。
 * 「文字」用 exclude 而非 include，这样服务端未来新增的未知类型仍归入文字，不会从四类里消失。
 */
export interface MessageSearchFilter {
  /** 限定单个会话（省略 = 跨会话） */
  conversation_id?: string;
  /** 仅保留这些 content_type（省略 = 不限；空数组 = 无任何命中） */
  include_content_types?: string[];
  /** 排除这些 content_type（省略 / 空数组 = 不排除） */
  exclude_content_types?: string[];
}

export interface SearchMessageResult {
  /** 命中消息本体 */
  message: LocalMessage;
  /** 会话名（来自 conversations 表） */
  conversation_name: string;
  /** 会话头像 */
  conversation_avatar: string | null;
  /** 前一条消息内容（按 seq 相邻） */
  context_before: string | null;
  /** 后一条消息内容 */
  context_after: string | null;
}

/**
 * 群成员本地已读位置行（对应 Rust group_read_positions 表）。
 *
 * `avatar_url` 为后端**原始**值（相对路径 / 逻辑域名 URL）；显示层经唯一收口点
 * resolveServerAvatarUrl 解析为回环反代 URL——不持久化已解析值，因反代端口跨应用重启会变。
 */
export interface GroupReadPositionRow {
  group_id: string;
  user_id: string;
  last_read_seq: number;
  display_name: string | null;
  avatar_url: string | null;
  last_read_at: string | null;
}

/** 本地文件映射 */
export interface LocalFileMapping {
  file_hash: string;
  local_path: string;
  file_size: number;
  file_name: string;
  content_type: string;
  source: 'uploaded' | 'downloaded';
  last_verified: string;
  created_at: string | null;
}

// ============================================================================
// 用户数据目录管理
// ============================================================================

/**
 * 设置当前用户（登录成功后调用）
 * 这会创建用户数据目录结构：
 * - data/{user_id}_{server}/chat/  - 聊天数据
 * - data/{user_id}_{server}/file/videos/  - 视频文件
 * - data/{user_id}_{server}/file/pictures/  - 图片文件
 * - data/{user_id}_{server}/file/documents/  - 文档文件
 */
export async function setCurrentUser(userId: string, serverUrl: string): Promise<void> {
  await invoke('set_current_user', { userId, serverUrl });
}

/** 清除当前用户（登出时调用） */
export async function clearCurrentUser(): Promise<void> {
  await invoke('clear_current_user');
}

// ============================================================================
// 数据库初始化
// ============================================================================

/** 初始化数据库连接并创建表（需要先调用 setCurrentUser） */
export async function initDatabase(): Promise<void> {
  await invoke('db_init');
}

// ============================================================================
// 会话操作
// ============================================================================

/** 获取所有会话列表 */
export function getConversations(): Promise<LocalConversation[]> {
  return invoke<LocalConversation[]>('db_get_conversations');
}

/** 获取所有会话及其最新消息预览（一次 SQL JOIN 查询） */
export function getConversationPreviews(): Promise<ConversationWithPreview[]> {
  return invoke<ConversationWithPreview[]>('db_get_conversation_previews');
}

/** 获取单个会话 */
export function getConversation(
  id: string,
): Promise<LocalConversation | null> {
  return invoke<LocalConversation | null>('db_get_conversation', { id });
}

/** 保存或更新会话 */
export async function saveConversation(
  // last_read_seq（本地已读位置，由 advanceConversationRead 维护）与 is_pinned（本地置顶，
  // 由 setConversationPinned 维护）都不由保存路径携带：Rust 侧 UPSERT 不覆盖这两列
  // （serde default + ON CONFLICT 不更新），服务端同步不会冲掉本地 UI 状态。
  conversation: Omit<LocalConversation, 'synced_at' | 'last_read_seq' | 'is_pinned'>,
): Promise<void> {
  _pendingWrites++;
  try {
    const conv = {
      ...conversation,
      synced_at: null,
    };
    await invoke('db_save_conversation', { conversation: conv });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/**
 * 设置会话置顶（本地 UI 状态，与服务端无关）。
 * 会话行可能尚不存在（还没有消息的好友/群），Rust 侧 UPSERT：插入最小行或仅更新 is_pinned。
 */
export async function setConversationPinned(
  id: string,
  type: ConversationType,
  name: string,
  pinned: boolean,
): Promise<void> {
  _pendingWrites++;
  try {
    await invoke('db_set_conversation_pinned', { id, convType: type, name, pinned });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/**
 * 推进会话本地已读位置（last_read_seq 单调只升）：
 * 不带 seq 推进到当前已收最新（MAX(last_read_seq, last_seq)）；带 seq 推进到显式读位
 * （MAX(last_read_seq, seq)，不碰 last_seq 同步游标）。同步写穿读位内存 Map
 * （connected 同步纠正的判定源）后再落库。
 */
export async function advanceConversationRead(id: string, seq?: number): Promise<void> {
  noteRead(id, seq);
  await invoke('db_advance_conversation_read', { id, seq: seq ?? null });
}

/**
 * 读取会话对方已读位置（单聊已读回执首帧初值；无记录返回 0）。
 * 进入会话时读出建立 peerLastReadSeq 初值，配合 sync 快照 + WS read_sync 增量校准。
 */
export function getConversationPeerReadSeq(conversationId: string): Promise<number> {
  return invoke<number>('db_get_conversation_peer_read_seq', { id: conversationId });
}

/** 单调推进会话对方已读位置（MAX，只升不降）。sync 快照 / WS read_sync（对方读）到达时写穿。 */
export async function setConversationPeerReadSeq(conversationId: string, seq: number): Promise<void> {
  await invoke('db_set_conversation_peer_read_seq', { id: conversationId, seq });
}

/** 更新会话的最后序列号（同步写穿读位内存 Map 后落库） */
export async function updateConversationLastSeq(
  id: string,
  lastSeq: number,
): Promise<void> {
  noteMessageSeq(id, lastSeq);
  await invoke('db_update_conversation_last_seq', { id, lastSeq });
}

/** 更新会话的最后消息预览 */
export async function updateConversationLastMessage(
  id: string,
  lastMessage: string,
  lastMessageTime: string,
): Promise<void> {
  _pendingWrites++;
  try {
    await invoke('db_update_conversation_last_message', { id, lastMessage, lastMessageTime });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/** 删除会话（通过清空数据实现） */
export function deleteConversation(_id: string): Promise<void> {
  // 暂时使用 clear 方式，后续可以在 Rust 端添加专门的删除方法
  return Promise.resolve();
}

// ============================================================================
// 消息操作
// ============================================================================

/** 获取会话的消息列表 */
export function getMessages(
  conversationId: string,
  limit: number = 50,
  beforeSeq?: number,
): Promise<LocalMessage[]> {
  return invoke<LocalMessage[]>('db_get_messages', {
    conversationId,
    limit,
    beforeSeq: beforeSeq ?? null,
  });
}

/** 获取会话的最新消息 */
export async function getLatestMessage(
  conversationId: string,
): Promise<LocalMessage | null> {
  const messages = await getMessages(conversationId, 1);
  return messages.length > 0 ? messages[0] : null;
}

/** 保存消息 */
export async function saveMessage(
  message: Omit<LocalMessage, 'created_at'>,
): Promise<void> {
  _pendingWrites++;
  try {
    const msg: LocalMessage = {
      ...message,
      created_at: null,
    };
    await invoke('db_save_message', { message: msg });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/** 批量保存消息（INSERT OR REPLACE — 以服务器为准；适用于 sync 增量 / WS 新消息） */
export async function saveMessages(
  messages: Omit<LocalMessage, 'created_at'>[],
): Promise<void> {
  _pendingWrites++;
  try {
    const msgs: LocalMessage[] = messages.map(m => ({
      ...m,
      created_at: null,
    }));
    await invoke('db_save_messages', { messages: msgs });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/** 批量插入消息（INSERT OR IGNORE — 仅补本地缺失的，不覆盖本地状态）
 *
 * 用途：历史消息加载（loadAllHistoryMessages）—— 服务器响应可能不带 is_recalled
 * 等本地状态字段，用 INSERT OR REPLACE 会把本地已撤回消息覆盖回 0；本函数确保
 * 已有的 message_uuid 不被覆盖，仅插入本地缺失的消息。
 */
export async function saveMessagesSkipExisting(
  messages: Omit<LocalMessage, 'created_at'>[],
): Promise<void> {
  _pendingWrites++;
  try {
    const msgs: LocalMessage[] = messages.map(m => ({
      ...m,
      created_at: null,
    }));
    await invoke('db_save_messages_skip_existing', { messages: msgs });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/**
 * 搜索消息内容（含文件名）— 调 Rust db_search_messages
 *
 * 不传 filter = 跨会话、不限类型（全局搜索）。
 * 传 filter 可限定单会话 + 按 content_type 筛选（会话内搜索的四类分页）。
 */
export function searchMessages(
  query: string,
  limit = 50,
  filter?: MessageSearchFilter,
): Promise<SearchMessageResult[]> {
  return invoke<SearchMessageResult[]>('db_search_messages', {
    query,
    limit,
    filter: filter ?? null,
  });
}

/** `listConversationMessages` 的入参（字段多且同类型，用对象避免位置参数写反） */
export interface ListConversationMessagesParams {
  /** 会话 ID（好友 `conv-{a}-{b}` / 群 group_id）；范围由 Rust 侧强制注入，不可省 */
  conversationId: string;
  /** 关键词。省略 / 空串 = **不过滤**，按分类列出全部（会话内查找的浏览态） */
  query?: string;
  /** 本页条数 */
  limit: number;
  /** 起始偏移（分页） */
  offset: number;
  /** content_type 白/黑名单（分类映射见 components/search/messageCategory.ts） */
  filter?: Pick<MessageSearchFilter, 'include_content_types' | 'exclude_content_types'>;
}

/**
 * 会话内按分类浏览消息（关键词可选）— 调 Rust `db_list_conversation_messages`
 *
 * 与 `searchMessages` 的分工：那条是**跨会话全局**搜索、关键词必填、FTS5 短语；
 * 这条是**单会话**内的分页浏览，**不给关键词就按分类按时间倒序列出全部**
 * （产品要求：点分类即出列表，不必先输入关键词），给了关键词就在该分类内再过滤。
 * 详细的「为什么不走 FTS」「排序为何是三元组」见 Rust 侧同名函数文档。
 */
export function listConversationMessages(
  params: ListConversationMessagesParams,
): Promise<LocalMessage[]> {
  return invoke<LocalMessage[]>('db_list_conversation_messages', {
    conversationId: params.conversationId,
    query: params.query ?? null,
    limit: params.limit,
    offset: params.offset,
    filter: params.filter ?? null,
  });
}

/** 标记消息为已删除 */
export async function markMessageDeleted(messageUuid: string): Promise<void> {
  _pendingWrites++;
  try {
    await invoke('db_mark_message_deleted', { messageUuid });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/** 标记消息为已撤回 */
export async function markMessageRecalled(messageUuid: string): Promise<void> {
  _pendingWrites++;
  try {
    await invoke('db_mark_message_recalled', { messageUuid });
  } finally {
    _pendingWrites--;
    schedulePreviewNotify();
  }
}

/**
 * 刷新会话的最新消息预览
 *
 * 在消息被删除或撤回后调用，重新从消息表查询最新的有效消息
 * 并更新 conversations 表的 last_message / last_message_time 字段。
 *
 * @returns 新的预览信息；若该会话已无有效消息则返回 null
 */
export async function refreshConversationPreview(
  conversationId: string,
): Promise<{ lastMessage: string; lastMessageTime: string } | null> {
  const latestMsg = await getLatestMessage(conversationId);
  if (latestMsg) {
    const contentTypeMap: Record<string, string> = {
      text: latestMsg.content,
      image: '[图片]',
      video: '[视频]',
    };
    const preview = contentTypeMap[latestMsg.content_type] ?? '[文件]';
    await updateConversationLastMessage(conversationId, preview, latestMsg.send_time);
    return { lastMessage: preview, lastMessageTime: latestMsg.send_time };
  }
  await updateConversationLastMessage(conversationId, '', '');
  return null;
}

// ============================================================================
// 文件映射操作
// ============================================================================

/** 保存文件映射 */
export async function saveFileMapping(
  mapping: Omit<LocalFileMapping, 'created_at'>,
): Promise<void> {
  const m: LocalFileMapping = {
    ...mapping,
    created_at: null,
  };
  await invoke('db_save_file_mapping', { mapping: m });
}

// ============================================================================
// file_uuid 到 file_hash 映射
// ============================================================================

/** 保存 file_uuid 到 file_hash 的映射 */
export async function saveFileUuidHash(fileUuid: string, fileHash: string): Promise<void> {
  await invoke('db_save_file_uuid_hash', { fileUuid, fileHash });
}

// ============================================================================
// 好友操作
// ============================================================================

/** 本地好友记录 */
export interface LocalFriend {
  friend_id: string;
  username: string;
  nickname: string | null;
  avatar_url: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

/** 获取所有本地好友 */
export function getFriends(): Promise<LocalFriend[]> {
  return invoke<LocalFriend[]>('db_get_friends');
}

/** 批量保存好友（全量替换） */
export async function saveFriends(friends: LocalFriend[]): Promise<void> {
  await invoke('db_save_friends', { friends });
}

// ============================================================================
// 群组操作
// ============================================================================

/** 本地群组记录 */
export interface LocalGroup {
  group_id: string;
  name: string;
  avatar_url: string | null;
  owner_id: string;
  member_count: number;
  my_role: string | null;
  created_at: string;
  updated_at: string | null;
}

/** 获取所有本地群组 */
export function getGroups(): Promise<LocalGroup[]> {
  return invoke<LocalGroup[]>('db_get_groups');
}

/** 批量保存群组（全量替换） */
export async function saveGroups(groups: LocalGroup[]): Promise<void> {
  await invoke('db_save_groups', { groups });
}

/** 更新群组信息 */
export async function updateGroup(group: LocalGroup): Promise<void> {
  await invoke('db_update_group', { group });
}

/** 删除群组 */
export async function deleteGroup(groupId: string): Promise<void> {
  await invoke('db_delete_group', { groupId });
}

// ============================================================================
// 群成员已读位置（群已读回执首帧初值 + 二开校准的本地持久化）
// ============================================================================

/**
 * 读某群全部成员的本地已读位置（首帧初值 + 二开校准）。
 * avatar_url 为后端原始值，显示层经 resolveServerAvatarUrl 解析（见 GroupReadPositionRow 注释）。
 */
export function getGroupReadPositions(groupId: string): Promise<GroupReadPositionRow[]> {
  return invoke<GroupReadPositionRow[]>('db_get_group_read_positions', { groupId });
}

/**
 * upsert 群成员已读位置（last_read_seq 单调 MAX；display_name/avatar_url/last_read_at 用
 * COALESCE 保留非空旧值——快照行携带完整身份，WS 单读者行仅带 seq、其余传 null 不清空身份）。
 */
export async function upsertGroupReadPositions(
  groupId: string,
  rows: GroupReadPositionRow[],
): Promise<void> {
  await invoke('db_upsert_group_read_positions', { groupId, rows });
}

/**
 * 用**全量权威快照**对齐某群成员集：删除快照里不再出现的成员（退群幽灵）+ upsert 快照成员。
 * 仅"进入会话的 sync 快照"这类全量活跃成员权威快照调用；WS 单读者/去抖补拉用 upsert（只补不删）。
 */
export async function replaceGroupReadPositions(
  groupId: string,
  rows: GroupReadPositionRow[],
): Promise<void> {
  await invoke('db_replace_group_read_positions', { groupId, rows });
}
