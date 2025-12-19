/**
 * WebSocket Context
 *
 * 提供 WebSocket 实时通信功能：
 * - 连接管理（自动连接、断线重连）
 * - 未读消息摘要
 * - 新消息通知
 * - 标记已读
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
import type {
  UnreadSummary,
  WsServerMessage,
  WsNewMessage,
  WsMessageRecalled,
  WsSystemNotification,
} from '../types/websocket';

// ============================================
// Context 类型定义
// ============================================

interface WebSocketContextType {
  // 连接状态
  connected: boolean;
  connecting: boolean;

  // 未读消息
  unreadSummary: UnreadSummary | null;
  totalUnread: number;
  getFriendUnread: (friendId: string) => number;
  getGroupUnread: (groupId: string) => number;

  // 操作
  markRead: (targetType: 'friend' | 'group', targetId: string) => void;
  connect: () => void;
  disconnect: () => void;

  // 设置当前活跃的聊天目标（用于避免收到当前会话消息时增加未读）
  setActiveChat: (targetType: 'friend' | 'group' | null, targetId: string | null) => void;

  // 更新消息预览（发送消息后调用）
  updateLastMessage: (
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file',
    timestamp: string
  ) => void;

  // 事件订阅
  onNewMessage: (callback: (msg: WsNewMessage) => void) => () => void;
  onMessageRecalled: (callback: (msg: WsMessageRecalled) => void) => () => void;
  onSystemNotification: (callback: (msg: WsSystemNotification) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

// ============================================
// Provider 组件
// ============================================

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { session } = useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unreadSummary, setUnreadSummary] = useState<UnreadSummary | null>(null);

  // 当前活跃的聊天目标（用于判断新消息是否需要增加未读）
  const activeChatRef = useRef<{ type: 'friend' | 'group'; id: string } | null>(null);

  // 事件监听器
  const newMessageListeners = useRef<Set<(msg: WsNewMessage) => void>>(new Set());
  const recalledListeners = useRef<Set<(msg: WsMessageRecalled) => void>>(new Set());
  const notificationListeners = useRef<Set<(msg: WsSystemNotification) => void>>(new Set());

  // 计算总未读数
  const totalUnread = unreadSummary?.total_count ?? 0;

  // 获取好友未读数
  const getFriendUnread = useCallback((friendId: string): number => {
    if (!unreadSummary) { return 0; }
    const found = unreadSummary.friend_unreads.find(u => u.friend_id === friendId);
    return found?.unread_count ?? 0;
  }, [unreadSummary]);

  // 获取群聊未读数
  const getGroupUnread = useCallback((groupId: string): number => {
    if (!unreadSummary) { return 0; }
    const found = unreadSummary.group_unreads.find(u => u.group_id === groupId);
    return found?.unread_count ?? 0;
  }, [unreadSummary]);

  // 处理 WebSocket 消息
  const handleMessage = useCallback((data: string) => {
    try {
      const msg = JSON.parse(data) as WsServerMessage;

      switch (msg.type) {
        case 'connected':
          setUnreadSummary(msg.unread_summary);
          break;

        case 'new_message': {
          // 根据消息类型生成预览文本
          let msgPreviewText = '[文件]';
          if (msg.message_type === 'text') {
            msgPreviewText = msg.preview;
          } else if (msg.message_type === 'image') {
            msgPreviewText = '[图片]';
          } else if (msg.message_type === 'video') {
            msgPreviewText = '[视频]';
          }

          // 检查是否是当前活跃的聊天（如果是则不增加未读计数）
          const isActiveChat = activeChatRef.current &&
            activeChatRef.current.type === msg.source_type &&
            activeChatRef.current.id === msg.source_id;

          // 更新未读计数和消息预览
          setUnreadSummary(prev => {
            if (!prev) { return prev; }

            const newSummary = { ...prev };

            if (msg.source_type === 'friend') {
              const idx = newSummary.friend_unreads.findIndex(
                u => u.friend_id === msg.source_id,
              );
              if (idx >= 0) {
                newSummary.friend_unreads = [...newSummary.friend_unreads];
                newSummary.friend_unreads[idx] = {
                  ...newSummary.friend_unreads[idx],
                  // 只有非当前聊天才增加未读计数
                  unread_count: isActiveChat
                    ? newSummary.friend_unreads[idx].unread_count
                    : newSummary.friend_unreads[idx].unread_count + 1,
                  last_message_preview: msgPreviewText,
                  last_message_time: msg.timestamp,
                };
              } else {
                newSummary.friend_unreads = [
                  ...newSummary.friend_unreads,
                  {
                    friend_id: msg.source_id,
                    unread_count: isActiveChat ? 0 : 1,
                    last_message_preview: msgPreviewText,
                    last_message_time: msg.timestamp,
                  },
                ];
              }
            } else {
              const idx = newSummary.group_unreads.findIndex(
                u => u.group_id === msg.source_id,
              );
              if (idx >= 0) {
                newSummary.group_unreads = [...newSummary.group_unreads];
                newSummary.group_unreads[idx] = {
                  ...newSummary.group_unreads[idx],
                  // 只有非当前聊天才增加未读计数
                  unread_count: isActiveChat
                    ? newSummary.group_unreads[idx].unread_count
                    : newSummary.group_unreads[idx].unread_count + 1,
                  last_message_preview: msgPreviewText,
                  last_message_time: msg.timestamp,
                };
              } else {
                newSummary.group_unreads = [
                  ...newSummary.group_unreads,
                  {
                    group_id: msg.source_id,
                    unread_count: isActiveChat ? 0 : 1,
                    last_message_preview: msgPreviewText,
                    last_message_time: msg.timestamp,
                  },
                ];
              }
            }

            // 重新计算总数
            newSummary.total_count =
              newSummary.friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
              newSummary.group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

            return newSummary;
          });

          // 通知监听器
          newMessageListeners.current.forEach(cb => cb(msg));
          break;
        }

        case 'message_recalled':
          recalledListeners.current.forEach(cb => cb(msg));
          break;

        case 'read_sync':
          // 可以在这里更新 UI 显示对方已读状态
          break;

        case 'system_notification':
          notificationListeners.current.forEach(cb => cb(msg));
          break;

        case 'heartbeat':
          // 服务器心跳，保持连接活跃
          break;

        case 'error':
          console.error('📡 WebSocket 错误:', msg.code, msg.message);
          break;
      }
    } catch (err) {
      console.error('📡 解析消息失败:', err);
    }
  }, []);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (!session) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (connecting) {
      return;
    }

    setConnecting(true);

    // 构建 WebSocket URL
    const wsUrl = `${session.serverUrl.replace(/^http/, 'ws')}/ws`;
    const url = `${wsUrl}?token=${encodeURIComponent(session.accessToken)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);

        // 清除重连定时器
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        // 启动心跳定时器（每 25 秒发送一次 ping）
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        wsRef.current = null;

        // 清除心跳定时器
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // 自动重连（如果有 session）
        if (session && !reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, 5000);
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
  }, [session, connecting, handleMessage]);

  // 断开 WebSocket
  const disconnect = useCallback(() => {
    // 清除心跳定时器
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // 清除重连定时器
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

  // 标记已读
  const markRead = useCallback((targetType: 'friend' | 'group', targetId: string) => {
    // 通知服务器（如果 WebSocket 已连接）
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'mark_read',
        target_type: targetType,
        target_id: targetId,
      }));
    }

    // 无论 WebSocket 是否连接，都更新本地未读数
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

      // 重新计算总数
      newSummary.total_count =
        newSummary.friend_unreads.reduce((sum, u) => sum + u.unread_count, 0) +
        newSummary.group_unreads.reduce((sum, u) => sum + u.unread_count, 0);

      return newSummary;
    });
  }, []);

  // 更新消息预览（发送消息后调用）
  const updateLastMessage = useCallback((
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file',
    timestamp: string,
  ) => {
    // 根据消息类型生成预览文本
    let previewText = '[文件]';
    if (messageType === 'text') {
      previewText = preview;
    } else if (messageType === 'image') {
      previewText = '[图片]';
    } else if (messageType === 'video') {
      previewText = '[视频]';
    }

    setUnreadSummary(prev => {
      if (!prev) {
        // 如果还没有 unreadSummary，创建一个初始的
        if (targetType === 'friend') {
          return {
            total_count: 0,
            friend_unreads: [{
              friend_id: targetId,
              unread_count: 0,
              last_message_preview: previewText,
              last_message_time: timestamp,
            }],
            group_unreads: [],
          };
        } else {
          return {
            total_count: 0,
            friend_unreads: [],
            group_unreads: [{
              group_id: targetId,
              unread_count: 0,
              last_message_preview: previewText,
              last_message_time: timestamp,
            }],
          };
        }
      }

      const newSummary = { ...prev };

      if (targetType === 'friend') {
        const idx = newSummary.friend_unreads.findIndex(u => u.friend_id === targetId);
        if (idx >= 0) {
          newSummary.friend_unreads = [...newSummary.friend_unreads];
          newSummary.friend_unreads[idx] = {
            ...newSummary.friend_unreads[idx],
            last_message_preview: previewText,
            last_message_time: timestamp,
          };
        } else {
          newSummary.friend_unreads = [
            ...newSummary.friend_unreads,
            {
              friend_id: targetId,
              unread_count: 0,
              last_message_preview: previewText,
              last_message_time: timestamp,
            },
          ];
        }
      } else {
        const idx = newSummary.group_unreads.findIndex(u => u.group_id === targetId);
        if (idx >= 0) {
          newSummary.group_unreads = [...newSummary.group_unreads];
          newSummary.group_unreads[idx] = {
            ...newSummary.group_unreads[idx],
            last_message_preview: previewText,
            last_message_time: timestamp,
          };
        } else {
          newSummary.group_unreads = [
            ...newSummary.group_unreads,
            {
              group_id: targetId,
              unread_count: 0,
              last_message_preview: previewText,
              last_message_time: timestamp,
            },
          ];
        }
      }

      return newSummary;
    });
  }, []);

  // 设置当前活跃的聊天目标
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

  // 事件订阅
  const onNewMessage = useCallback((callback: (msg: WsNewMessage) => void) => {
    newMessageListeners.current.add(callback);
    return () => {
      newMessageListeners.current.delete(callback);
    };
  }, []);

  const onMessageRecalled = useCallback((callback: (msg: WsMessageRecalled) => void) => {
    recalledListeners.current.add(callback);
    return () => {
      recalledListeners.current.delete(callback);
    };
  }, []);

  const onSystemNotification = useCallback((callback: (msg: WsSystemNotification) => void) => {
    notificationListeners.current.add(callback);
    return () => {
      notificationListeners.current.delete(callback);
    };
  }, []);

  // Session 变化时自动连接/断开
  useEffect(() => {
    if (session) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]); // 故意不包含 connect/disconnect 避免无限循环

  const contextValue: WebSocketContextType = {
    connected,
    connecting,
    unreadSummary,
    totalUnread,
    getFriendUnread,
    getGroupUnread,
    markRead,
    connect,
    disconnect,
    setActiveChat,
    updateLastMessage,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
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
