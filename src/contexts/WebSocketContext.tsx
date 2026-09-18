/**
 * WebSocket Context
 *
 * 提供 WebSocket 实时通信功能：
 * - 连接管理（自动连接、断线重连、会话恢复）
 * - Token 刷新不重建主连（主连稳定保持；token 只在 WS 握手时校验，established 后不复验）
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
 * - 主动刷新：SessionContext 在 JWT 过期前 5 分钟自动刷新（只更新 tokenRef，供下次建连用）
 * - 主连不因 token 刷新而重建：WS 只在握手 URL 里校验 token，established 后服务端不复验
 *   （client_timeout=86400s 是入站空闲上限，不是 token 过期回收），故 token 刷新时**保持主连不动**。
 *   —— 旧版「热切换 make-before-break」（token 变化即并行新开一条 WS、成功后 close 旧连）已删除：
 *   它每次刷新都新建连接抢占主连 → 服务端反复 register→13ms 内 Client close 的闪断；且新连携旧
 *   session_id resume 又必失败（旧 session 仍活，服务端拒绝 resume），实时推送落到 0 个活连接。
 * - 断线重连用最新 tokenRef 建连；旧连已 unregister → resume 可真正复用（半开窗口内重放）
 *   或退化为增量 sync（resumed=false → onReconnected）。
 * - 被动刷新：关闭码 1008 或重连失败 ≥ MAX_RECONNECT_ATTEMPTS 次时触发
 * - 刷新失败则退出登录，避免无限循环
 *
 * 重连策略：
 * - 指数退避：1s → 2s → 4s → 8s → 16s → 最大 30s
 * - 抖动：叠加随机延迟防止雷群效应（服务重启后所有客户端同时重连）
 *
 * 半开检测（假活防护，双层判据 evaluateLiveness）：
 * - 服务端心跳 = WS 协议层 Ping（每 30s，ws_proxy 转发为活性信号）
 * - transport 层：超 LIVENESS_TIMEOUT 无任何入站帧 → 判半开 → terminate 本地
 *   强制 onclose → 走既有指数退避重连
 * - 应用层：超 APP_FRAME_SILENCE_TIMEOUT 无应用层帧（含 ping→heartbeat 应答）→ 判
 *   「推送路由被服务端顶替/摘除」型假活（协议层心跳仍在流但推送永绝，绿点常亮）
 * - Rust 层 idle_timeout_secs 兜底回收半开 reader；ws_connect 带 15s 建连超时
 * - 重连成功后强制补一次增量 sync（halfOpenSyncPendingRef），不依赖 resumed 重放
 *
 * 踢出/会话顶替帧显式处理：服务端 error 帧带 kick/session_replaced/force_logout 语义
 * （isKickServerFrame，语义参照 meeting 侧 kicked）→ 立即 terminate 走既有重连链，
 * 不再绿点常亮等用户重登。
 *
 * 前台/网络恢复活性校验：visibilitychange→visible / window online → checkLiveness →
 * 活性异常则 terminate 重连（重连后增量补拉），连接丢失且无重连排队则立即建连，
 * 断流期间漏收的消息不依赖重新登录即可拉回。
 *
 * 连接世代隔离（跨连接生命周期污染防护）：
 * - connect() 每次真正建连时递增「连接世代」，并把该世代**捕获进这条连接的全部回调闭包**；
 *   disconnect() 递增世代以作废当前连接
 * - onopen / onclose / 入站帧只在「自己的世代 === 当前世代」时生效；陈旧世代的事件一律忽略并 warn
 * - 取代旧的粘滞布尔 isDisconnectingRef：布尔既表达不了「这条 close/帧属于哪一次连接生命周期」
 *   （上一代连接迟到的 close 会清掉新连接的 wsRef/connected/ping 并凭空再排一次重连 → 并存双连接），
 *   又会在「disconnect() 置位后 connect() 撞上任一 early return」时永久卡死（此后不重连、丢弃所有
 *   入站帧且零日志）。世代计数无粘滞状态：early return 不改动任何世代，故不污染后续任何一次连接。
 *   陈旧事件必须留日志——静默吞掉本身就是缺陷（故障期零日志 = 无法定位）。
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
import { invoke as rcDbgInvoke } from '@tauri-apps/api/core';
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
import { isRemoteControlEnabled } from '../remote-control/devGate';
import { registerControlSessionWsSender } from '../remote-control/wsSender';

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
/** 应用层帧静默超时（毫秒）：看门狗每 PING_INTERVAL 发一次应用层 ping，服务端经连接路由表
 *  查到本连接后回 heartbeat 应答；而协议层 Ping/Pong 由连接处理任务直发、不经路由表。
 *  服务端同账号同设备重复建连时静默摘除旧连接的路由条目（不发任何踢出帧/Close）→ 协议层
 *  心跳仍在流而应用层帧永绝：单看 lastActivityAt 会假活（绿点），须叠加应用层静默判据。
 *  超 3 个 ping 周期无任何应用层入站帧 = 路由已死，判死重连。 */
const APP_FRAME_SILENCE_TIMEOUT = 75000;

/** 入站活性裁决结果 */
export type LivenessVerdict = 'healthy' | 'transport-stale' | 'app-silent';

/**
 * 入站活性裁决（纯函数，便于单测）。
 * - transport-stale：连协议层心跳都断了（真正半开/网络死），lastActivityAt 不再刷新；
 * - app-silent：协议层心跳仍在流（lastActivityAt 新鲜）但应用层帧静默超窗 —— 连接被服务端
 *   顶替/摘除路由的特征（推送与 heartbeat 应答都经路由表，摘除后永绝），即「绿点假活」；
 * - healthy：两层都新鲜。
 * lastAppFrameAt <= 0 表示本连接尚未收到过任何应用层帧（onopen 时已基线化，正常不出现；
 * 防御上不判 app-silent，交给 transport-stale 分支）。
 */
export function evaluateLiveness(now: number, lastActivityAt: number, lastAppFrameAt: number): LivenessVerdict {
  if (now - lastActivityAt > LIVENESS_TIMEOUT) { return 'transport-stale'; }
  if (lastAppFrameAt > 0 && now - lastAppFrameAt > APP_FRAME_SILENCE_TIMEOUT) { return 'app-silent'; }
  return 'healthy';
}

/** 前台/网络恢复校验的决策动作 */
export type ForegroundAction = 'terminate' | 'probe' | 'connect' | 'noop';

/**
 * 前台恢复/网络恢复时的决策（纯函数，便于单测）。
 * - terminate：连接打开但活性裁决异常 → 强制断开走既有重连链（重连后补偿增量 sync）；
 * - probe：连接打开且看起来新鲜 → 立即补发应用层 ping 探测（路由被摘则无应答，
 *   看门狗按 APP_FRAME_SILENCE_TIMEOUT 判死），不等下个周期；
 * - connect：连接未打开且无重连在途/排队（后台冻结期定时器丢失等）→ 立即建连；
 * - noop：重连已在途，或无会话。
 */
export function decideForegroundAction(opts: {
  hasSession: boolean;
  socketOpen: boolean;
  verdict: LivenessVerdict | null;
  connecting: boolean;
  reconnectScheduled: boolean;
}): ForegroundAction {
  if (!opts.hasSession) { return 'noop'; }
  if (opts.socketOpen) {
    return opts.verdict && opts.verdict !== 'healthy' ? 'terminate' : 'probe';
  }
  if (!opts.connecting && !opts.reconnectScheduled) { return 'connect'; }
  return 'noop';
}
/** Rust 层入站空闲超时（秒）：3 个心跳周期，兜底回收半开连接的读任务并上抛 Error
 *  （覆盖 JS 看门狗 terminate 后残留的 Rust reader，以及 webview 假死等 JS 层失能场景） */
const WS_IDLE_TIMEOUT_SECS = 90;
/** 被动刷新后重连延迟（毫秒）：onclose 遇 1008/重连超限 → refreshToken 成功后隔此延迟再建连 */
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
  /** 把一条与 WS new_message 同形的**本地**帧送进同一个监听器集合（转发写穿用，见 chat/shared/forwardEcho.ts）。
   *  只分发到 newMessageListeners，不碰 unreadSummary / DB —— 那两跳由调用方按需另行处理。 */
  emitLocalNewMessage: (msg: WsNewMessage) => void;
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
  /**
   * 连接世代计数器（取代粘滞布尔 isDisconnectingRef，见文件头「连接世代隔离」）：
   * connect() 真正建连时递增并把世代捕获进该连接的回调闭包；disconnect() 递增以作废当前连接。
   * 事件消费点比较「我的世代 === 当前世代」，只有当前世代的事件才作用于共享状态。
   */
  const connectionGenRef = useRef(0);
  /** 是否是首次连接（用于区分首次连接和重连） */
  const isFirstConnectRef = useRef(true);
  /** 是否正在刷新 token（防止重复刷新） */
  const isRefreshingTokenRef = useRef(false);
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
  /** 最近一次收到【应用层】入站帧（text，含 heartbeat 应答/connected/业务帧）的时刻。
   *  协议层 Ping 不计（不经路由表，会话被顶替/路由摘除后仍在流，判不了假活）。
   *  0 = 未基线化（onopen 时基线化，防跨连接旧值误判）。 */
  const lastAppFrameAtRef = useRef(0);

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

  const handleMessage = useCallback((data: string, generation: number) => {
    // 陈旧世代（已被新连接取代 / 已主动断开）的在途帧不得当作当前连接的帧处理，
    // 否则会把旧连接的 session_id / event_seq / 未读快照灌进当前连接的状态。绝不静默丢弃。
    if (generation !== connectionGenRef.current) {
      console.warn(
        `[WebSocket] 丢弃陈旧连接的入站帧（该帧属第 ${generation} 代连接，当前第 ${connectionGenRef.current} 代）`,
      );
      return;
    }

    // 应用层入站帧活性基线（所有 text 帧都经服务端路由表投递，含 heartbeat 应答）。
    // 这是「会话被顶替/路由摘除」假活状态的唯一可观测信号（协议层 Ping 不经路由表，会照常流）。
    lastAppFrameAtRef.current = Date.now();

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

    // 服务端踢出/会话顶替帧：显式处理（此前 chat 侧无任何处理=服务端已停推流而绿点常亮，
    // 只能重登恢复）。立即断开当前连接走既有重连链：重连→重新 register 恢复推送路由→
    // connected 帧→halfOpenSyncPendingRef 补偿增量 sync，漏收段不丢、不依赖重新登录。
    if (result.kicked && wsRef.current && generation === connectionGenRef.current) {
      console.warn('[WebSocket] 服务端踢出/会话顶替：主动断开当前连接并重连（恢复推送路由）');
      halfOpenSyncPendingRef.current = true;
      wsRef.current.terminate();
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
  const installWsHandlers = useCallback((ws: RustWebSocket, generation: number) => {
    ws.onmessage = (event) => {
      handleMessage(event.data as string, generation);
    };

    ws.onerror = () => {
      // 陈旧连接的 error 不得清掉【当前】连接的建连中状态
      if (generation !== connectionGenRef.current) {
        return;
      }
      connectingRef.current = false;
      setConnecting(false);
    };

    ws.onclose = async (event) => {
      void rcDbgInvoke('rc_debug_marker', { marker: `DBG7-ws-onclose code=${String(event.code)} gen=${String(generation)}` }).catch(() => undefined);
      // 世代不匹配 = 这条 close 属于已被取代 / 已主动断开的连接。必须在改动任何共享状态
      //（wsRef / connected / connecting / ping 定时器）之前返回：否则上一代迟到的 close 会把
      // 当前连接连根拔掉（wsRef 置空 + 停 ping）并再排一次退避重连 → 并存双连接。
      // 生产可达：RustWebSocket.close() 只置 CLOSING + fire-and-forget ws_close，不置终态，
      // 服务端的 close 事件与在途帧稍后仍会经 Channel 投递回来。
      if (generation !== connectionGenRef.current) {
        console.warn(
          `[WebSocket] 忽略陈旧连接的关闭事件 (code=${event.code}，属第 ${generation} 代连接，当前第 ${connectionGenRef.current} 代)，不重连`,
        );
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
      // 入站活性看门狗（双层判据，evaluateLiveness 纯函数）：
      // - transport-stale：连协议层 Ping 都断了（服务端心跳 30s 一发、ws_proxy 转发计入
      //   lastActivityAt），超窗 = 半开连接（入站黑洞但 TCP 假活）；
      // - app-silent：协议层心跳仍在流但应用层帧（含 ping→heartbeat 应答）静默超窗 =
      //   连接路由被服务端顶替/摘除（推送不经路由表永绝），即「绿点假活」的真正信号。
      // 任一命中：terminate 本地强制派发 onclose（半开时对端不会回应 Close 帧，常规 close
      // 的 onclose 永不触发）→ 走既有指数退避重连；置 halfOpenSyncPendingRef，重连成功后
      // 补一次增量 sync（漏收段按 seq 对账拉回，不依赖重新登录）。
      const verdict = evaluateLiveness(Date.now(), ws.lastActivityAt, lastAppFrameAtRef.current);
      if (verdict !== 'healthy') {
        console.warn(
          `[WebSocket] 入站活性超时（${verdict === 'transport-stale' ? '无任何入站帧' : '无应用层入站帧，疑似会话被顶替/推送路由摘除'}），强制断开并重连`,
        );
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

    // 递增连接世代并捕获进本次连接的所有回调闭包。放在两处 early return 之后：
    // early return 不改动任何世代 ⇒ 不会留下影响后续连接的粘滞状态（旧粘滞布尔正是卡死在这里）。
    const generation = ++connectionGenRef.current;
    connectingRef.current = true;
    setConnecting(true);

    const url = buildWsUrl(token, serverUrl);

    try {
      const ws = new RustWebSocket(url, resolveForSecureHttp() ?? { pin_ca: true }, { idleTimeoutSecs: WS_IDLE_TIMEOUT_SECS });
      wsRef.current = ws;

      ws.onopen = () => {
        // 建连返回前本连接已被取代/主动断开（disconnect 时 wsRef 可能已不指向它，故它没被关掉）：
        // 不得据此宣告 connected、更不得用它抢占 pingIntervalRef；直接关掉，避免留下无人引用的活连接。
        if (generation !== connectionGenRef.current) {
          console.warn(
            `[WebSocket] 忽略陈旧连接的建立成功事件（属第 ${generation} 代连接，当前第 ${connectionGenRef.current} 代），关闭之`,
          );
          ws.close();
          return;
        }

        setConnected(true);
        connectingRef.current = false;
        setConnecting(false);
        reconnectAttemptsRef.current = 0;
        // 应用层帧活性基线：从本连接建立时刻起算，防跨连接旧值在首个看门狗 tick 误判
        lastAppFrameAtRef.current = Date.now();

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        startPing(ws);

        // 会议内远程控制（设计 §8.3 块 C；正式功能入口——缺口修复前仅 dev 门控，
        // 常规构建无上行通道）：向控制域注册主 WS 发送器，供 M1/M2/M3 上行。
        if (isRemoteControlEnabled()) {
          registerControlSessionWsSender((payload) => {
            if (wsRef.current?.readyState === RustWebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(payload));
              void rcDbgInvoke('rc_debug_marker', { marker: `DBG6-ws-sent type=${String((payload as { type?: string }).type)} state=${String(wsRef.current?.readyState)}` }).catch(() => undefined);
            } else {
              void rcDbgInvoke('rc_debug_marker', { marker: `DBG5-ws-not-open state=${String(wsRef.current?.readyState)}` }).catch(() => undefined);
            }
          });
        }

        // onReconnected 的触发由 wsHandlers 中 connected 消息的 resumed 字段决定
        // 这里仅在非首次连接 + 非 resumed 时触发（见 wsHandlers 中的处理）
        if (isFirstConnectRef.current) {
          isFirstConnectRef.current = false;
        }
      };

      installWsHandlers(ws, generation);
    } catch (err) {
      console.error('[WebSocket] 连接失败:', err);
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [buildWsUrl, installWsHandlers, startPing]);

  // 保持 connectRef 与最新 connect 同步
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    // 递增世代作废「到此刻为止的」连接：它们之后到达的 onclose / 入站帧一律属陈旧世代
    // → 不重连、不处理（主动断开仍然不触发重连，语义与旧实现一致）。
    // 与旧粘滞布尔的区别：这里只作废已存在的连接，不给后续的 connect() 留下任何需要被"复位"的状态。
    connectionGenRef.current++;
    isFirstConnectRef.current = true;
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

    // 会议内远程控制（正式功能入口）：注销控制域主 WS 发送器
    if (isRemoteControlEnabled()) {
      registerControlSessionWsSender(null);
    }

    setConnected(false);
    setConnecting(false);
    setUnreadSummary(null);
    // 登出/账号切换：读位内存 Map 与离线暂存的 mark_read 同 unreadSummary 一起清，防跨账号串数据
    resetReadPositions();
    pendingMarkReadsRef.current.clear();
    lastAppFrameAtRef.current = 0;
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
  // 前台恢复/网络恢复 → 活性校验 + 漏报增量补拉
  // ============================================

  /**
   * 前台/网络恢复时的连接活性校验（decideForegroundAction 纯函数决策）。
   * - 连接打开且活性异常（transport-stale / app-silent）→ terminate 走既有重连链：
   *   重连 → 重新 register 恢复推送路由 → connected 帧 → halfOpenSyncPendingRef →
   *   onReconnected → useInitialSync 增量补拉断流期间漏收的消息（不依赖重新登录）；
   * - 连接打开且看起来新鲜 → 立即补发应用层 ping 探测（路由被摘则无 heartbeat 应答，
   *   看门狗按 APP_FRAME_SILENCE_TIMEOUT 判死），不等下个周期；
   * - 连接未打开且无重连在途/排队（后台冻结期定时器丢失等）→ 立即建连。
   */
  const checkLiveness = useCallback((source: string) => {
    if (!tokenRef.current || !serverUrlRef.current) {
      return;
    }
    const ws = wsRef.current;
    const socketOpen = !!ws && ws.readyState === RustWebSocket.OPEN;
    const verdict = socketOpen
      ? evaluateLiveness(Date.now(), ws.lastActivityAt, lastAppFrameAtRef.current)
      : null;
    const action = decideForegroundAction({
      hasSession: true,
      socketOpen,
      verdict,
      connecting: connectingRef.current,
      reconnectScheduled: reconnectTimerRef.current !== null,
    });
    if (action === 'terminate' && ws) {
      console.warn(
        `[WebSocket] 前台/网络恢复活性校验（${source}）：连接异常（${verdict}），强制断开并重连（重连后增量补拉）`,
      );
      halfOpenSyncPendingRef.current = true;
      ws.terminate();
      return;
    }
    if (action === 'probe' && ws) {
      ws.send(JSON.stringify({ type: 'ping' }));
      return;
    }
    if (action === 'connect') {
      console.warn(`[WebSocket] 前台/网络恢复校验（${source}）：连接未建立且无重连排队，立即建连`);
      connectRef.current();
    }
  }, []);

  // 切后台（熚屏/切应用）期间 WebView 定时器可能被冻结，半开/被顶替的连接无人裁决；
  // 回前台（visibilitychange→visible）或网络恢复（window online）时立即校验连接活性
  // 并走既有重连+增量补拉链，把「断流期间漏收的消息」拉回，不再依赖用户重新登录。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkLiveness('visibilitychange-visible');
      }
    };
    const onOnline = () => { checkLiveness('window-online'); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [checkLiveness]);

  // ============================================
  // 事件订阅
  // ============================================

  const onNewMessage = useCallback((callback: (msg: WsNewMessage) => void) => {
    newMessageListeners.current.add(callback);
    return () => { newMessageListeners.current.delete(callback); };
  }, []);

  /** 转发写穿：本机发出的消息不会有 WS 回显（后端只推接收方 + 发送者其他设备），
   *  由转发路径构造本地帧走这里，让打开中的目标会话消息流即时上屏。 */
  const emitLocalNewMessage = useCallback((msg: WsNewMessage) => {
    newMessageListeners.current.forEach(cb => cb(msg));
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

  // Token 刷新时【不】重建主连（旧「热切换 make-before-break」已删除）。
  //
  // 根因（0信任服务端日志实证）：旧热切换在每次 token 主动刷新（≈每 10min，JWT 15min 期 -5min）时
  // 用新 token 并行新开一条 WS 抢占主连、成功后 close 旧连。真机上这条 make-before-break 反而让
  // 主连长期不稳：服务端反复 register→13ms 内收到 Client close→unregister（闪断），且新连携带旧
  // session_id 走 resume 又必失败（旧 session 仍活，服务端拒绝对活跃 session 的 resume），最终
  // 任一时刻都没有活的 socket → bot 卡片/消息等实时推送落到 0 个活连接，只能手动切会话经 REST 拉。
  //
  // 修复：token 只在 WS 握手 URL 里校验，established 后服务端不复验 token 有效期
  //（client_timeout=86400s 是入站空闲上限）。所以 token 刷新只需更新 tokenRef（见上「保持 Refs 与
  // Session 同步」effect），主连保持不动即可持续收推送。真正断线时才由既有 onclose→重连路径用最新
  // tokenRef 建连，此时旧连已 unregister → resume 能真正复用（半开窗口内重放）或退化增量 sync。

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
    emitLocalNewMessage,
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
    emitLocalNewMessage,
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
