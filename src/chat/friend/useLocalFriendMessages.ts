/**
 * 本地优先私聊消息 Hook
 *
 * @module chat/friend
 * @location src/chat/friend/useLocalFriendMessages.ts
 *
 * 实现离线优先策略：
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
 *
 * 调试日志前缀：
 * - [LocalMessages] 本地消息加载
 * - [Sync] 服务器同步
 * - [FileLink] 文件本地链接
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from '../../db';
import type { LocalMessage, LocalConversation } from '../../db';
import { initSyncService, getSyncService, SyncService } from '../../services/syncService';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getFriendConversationId } from '../../utils/conversationId';
import type { Message } from '../../types/chat';
import type { WsNewMessage, WsMessageRecalled } from '../../types/websocket';

// ============================================================================
// 调试日志
// ============================================================================

const DEBUG = true;

function logLocal(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[LocalMessages] ${action}`, 'color: #4CAF50; font-weight: bold', data ?? '');
  }
}

function logSync(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[Sync] ${action}`, 'color: #2196F3; font-weight: bold', data ?? '');
  }
}

function logFileLink(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[FileLink] ${action}`, 'color: #FF9800; font-weight: bold', data ?? '');
  }
}

function logError(action: string, error: unknown) {
  console.error(`%c[Error] ${action}`, 'color: #f44336; font-weight: bold', error);
}

// ============================================================================
// 类型转换
// ============================================================================

/**
 * 将本地消息转换为 UI Message 类型
 */
function localMessageToMessage(local: LocalMessage, friendId: string): Message {
  return {
    message_uuid: local.message_uuid,
    sender_id: local.sender_id,
    receiver_id: local.sender_id === friendId ? local.conversation_id : friendId,
    message_content: local.content,
    message_type: local.content_type as Message['message_type'],
    file_uuid: local.file_uuid,
    file_url: local.file_url,
    file_size: local.file_size,
    file_hash: local.file_hash,
    image_width: local.image_width,
    image_height: local.image_height,
    send_time: local.send_time,
    seq: local.seq,
  };
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useLocalFriendMessages(friendId: string | null) {
  const api = useApi();
  const { session } = useSession();
  const ws = useWebSocket();

  // 状态
  const [messages, setMessages] = useState<Message[]>([]);
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
  const currentFriendId = useRef<string | null>(null);
  const dbInitialized = useRef(false);

  // ============================================
  // 数据库初始化检查
  // ============================================
  // 注意：数据库在登录时已由 useAuth 初始化
  // 这里只标记为已初始化（当有 session 时）

  useEffect(() => {
    if (session && !dbInitialized.current) {
      dbInitialized.current = true;
      logLocal('数据库已就绪（由登录流程初始化）');
    }
  }, [session]);

  // ============================================
  // 切换好友时重置
  // ============================================

  useEffect(() => {
    if (friendId !== currentFriendId.current) {
      logLocal('切换好友', { from: currentFriendId.current, to: friendId });
      setMessages([]);
      setHasMore(true);
      setError(null);
      conversationRef.current = null;
      currentFriendId.current = friendId;
    }
  }, [friendId]);

  // ============================================
  // 加载本地消息
  // ============================================

  const loadMessages = useCallback(async (limit = 50) => {
    if (!friendId || !session || !dbInitialized.current) {
      return;
    }

    // 生成正确的 conversation_id（格式: conv-user1-user2）
    const conversationId = getFriendConversationId(session.userId, friendId);

    setLoading(true);
    setError(null);

    try {
      logLocal('开始加载本地消息', { friendId, conversationId, limit });

      // 1. 从本地数据库加载（使用正确的 conversation_id）
      const localMessages = await db.getMessages(conversationId, limit);

      logLocal('本地消息加载完成', {
        count: localMessages.length,
        hasMore: localMessages.length >= limit,
        firstSeq: localMessages[0]?.seq,
        lastSeq: localMessages[localMessages.length - 1]?.seq,
      });

      // 调试：打印图片消息的尺寸信息
      const imageMessages = localMessages.filter((m) => m.content_type === 'image');
      if (imageMessages.length > 0) {
        logLocal('图片消息尺寸信息', {
          total: imageMessages.length,
          withDimensions: imageMessages.filter((m) => m.image_width && m.image_height).length,
          details: imageMessages.map((m) => ({
            uuid: m.message_uuid.slice(0, 8),
            width: m.image_width,
            height: m.image_height,
            content: m.content.slice(0, 20),
          })),
        });
      }

      // 2. 转换为 UI Message 类型
      const uiMessages = localMessages.map((m) => localMessageToMessage(m, friendId));
      setMessages(uiMessages);
      setHasMore(localMessages.length >= limit);

      // 3. 获取会话信息
      conversationRef.current = await db.getConversation(conversationId);

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
  }, [friendId]);

  // ============================================
  // 后台同步服务器消息
  // ============================================

  const syncMessagesInBackground = useCallback(async () => {
    if (!friendId || !session || syncing) {
      return;
    }

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

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
          id: conversationId, // 使用正确的 conversation_id 格式
          type: 'friend',
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
        logSync('创建新会话记录', { conversationId });
      }

      logSync('开始增量同步', {
        conversationId,
        friendId,
        lastSeq: conversation.last_seq,
      });

      // 执行增量同步
      const result = await syncService.syncMessages([conversation]);

      if (result.updatedConversations.includes(conversationId)) {
        logSync('同步完成，发现新消息', {
          newCount: result.newMessagesCount,
        });

        // 重新加载本地消息
        const updatedMessages = await db.getMessages(conversationId, 50);
        const uiMessages = updatedMessages.map((m) => localMessageToMessage(m, friendId));

        // 智能合并：保留现有消息的 clientId 和 sendStatus，避免触发不必要的动画
        // 同时保留正在发送中的消息（sendStatus 为 'sending'）
        setMessages((prev) => {
          const existingMap = new Map(prev.map((m) => [m.message_uuid, m]));
          // 保留正在发送中的消息（这些消息还没保存到数据库）
          const sendingMessages = prev.filter((m) => m.sendStatus === 'sending');

          const mergedMessages = uiMessages.map((newMsg) => {
            const existing = existingMap.get(newMsg.message_uuid);
            if (existing) {
              // 保留 clientId 和 sendStatus
              return { ...newMsg, clientId: existing.clientId, sendStatus: existing.sendStatus };
            }
            return newMsg;
          });

          // 如果有正在发送的消息，确保它们不被覆盖
          if (sendingMessages.length > 0) {
            const mergedUuids = new Set(mergedMessages.map((m) => m.message_uuid));
            // 添加那些不在合并结果中的发送中消息
            const missingMessages = sendingMessages.filter(
              (m) => !mergedUuids.has(m.message_uuid),
            );
            if (missingMessages.length > 0) {
              logSync('保留发送中的消息', { count: missingMessages.length });
              return [...missingMessages, ...mergedMessages];
            }
          }

          return mergedMessages;
        });
        setHasMore(updatedMessages.length >= 50);

        logLocal('同步后重新加载消息', { count: uiMessages.length });
      } else {
        logSync('同步完成，无新消息');
      }
    } catch (err) {
      logError('后台同步失败', err);
      // 同步失败不影响本地消息显示
    } finally {
      setSyncing(false);
    }
  }, [friendId, session, syncing, api]);

  // ============================================
  // 加载更多历史消息
  // ============================================

  const loadMoreMessages = useCallback(async (limit = 50) => {
    if (!friendId || !session || !hasMore || messages.length === 0) {
      return;
    }

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

    setLoadingMore(true);

    try {
      // 消息按倒序排列 [新→旧]，最后一个是最旧的
      const oldestMessage = messages[messages.length - 1];
      const oldestSeq = oldestMessage.seq;

      logLocal('加载更多历史消息', { beforeSeq: oldestSeq });

      const olderMessages = await db.getMessages(conversationId, limit, oldestSeq);

      if (olderMessages.length > 0) {
        const uiMessages = olderMessages.map((m) => localMessageToMessage(m, friendId));
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
  }, [friendId, session, hasMore, messages]);

  // ============================================
  // 发送文本消息（乐观更新）
  // ============================================

  const sendTextMessage = useCallback(async (content: string): Promise<void> => {
    if (!friendId || !content.trim() || !session) {
      return;
    }

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

    // 生成临时 UUID 和稳定的 clientId
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tempUuid = clientId; // 临时 UUID 使用 clientId
    const tempSendTime = new Date().toISOString();

    // 构建临时消息对象（乐观更新）
    const tempMessage: Message = {
      message_uuid: tempUuid,
      sender_id: session.userId,
      receiver_id: friendId,
      message_content: content,
      message_type: 'text',
      file_uuid: null,
      file_url: null,
      file_size: null,
      file_hash: null,
      send_time: tempSendTime,
      seq: 0,
      sendStatus: 'sending',
      clientId, // 稳定的客户端 ID，用于 React key
    };

    // 立即添加到 UI（乐观更新）
    setMessages((prev) => [tempMessage, ...prev]);
    setError(null);

    logLocal('发送文本消息（乐观更新）', { tempUuid, content: content.substring(0, 50) });

    try {
      // 调用 API 发送
      const { sendMessage } = await import('../../api/messages');
      const response = await sendMessage(api, {
        receiver_id: friendId,
        message_content: content,
        message_type: 'text',
      });

      // 更新消息状态：用真正的 UUID 替换临时 UUID，标记为已发送（保留 clientId）
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? {
            ...msg,
            message_uuid: response.message_uuid,
            send_time: response.send_time,
            sendStatus: 'sent',
          }
          : msg,
      ));

      // 保存到本地数据库（使用正确的 conversation_id）
      const localMessage: Omit<LocalMessage, 'created_at'> = {
        message_uuid: response.message_uuid,
        conversation_id: conversationId,
        conversation_type: 'friend',
        sender_id: session.userId,
        sender_name: session.profile.user_nickname,
        sender_avatar: session.profile.user_avatar_url,
        content,
        content_type: 'text',
        file_uuid: null,
        file_url: null,
        file_size: null,
        file_hash: null,
        image_width: null,
        image_height: null,
        seq: 0,
        reply_to: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('消息发送成功并保存到本地', { uuid: response.message_uuid });
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
  }, [api, friendId, session]);

  // ============================================
  // 发送媒体消息（乐观更新）
  // ============================================

  const sendMediaMessage = useCallback(async (
    content: string,
    messageType: Message['message_type'],
    fileUuid?: string,
    fileUrl?: string,
    fileSize?: number,
    fileHash?: string,
    localPath?: string,
  ) => {
    if (!friendId || !session) {
      return null;
    }

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

    // 生成临时 UUID 和稳定的 clientId
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tempUuid = clientId; // 临时 UUID 使用 clientId
    const tempSendTime = new Date().toISOString();

    // 构建临时消息对象（乐观更新）
    const tempMessage: Message = {
      message_uuid: tempUuid,
      sender_id: session.userId,
      receiver_id: friendId,
      message_content: content,
      message_type: messageType,
      file_uuid: fileUuid ?? null,
      file_url: fileUrl ?? null,
      file_size: fileSize ?? null,
      file_hash: fileHash ?? null,
      send_time: tempSendTime,
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
        // 确定 content type
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
      const { sendMessage } = await import('../../api/messages');
      const response = await sendMessage(api, {
        receiver_id: friendId,
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
            message_uuid: response.message_uuid,
            send_time: response.send_time,
            sendStatus: 'sent',
          }
          : msg,
      ));

      // 保存到本地数据库（使用正确的 conversation_id）
      const localMessage: Omit<LocalMessage, 'created_at'> = {
        message_uuid: response.message_uuid,
        conversation_id: conversationId,
        conversation_type: 'friend',
        sender_id: session.userId,
        sender_name: session.profile.user_nickname,
        sender_avatar: session.profile.user_avatar_url,
        content,
        content_type: messageType,
        file_uuid: fileUuid || null,
        file_url: fileUrl || null,
        file_size: fileSize || null,
        file_hash: fileHash || null,
        image_width: null, // 图片尺寸在发送后由后端返回
        image_height: null,
        seq: 0,
        reply_to: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('媒体消息发送成功', { uuid: response.message_uuid, hasFileLink: !!fileHash });
      logFileLink('媒体消息已链接到本地', { uuid: response.message_uuid, fileHash, localPath });
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
  }, [api, friendId, session]);

  // ============================================
  // 撤回消息
  // ============================================

  const recall = useCallback(async (messageUuid: string) => {
    try {
      const { recallMessage } = await import('../../api/messages');
      await recallMessage(api, messageUuid);

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
    if (wsMsg.source_type !== 'friend' || wsMsg.source_id !== friendId || !session) {
      return;
    }

    logLocal('收到 WebSocket 新消息', { uuid: wsMsg.message_uuid, sender: wsMsg.sender_id });

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

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
      // 查找是否有正在发送中的消息（sender_id 是自己）
      if (wsMsg.sender_id === session.userId) {
        const sendingIndex = prev.findIndex((m) => m.sendStatus === 'sending');
        if (sendingIndex >= 0) {
          // 替换发送中的消息（更新 uuid、seq、sendStatus）
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

      // 情况 3：新消息（对方发送的）
      // 添加 clientId 以触发入场动画
      const newMessage: Message = {
        message_uuid: wsMsg.message_uuid,
        sender_id: wsMsg.sender_id,
        receiver_id: session.userId,
        message_content: wsMsg.content || wsMsg.preview || '',
        message_type: wsMsg.message_type as Message['message_type'],
        file_uuid: wsMsg.file_uuid ?? null,
        file_url: wsMsg.file_url ?? null,
        file_size: wsMsg.file_size ?? null,
        file_hash: wsMsg.file_hash ?? null,
        send_time: wsMsg.timestamp,
        seq: wsMsg.seq || 0,
        clientId: `ws_${wsMsg.message_uuid}`, // 用于触发入场动画
      };

      // 新消息添加到数组开头，配合 column-reverse 显示在底部
      return [newMessage, ...prev];
    });

    // 保存/更新到本地数据库（使用正确的 conversation_id 和完整文件信息）
    const localMessage: Omit<LocalMessage, 'created_at'> = {
      message_uuid: wsMsg.message_uuid,
      conversation_id: conversationId,
      conversation_type: 'friend',
      sender_id: wsMsg.sender_id,
      sender_name: wsMsg.sender_nickname || null,
      sender_avatar: wsMsg.sender_avatar_url || null,
      content: wsMsg.content || wsMsg.preview || '',
      content_type: wsMsg.message_type,
      file_uuid: wsMsg.file_uuid || null,
      file_url: wsMsg.file_url || null,
      file_size: wsMsg.file_size || null,
      file_hash: wsMsg.file_hash || null,
      image_width: wsMsg.image_width ?? null,
      image_height: wsMsg.image_height ?? null,
      seq: wsMsg.seq || 0,
      reply_to: null,
      is_recalled: false,
      is_deleted: false,
      send_time: wsMsg.timestamp,
    };
    db.saveMessage(localMessage).catch((err) => {
      logError('保存 WebSocket 消息到本地失败', err);
    });
  }, [friendId, session]);

  // ============================================
  // 处理 WebSocket 消息撤回
  // ============================================

  const handleMessageRecalled = useCallback((wsMsg: WsMessageRecalled) => {
    if (wsMsg.source_type !== 'friend' || wsMsg.source_id !== friendId) {
      return;
    }

    logLocal('收到 WebSocket 消息撤回', { uuid: wsMsg.message_uuid });

    // 从 UI 移除
    setMessages((prev) => prev.filter((m) => m.message_uuid !== wsMsg.message_uuid));

    // 标记本地已撤回
    db.markMessageRecalled(wsMsg.message_uuid).catch((err) => {
      logError('标记消息撤回失败', err);
    });
  }, [friendId]);

  // ============================================
  // 监听 WebSocket 事件
  // ============================================

  useEffect(() => {
    const unsubscribeNew = ws.onNewMessage((msg) => {
      if (msg.source_type === 'friend' && msg.source_id === friendId) {
        handleNewMessage(msg);
      }
    });

    const unsubscribeRecalled = ws.onMessageRecalled((msg) => {
      if (msg.source_type === 'friend' && msg.source_id === friendId) {
        handleMessageRecalled(msg);
      }
    });

    return () => {
      unsubscribeNew();
      unsubscribeRecalled();
    };
  }, [ws, friendId, handleNewMessage, handleMessageRecalled]);

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
    // 兼容旧接口
    handleNewMessage,
    handleMessageRecalled,
  };
}
