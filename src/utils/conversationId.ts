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
 * 用户 ID 本身可含连字符（如 vis-test-cf09b2-a），不能按 '-' split 计数；
 * 必须用 currentUserId 精确定界：两 ID 按字典序拼接，当前用户必为首段或尾段。
 *
 * @param conversationId 会话 ID (格式: conv-{smaller}-{larger})
 * @param currentUserId 当前用户 ID
 * @returns 好友 ID；格式非法或当前用户不在该会话中时返回 null
 */
export function parseFriendIdFromConversationId(
  conversationId: string,
  currentUserId: string,
): string | null {
  if (!conversationId.startsWith('conv-')) {
    return null;
  }

  const pair = conversationId.slice(5);
  // 当前用户在首位：剩余部分即好友 ID
  if (pair.startsWith(`${currentUserId}-`)) {
    return pair.slice(currentUserId.length + 1);
  }
  // 当前用户在末位：前面部分即好友 ID
  if (pair.endsWith(`-${currentUserId}`)) {
    return pair.slice(0, pair.length - currentUserId.length - 1);
  }
  return null;
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
