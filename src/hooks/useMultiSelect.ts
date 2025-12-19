/**
 * 多选模式 Hook
 *
 * 管理消息多选状态和批量操作
 */

import { useState, useEffect, useCallback } from 'react';
import type { ChatTarget } from '../types/chat';
import type { Message } from '../types/chat';
import type { GroupMessage } from '../types/chat';

interface UseMultiSelectParams {
  chatTarget: ChatTarget | null;
  friendMessages: Message[];
  groupMessages: GroupMessage[];
  handleRecallMessage: (messageUuid: string) => Promise<void>;
  handleDeleteMessage: (messageUuid: string) => Promise<void>;
}

interface UseMultiSelectReturn {
  isMultiSelectMode: boolean;
  selectedMessages: Set<string>;
  handleToggleSelect: (messageUuid: string) => void;
  handleEnterMultiSelect: () => void;
  handleExitMultiSelect: () => void;
  handleSelectAll: () => void;
  handleDeselectAll: () => void;
  handleBatchDelete: () => Promise<void>;
  handleBatchRecall: () => Promise<void>;
}

/**
 * 多选模式 Hook
 */
export function useMultiSelect({
  chatTarget,
  friendMessages,
  groupMessages,
  handleRecallMessage,
  handleDeleteMessage,
}: UseMultiSelectParams): UseMultiSelectReturn {
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  // 退出多选模式时清空选中
  useEffect(() => {
    if (!isMultiSelectMode) {
      setSelectedMessages(new Set());
    }
  }, [isMultiSelectMode]);

  // 切换聊天对象时退出多选模式
  useEffect(() => {
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, [chatTarget]);

  // 切换消息选中状态
  const handleToggleSelect = useCallback((messageUuid: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageUuid)) {
        next.delete(messageUuid);
      } else {
        next.add(messageUuid);
      }
      return next;
    });
  }, []);

  // 进入多选模式
  const handleEnterMultiSelect = useCallback(() => {
    setIsMultiSelectMode(true);
  }, []);

  // 退出多选模式
  const handleExitMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, []);

  // 全选
  const handleSelectAll = useCallback(() => {
    if (chatTarget?.type === 'friend') {
      setSelectedMessages(new Set(friendMessages.map((m) => m.message_uuid)));
    } else if (chatTarget?.type === 'group') {
      setSelectedMessages(new Set(groupMessages.map((m) => m.message_uuid)));
    }
  }, [chatTarget, friendMessages, groupMessages]);

  // 取消全选
  const handleDeselectAll = useCallback(() => {
    setSelectedMessages(new Set());
  }, []);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedMessages.size === 0) { return; }

    const uuids = Array.from(selectedMessages);
    await Promise.all(uuids.map((uuid) => handleDeleteMessage(uuid)));
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, [selectedMessages, handleDeleteMessage]);

  // 批量撤回
  const handleBatchRecall = useCallback(async () => {
    if (selectedMessages.size === 0) { return; }

    const uuids = Array.from(selectedMessages);
    await Promise.all(uuids.map((uuid) => handleRecallMessage(uuid)));
    setIsMultiSelectMode(false);
    setSelectedMessages(new Set());
  }, [selectedMessages, handleRecallMessage]);

  return {
    isMultiSelectMode,
    selectedMessages,
    handleToggleSelect,
    handleEnterMultiSelect,
    handleExitMultiSelect,
    handleSelectAll,
    handleDeselectAll,
    handleBatchDelete,
    handleBatchRecall,
  };
}
