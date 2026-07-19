/**
 * 聊天操作 Hook
 *
 * 封装消息的撤回、删除等操作逻辑：
 *
 * - 撤回（recall）：直接委托 useLocalFriendMessages.recall / useLocalGroupMessages.recall。
 *   它们内部完成 [服务器调用 → setMessages.map(is_recalled=true) → db.markMessageRecalled]
 *   全链路，使当前聊天界面在服务器返回后立即翻转为「消息已撤回」占位胶囊。
 *   useChatActions 仅负责事后刷新会话列表卡片预览。
 *
 *   ❗ 不再使用 removeXxxMessage + db.markMessageDeleted 老路径：
 *   - removeMessage 会把消息直接 filter 移除 → 用户看不到撤回胶囊
 *   - markMessageDeleted 写 is_deleted=1 → 会话预览 JOIN 把这条排除 → 卡片排序退回
 *
 * - 删除（delete）：保持 filter 移除 + markMessageDeleted 行为。
 *   删除是用户主动隐藏，与撤回的"显示占位"语义不同。
 */

import { useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { deleteMessage } from '../api/messages';
import { deleteGroupMessage } from '../api/groupMessages';
import * as db from '../db';
import { isFriendLikeTarget } from '../utils/chatTarget';
import type { ChatTarget } from '../types/chat';

interface UseChatActionsParams {
  chatTarget: ChatTarget | null;
  removeFriendMessage: (messageUuid: string) => void;
  removeGroupMessage: (messageUuid: string) => void;
  /** 好友侧 hook 暴露的 recall：内部完成 server + setMessages.map + markMessageRecalled */
  recallFriendMessage: (messageUuid: string) => Promise<boolean>;
  /** 群聊侧 hook 暴露的 recall：内部完成 server + setMessages.map + markMessageRecalled */
  recallGroupMessage: (messageUuid: string) => Promise<boolean>;
}

interface UseChatActionsReturn {
  handleRecallMessage: (messageUuid: string) => Promise<void>;
  handleDeleteMessage: (messageUuid: string) => Promise<void>;
}

export function useChatActions({
  chatTarget,
  removeFriendMessage,
  removeGroupMessage,
  recallFriendMessage,
  recallGroupMessage,
}: UseChatActionsParams): UseChatActionsReturn {
  const api = useApi();
  const { refreshLastMessagePreview } = useWebSocket();

  const handleRecallMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget || chatTarget.type === 'ai') { return; }

    // 委托 hook 的 recall：服务器撤回 + 立即翻转 is_recalled + DB markMessageRecalled
    // 失败时 hook 内部已 setError，无需再额外抛（bot 与好友共用私聊链路）
    const ok = isFriendLikeTarget(chatTarget)
      ? await recallFriendMessage(messageUuid)
      : await recallGroupMessage(messageUuid);

    if (!ok) { return; }

    // 撤回成功后刷新会话列表卡片的最新消息预览
    // （DB 里 is_deleted=0 + content='[消息已撤回]'，预览 JOIN 会带回该占位）
    // 预览通道 id 只认 'friend' | 'group'：bot 目标走 'friend'
    const channel = isFriendLikeTarget(chatTarget) ? 'friend' : 'group';
    const targetId = isFriendLikeTarget(chatTarget)
      ? chatTarget.data.friend_id
      : chatTarget.data.group_id;
    await refreshLastMessagePreview(channel, targetId);
  }, [chatTarget, recallFriendMessage, recallGroupMessage, refreshLastMessagePreview]);

  const handleDeleteMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget || chatTarget.type === 'ai') { return; }

    try {
      if (isFriendLikeTarget(chatTarget)) {
        await deleteMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await deleteGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
      await db.markMessageDeleted(messageUuid);

      const channel = isFriendLikeTarget(chatTarget) ? 'friend' : 'group';
      const targetId = isFriendLikeTarget(chatTarget)
        ? chatTarget.data.friend_id
        : chatTarget.data.group_id;
      await refreshLastMessagePreview(channel, targetId);
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage, refreshLastMessagePreview]);

  return {
    handleRecallMessage,
    handleDeleteMessage,
  };
}
