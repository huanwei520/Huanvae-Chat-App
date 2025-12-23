/**
 * 会话 ID 工具函数
 *
 * 根据后端文档，好友消息的 conversation_id 格式为 `conv-{userId}-{friendId}`
 * 其中两个 ID 按字典序排序，确保双方使用相同的 conversation_id
 */

/**
 * 生成好友会话的 conversation_id
 * 格式: `conv-{smaller}-{larger}` (按字典序排序)
 *
 * @param userId 当前用户 ID
 * @param friendId 好友用户 ID
 * @returns 格式化的 conversation_id
 */
export function getFriendConversationId(userId: string, friendId: string): string {
  // 按字典序排序，确保双方生成相同的 ID
  const sorted = [userId, friendId].sort();
  return `conv-${sorted[0]}-${sorted[1]}`;
}

/**
 * 从 conversation_id 中解析好友 ID
 *
 * @param conversationId 会话 ID (格式: conv-user1-user2)
 * @param currentUserId 当前用户 ID
 * @returns 好友 ID
 */
export function parseFriendIdFromConversationId(
  conversationId: string,
  currentUserId: string,
): string | null {
  if (!conversationId.startsWith('conv-')) {
    return null;
  }

  const parts = conversationId.slice(5).split('-');
  if (parts.length !== 2) {
    return null;
  }

  // 返回不是当前用户的那个 ID
  return parts[0] === currentUserId ? parts[1] : parts[0];
}

/**
 * 判断是否是好友会话 ID
 */
export function isFriendConversationId(conversationId: string): boolean {
  return conversationId.startsWith('conv-');
}

/**
 * 群聊的 conversation_id 就是 group_id，无需特殊处理
 */
export function getGroupConversationId(groupId: string): string {
  return groupId;
}
