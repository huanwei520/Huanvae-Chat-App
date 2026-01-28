/**
 * WebSocket Context
 *
 * 提供 WebSocket 实时通信功能：
 * - 连接管理（自动连接、断线重连）
 * - 未读消息摘要
 * - 新消息通知（new_message）
 * - 消息撤回通知（message_recalled）
 * - 标记已读
 * - 系统通知（好友请求、群邀请等）
 * - 重连事件（用于触发消息增量同步）
 *
 * 重连同步机制：
 * - 首次连接不触发 onReconnected
 * - 断线重连成功后触发 onReconnected，通知 useInitialSync 执行增量同步
 *
 * Token 刷新机制：
 * - 使用 ref 存储最新 token，避免闭包陈旧问题
 * - 重连失败达到阈值时，尝试刷新 token
 * - Token 刷新后自动使用新 token 重连
 * - 刷新失败则退出登录，避免无限循环
 *
 * 消息处理逻辑已提取到 wsHandlers.ts
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useSession } from './SessionContext';
import {
  handleWebSocketMessage,
  getMessagePreviewText,
  updateFriendUnread,
  updateGroupUnread,
  createInitialUnreadSummary,
} from './wsHandlers';
import type {
  UnreadSummary,
  WsNewMessage,
  WsMessageRecalled,
  WsSystemNotification,
} from '../types/websocket';

// ============================================
// 常量
// ============================================

/** 最大重连尝试次数（超过后尝试刷新 token） */
const MAX_RECONNECT_ATTEMPTS = 3;
/** 重连间隔（毫秒） */
const RECONNECT_INTERVAL = 5000;
/** Token 刷新后重连延迟（毫秒），等待 ref 更新 */
const TOKEN_REFRESH_RECONNECT_DELAY = 100;

// ============================================
// 类型定义
// ============================================

/** 待处理通知计数 */
export interface PendingNotifications {
  friendRequests: number;
  groupInvites: number;
  groupJoinRequests: number;
}

interface WebSocketContextType {
  connected: boolean;
  connecting: boolean;
  unreadSummary: UnreadSummary | null;
  totalUnread: number;
  getFriendUnread: (friendId: string) => number;
  getGroupUnread: (groupId: string) => number;
  pendingNotifications: PendingNotifications;
  clearPendingNotification: (type: keyof PendingNotifications) => void;
  initPendingNotifications: (counts: Partial<PendingNotifications>) => void;
  markRead: (targetType: 'friend' | 'group', targetId: string) => void;
  connect: () => void;
  disconnect: () => void;
  setActiveChat: (targetType: 'friend' | 'group' | null, targetId: string | null) => void;
  updateLastMessage: (
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file',
    timestamp: string
  ) => void;
  onNewMessage: (callback: (msg: WsNewMessage) => void) => () => void;
  onMessageRecalled: (callback: (msg: WsMessageRecalled) => void) => () => void;
  onSystemNotification: (callback: (msg: WsSystemNotification) => void) => () => void;
  /** 订阅重连成功事件（用于触发消息增量同步） */
  onReconnected: (callback: () => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

// ============================================
// Provider 组件
// ============================================

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { session, api, clearSession } = useSession();

  // Refs - 使用 ref 存储最新值，避免闭包陈旧问题
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatRef = useRef<{ type: 'friend' | 'group'; id: string } | null>(null);
  /** 是否正在断开连接（用于阻止闭包中的重连逻辑和消息处理） */
  const isDisconnectingRef = useRef(false);
  /** 是否是首次连接（用于区分首次连接和重连） */
  const isFirstConnectRef = useRef(true);
  /** 是否正在刷新 token（防止重复刷新） */
  const isRefreshingTokenRef = useRef(false);
  /** 重连尝试次数（连续失败次数） */
  const reconnectAttemptsRef = useRef(0);
  /** 最新的 accessToken（避免闭包陈旧） */
  const tokenRef = useRef<string | null>(null);
  /** 最新的 serverUrl（避免闭包陈旧） */
  const serverUrlRef = useRef<string | null>(null);
  /** 当前用户 ID（用于消息处理） */
  const userIdRef = useRef<string | null>(null);

  const newMessageListeners = useRef<Set<(msg: WsNewMessage) => void>>(new Set());
  const recalledListeners = useRef<Set<(msg: WsMessageRecalled) => void>>(new Set());
  const notificationListeners = useRef<Set<(msg: WsSystemNotification) => void>>(new Set());
  const reconnectedListeners = useRef<Set<() => void>>(new Set());

  // State
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unreadSummary, setUnreadSummary] = useState<UnreadSummary | null>(null);
  const [pendingNotifications, setPendingNotifications] = useState<PendingNotifications>({
    friendRequests: 0,
    groupInvites: 0,
    groupJoinRequests: 0,
  });

  const totalUnread = unreadSummary?.total_count ?? 0;

  // ============================================
  // 保持 Refs 与 Session 同步
  // ============================================

  useEffect(() => {
    tokenRef.current = session?.accessToken ?? null;
    serverUrlRef.current = session?.serverUrl ?? null;
    userIdRef.current = session?.userId ?? null;
  }, [session?.accessToken, session?.serverUrl, session?.userId]);

  // ============================================
  // 未读数查询
  // ============================================

  const getFriendUnread = useCallback((friendId: string): number => {
    if (!unreadSummary) { return 0; }
    const found = unreadSummary.friend_unreads.find(u => u.friend_id === friendId);
    return found?.unread_count ?? 0;
  }, [unreadSummary]);

  const getGroupUnread = useCallback((groupId: string): number => {
    if (!unreadSummary) { return 0; }
    const found = unreadSummary.group_unreads.find(u => u.group_id === groupId);
    return found?.unread_count ?? 0;
  }, [unreadSummary]);

  // ============================================
  // 消息处理
  // ============================================

  const handleMessage = useCallback((data: string) => {
    // 如果正在断开连接，忽略所有消息（防止退出登录后仍触发通知）
    if (isDisconnectingRef.current) {
      return;
    }

    handleWebSocketMessage(data, {
      activeChatRef,
      currentUserId: userIdRef.current,
      setUnreadSummary,
      setPendingNotifications,
      newMessageListeners,
      recalledListeners,
      notificationListeners,
    });
  }, []); // 使用 ref，不需要依赖

  // ============================================
  // Token 刷新
  // ============================================

  /**
   * 尝试刷新 Token
   * @returns 是否刷新成功
   */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (isRefreshingTokenRef.current) {
      return false;
    }

    if (!api) {
      console.error('[WebSocket] 无法刷新 token：API 客户端不可用');
      return false;
    }

    isRefreshingTokenRef.current = true;

    try {
      // 调用任意需要认证的 API，触发 API Client 的自动刷新机制
      // 如果 token 过期，API Client 会自动刷新并更新 SessionContext
      await api.get('/api/profile');
      console.warn('[WebSocket] Token 刷新成功');
      return true;
    } catch (error) {
      console.error('[WebSocket] Token 刷新失败:', error);
      return false;
    } finally {
      isRefreshingTokenRef.current = false;
    }
  }, [api]);

  // ============================================
  // 连接管理
  // ============================================

  const connect = useCallback(() => {
    const token = tokenRef.current;
    const serverUrl = serverUrlRef.current;

    // 使用 ref 检查，避免闭包陈旧
    if (!token || !serverUrl) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN || connecting) {
      return;
    }

    // 重置断开连接标志，允许消息处理和重连
    isDisconnectingRef.current = false;
    setConnecting(true);

    const wsUrl = `${serverUrl.replace(/^http/, 'ws')}/ws`;
    const url = `${wsUrl}?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);
        // 连接成功，重置重连计数
        reconnectAttemptsRef.current = 0;

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);

        // 重连成功后触发事件，通知 useInitialSync 执行增量同步
        if (!isFirstConnectRef.current) {
          console.warn('[WebSocket] 重连成功，触发消息增量同步');
          reconnectedListeners.current.forEach(callback => callback());
        } else {
          // 首次连接后标记为非首次
          isFirstConnectRef.current = false;
        }
      };

      ws.onclose = async (event) => {
        setConnected(false);
        setConnecting(false);
        wsRef.current = null;

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // 如果是主动断开连接（退出登录），不重连
        if (isDisconnectingRef.current) {
          return;
        }

        // 检查是否需要刷新 token
        // WebSocket 关闭码 1008 表示策略违规（通常是认证失败）
        const isAuthError = event.code === 1008;
        const tooManyAttempts = reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS;

        if (isAuthError || tooManyAttempts) {
          console.warn('[WebSocket] 认证问题或重连次数过多，尝试刷新 token...');

          const success = await refreshToken();

          if (success) {
            // Token 刷新成功，重置计数，稍后重连（等待 tokenRef 更新）
            reconnectAttemptsRef.current = 0;
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              connect();
            }, TOKEN_REFRESH_RECONNECT_DELAY);
          } else {
            // Token 刷新失败，退出登录
            console.error('[WebSocket] Token 刷新失败，退出登录');
            clearSession();
          }
          return;
        }

        // 普通重连
        reconnectAttemptsRef.current++;
        console.warn(`[WebSocket] 连接断开，${RECONNECT_INTERVAL / 1000}s 后重连 (第 ${reconnectAttemptsRef.current} 次)`);

        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, RECONNECT_INTERVAL);
        }
      };

      ws.onerror = () => {
        setConnecting(false);
      };

      ws.onmessage = (event) => {
        handleMessage(event.data);
      };
    } catch (err) {
      console.error('📡 WebSocket 连接失败:', err);
      setConnecting(false);
    }
  }, [connecting, handleMessage, refreshToken, clearSession]);

  const disconnect = useCallback(() => {
    // 设置断开连接标志，阻止消息处理和重连
    isDisconnectingRef.current = true;
    // 重置首次连接标志，下次登录时重新标记为首次连接
    isFirstConnectRef.current = true;

    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
    setUnreadSummary(null);
  }, []);

  // ============================================
  // 标记已读
  // ============================================

  const markRead = useCallback((targetType: 'friend' | 'group', targetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'mark_read',
        target_type: targetType,
        target_id: targetId,
      }));
    }

    setUnreadSummary(prev => {
      if (!prev) { return prev; }

      const newSummary = { ...prev };

      if (targetType === 'friend') {
        newSummary.friend_unreads = newSummary.friend_unreads.map(u =>
          u.friend_id === targetId ? { ...u, unread_count: 0 } : u,
        );
      } else {
        newSummary.group_unreads = newSummary.group_unreads.map(u =>
          u.group_id === targetId ? { ...u, unread_count: 0 } : u,
        );
      }

      newSummary.total_count =
        newSummary.friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
        newSummary.group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

      return newSummary;
    });
  }, []);

  // ============================================
  // 更新消息预览
  // ============================================

  const updateLastMessage = useCallback((
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file',
    timestamp: string,
  ) => {
    const previewText = getMessagePreviewText(messageType, preview);

    setUnreadSummary(prev => {
      if (!prev) {
        return createInitialUnreadSummary(targetType, targetId, previewText, timestamp);
      }

      if (targetType === 'friend') {
        return updateFriendUnread(prev, targetId, previewText, timestamp, false);
      }
      return updateGroupUnread(prev, targetId, previewText, timestamp, false);
    });
  }, []);

  // ============================================
  // 活跃聊天管理
  // ============================================

  const setActiveChat = useCallback((
    targetType: 'friend' | 'group' | null,
    targetId: string | null,
  ) => {
    if (targetType && targetId) {
      activeChatRef.current = { type: targetType, id: targetId };
    } else {
      activeChatRef.current = null;
    }
  }, []);

  // ============================================
  // 通知管理
  // ============================================

  const clearPendingNotification = useCallback((type: keyof PendingNotifications) => {
    setPendingNotifications(prev => ({ ...prev, [type]: 0 }));
  }, []);

  const initPendingNotifications = useCallback((counts: Partial<PendingNotifications>) => {
    setPendingNotifications(prev => ({ ...prev, ...counts }));
  }, []);

  // ============================================
  // 事件订阅
  // ============================================

  const onNewMessage = useCallback((callback: (msg: WsNewMessage) => void) => {
    newMessageListeners.current.add(callback);
    return () => { newMessageListeners.current.delete(callback); };
  }, []);

  const onMessageRecalled = useCallback((callback: (msg: WsMessageRecalled) => void) => {
    recalledListeners.current.add(callback);
    return () => { recalledListeners.current.delete(callback); };
  }, []);

  const onSystemNotification = useCallback((callback: (msg: WsSystemNotification) => void) => {
    notificationListeners.current.add(callback);
    return () => { notificationListeners.current.delete(callback); };
  }, []);

  const onReconnected = useCallback((callback: () => void) => {
    reconnectedListeners.current.add(callback);
    return () => { reconnectedListeners.current.delete(callback); };
  }, []);

  // ============================================
  // 自动连接/断开
  // ============================================

  // 登录/退出时连接/断开
  useEffect(() => {
    if (session) {
      connect();
    } else {
      disconnect();
    }
    return () => { disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session]); // 只依赖 session 是否存在，不依赖具体值

  // Token 变化时重连（使用新 token）
  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    // 如果 WebSocket 已连接且 token 变化，关闭连接触发重连
    // 重连时会使用 tokenRef 中的最新 token
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.warn('[WebSocket] Token 已刷新，使用新 token 重连...');
      // 不设置 isDisconnectingRef，允许自动重连
      wsRef.current.close(1000, 'Token refreshed');
    }
  }, [session?.accessToken]);

  const contextValue: WebSocketContextType = {
    connected,
    connecting,
    unreadSummary,
    totalUnread,
    getFriendUnread,
    getGroupUnread,
    pendingNotifications,
    clearPendingNotification,
    initPendingNotifications,
    markRead,
    connect,
    disconnect,
    setActiveChat,
    updateLastMessage,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
    onReconnected,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
