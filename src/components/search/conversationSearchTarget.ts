/**
 * 由 ChatTarget 解析出会话内查找要用的 conversation_id
 *
 * 三种会话都落本地 messages 表、只是 id 来源不同：
 * - 好友私聊 / bot：`conv-{a}-{b}`（两 ID 字典序，getFriendConversationId）
 *   —— bot 是真实好友行，走同一条私聊消息链路（见 utils/chatTarget.ts）
 * - 群聊：conversation_id 即 group_id
 * - AI：不落本地 messages 表 → null，调用方据此不挂载查找面板
 */

import { isFriendLikeTarget } from '../../utils/chatTarget';
import { getFriendConversationId } from '../../utils/conversationId';
import type { ChatTarget } from '../../types/chat';

export function getSearchConversationId(
  chatTarget: ChatTarget,
  currentUserId: string,
): string | null {
  if (chatTarget.type === 'group') {
    return chatTarget.data.group_id;
  }
  if (isFriendLikeTarget(chatTarget)) {
    return getFriendConversationId(currentUserId, chatTarget.data.friend_id);
  }
  return null;
}
