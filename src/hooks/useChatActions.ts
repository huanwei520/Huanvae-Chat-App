/**
 * 聊天操作 Hook
 *
 * 封装消息的撤回、删除等操作逻辑
 * 同时处理远程 API 和本地数据库
 */

import { useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
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

/**
 * 聊天操作 Hook
 */
export function useChatActions({
  chatTarget,
  removeFriendMessage,
  removeGroupMessage,
}: UseChatActionsParams): UseChatActionsReturn {
  const api = useApi();

  // 撤回单条消息（只有成功才移除，失败不移除）
  const handleRecallMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget) { return; }

    try {
      if (chatTarget.type === 'friend') {
        await recallMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await recallGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
      // 远程撤回成功后，删除本地数据库中的消息
      await db.markMessageDeleted(messageUuid);
    } catch (err) {
      console.error('撤回失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage]);

  // 删除单条消息
  const handleDeleteMessage = useCallback(async (messageUuid: string) => {
    if (!chatTarget) { return; }

    try {
      if (chatTarget.type === 'friend') {
        await deleteMessage(api, messageUuid);
        removeFriendMessage(messageUuid);
      } else {
        await deleteGroupMessage(api, messageUuid);
        removeGroupMessage(messageUuid);
      }
      // 远程删除成功后，删除本地数据库中的消息
      await db.markMessageDeleted(messageUuid);
    } catch (err) {
      console.error('删除失败:', err);
    }
  }, [api, chatTarget, removeFriendMessage, removeGroupMessage]);

  return {
    handleRecallMessage,
    handleDeleteMessage,
  };
}