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
 * 防重复机制：
 * - WS 事件仅在本 hook 内订阅（useMainPage 不再重复订阅），收到新消息时同步调用 markRead
 * - loadMessages / syncMessagesInBackground 在 await 后校验 friendId 是否过期，
 *   快速切换时丢弃旧会话的异步结果，防止消息污染
 * - Sync 合并时按 clientId 去重，避免临时 uuid 与真实 uuid 不匹配导致的重复
 *
 * 调试日志前缀：
 * - [LocalMessages] 本地消息加载
 * - [Sync] 服务器同步
 * - [FileLink] 文件本地链接
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as db from '../../db';
import type { LocalMessage, LocalConversation } from '../../db';
import { getSyncService } from '../../services/syncService';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { getFriendConversationId } from '../../utils/conversationId';
import { sendMessage, recallMessage } from '../../api/messages';
import { recordUploadedFile } from '../../services/fileService';
import { useChatStore } from '../../stores/chatStore';
// clientId 的前缀是「本机这次发送动作」的唯一物证，消息列表据此把它与「多端回流」区分开
// （回流走 WS 分支、前缀是 ws_）。生成与判读必须同源，故一律走这个生成器。
import { newLocalSendClientId } from '../shared/useStickToBottom';
import { useSendingOutboxMerge } from '../shared/useSendingOutboxMerge';
import { resolveUploadedContent } from '../shared/uploadPersist';
import { draftKeyOf } from '../shared/conversationKey';
import type { SendingMediaEntry } from '../../stores/sendingMediaStore';
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
    image_width: local.image_width,
    image_height: local.image_height,
    // reply_to 与相册三件套必须一路带到 UI：落库了但转换时丢掉，
    // 等于白存 —— 从 DB 读出来的消息照样没有引用块、相册照样散架
    reply_to: local.reply_to,
    media_group_id: local.media_group_id,
    media_group_index: local.media_group_index,
    media_group_count: local.media_group_count,
    send_time: local.send_time,
    seq: local.seq,
    is_recalled: local.is_recalled,
  };
}

// ============================================================================
// 定位窗口大小
// ============================================================================

/**
 * 定位跳转时锚点**两侧**各取多少条。
 *
 * 取 30（窗口 61 条）的依据：
 * - 既有分页页大小是 50，30 条约 1.5~2 屏，落地即填满视口并留出滚动余量，
 *   不会一落地就立刻触发续加载（那会把"少读"的收益又还回去）；
 * - 又明显小于 50，首帧要渲染的气泡数量随之下降 —— 这正是卡顿的另一半来源；
 * - 两侧对称，是因为用户从查找结果跳过来后，往上往下看的概率没有先验差别。
 */
const LOCATE_WINDOW_BEFORE = 30;
const LOCATE_WINDOW_AFTER = 30;

// ============================================================================
// Hook 实现
// ============================================================================

export function useLocalFriendMessages(friendId: string | null) {
  const api = useApi();
  const { session } = useSession();
  const ws = useWebSocket();

  // 状态
  //
  // messages 初始值：useState lazy initializer 仅在 hook 第一次 mount 时跑一次
  // （App 登录后首次实例化 useMainPage 时）。之后的 friendId 切换由下方的
  // 渲染期同步重置块从 cachedFriendMessages 重新读取并 setMessages —— 那才是
  // "切回保留 loadMore 历史"的真正生效路径。这里仅为应对极少数情况（首次实例化
  // 时 friendId 已经非 null，如刷新页面恢复了 chatTarget），让第一帧就有缓存数据。
  const [messages, setMessages] = useState<Message[]>(() => {
    if (!friendId) { return []; }
    return useChatStore.getState().cachedFriendMessages[friendId] ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // 定位窗口态：非 null = 当前列表是「围绕某条历史消息的一段窗口」，不是「最新那一段」。
  // 它有两处不可省的护栏（见 loadMessages / unmount 缓存写入）：窗口既不能被最新 50 条
  // 合并（会造成中间断档却看不出来），也不能被写进 cachedFriendMessages（那会让下次进会话
  // 从一段历史窗口开场）。
  const [windowAnchorUuid, setWindowAnchorUuid] = useState<string | null>(null);
  // 窗口态下「更新方向还有没有」。非窗口态恒 false —— 非窗口态的列表本就顶到最新。
  const [hasNewer, setHasNewer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // 上次渲染的 friendId —— 用于"切换好友时同步重置 messages"（见下方 reset 块）
  const [prevFriendId, setPrevFriendId] = useState<string | null>(friendId);

  // Refs
  const conversationRef = useRef<LocalConversation | null>(null);
  const currentFriendId = useRef<string | null>(friendId);
  const dbInitialized = useRef(false);

  // 异步回调里读最新 state（避免闭包过期）
  const messagesRef = useRef<Message[]>(messages);
  const hasMoreRef = useRef<boolean>(hasMore);
  // 窗口态标志的 ref 版：loadMessages 与 unmount cleanup 都在闭包里判它，
  // 用 state 会读到过期值（护栏读到过期值 = 护栏失效，是这里必须用 ref 的唯一理由）
  const windowAnchorRef = useRef<string | null>(windowAnchorUuid);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    windowAnchorRef.current = windowAnchorUuid;
  }, [windowAnchorUuid]);

  // ============================================
  // 数据库初始化检查
  // ============================================
  // 注意：数据库在登录时已由 App.tsx 的登录流程初始化
  // 这里只标记为已初始化（当有 session 时）

  useEffect(() => {
    if (session && !dbInitialized.current) {
      dbInitialized.current = true;
      logLocal('数据库已就绪（由登录流程初始化）');
    }
  }, [session]);

  // ============================================
  // 切换好友时同步重置（渲染期，React 官方"prop 变更即调整 state"模式）
  // ============================================
  // ChatMessages 按 key={`friend-${id}`} 重新挂载，但本 hook 不重挂。若在 useEffect
  // （paint 后）才重置 messages，重挂的 ChatMessages 第一帧会拿到【上一个会话】的 messages，
  // 首帧滚动跑在陈旧内容上、真实消息到达后再滚一次 → "两次跳转"+ 不滚到最新。
  // 改为渲染期同步重置：friendId 一变就把 messages 切到该会话缓存（含上次 loadMore 历史），
  // React 在 paint 前用新 state 重渲染，ChatMessages 首帧即正确内容、只滚一次。
  // 缓存缺失（首次进会话）用空数组兜底，等 useMainPage 的 loadMessages 异步加载 db 最新 50 条。
  if (friendId !== prevFriendId) {
    setPrevFriendId(friendId);
    const cached = friendId ? (useChatStore.getState().cachedFriendMessages[friendId] ?? []) : [];
    setMessages(cached);
    // 缓存未命中（需异步拉 db）时立即标记加载中：让列表占位门控（!loading && 空）在加载期不显示
    // "暂无消息"，消除占位闪；缓存命中（非空）loading=false 但 isEmpty=false，占位本就不显示。
    setLoading(cached.length === 0 && friendId !== null);
    setHasMore(true);
    setError(null);
    conversationRef.current = null;
    currentFriendId.current = friendId;
  }

  // unmount 时把当前 messages 缓存到 chatStore，用于下次 mount 时秒开。
  // 仅缓存最近 50 条（store.cacheFriendMessages 内部已 slice(-50)），避免内存膨胀。
  //
  // 通过 messagesRef.current 读 unmount 那一刻的最新 messages 值（messagesRef 由 line 131
  // 的 useEffect 实时镜像）；如果 deps 包含 messages，cleanup 会在每次 messages 变化都
  // 跑一次，写入缓存的频率过高且无意义。仅在 friendId 切换或 unmount 时才需要写缓存。
  //
  // 🔴 护栏一：**窗口态不写缓存**。窗口是「某条历史消息前后各 30 条」，把它写进
  // cachedFriendMessages 会让下次进这个会话直接从一段历史开场（且它会成为 useState
  // 初值，与 loadMessages 的增量合并撞在一起）—— 正是 .claude/rules/common.md
  // 「缓存与数据库 SSOT 协同」那条规则描述的失效形态，只是方向反过来。
  useEffect(() => {
    const captureFriendId = friendId;
    return () => {
      if (windowAnchorRef.current) {
        return;
      }
      if (captureFriendId && messagesRef.current.length > 0) {
        useChatStore.getState().cacheFriendMessages(captureFriendId, messagesRef.current);
      }
    };
  }, [friendId]);

  // ============================================
  // 加载本地消息
  // ============================================

  const loadMessages = useCallback(async (limit = 50) => {
    if (!friendId || !session || !dbInitialized.current) {
      return;
    }
    // 🔴 护栏二：**窗口态不并最新 50 条**。下方的增量合并把 db 结果并进 prev，
    // 而窗口态的 prev 是一段历史；并进来的最新 50 条与窗口之间隔着成百上千条没加载的消息，
    // 渲染出来却是紧挨着的两段 —— 用户从窗口往上滚会直接掉进另一个时间段，且**看不出断档**。
    // 要回到最新走 jumpToLatest（显式退出窗口态 + 整段替换），不走这里。
    if (windowAnchorRef.current) {
      return;
    }

    const targetFriendId = friendId;
    const conversationId = getFriendConversationId(session.userId, friendId);

    setLoading(true);
    setError(null);

    try {
      logLocal('开始加载本地消息', { friendId, conversationId, limit });

      const localMessages = await db.getMessages(conversationId, limit);

      // 过期校验：快速切换后丢弃旧结果
      if (currentFriendId.current !== targetFriendId) {
        logLocal('加载完成但好友已切换，丢弃结果', { target: targetFriendId, current: currentFriendId.current });
        return;
      }

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

      const uiMessages = localMessages.map((m) => localMessageToMessage(m, friendId));
      // 增量合并：保留已缓存的较老消息（loadMore 加载的历史）+ 用 db 版本更新最新 50
      // 条窗口内的消息（同步撤回/删除等离线期间发生的状态变化）+ 追加 db 中新增的消息。
      //
      // 历史原因：原实现 `setMessages(uiMessages)` 直接覆盖。当用户在 A 中翻历史触发
      // loadMore（messages 含 200+ 条）→ 切到 B → 切回 A，cachedFriendMessages 写入
      // 全量 200+ 条作为 useState 初值；但 useMainPage 的 useEffect 立刻调 loadMessages
      // → db.getMessages(50) 只返回最新 50 条 → setMessages 覆盖为 50 条 → 用户向上翻
      // 的 200+ 条全部丢失（向上翻历史时缓存的较老消息凭空消失）。
      //
      // 增量合并策略：
      //   - 无缓存（prev=[]）→ 直接用 db 结果（首次进入会话）
      //   - 有缓存：用 db 版本替换 prev 中相同 uuid 的消息（捕获离线期间撤回/删除等
      //     状态更新；db 是 SSOT），不在 db 窗口的较老消息保持 prev 版本（缓存权威）
      //   - db 有新消息（用户隐藏期间收到的）→ 追加到 prev 末尾按 send_time 排序
      //
      // 在线撤回事件仍由 WebSocket onMessageRecalled 独立 handler 即时处理；本逻辑
      // 仅兜底"用户切走期间发生的撤回/删除"场景（WS 事件已错过但 db 已同步）。
      setMessages((prev) => {
        if (prev.length === 0) {
          return uiMessages;
        }
        const dbByUuid = new Map(uiMessages.map((m) => [m.message_uuid, m]));
        // 用 db 版本替换 prev 中存在的（同步状态字段，如 is_recalled / message_content），
        // 但保留 prev 的 clientId / sendStatus —— db 版（localMessageToMessage）不带这两字段，
        // 若丢失会让自己发的消息 React key 从 client_xxx 突变成真 uuid → 打开会话时 AnimatePresence
        // 卸载重挂 → 退/入场动画 churn + 布局位移（bug② 双跳）。与 syncMessagesInBackground 保持一致。
        const updated = prev.map((m) => {
          const dbVer = dbByUuid.get(m.message_uuid);
          return dbVer ? { ...dbVer, clientId: m.clientId, sendStatus: m.sendStatus } : m;
        });
        const existingUuids = new Set(prev.map((m) => m.message_uuid));
        const newOnes = uiMessages.filter((m) => !existingUuids.has(m.message_uuid));
        if (newOnes.length === 0) {
          return updated;
        }
        // 降序 [新→旧]，与 db.getMessages / getLatestMessage[0] / loadMore（messages[length-1]=最旧）
        // 的数组约定一致；显示层 sortedMessages 再各自升序排版，不受此影响。
        return [...updated, ...newOnes].sort(
          (a, b) => new Date(b.send_time).getTime() - new Date(a.send_time).getTime(),
        );
      });
      setHasMore(localMessages.length >= limit);

      conversationRef.current = await db.getConversation(conversationId);

    } catch (err) {
      logError('加载本地消息失败', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }

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

    const targetFriendId = friendId;
    const conversationId = getFriendConversationId(session.userId, friendId);

    setSyncing(true);

    try {
      const syncService = getSyncService();
      if (!syncService) {
        return;
      }

      let conversation = conversationRef.current;
      if (!conversation) {
        // saveConversation 不携带 last_read_seq / is_pinned（分别由 advanceConversationRead /
        // setConversationPinned 单独维护，DB 新行走列默认 0）；内存 ref 需完整 LocalConversation，
        // 新会话必然未读 0 / 未置顶，spread 时补齐。
        const newConversation: Omit<LocalConversation, 'synced_at' | 'last_read_seq' | 'is_pinned'> = {
          id: conversationId,
          type: 'friend',
          name: '',
          avatar_url: null,
          last_message: null,
          last_message_time: null,
          last_seq: 0,
          unread_count: 0,
          is_muted: false,
          updated_at: new Date().toISOString(),
        };
        await db.saveConversation(newConversation);
        conversation = { ...newConversation, synced_at: null, last_read_seq: 0, is_pinned: false };
        conversationRef.current = conversation;
        logSync('创建新会话记录', { conversationId });
      }

      logSync('开始增量同步', {
        conversationId,
        friendId,
        lastSeq: conversation.last_seq,
      });

      // 打开会话那次同步携带已读位置快照（with_read_positions:true）：响应 read_positions 经
      // syncService 转发给 useFriendReadReceipt 校准，取代原独立 read-positions 端点首拉（已移除）。
      const result = await syncService.syncMessages([conversation], { withReadPositions: true });

      // 过期校验：快速切换后丢弃旧结果
      if (currentFriendId.current !== targetFriendId) {
        logSync('同步完成但好友已切换，丢弃结果', { target: targetFriendId, current: currentFriendId.current });
        return;
      }

      if (result.updatedConversations.includes(conversationId)) {
        logSync('同步完成，发现新消息', {
          newCount: result.newMessagesCount,
        });

        const updatedMessages = await db.getMessages(conversationId, 50);

        // 二次过期校验
        if (currentFriendId.current !== targetFriendId) {
          logSync('加载同步消息后好友已切换，丢弃结果');
          return;
        }

        const uiMessages = updatedMessages.map((m) => localMessageToMessage(m, friendId));

        setMessages((prev) => {
          const existingMap = new Map(prev.map((m) => [m.message_uuid, m]));
          const sendingMessages = prev.filter((m) => m.sendStatus === 'sending');

          const mergedMessages = uiMessages.map((newMsg) => {
            const existing = existingMap.get(newMsg.message_uuid);
            if (existing) {
              return { ...newMsg, clientId: existing.clientId, sendStatus: existing.sendStatus };
            }
            return newMsg;
          });

          if (sendingMessages.length > 0) {
            const mergedUuids = new Set(mergedMessages.map((m) => m.message_uuid));
            const mergedClientIds = new Set(mergedMessages.map((m) => m.clientId).filter(Boolean));
            const missingMessages = sendingMessages.filter(
              (m) => !mergedUuids.has(m.message_uuid) && !mergedClientIds.has(m.clientId),
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
    } finally {
      setSyncing(false);
    }
  }, [friendId, session, syncing]);

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
  // 定位到某条消息：只取它前后一小段（窗口化）
  // ============================================

  /**
   * 以目标消息为锚点，一次取回它**前后各一段**并整段替换列表。
   *
   * ## 为什么不是「翻页翻到它」
   *
   * 原实现是 `loadUntilMessage`：从最新逐页 `loadMoreMessages()` 往回翻直到命中，
   * 上限 20 轮 × 每页 50。两个后果：
   * 1. **卡顿** —— 中间每一页都会进 state 并渲染，目标越早读得越多。
   *    实测（`src-tauri/src/db/messages.rs` 的 `locate_paging_reads_whole_prefix_window_reads_constant`）：
   *    锚点离最新约 600 条时读 **650 行**，而窗口恒为 **61 行**。
   * 2. **静默够不着** —— 超出 20×50=1000 条的目标**根本翻不到**，用户看到「定位失败」，
   *    可那条消息就在本地库里。窗口查询与目标多早无关，天然没有这个上限
   *    （守卫测试 `locate_paging_cannot_reach_beyond_iteration_cap_but_window_can`）。
   *
   * 返回 false = 锚点不在本地库（DB 层返回 null），调用方据此走「定位失败」提示；
   * **不与「窗口为空」混为一谈**。
   */
  const locateMessage = useCallback(
    async (messageUuid: string): Promise<boolean> => {
      if (!friendId || !session) {
        return false;
      }
      const conversationId = getFriendConversationId(session.userId, friendId);
      try {
        const rows = await db.getMessagesAround(
          conversationId,
          messageUuid,
          LOCATE_WINDOW_BEFORE,
          LOCATE_WINDOW_AFTER,
        );
        if (rows === null) {
          return false;
        }
        const uiMessages = rows.map((m) => localMessageToMessage(m, friendId));
        // 整段替换：窗口态的语义就是「现在看的是这一段」，不是「在原列表上补几条」。
        // 缓存不受影响 —— 窗口态下 unmount 不写缓存（见上方护栏一）。
        setMessages(uiMessages);
        // 该侧取满 = 该侧还有更多。锚点必在结果里（DB 层不返回 null 即代表命中），
        // 用它把窗口切成"更旧"与"更新"两半分别判定。
        const anchorSeq = rows.find((m) => m.message_uuid === messageUuid)?.seq ?? 0;
        const olderCount = rows.filter((m) => m.seq < anchorSeq).length;
        const newerCount = rows.filter((m) => m.seq > anchorSeq).length;
        setHasMore(olderCount >= LOCATE_WINDOW_BEFORE);
        // 更新侧没取满 = 窗口已经顶到最新 ⇒ 列表与最新连续，**不进窗口态**。
        // 否则会卡在「窗口态但加载不了更新的」，两条护栏永远挂着却毫无意义。
        const reachedNewest = newerCount < LOCATE_WINDOW_AFTER;
        setHasNewer(!reachedNewest);
        setWindowAnchorUuid(reachedNewest ? null : messageUuid);
        logLocal('定位窗口加载完成', { anchor: messageUuid, count: uiMessages.length });
        return true;
      } catch (err) {
        logError('定位窗口加载失败', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [friendId, session],
  );

  /**
   * 窗口态下向**更新**方向续加载（用户从历史窗口往下滚）
   *
   * 接到最新端（DB 返回不足一页）时**自动退出窗口态** —— 此刻列表已与最新连续，
   * 再留着窗口标志只会让缓存与合并两条护栏白白继续拦着。
   */
  const loadNewerMessages = useCallback(async (limit = 50) => {
    if (!friendId || !session || !hasNewer || loadingMore) {
      return;
    }
    const conversationId = getFriendConversationId(session.userId, friendId);
    // messages 是 [新→旧]，最新的一条在头部；seq=0 / 未定义都是本地未同步消息，
    // 它们恒在最新端且没有真实序号，不能拿来当向前分页的游标
    const newestSeq = messagesRef.current.find((m) => (m.seq ?? 0) > 0)?.seq;
    if (newestSeq === undefined) {
      return;
    }
    setLoadingMore(true);
    try {
      const rows = await db.getMessagesAfter(conversationId, newestSeq, limit);
      if (rows.length > 0) {
        const uiMessages = rows.map((m) => localMessageToMessage(m, friendId));
        // 更新的消息接在头部（[新→旧] 顺序）
        setMessages((prev) => [...uiMessages, ...prev]);
      }
      if (rows.length < limit) {
        setHasNewer(false);
        setWindowAnchorUuid(null);
        logLocal('已接上最新，退出定位窗口态');
      }
    } catch (err) {
      logError('向更新方向加载失败', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [friendId, session, hasNewer, loadingMore]);

  /**
   * 回到最新（④「一键回到最底部」在窗口态下的真实动作）
   *
   * 窗口态下列表里根本没有最新消息，单纯滚容器只会滚到**已加载区域**的底 —— 那不是最新。
   * 所以这里显式退出窗口态并整段换成最新一页。
   */
  const jumpToLatest = useCallback(async (limit = 50) => {
    if (!friendId || !session) {
      return;
    }
    const conversationId = getFriendConversationId(session.userId, friendId);
    try {
      const rows = await db.getMessages(conversationId, limit);
      setMessages(rows.map((m) => localMessageToMessage(m, friendId)));
      setWindowAnchorUuid(null);
      setHasNewer(false);
      setHasMore(rows.length >= limit);
    } catch (err) {
      logError('回到最新失败', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [friendId, session]);

  // ============================================
  // 发送文本消息（乐观更新）
  // ============================================

  const sendTextMessage = useCallback(async (content: string, replyTo?: string): Promise<void> => {
    if (!friendId || !content.trim() || !session) {
      return;
    }

    // 生成正确的 conversation_id
    const conversationId = getFriendConversationId(session.userId, friendId);

    // 生成临时 UUID 和稳定的 clientId
    const clientId = newLocalSendClientId();
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
      reply_to: replyTo ?? null,
      send_time: tempSendTime,
      seq: 0,
      is_recalled: false,
      sendStatus: 'sending',
      clientId, // 稳定的客户端 ID，用于 React key
    };

    // 立即添加到 UI（乐观更新）
    setMessages((prev) => [tempMessage, ...prev]);
    setError(null);

    logLocal('发送文本消息（乐观更新）', { tempUuid, content: content.substring(0, 50) });

    try {
      // 调用 API 发送
      const response = await sendMessage(api, {
        receiver_id: friendId,
        message_content: content,
        message_type: 'text',
        // 非回复时留 undefined，JSON 序列化会整个丢掉这个 key（后端 reply_to 为可选字段）
        reply_to: replyTo,
      });

      // 更新消息状态：用真正的 UUID 替换临时 UUID，标记为已发送（保留 clientId）
      setMessages((prev) => prev.map((msg) =>
        msg.clientId === clientId
          ? {
            ...msg,
            message_uuid: response.message_uuid,
            send_time: response.send_time,
            seq: response.seq,
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
        image_width: null,
        image_height: null,
        seq: response.seq,
        reply_to: replyTo ?? null,
        // 本端发送：本客户端尚不支持创建相册（发送侧未落地），故恒 null。
        // 发送侧接上后这里要跟着带三件套，否则自己发的相册在本地散架。
        media_group_id: null,
        media_group_index: null,
        media_group_count: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('消息发送成功并保存到本地', { uuid: response.message_uuid });
      // 注意：seq 已从发送响应回写；WebSocket 回显仅用于补充顺序等其它字段（不再主动触发同步）
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
    const clientId = newLocalSendClientId();
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
      send_time: tempSendTime,
      seq: 0,
      is_recalled: false,
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
            seq: response.seq,
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
        image_width: null, // 图片尺寸在发送后由后端返回
        image_height: null,
        seq: response.seq,
        // 文件消息恒无引用：「正在回复」条只挂在文本输入区，走 sendTextMessage 那条路；
        // 发文件不经过它，故这里不是漏传而是本就没有引用目标（群聊文件路径同口径）。
        reply_to: null,
        // 本端发送：本客户端尚不支持创建相册（发送侧未落地），故恒 null。
        // 发送侧接上后这里要跟着带三件套，否则自己发的相册在本地散架。
        media_group_id: null,
        media_group_index: null,
        media_group_count: null,
        is_recalled: false,
        is_deleted: false,
        send_time: response.send_time,
      };
      await db.saveMessage(localMessage);

      logLocal('媒体消息发送成功', { uuid: response.message_uuid, hasFileLink: !!fileHash });
      logFileLink('媒体消息已链接到本地', { uuid: response.message_uuid, fileHash, localPath });
      // 注意：seq 已从发送响应回写；WebSocket 回显仅用于补充顺序等其它字段（不再主动触发同步）

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
      await recallMessage(api, messageUuid);

      // 原地更新为撤回占位（不要 filter 移除）。理由：
      // 1. 与 WeChat / Telegram / WhatsApp 行为一致：自己撤回也保留「[消息已撤回]」占位
      // 2. 不再调 markMessageDeleted（is_deleted=1）—— 那会让会话预览 JOIN 把这条排除掉，
      //    导致卡片排序时间退回到上一条旧消息，卡片掉位
      // 3. markMessageRecalled 仅设 is_recalled=1 + content='[消息已撤回]'；
      //    is_deleted 保持 0 → 预览 JOIN 包含 → 卡片留在原排序位置（撤回时间）
      setMessages((prev) =>
        prev.map((m) =>
          m.message_uuid === messageUuid
            ? { ...m, is_recalled: true, message_content: '[消息已撤回]' }
            : m,
        ),
      );

      await db.markMessageRecalled(messageUuid);

      logLocal('消息撤回成功（保留为占位）', { uuid: messageUuid });
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

    // 调试：检查 WebSocket 消息中是否包含尺寸信息
    if (wsMsg.message_type === 'image' || wsMsg.message_type === 'video') {
      // eslint-disable-next-line no-console
      console.log('%c[WS] 媒体消息尺寸检查', 'color: #FF5722; font-weight: bold', {
        uuid: wsMsg.message_uuid.slice(0, 8),
        type: wsMsg.message_type,
        image_width: wsMsg.image_width,
        image_height: wsMsg.image_height,
        hasWidth: wsMsg.image_width !== undefined && wsMsg.image_width !== null,
        hasHeight: wsMsg.image_height !== undefined && wsMsg.image_height !== null,
      });
    }

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
            // WS 回显的自己的消息必然已送达（seq>=1）；拉黑丢弃不产生 WS 事件。
            // 忠实写入 wsMsg.seq，不强制成 0——seq=0 是红叹号「未送达」的唯一信号。
            seq: wsMsg.seq,
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
        image_width: wsMsg.image_width ?? null,
        image_height: wsMsg.image_height ?? null,
        // 实时推送同样要带：不带的话对方回复/发相册时，我这边**当场**就渲染不出
        // 引用块与网格（重启后更没有，因为落库那段也曾经在丢）
        reply_to: wsMsg.reply_to ?? null,
        media_group_id: wsMsg.media_group_id ?? null,
        media_group_index: wsMsg.media_group_index ?? null,
        media_group_count: wsMsg.media_group_count ?? null,
        send_time: wsMsg.timestamp,
        // WS 推送的消息必然已送达（seq>=1）；忠实写入，不强制成 0（0=未送达信号）。
        seq: wsMsg.seq,
        is_recalled: false,
        clientId: `ws_${wsMsg.message_uuid}`, // 用于触发入场动画
      };

      // 新消息添加到数组开头，配合 column-reverse 显示在底部
      return [newMessage, ...prev];
    });

    // DB 保存已由 wsHandlers.saveMessageToLocal 统一处理（含 updateLastSeq + updateLastMessage），
    // 此处不再重复保存，避免 _pendingWrites 计数膨胀导致预览刷新延迟。
  }, [friendId, session]);

  // ============================================
  // 处理 WebSocket 消息撤回
  // ============================================

  const handleMessageRecalled = useCallback((wsMsg: WsMessageRecalled) => {
    if (wsMsg.source_type !== 'friend' || wsMsg.source_id !== friendId) {
      return;
    }

    logLocal('收到 WebSocket 消息撤回', { uuid: wsMsg.message_uuid });

    // 原地更新 is_recalled=true（与 GroupMessageBubble 一致），保留占位条目而非凭空消失。
    // message_content 同步替换为 '[消息已撤回]'，与 markMessageRecalled DB 写入对齐，
    // 下次 reload 时内存与 DB 一致。
    setMessages((prev) =>
      prev.map((m) =>
        m.message_uuid === wsMsg.message_uuid
          ? { ...m, is_recalled: true, message_content: '[消息已撤回]' }
          : m,
      ),
    );

    // 标记本地已撤回（与 wsHandlers.ts:407 全局调用幂等冗余）
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
        ws.markRead('friend', msg.source_id, msg.seq);
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
  // connected false→true 时触发同步，但 Token 热切换（connected 始终为 true）不会触发。
  // 断连时间 < 2s 的极短断连（如 resumed 会话恢复）也跳过，由服务端重放事件覆盖。

  const wasConnectedRef = useRef(false);
  const disconnectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ws.connected && wasConnectedRef.current) {
      disconnectedAtRef.current = Date.now();
    }

    if (ws.connected && !wasConnectedRef.current) {
      const gap = disconnectedAtRef.current
        ? Date.now() - disconnectedAtRef.current
        : Infinity;
      disconnectedAtRef.current = null;

      if (gap > 2000) {
        logSync('WebSocket 重连，触发增量同步');
        syncMessagesInBackground();
      } else {
        logSync(`WebSocket 短断连 (${gap}ms)，跳过同步`);
      }
    }
    wasConnectedRef.current = ws.connected;
  }, [ws.connected, syncMessagesInBackground]);

  // ============================================
  // 待发区在途媒体的乐观插入（类 Telegram 发送态）
  // ============================================
  // key 必须与 ChatInputArea 入队时用的完全一致（都走 draftKeyOf），否则条目进得来出不去。
  // 再用 friendId 兜一道：切会话时 chatTarget 与本 hook 的 friendId 有一帧不同步，
  // 不兜会把上一个会话的在途条目短暂并进这个会话的列表。
  const chatTargetForOutbox = useChatStore((s) => s.chatTarget);
  const outboxKey = useMemo(() => {
    const key = draftKeyOf(chatTargetForOutbox);
    if (!key || !friendId) { return null; }
    return key.endsWith(`:${friendId}`) ? key : null;
  }, [chatTargetForOutbox, friendId]);

  const outboxToMessage = useCallback((entry: SendingMediaEntry): Message => ({
    // 临时 uuid 就是 clientId（与 sendTextMessage 的 tempUuid 同口径）
    message_uuid: entry.clientId,
    sender_id: session?.userId ?? '',
    receiver_id: friendId ?? '',
    // 与后端 resolve_content 同口径（无配文时是 `[图片] 文件名`，不是裸文件名）——
    // 用裸文件名会让这条消息在「确认落库」那一刻正文形状突变，肉眼可见地闪一下
    message_content: resolveUploadedContent(entry.caption, entry.preview.kind, entry.preview.name),
    message_type: entry.preview.kind,
    file_uuid: null,
    // 还没上传完，服务端 URL 尚不存在。本地预览由 SendingMediaOverlay 侧的
    // useSendingMediaState(clientId).preview.previewUrl 提供 —— 不把 object URL
    // 塞进 file_url，那条字段的消费方会拿它去做远程解析。
    file_url: null,
    file_size: entry.preview.size,
    // 🔴 与上面 message_content 完全同一条理由：这里写死 null，在途气泡就没有引用块，
    // 而「确认落库」那一刻引用块会**突然冒出来** —— 同样是肉眼可见地闪一下。
    // 引用回复只在好友侧有值（群侧后端丢弃，门在 useComposerTrayOutbox.send）。
    reply_to: entry.replyTo ?? null,
    // 形态发送前定死；single 时三者恒 null =「单条不包相册」
    media_group_id: entry.shape.groupId,
    media_group_index: entry.shape.index,
    media_group_count: entry.shape.count,
    send_time: entry.sendTime,
    seq: 0,
    is_recalled: false,
    sendStatus: entry.status === 'failed' ? 'failed' : 'sending',
    clientId: entry.clientId,
  }), [session, friendId]);

  const messagesWithSending = useSendingOutboxMerge(
    outboxKey,
    messages,
    outboxToMessage,
    loadMessages,
  );

  return {
    messages: messagesWithSending,
    loading,
    loadingMore,
    hasMore,
    error,
    syncing,
    loadMessages,
    loadMoreMessages,
    locateMessage,
    // 窗口态三件套：非窗口态时 isWindowed=false / hasNewer=false，
    // 调用方无需分辨两种形态，按同一套接口用即可。
    isWindowed: windowAnchorUuid !== null,
    hasNewer,
    loadNewerMessages,
    jumpToLatest,
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
