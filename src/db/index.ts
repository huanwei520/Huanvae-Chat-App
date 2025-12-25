/**
 * 本地数据库服务 - 通过 Tauri Commands 调用 Rust 后端
 *
 * 所有数据库操作都在 Rust 后端执行，前端只负责调用和数据传递
 * 这符合 Tauri 的安全架构理念
 */

import { invoke } from '@tauri-apps/api/core';

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
  seq: number;
  reply_to: string | null;
  is_recalled: boolean;
  is_deleted: boolean;
  send_time: string;
  created_at: string | null;
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

/** 获取当前用户的文件下载目录 */
export function getUserFileDir(): Promise<string> {
  return invoke<string>('get_user_file_dir');
}

/** 根据文件类型获取下载目录 */
export function getDownloadDir(fileType: 'video' | 'image' | 'document'): Promise<string> {
  return invoke<string>('get_download_dir', { fileType });
}

/** 列出当前用户的所有下载文件 */
export function listUserFiles(): Promise<string[]> {
  return invoke<string[]>('list_user_files');
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

/** 获取单个会话 */
export function getConversation(
  id: string,
): Promise<LocalConversation | null> {
  return invoke<LocalConversation | null>('db_get_conversation', { id });
}

/** 保存或更新会话 */
export async function saveConversation(
  conversation: Omit<LocalConversation, 'synced_at'>,
): Promise<void> {
  // 转换类型以匹配 Rust 端
  const conv: LocalConversation = {
    ...conversation,
    synced_at: null,
  };
  await invoke('db_save_conversation', { conversation: conv });
}

/** 更新会话的最后序列号 */
export async function updateConversationLastSeq(
  id: string,
  lastSeq: number,
): Promise<void> {
  await invoke('db_update_conversation_last_seq', { id, lastSeq });
}

/** 更新会话未读数 */
export async function updateConversationUnread(
  id: string,
  unreadCount: number,
): Promise<void> {
  await invoke('db_update_conversation_unread', { id, unreadCount });
}

/** 清零会话未读数 */
export async function clearConversationUnread(id: string): Promise<void> {
  await invoke('db_clear_conversation_unread', { id });
}

/** 更新会话的最后消息预览 */
export async function updateConversationLastMessage(
  id: string,
  lastMessage: string,
  lastMessageTime: string,
): Promise<void> {
  await invoke('db_update_conversation_last_message', { id, lastMessage, lastMessageTime });
}

/** 增加会话未读数 */
export async function incrementConversationUnread(id: string): Promise<void> {
  // 先获取当前未读数，再 +1
  const conv = await getConversation(id);
  if (conv) {
    await updateConversationUnread(id, conv.unread_count + 1);
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
  const msg: LocalMessage = {
    ...message,
    created_at: null,
  };
  await invoke('db_save_message', { message: msg });
}

/** 批量保存消息 */
export async function saveMessages(
  messages: Omit<LocalMessage, 'created_at'>[],
): Promise<void> {
  const msgs: LocalMessage[] = messages.map(m => ({
    ...m,
    created_at: null,
  }));
  await invoke('db_save_messages', { messages: msgs });
}

/** 标记消息为已删除 */
export async function markMessageDeleted(messageUuid: string): Promise<void> {
  await invoke('db_mark_message_deleted', { messageUuid });
}

/** 标记消息为已撤回 */
export async function markMessageRecalled(messageUuid: string): Promise<void> {
  await invoke('db_mark_message_recalled', { messageUuid });
}

// ============================================================================
// 文件映射操作
// ============================================================================

/** 获取文件的本地映射 */
export function getFileMapping(
  fileHash: string,
): Promise<LocalFileMapping | null> {
  return invoke<LocalFileMapping | null>('db_get_file_mapping', { fileHash });
}

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

/** 删除文件映射 */
export async function deleteFileMapping(fileHash: string): Promise<void> {
  await invoke('db_delete_file_mapping', { fileHash });
}

/** 更新文件最后验证时间 */
export async function updateFileMappingVerified(fileHash: string): Promise<void> {
  await invoke('db_update_file_mapping_verified', { fileHash });
}

// ============================================================================
// file_uuid 到 file_hash 映射
// ============================================================================

/** 保存 file_uuid 到 file_hash 的映射 */
export async function saveFileUuidHash(fileUuid: string, fileHash: string): Promise<void> {
  await invoke('db_save_file_uuid_hash', { fileUuid, fileHash });
}

/** 通过 file_uuid 获取 file_hash */
export function getFileHashByUuid(fileUuid: string): Promise<string | null> {
  return invoke<string | null>('db_get_file_hash_by_uuid', { fileUuid });
}

// ============================================================================
// 清理操作
// ============================================================================

/** 清空所有本地数据（登出时调用） */
export async function clearAllData(): Promise<void> {
  await invoke('db_clear_all_data');
}

/** 清理过期的文件映射（文件不存在的） */
export function cleanupInvalidFileMappings(): Promise<{ removed: number; total: number }> {
  // 这个功能需要配合文件系统检查，在调用处实现
  return Promise.resolve({ removed: 0, total: 0 });
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

/** 保存单个好友 */
export async function saveFriend(friend: LocalFriend): Promise<void> {
  await invoke('db_save_friend', { friend });
}

/** 删除好友 */
export async function deleteFriend(friendId: string): Promise<void> {
  await invoke('db_delete_friend', { friendId });
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

/** 保存单个群组 */
export async function saveGroup(group: LocalGroup): Promise<void> {
  await invoke('db_save_group', { group });
}

/** 更新群组信息 */
export async function updateGroup(group: LocalGroup): Promise<void> {
  await invoke('db_update_group', { group });
}

/** 删除群组 */
export async function deleteGroup(groupId: string): Promise<void> {
  await invoke('db_delete_group', { groupId });
}
