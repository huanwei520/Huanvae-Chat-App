/**
 * 聊天操作 Hook
 *
 * 封装消息的撤回、删除等操作逻辑，同时处理：
 * - 远程 API 调用
 * - 本地数据库标记
 * - 会话卡片的最新消息预览同步刷新
 */

import { useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { deleteMessage, recallMessage } from '../api/messages';
import { deleteGroupMessage, recallGroupMessage } from '../api/groupMessages';
import * as db from '../db';
import type { ChatTarget } from '../types/chat';

interface UseChatActionsParams {
  chatTarget: ChatTarget | null;
  removeFriendMessage: (messageUuid: string) => void;
  removeGroupMessage: (messageUuid: string) => void;
}

interface UseChatActionsReturn {
  handleRecallMessage: (messageUuid: string) => Promise<void>;
  handleDeleteMessage: (messageUuid: string) => Promise<void>;
}

export function useChatActions({
  chatTarget,
  removeFriendMessage,
  removeGroupMessage,
}: UseChatActionsParams): UseChatActionsReturn {
  const api = useApi();
  const { refreshLastMessagePreview } = useWebSocket();

  const handleRecallMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget || chatTarget.type === 'ai') { return; }

    try {
      if (chatTarget.type === 'friend') {
        await recallMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await recallGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
      await db.markMessageDeleted(messageUuid);

      const targetId = chatTarget.type === 'friend'
        ? chatTarget.data.friend_id
        : chatTarget.data.group_id;
      await refreshLastMessagePreview(chatTarget.type, targetId);
    } catch (err) {
      console.error('撤回失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage, refreshLastMessagePreview]);

  const handleDeleteMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget || chatTarget.type === 'ai') { return; }

    try {
      if (chatTarget.type === 'friend') {
        await deleteMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await deleteGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
      await db.markMessageDeleted(messageUuid);

      const targetId = chatTarget.type === 'friend'
        ? chatTarget.data.friend_id
        : chatTarget.data.group_id;
      await refreshLastMessagePreview(chatTarget.type, targetId);
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage, refreshLastMessagePreview]);

  return {
    handleRecallMessage,
    handleDeleteMessage,
  };
}
