/**
 * WebSocket Context
 *
 * 提供 WebSocket 实时通信功能：
 * - 连接管理（自动连接、断线重连、会话恢复）
 * - Token 热切换（新 token 先建新连接，成功后断旧连接，零断连）
 * - 未读消息摘要
 * - 新消息通知（new_message）
 * - 消息撤回通知（message_recalled）
 * - 标记已读
 * - 系统通知（好友请求、群邀请等）
 * - 重连事件（用于触发消息增量同步）
 * - 事件序列号追踪（跳号检测 → 精准补漏）
 * - 消息预览刷新（refreshLastMessagePreview，删除/撤回后同步卡片显示）
 *
 * 连接恢复机制：
 * - 服务端 connected 消息包含 session_id，客户端保存
 * - 断线重连时 URL 携带 session_id + last_event_seq
 * - 服务端返回 resumed=true → 自动重放缺失事件，无需手动 sync
 * - 服务端返回 resumed=false → 触发 onReconnected，执行增量同步
 * - 首次连接不触发 onReconnected
 *
 * Token 刷新机制：
 * - 主动刷新：SessionContext 在 JWT 过期前 5 分钟自动刷新
 * - 热切换：检测到 token 变化 → 用新 token 并行建立新 WS
 *   → 新 WS onopen 后关闭旧 WS，全程 connected 状态不变
 *   → 新连接失败时回退到旧连接（旧 token 仍有效）
 * - 被动刷新：关闭码 1008 或重连失败 ≥ MAX_RECONNECT_ATTEMPTS 次时触发
 * - 刷新失败则退出登录，避免无限循环
 *
 * 重连策略：
 * - 指数退避：1s → 2s → 4s → 8s → 16s → 最大 30s
 * - 抖动：叠加随机延迟防止雷群效应（服务重启后所有客户端同时重连）
 *
 * 半开检测（假活防护）：
 * - 服务端心跳 = WS 协议层 Ping（每 30s，ws_proxy 转发为活性信号）
 * - 入站活性看门狗：超 LIVENESS_TIMEOUT 无任何入站帧 → 判半开 → terminate 本地
 *   强制 onclose → 走既有指数退避重连
 * - Rust 层 idle_timeout_secs 兜底回收半开 reader；ws_connect 带 15s 建连超时
 * - 重连成功后强制补一次增量 sync（halfOpenSyncPendingRef），不依赖 resumed 重放
 *
 * 消息处理逻辑已提取到 wsHandlers.ts
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  clearUnreadEntry,
} from './wsHandlers';
import { seedReadPositions, resetReadPositions } from './readPositions';
import * as db from '../db';
import { getFriendConversationId } from '../utils/conversationId';
import { setSyncedConversationListener } from '../services/syncService';

import type {
  UnreadSummary,
  WsNewMessage,
  WsMessageRecalled,
  WsSystemNotification,
  WsReadSync,
} from '../types/websocket';
import { RustWebSocket } from '../services/rustWebSocket';
import { resolveForSecureHttp, rediscoverOnFailure, getActiveEndpoint } from '../services/discovery';

// ============================================
// 常量
// ============================================

/** 最大重连尝试次数（超过后尝试刷新 token） */
const MAX_RECONNECT_ATTEMPTS = 5;
/** 连续重连失败达到此次数后，重连前先轮换后端 IP（当前 active 节点疑似下线 → rediscoverOnFailure 排除死 IP 重发现）。
 *  < MAX_RECONNECT_ATTEMPTS，使死节点在触发 token 刷新/登出前先尝试轮换到其他可达节点，自愈不依赖发现池摘死节点。 */
const ROTATE_AFTER_ATTEMPTS = 2;
/** 重连基础延迟（毫秒），实际延迟 = base * 2^attempts + jitter */
const RECONNECT_BASE_DELAY = 1000;
/** 重连最大延迟（毫秒） */
const RECONNECT_MAX_DELAY = 30000;
/** 客户端 Ping 间隔（毫秒） */
const PING_INTERVAL = 25000;
/** 入站活性超时（毫秒）。服务端心跳=WS 协议层 Ping 每 30s（经 ws_proxy 转发计入活性），
 *  健康连接的入站静默不超过一个心跳周期；连续 2 个周期 + 余量无任何入站帧判半开。 */
const LIVENESS_TIMEOUT = 70000;
/** Rust 层入站空闲超时（秒）：3 个心跳周期，兜底回收半开连接的读任务并上抛 Error
 *  （覆盖 JS 看门狗 terminate 后残留的 Rust reader，以及 webview 假死等 JS 层失能场景） */
const WS_IDLE_TIMEOUT_SECS = 90;
/** Token 刷新后被动重连延迟（毫秒），仅在热切换失败时使用 */
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
  /**
   * 标记会话已读：发 WS mark_read 帧（离线/假活时暂存，connected 后补发）+ 本地 summary 清零
   * + 推进本地读位。seq 可选：收到新消息当帧标读时传该消息 seq，消除 advance 与
   * updateConversationLastSeq 两条 invoke 链的顺序竞态（读位恒落后 1 条堵死自愈判据）。
   */
  markRead: (targetType: 'friend' | 'group', targetId: string, seq?: number) => void;
  connect: () => void;
  disconnect: () => void;
  setActiveChat: (targetType: 'friend' | 'group' | null, targetId: string | null) => void;
  updateLastMessage: (
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file' | 'meeting_invite',
    timestamp: string
  ) => void;
  onNewMessage: (callback: (msg: WsNewMessage) => void) => () => void;
  onMessageRecalled: (callback: (msg: WsMessageRecalled) => void) => () => void;
  onSystemNotification: (callback: (msg: WsSystemNotification) => void) => () => void;
  /** 订阅已读回执（私聊对方已读 / 群聊某成员已读），用于发送方显示"已读"/"N 人已读" */
  onReadSync: (callback: (msg: WsReadSync) => void) => () => void;
  /** 订阅重连成功事件（仅在 resumed=false 时触发，用于增量同步） */
  onReconnected: (callback: () => void) => () => void;
  /** 刷新指定会话的最新消息预览（用于删除/撤回后同步卡片显示） */
  refreshLastMessagePreview: (
    targetType: 'friend' | 'group',
    targetId: string,
  ) => Promise<void>;
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
  const wsRef = useRef<RustWebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatRef = useRef<{ type: 'friend' | 'group'; id: string } | null>(null);
  /** 是否正在断开连接（用于阻止闭包中的重连逻辑和消息处理） */
  const isDisconnectingRef = useRef(false);
  /** 是否是首次连接（用于区分首次连接和重连） */
  const isFirstConnectRef = useRef(true);
  /** 是否正在刷新 token（防止重复刷新） */
  const isRefreshingTokenRef = useRef(false);
  /** 是否正在进行 Token 热切换（防止重复触发） */
  const isSwappingRef = useRef(false);
  /** 连接状态 guard（ref 版本，消除 useCallback 对 connecting state 的依赖） */
  const connectingRef = useRef(false);
  /** 重连尝试次数（连续失败次数） */
  const reconnectAttemptsRef = useRef(0);
  /** 最新的 accessToken（避免闭包陈旧） */
  const tokenRef = useRef<string | null>(null);
  /** 最新的 serverUrl（避免闭包陈旧） */
  const serverUrlRef = useRef<string | null>(null);
  /** 当前用户 ID（用于消息处理） */
  const userIdRef = useRef<string | null>(null);

  // Session Recovery refs
  /** 服务端分配的连接会话 ID（重连时携带以恢复会话） */
  const sessionIdRef = useRef<string | null>(null);
  /** 最后收到的连接级事件序列号（用于跳号检测和会话恢复） */
  const lastEventSeqRef = useRef(0);
  /** 服务端建议的重连抖动上限（毫秒） */
  const reconnectJitterMsRef = useRef(3000);
  /** 看门狗判半开断开后待补偿：重连成功（收到 connected 帧）后强制触发一次增量 sync */
  const halfOpenSyncPendingRef = useRef(false);

  /** 离线/假活期间未能发出的 mark_read（按 type:id 去重），connected 后补发（服务端 GREATEST 幂等） */
  const pendingMarkReadsRef = useRef<Map<string, { targetType: 'friend' | 'group'; targetId: string }>>(new Map());
  /** markReadRef 解决 handleMessage（ctx 回调）→ markRead 的声明顺序问题（同 connectRef 模式） */
  const markReadRef = useRef<(targetType: 'friend' | 'group', targetId: string, seq?: number) => void>(() => {});

  const newMessageListeners = useRef<Set<(msg: WsNewMessage) => void>>(new Set());
  const recalledListeners = useRef<Set<(msg: WsMessageRecalled) => void>>(new Set());
  const notificationListeners = useRef<Set<(msg: WsSystemNotification) => void>>(new Set());
  const readSyncListeners = useRef<Set<(msg: WsReadSync) => void>>(new Set());
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
    if (isDisconnectingRef.current) {
      return;
    }

    const result = handleWebSocketMessage(data, {
      activeChatRef,
      currentUserId: userIdRef.current,
      setUnreadSummary,
      setPendingNotifications,
      newMessageListeners,
      recalledListeners,
      notificationListeners,
      readSyncListeners,
      sendResyncReadPositions: (positions) => {
        if (positions.length > 0 && wsRef.current?.readyState === RustWebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resync_read_positions', positions }));
        }
      },
      flushPendingMarkReads: () => {
        if (pendingMarkReadsRef.current.size === 0 || wsRef.current?.readyState !== RustWebSocket.OPEN) {
          return;
        }
        for (const { targetType, targetId } of pendingMarkReadsRef.current.values()) {
          wsRef.current.send(JSON.stringify({
            type: 'mark_read',
            target_type: targetType,
            target_id: targetId,
          }));
        }
        pendingMarkReadsRef.current.clear();
      },
      markActiveChatRead: () => {
        const active = activeChatRef.current;
        if (active) {
          markReadRef.current(active.type, active.id);
        }
      },
    });

    if (!result) {
      return;
    }

    // 保存 session recovery 信息
    if (result.sessionId !== undefined) {
      sessionIdRef.current = result.sessionId;
    }
    if (result.reconnectJitterMs !== undefined) {
      reconnectJitterMsRef.current = result.reconnectJitterMs;
    }

    // 追踪连接级事件 seq（跳号检测）
    if (result.eventSeq !== undefined && result.eventSeq > 0) {
      const expected = lastEventSeqRef.current + 1;
      if (lastEventSeqRef.current > 0 && result.eventSeq > expected) {
        console.warn(`[WebSocket] event seq 跳号: 期望 ${expected}, 收到 ${result.eventSeq}，触发增量同步`);
        reconnectedListeners.current.forEach(callback => callback());
      }
      lastEventSeqRef.current = result.eventSeq;
    }

    // 处理 resumed / 半开补偿：connected 帧（携带 session_id / resumed）= 重连落定
    const isConnectedFrame = result.sessionId !== undefined || result.resumed !== undefined;
    const resumeFailed = result.resumed === false && !isFirstConnectRef.current;
    const halfOpenCompensate = isConnectedFrame && halfOpenSyncPendingRef.current;
    if (isConnectedFrame) {
      halfOpenSyncPendingRef.current = false;
    }
    if (resumeFailed) {
      console.warn('[WebSocket] 会话未恢复 (resumed=false)，触发消息增量同步');
      reconnectedListeners.current.forEach(callback => callback());
    } else if (halfOpenCompensate) {
      // 半开期间入站帧黑洞时长未知，resumed=true 的重放只覆盖服务端事件缓冲窗口，
      // 看门狗恢复后无条件补一次增量 sync（syncService 按 seq 增量拉取，幂等）
      console.warn('[WebSocket] 半开恢复重连成功，补偿增量同步');
      reconnectedListeners.current.forEach(callback => callback());
    }
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

  // connectRef 解决 installWsHandlers → connect 的循环引用
  const connectRef = useRef<() => void>(() => {});

  /** 构建 WS URL（含 session recovery 参数） */
  const buildWsUrl = useCallback((token: string, serverUrl: string): string => {
    const wsUrl = `${serverUrl.replace(/^http/, 'ws')}/ws`;
    let url = `${wsUrl}?token=${encodeURIComponent(token)}`;
    if (sessionIdRef.current && lastEventSeqRef.current > 0) {
      url += `&session_id=${encodeURIComponent(sessionIdRef.current)}&last_seq=${lastEventSeqRef.current}`;
    }
    return url;
  }, []);

  /** 计算重连延迟（指数退避 + 抖动） */
  const getReconnectDelay = useCallback((): number => {
    const exponential = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptsRef.current),
      RECONNECT_MAX_DELAY,
    );
    const jitter = Math.random() * Math.min(reconnectJitterMsRef.current, exponential);
    return exponential + jitter;
  }, []);

  /** 为 WebSocket 实例安装标准事件处理器 */
  const installWsHandlers = useCallback((ws: RustWebSocket) => {
    ws.onmessage = (event) => {
      handleMessage(event.data as string);
    };

    ws.onerror = () => {
      connectingRef.current = false;
      setConnecting(false);
    };

    ws.onclose = async (event) => {
      // Token 热切换期间，旧连接被服务端踢下线时忽略此事件
      // （由热切换流程统一管理连接状态）
      if (isSwappingRef.current) {
        return;
      }

      setConnected(false);
      connectingRef.current = false;
      setConnecting(false);
      wsRef.current = null;

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      if (isDisconnectingRef.current) {
        return;
      }

      const isAuthError = event.code === 1008;
      const tooManyAttempts = reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS;

      if (isAuthError || tooManyAttempts) {
        console.warn('[WebSocket] 认证问题或重连次数过多，尝试刷新 token...');

        const success = await refreshToken();

        if (success) {
          reconnectAttemptsRef.current = 0;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectRef.current();
          }, TOKEN_REFRESH_RECONNECT_DELAY);
        } else {
          console.error('[WebSocket] Token 刷新失败，退出登录');
          clearSession();
        }
        return;
      }

      reconnectAttemptsRef.current++;
      const delay = getReconnectDelay();
      console.warn(`[WebSocket] 连接断开 (code=${event.code})，${(delay / 1000).toFixed(1)}s 后重连 (第 ${reconnectAttemptsRef.current} 次)`);

      // 连续多次重连失败 → 疑似当前 active 节点已下线：重连前先轮换到其他可达 IP（rediscoverOnFailure
      // 强制重发现并把死 IP 降级），让 App 在节点下线时自愈，不依赖发现池是否已摘掉死节点。轮换更新全局
      // mem.active 后，connect() 里 resolveForSecureHttp() 自然读到新 IP（HTTP 等其他数据面下次请求同步受益）。
      const shouldRotate = reconnectAttemptsRef.current >= ROTATE_AFTER_ATTEMPTS;

      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          void (async () => {
            try {
              if (shouldRotate) {
                const activeIp = getActiveEndpoint()?.ip;
                if (activeIp) {
                  await rediscoverOnFailure(activeIp);
                }
              }
            } finally {
              // 无论轮换成功/失败都继续重连（轮换是尽力而为；连不上时靠既有退避继续重试）
              connectRef.current();
            }
          })();
        }, delay);
      }
    };
  }, [handleMessage, refreshToken, clearSession, getReconnectDelay]);

  /** 启动 Ping + 入站活性看门狗定时器 */
  const startPing = useCallback((ws: RustWebSocket) => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    pingIntervalRef.current = setInterval(() => {
      if (ws.readyState !== RustWebSocket.OPEN) {
        return;
      }
      // 入站活性看门狗：服务端协议层 Ping 每 30s（ws_proxy 转发计入 lastActivityAt），
      // 超窗 = 半开连接（入站黑洞但 TCP 假活）。terminate 本地强制派发 onclose
      // （半开时对端不会回应 Close 帧，常规 close 的 onclose 永不触发）→ 走既有
      // 指数退避重连；置 halfOpenSyncPendingRef，重连成功后补一次增量 sync。
      if (Date.now() - ws.lastActivityAt > LIVENESS_TIMEOUT) {
        console.warn('[WebSocket] 入站活性超时（疑似半开连接），强制断开并重连');
        halfOpenSyncPendingRef.current = true;
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify({ type: 'ping' }));
    }, PING_INTERVAL);
  }, []);

  const connect = useCallback(() => {
    const token = tokenRef.current;
    const serverUrl = serverUrlRef.current;

    if (!token || !serverUrl) {
      return;
    }

    if (wsRef.current?.readyState === RustWebSocket.OPEN || connectingRef.current) {
      return;
    }

    isDisconnectingRef.current = false;
    connectingRef.current = true;
    setConnecting(true);

    const url = buildWsUrl(token, serverUrl);

    try {
      const ws = new RustWebSocket(url, resolveForSecureHttp() ?? { pin_ca: true }, { idleTimeoutSecs: WS_IDLE_TIMEOUT_SECS });
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        connectingRef.current = false;
        setConnecting(false);
        reconnectAttemptsRef.current = 0;

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        startPing(ws);

        // onReconnected 的触发由 wsHandlers 中 connected 消息的 resumed 字段决定
        // 这里仅在非首次连接 + 非 resumed 时触发（见 wsHandlers 中的处理）
        if (isFirstConnectRef.current) {
          isFirstConnectRef.current = false;
        }
      };

      installWsHandlers(ws);
    } catch (err) {
      console.error('[WebSocket] 连接失败:', err);
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [buildWsUrl, installWsHandlers, startPing]);

  // 保持 connectRef 与最新 connect 同步
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    isDisconnectingRef.current = true;
    isFirstConnectRef.current = true;
    isSwappingRef.current = false;
    connectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    halfOpenSyncPendingRef.current = false;

    // 清理 session recovery 状态（退出登录后不应恢复旧会话）
    sessionIdRef.current = null;
    lastEventSeqRef.current = 0;

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
    // 登出/账号切换：读位内存 Map 与离线暂存的 mark_read 同 unreadSummary 一起清，防跨账号串数据
    resetReadPositions();
    pendingMarkReadsRef.current.clear();
  }, []);

  // ============================================
  // 标记已读
  // ============================================

  const markRead = useCallback((targetType: 'friend' | 'group', targetId: string, seq?: number) => {
    if (wsRef.current?.readyState === RustWebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'mark_read',
        target_type: targetType,
        target_id: targetId,
      }));
    } else {
      // 离线/假活（真机熄屏、切网 socket 假活）：暂存而非静默丢弃，connected 后补发。
      // 服务端读位 GREATEST 单调合并，重发幂等无害。本地清零/advance 照旧立即做。
      pendingMarkReadsRef.current.set(`${targetType}:${targetId}`, { targetType, targetId });
    }

    // 持久化本地已读位置（带 seq 时推进到显式读位，消除与 updateConversationLastSeq 的顺序竞态），
    // 供重连时回传 resync_read_positions 修复抖断丢失的 mark_read。fire-and-forget，失败不影响已读流程。
    let convId: string | null = targetId; // group: 会话 id 即 group_id
    if (targetType === 'friend') {
      convId = userIdRef.current ? getFriendConversationId(userIdRef.current, targetId) : null;
    }
    if (convId) {
      void db.advanceConversationRead(convId, seq).catch(err =>
        console.error('[WS] 持久化本地已读位置失败:', err),
      );
    }

    setUnreadSummary(prev => (prev ? clearUnreadEntry(prev, targetType, targetId) : prev));
  }, []);

  // 保持 markReadRef 与最新 markRead 同步（供 handleMessage ctx 的 markActiveChatRead 使用）
  markReadRef.current = markRead;

  // sync 补刀：HTTP 增量同步给【当前打开的会话】落了新消息时，补一次 markRead（含 WS 帧 +
  // 本地清零 + advance 带最终 seq）。人停在会话里时 sync 上屏的消息不再"可见但红点挂死"。
  // 仅 activeChat，绝不全局标读；service 层经 setSyncedConversationListener 注入，不依赖 React。
  useEffect(() => {
    setSyncedConversationListener((conversationId, conversationType, latestSeq) => {
      const active = activeChatRef.current;
      if (!active || active.type !== conversationType) {
        return;
      }
      let activeConvId: string | null = active.id; // group: 会话 id 即 group_id
      if (active.type === 'friend') {
        activeConvId = userIdRef.current
          ? getFriendConversationId(userIdRef.current, active.id)
          : null;
      }
      if (activeConvId === conversationId) {
        markRead(active.type, active.id, latestSeq);
      }
    });
    return () => { setSyncedConversationListener(null); };
  }, [markRead]);

  // ============================================
  // 更新消息预览
  // ============================================

  const updateLastMessage = useCallback((
    targetType: 'friend' | 'group',
    targetId: string,
    preview: string,
    messageType: 'text' | 'image' | 'video' | 'file' | 'meeting_invite',
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
  // 刷新消息预览（删除/撤回后同步卡片显示）
  // ============================================

  const refreshLastMessagePreview = useCallback(async (
    targetType: 'friend' | 'group',
    targetId: string,
  ) => {
    try {
      const userId = userIdRef.current;
      const conversationId = targetType === 'friend'
        ? getFriendConversationId(userId ?? '', targetId)
        : targetId;
      await db.refreshConversationPreview(conversationId);
    } catch (err) {
      console.error('[WS] 刷新消息预览失败:', err);
    }
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

  const onReadSync = useCallback((callback: (msg: WsReadSync) => void) => {
    readSyncListeners.current.add(callback);
    return () => { readSyncListeners.current.delete(callback); };
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
      // 预载读位内存 Map（connected 同步纠正的判定源）。此刻本地 db 可能尚未初始化：
      // 失败静默跳过，首个 connected 的两段式兜底路径（applyConnectedReadCorrection）会再灌入。
      void db.getConversations().then(seedReadPositions).catch(() => {});
      connect();
    } else {
      disconnect();
    }
    return () => { disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session]); // 只依赖 session 是否存在，不依赖具体值

  // Token 变化时执行热切换（make-before-break）
  // 旧 token 在过期前 5 分钟刷新，此时旧 token 仍有效约 5 分钟，
  // 利用这个重叠窗口用新 token 先建新连接，成功后再断旧连接，实现零断连。
  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const oldWs = wsRef.current;
    if (!oldWs || oldWs.readyState !== RustWebSocket.OPEN) {
      return;
    }

    if (isSwappingRef.current) {
      return;
    }

    const token = tokenRef.current;
    const serverUrl = serverUrlRef.current;
    if (!token || !serverUrl) {
      return;
    }

    isSwappingRef.current = true;
    console.warn('[WebSocket] Token 已刷新，执行热切换...');

    const url = buildWsUrl(token, serverUrl);

    try {
      const newWs = new RustWebSocket(url, resolveForSecureHttp() ?? { pin_ca: true }, { idleTimeoutSecs: WS_IDLE_TIMEOUT_SECS });

      newWs.onopen = () => {
        // 1. 解除旧连接所有 handler（防止后续事件干扰）
        oldWs.onclose = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;

        // 2. 关闭旧连接 + 清理旧 ping
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        oldWs.close(1000, 'Token refreshed');

        // 3. 安装新连接（标记为首次连接，跳过 resumed=false 触发的同步）
        wsRef.current = newWs;
        isFirstConnectRef.current = true;
        installWsHandlers(newWs);
        startPing(newWs);

        // 4. 确保连接状态正确（防止竞态：旧 onclose 可能已触发 setConnected(false)）
        setConnected(true);
        connectingRef.current = false;
        setConnecting(false);
        reconnectAttemptsRef.current = 0;

        // 5. 清除可能由竞态产生的重连定时器
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        isSwappingRef.current = false;
        console.warn('[WebSocket] Token 热切换完成');
      };

      newWs.onerror = () => {
        isSwappingRef.current = false;
        newWs.close();

        // 如果旧连接已被服务端关闭（竞态），需要执行完整重连
        if (oldWs.readyState !== RustWebSocket.OPEN) {
          console.warn('[WebSocket] Token 热切换失败且旧连接已断开，执行重连');
          wsRef.current = null;
          setConnected(false);
          connectRef.current();
        } else {
          console.warn('[WebSocket] Token 热切换失败，保持旧连接');
        }
      };
    } catch {
      isSwappingRef.current = false;
    }
  }, [session?.accessToken, buildWsUrl, installWsHandlers, startPing]);

  const contextValue = useMemo<WebSocketContextType>(() => ({
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
    refreshLastMessagePreview,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
    onReadSync,
    onReconnected,
  }), [
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
    refreshLastMessagePreview,
    onNewMessage,
    onMessageRecalled,
    onSystemNotification,
    onReadSync,
    onReconnected,
  ]);

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
