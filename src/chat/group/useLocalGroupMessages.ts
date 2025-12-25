/**
 * 本地优先群聊消息 Hook
 *
 * 实现离线优先策略（与好友消息一致）：
 * 1. 先从本地 SQLite 加载消息并立即显示
 * 2. 新消息通过 WebSocket 实时推送更新（包括 seq 序列号）
 * 3. 发送消息时先乐观更新本地，API 响应后更新 uuid
 * 4. WebSocket 断线重连时执行增量同步，获取断线期间的消息
 *
 * 消息同步策略（类似 Telegram）：
 * - 发送消息后不再主动触发同步，依赖 WebSocket 推送
 * - WebSocket 推送的消息包含 seq，会自动更新本地
 * - 只有在 WebSocket 连接建立时（首次连接或重连）才执行同步
 * - handleNewMessage 智能处理：
 *   1. message_uuid 已存在 → 更新 seq
 *   2. 自己发送的消息且 WebSocket 比 API 快 → 替换 sending 消息
 *   3. 其他情况 → 添加新消息
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from '../../db';
import type { LocalMessage, LocalConversation } from '../../db';
import { initSyncService, getSyncService, SyncService } from '../../services/syncService';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import type { GroupMessage } from '../../api/groupMessages';
import type { WsNewMessage, WsMessageRecalled } from '../../types/websocket';

// ============================================================================
// 调试日志
// ============================================================================

const DEBUG = true;

function logLocal(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[GroupLocalMsg] ${action}`, 'color: #9C27B0; font-weight: bold', data ?? '');
  }
}

function logSync(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[GroupSync] ${action}`, 'color: #2196F3; font-weight: bold', data ?? '');
  }
}

function logFileLink(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[GroupFileLink] ${action}`, 'color: #FF9800; font-weight: bold', data ?? '');
  }
}

function logError(action: string, error: unknown) {
  console.error(`%c[GroupError] ${action}`, 'color: #f44336; font-weight: bold', error);
}

// ============================================================================
// 类型转换
// ============================================================================

/**
 * 将本地消息转换为 UI GroupMessage 类型
 */
function localMessageToGroupMessage(local: LocalMessage): GroupMessage {
  return {
    message_uuid: local.message_uuid,
    group_id: local.conversation_id,
    sender_id: local.sender_id,
    sender_nickname: local.sender_name || '',
    sender_avatar_url: local.sender_avatar || '',
    message_content: local.content,
    message_type: local.content_type as GroupMessage['message_type'],
    file_uuid: local.file_uuid,
    file_url: local.file_url,
    file_size: local.file_size,
    file_hash: local.file_hash,
    reply_to: local.reply_to,
    send_time: local.send_time,
    is_recalled: local.is_recalled,
    seq: local.seq,
  };
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useLocalGroupMessages(groupId: string | null) {
  const api = useApi();
  const { session } = useSession();
  const ws = useWebSocket();

  // 状态
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // sending 状态保留用于向后兼容，但不再使用发送锁
  const [sending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Refs
  const syncServiceRef = useRef<SyncService | null>(null);
  const conversationRef = useRef<LocalConversation | null>(null);
  const currentGroupId = useRef<string | null>(null);
  const dbInitialized = useRef(false);

  // ============================================
  // 数据库初始化检查
  // ============================================

  useEffect(() => {
    if (session && !dbInitialized.current) {
      dbInitialized.current = true;
      logLocal('数据库已就绪（由登录流程初始化）');
    }
  }, [session]);

  // ============================================
  // 切换群组时重置
  // ============================================

  useEffect(() => {
    if (groupId !== currentGroupId.current) {
      logLocal('切换群组', { from: currentGroupId.current, to: groupId });
      setMessages([]);
      setHasMore(true);
      setError(null);
      conversationRef.current = null;
      currentGroupId.current = groupId;
    }
  }, [groupId]);

  // ============================================
  // 加载本地消息
  // ============================================

  const loadMessages = useCallback(async (limit = 50) => {
    if (!groupId || !dbInitialized.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      logLocal('开始加载本地消息', { groupId, limit });

      // 1. 从本地数据库加载
      const localMessages = await db.getMessages(groupId, limit);

      logLocal('本地消息加载完成', {
        count: localMessages.length,
        hasMore: localMessages.length >= limit,
        firstSeq: localMessages[0]?.seq,
        lastSeq: localMessages[localMessages.length - 1]?.seq,
      });

      // 2. 转换为 UI GroupMessage 类型，过滤已撤回的消息
      const uiMessages = localMessages
        .filter((m) => !m.is_recalled)
        .map((m) => localMessageToGroupMessage(m));
      setMessages(uiMessages);
      setHasMore(localMessages.length >= limit);

      // 3. 获取会话信息
      conversationRef.current = await db.getConversation(groupId);

      // 4. 记录文件链接状态
      const filesWithHash = localMessages.filter((m) => m.file_hash);
      if (filesWithHash.length > 0) {
        logFileLink('检测到带哈希的文件消息', {
          count: filesWithHash.length,
          files: filesWithHash.map((m) => ({
            uuid: m.message_uuid,
            hash: m.file_hash,
            type: m.content_type,
          })),
        });
      }
    } catch (err) {
      logError('加载本地消息失败', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }

    // 5. 触发后台同步
    syncMessagesInBackground();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // ============================================
  // 后台同步服务器消息
  // ============================================

  const syncMessagesInBackground = useCallback(async () => {
    if (!groupId || !session || syncing) {
      return;
    }

    setSyncing(true);

    try {
      // 初始化同步服务
      if (!syncServiceRef.current) {
        syncServiceRef.current = initSyncService(api);
        logSync('同步服务初始化完成');
      }

      const syncService = getSyncService();
      if (!syncService) {
        return;
      }

      // 获取或创建会话记录
      let conversation = conversationRef.current;
      if (!conversation) {
        conversation = {
          id: groupId,
          type: 'group',
          name: '',
          avatar_url: null,
          last_message: null,
          last_message_time: null,
          last_seq: 0,
          unread_count: 0,
          is_muted: false,
          is_pinned: false,
          updated_at: new Date().toISOString(),
          synced_at: null,
        };
        await db.saveConversation(conversation);
        conversationRef.current = conversation;
        logSync('创建新群组会话记录', { groupId });
      }

      logSync('开始增量同步', {
        groupId,
        lastSeq: conversation.last_seq,
      });

      // 执行增量同步
      const result = await syncService.syncMessages([conversation]);

      if (result.updatedConversations.includes(groupId)) {
        logSync('同步完成，发现新消息', {
          newCount: result.newMessagesCount,
        });

        // 重新加载本地消息
        const updatedMessages = await db.getMessages(groupId, 50);
        const uiMessages = updatedMessages
          .filter((m) => !m.is_recalled)
          .map((m) => localMessageToGroupMessage(m));

        // 智能合并：保留现有消息的 clientId 和 sendStatus，避免触发不必要的动画
        setMessages((prev) => {
          const existingMap = new Map(prev.map((m) => [m.message_uuid, m]));
          return uiMessages.map((newMsg) => {
            const existing = existingMap.get(newMsg.message_uuid);
            if (existing) {
              // 保留 clientId 和 sendStatus
              return { ...newMsg, clientId: existing.clientId, sendStatus: existing.sendStatus };
            }
            return newMsg;
          });
        });
        setHasMore(updatedMessages.length >= 50);

        logLocal('同步后重新加载消息', { count: uiMessages.length });
      } else {
        logSync('同步完成，无新消息');
      }
    } catch (err) {
      logError('后台同步失败', err);
    } finally {
      setSyncing(false);
    }
  }, [groupId, session, syncing, api]);

  // ============================================
  // 加载更多历史消息
  // ============================================

  const loadMoreMessages = useCallback(async (limit = 50) => {
    if (!groupId || !hasMore || messages.length === 0) {
      return;
    }

    setLoadingMore(true);

    try {
      // 消息按倒序排列 [新→旧]，最后一个是最旧的
      const oldestMessage = messages[messages.length - 1];
      const oldestSeq = oldestMessage.seq;

      logLocal('加载更多历史消息', { beforeSeq: oldestSeq });

      const olderMessages = await db.getMessages(groupId, limit, oldestSeq);

      if (olderMessages.length > 0) {
        const uiMessages = olderMessages
          .filter((m) => !m.is_recalled)
          .map((m) => localMessageToGroupMessage(m));
        // 更老的消息添加到数组末尾
        setMessages((prev) => [...prev, ...uiMessages]);
        logLocal('加载更多完成', { count: olderMessages.length });
      }

      setHasMore(olderMessages.length >= limit);
    } catch (err) {
      logError('加载更多失败', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, hasMore, messages]);

  // ============================================
  // 发送文本消息（乐观更新）
  // ============================================

  const sendTextMessage = useCallback(async (content: string): Promise<void> => {
    if (!groupId || !content.trim() || !session) {
      return;
    }

    // 生成临时 UUID 和稳定的 clientId
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tempUuid = clientId; // 临时 UUID 使用 clientId
    const tempSendTime = new Date().toISOString();

    // 构建临时消息对象（乐观更新）
    const tempMessage: GroupMessage = {
      message_uuid: tempUuid,
      group_id: groupId,
      sender_id: session.userId,
      sender_nickname: session.profile.user_nickname,
      sender_avatar_url: session.profile.user_avatar_url ?? '',
      message_content: content,
      message_type: 'text',
      file_uuid: null,
      file_url: null,
      file_size: null,
      file_hash: null,
      reply_to: null,
      send_time: tempSendTime,
      is_recalled: false,
      seq: 0,
      sendStatus: 'sending',
      clientId, // 稳定的客户端 ID，用于 React key
    };

    // 立即添加到 UI（乐观更新）
    setMessages((prev) => [tempMessage, ...prev]);
    setError(null);

    logLocal('发送文本消息（乐观更新）', { clientId, content: content.substring(0, 50) });

    try {
      // 调用 API 发送
      const { sendGroupMessage } = await import('../../api/groupMessages');
      const response = await sendGroupMessage(api, {
        group_id: groupId,
        message_content: content,
        message_type: 'text',
      });

      // 更新消息状态：用真正的 UUID 替换临时 UUID，标记为已发送（保留 clientId）
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? {
            ...msg,
            message_uuid: response.data.message_uuid,
            send_time: response.data.send_time,
            sendStatus: 'sent',
          }
          : msg,
      ));

      // 保存到本地数据库
      const localMessage: Omit<LocalMessage, 'created_at'> = {
        message_uuid: response.data.message_uuid,
        conversation_id: groupId,
        conversation_type: 'group',
        sender_id: session.userId,
        sender_name: session.profile.user_nickname,
        sender_avatar: session.profile.user_avatar_url,
        content,
        content_type: 'text',
        file_uuid: null,
        file_url: null,
        file_size: null,
        file_hash: null,
        seq: 0,
        reply_to: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.data.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('消息发送成功并保存到本地', { uuid: response.data.message_uuid });
      // 注意：不再主动触发同步，seq 会通过 WebSocket 推送更新
    } catch (err) {
      logError('发送消息失败', err);
      setError(err instanceof Error ? err.message : String(err));

      // 标记消息发送失败
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? { ...msg, sendStatus: 'failed' }
          : msg,
      ));
    }
  }, [api, groupId, session]);

  // ============================================
  // 发送媒体消息（乐观更新）
  // ============================================

  const sendMediaMessage = useCallback(async (
    content: string,
    messageType: GroupMessage['message_type'],
    fileUuid?: string,
    fileUrl?: string,
    fileSize?: number,
    fileHash?: string,
    localPath?: string,
  ) => {
    if (!groupId || !session) {
      return null;
    }

    // 生成临时 UUID 和稳定的 clientId
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tempUuid = clientId; // 临时 UUID 使用 clientId
    const tempSendTime = new Date().toISOString();

    // 构建临时消息对象（乐观更新）
    const tempMessage: GroupMessage = {
      message_uuid: tempUuid,
      group_id: groupId,
      sender_id: session.userId,
      sender_nickname: session.profile.user_nickname,
      sender_avatar_url: session.profile.user_avatar_url ?? '',
      message_content: content,
      message_type: messageType,
      file_uuid: fileUuid ?? null,
      file_url: fileUrl ?? null,
      file_size: fileSize ?? null,
      file_hash: fileHash ?? null,
      reply_to: null,
      send_time: tempSendTime,
      is_recalled: false,
      seq: 0,
      sendStatus: 'sending',
      clientId, // 稳定的客户端 ID，用于 React key
    };

    // 立即添加到 UI（乐观更新）
    setMessages((prev) => [tempMessage, ...prev]);
    setError(null);

    logLocal('发送媒体消息（乐观更新）', { clientId, type: messageType, fileName: content, fileHash });

    try {
      // 如果有本地路径和哈希，记录文件映射
      if (fileHash && localPath) {
        const { recordUploadedFile } = await import('../../services/fileService');
        let contentType = 'application/octet-stream';
        if (messageType === 'image') {
          contentType = 'image/jpeg';
        } else if (messageType === 'video') {
          contentType = 'video/mp4';
        }
        await recordUploadedFile(
          fileHash,
          localPath,
          fileSize || 0,
          content,
          contentType,
        );
        logFileLink('记录上传文件映射', { fileHash, localPath });
      }

      // 调用 API 发送
      const { sendGroupMessage } = await import('../../api/groupMessages');
      const response = await sendGroupMessage(api, {
        group_id: groupId,
        message_content: content,
        message_type: messageType,
        file_uuid: fileUuid,
        file_url: fileUrl,
        file_size: fileSize,
      });

      // 更新消息状态：用真正的 UUID 替换临时 UUID，标记为已发送（保留 clientId）
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? {
            ...msg,
            message_uuid: response.data.message_uuid,
            send_time: response.data.send_time,
            sendStatus: 'sent',
          }
          : msg,
      ));

      // 保存到本地数据库
      const localMessage: Omit<LocalMessage, 'created_at'> = {
        message_uuid: response.data.message_uuid,
        conversation_id: groupId,
        conversation_type: 'group',
        sender_id: session.userId,
        sender_name: session.profile.user_nickname,
        sender_avatar: session.profile.user_avatar_url,
        content,
        content_type: messageType,
        file_uuid: fileUuid || null,
        file_url: fileUrl || null,
        file_size: fileSize || null,
        file_hash: fileHash || null,
        seq: 0,
        reply_to: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.data.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('媒体消息发送成功', { uuid: response.data.message_uuid, hasFileLink: !!fileHash });
      logFileLink('媒体消息已链接到本地', { uuid: response.data.message_uuid, fileHash, localPath });
      // 注意：不再主动触发同步，seq 会通过 WebSocket 推送更新

      return response;
    } catch (err) {
      logError('发送媒体消息失败', err);
      setError(err instanceof Error ? err.message : String(err));

      // 标记消息发送失败
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? { ...msg, sendStatus: 'failed' }
          : msg,
      ));

      return null;
    }
  }, [api, groupId, session]);

  // ============================================
  // 撤回消息
  // ============================================

  const recall = useCallback(async (messageUuid: string) => {
    try {
      const { recallGroupMessage } = await import('../../api/groupMessages');
      await recallGroupMessage(api, messageUuid);

      // 从 UI 移除
      setMessages((prev) => prev.filter((m) => m.message_uuid !== messageUuid));

      // 删除本地消息（确保切换会话后不再显示）
      await db.markMessageDeleted(messageUuid);

      logLocal('消息撤回成功并从本地删除', { uuid: messageUuid });
      return true;
    } catch (err) {
      logError('撤回消息失败', err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [api]);

  // ============================================
  // 刷新消息
  // ============================================

  const refresh = useCallback(() => {
    return loadMessages();
  }, [loadMessages]);

  // ============================================
  // 从本地列表移除消息
  // ============================================

  const removeMessage = useCallback((messageUuid: string) => {
    setMessages((prev) => prev.filter((m) => m.message_uuid !== messageUuid));
  }, []);

  // ============================================
  // 处理 WebSocket 新消息
  // ============================================

  const handleNewMessage = useCallback((wsMsg: WsNewMessage) => {
    if (wsMsg.source_type !== 'group' || wsMsg.source_id !== groupId || !session) {
      return;
    }

    logLocal('收到 WebSocket 新消息', { uuid: wsMsg.message_uuid, sender: wsMsg.sender_id });

    // 智能处理消息：
    // 1. 如果 message_uuid 已存在 → 更新 seq
    // 2. 如果是自己发送的且有 sendStatus='sending' → 替换为服务器确认的消息
    // 3. 否则 → 添加新消息
    setMessages((prev) => {
      // 情况 1：message_uuid 已存在（API 响应比 WebSocket 快）
      const existingIndex = prev.findIndex((m) => m.message_uuid === wsMsg.message_uuid);
      if (existingIndex >= 0) {
        // 更新 seq 和 sendStatus
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          seq: wsMsg.seq || updated[existingIndex].seq,
          sendStatus: 'sent', // 确保标记为已发送
        };
        logLocal('消息已存在，更新 seq', { uuid: wsMsg.message_uuid, seq: wsMsg.seq });
        return updated;
      }

      // 情况 2：WebSocket 比 API 响应快（自己发送的消息）
      if (wsMsg.sender_id === session.userId) {
        const sendingIndex = prev.findIndex((m) => m.sendStatus === 'sending');
        if (sendingIndex >= 0) {
          // 替换发送中的消息
          const updated = [...prev];
          updated[sendingIndex] = {
            ...updated[sendingIndex],
            message_uuid: wsMsg.message_uuid,
            seq: wsMsg.seq || 0,
            send_time: wsMsg.timestamp,
            sendStatus: 'sent',
          };
          logLocal('WebSocket 比 API 快，替换发送中消息', { uuid: wsMsg.message_uuid });
          return updated;
        }
      }

      // 情况 3：新消息（其他成员发送的）
      // 添加 clientId 以触发入场动画
      const newMessage: GroupMessage = {
        message_uuid: wsMsg.message_uuid,
        group_id: wsMsg.source_id,
        sender_id: wsMsg.sender_id,
        sender_nickname: wsMsg.sender_nickname || '',
        sender_avatar_url: wsMsg.sender_avatar_url || '',
        message_content: wsMsg.content || wsMsg.preview || '',
        message_type: wsMsg.message_type as GroupMessage['message_type'],
        file_uuid: wsMsg.file_uuid ?? null,
        file_url: wsMsg.file_url ?? null,
        file_size: wsMsg.file_size ?? null,
        file_hash: wsMsg.file_hash ?? null,
        reply_to: null,
        send_time: wsMsg.timestamp,
        is_recalled: false,
        seq: wsMsg.seq || 0,
        clientId: `ws_${wsMsg.message_uuid}`, // 用于触发入场动画
      };

      return [newMessage, ...prev];
    });

    // 保存/更新到本地数据库（包含完整文件信息）
    const localMessage: Omit<LocalMessage, 'created_at'> = {
      message_uuid: wsMsg.message_uuid,
      conversation_id: wsMsg.source_id,
      conversation_type: 'group',
      sender_id: wsMsg.sender_id,
      sender_name: wsMsg.sender_nickname || null,
      sender_avatar: wsMsg.sender_avatar_url || null,
      content: wsMsg.content || wsMsg.preview || '',
      content_type: wsMsg.message_type,
      file_uuid: wsMsg.file_uuid || null,
      file_url: wsMsg.file_url || null,
      file_size: wsMsg.file_size || null,
      file_hash: wsMsg.file_hash || null,
      seq: wsMsg.seq || 0,
      reply_to: null,
      is_recalled: false,
      is_deleted: false,
      send_time: wsMsg.timestamp,
    };
    db.saveMessage(localMessage).catch((err) => {
      logError('保存 WebSocket 消息到本地失败', err);
    });
  }, [groupId, session]);

  // ============================================
  // 处理 WebSocket 消息撤回
  // ============================================

  const handleMessageRecalled = useCallback((wsMsg: WsMessageRecalled) => {
    if (wsMsg.source_type !== 'group' || wsMsg.source_id !== groupId) {
      return;
    }

    logLocal('收到 WebSocket 消息撤回', { uuid: wsMsg.message_uuid });

    // 从 UI 移除
    setMessages((prev) => prev.filter((m) => m.message_uuid !== wsMsg.message_uuid));

    // 标记本地已撤回
    db.markMessageRecalled(wsMsg.message_uuid).catch((err) => {
      logError('标记消息撤回失败', err);
    });
  }, [groupId]);

  // ============================================
  // 监听 WebSocket 事件
  // ============================================

  useEffect(() => {
    const unsubscribeNew = ws.onNewMessage((msg) => {
      if (msg.source_type === 'group' && msg.source_id === groupId) {
        handleNewMessage(msg);
      }
    });

    const unsubscribeRecalled = ws.onMessageRecalled((msg) => {
      if (msg.source_type === 'group' && msg.source_id === groupId) {
        handleMessageRecalled(msg);
      }
    });

    return () => {
      unsubscribeNew();
      unsubscribeRecalled();
    };
  }, [ws, groupId, handleNewMessage, handleMessageRecalled]);

  // ============================================
  // WebSocket 重连时触发同步
  // ============================================
  // 只在连接建立后（特别是重连时）执行一次同步，以获取断线期间的消息

  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (ws.connected && !wasConnectedRef.current) {
      // 连接刚建立，触发同步
      logSync('WebSocket 连接建立，触发增量同步');
      syncMessagesInBackground();
    }
    wasConnectedRef.current = ws.connected;
  }, [ws.connected, syncMessagesInBackground]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    sending,
    syncing,
    loadMessages,
    loadMoreMessages,
    sendTextMessage,
    sendMediaMessage,
    recall,
    refresh,
    removeMessage,
    // WebSocket 事件处理方法
    handleNewMessage,
    handleMessageRecalled,
  };
}
