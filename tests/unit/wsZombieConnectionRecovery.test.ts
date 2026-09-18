/**
 * WS 僵尸连接（绿点假活）恢复单元测试
 *
 * 与 wsLivenessWatchdog.test.ts（transport 层半开看门狗组件级测试）同构互补，
 * 覆盖绿点假活修复的三条新路径（块 1789679152008-mi8hug16-1）：
 * 1. 服务端踢出/会话顶替帧 → 显式处理（isKickServerFrame 判定 + handleWebSocketMessage
 *    置 result.kicked → Context terminate 走既有重连链的触发信号）；
 * 2. 双层活性裁决 evaluateLiveness：transport-stale（半开）与 app-silent（协议层心跳仍在
 *    流但推送路由被服务端顶替/摘除 = 绿点假活），healthy 不误杀；
 * 3. 前台/网络恢复决策 decideForegroundAction：活性异常 → terminate（重连+补偿增量 sync）、
 *    新鲜 → probe、连接丢失且无重连排队 → connect、重连在途 → noop。
 *
 * 被测对象均为纯函数 / 帧分发（真实 handleWebSocketMessage + 最小 ctx 桩），
 * mock 仅限外部边界（db / notificationService / tauri event）。
 */

import { describe, it, expect, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  markMessageRecalled: vi.fn().mockResolvedValue(undefined),
  markMessageDeleted: vi.fn().mockResolvedValue(undefined),
  refreshConversationPreview: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);

const notifMock = vi.hoisted(() => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/notificationService', () => notifMock);

const eventMock = vi.hoisted(() => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => eventMock);

import { handleWebSocketMessage, isKickServerFrame } from '../../src/contexts/wsHandlers';
import type { MessageHandlerContext } from '../../src/contexts/wsHandlers';
import type { WsMessageRecalled, WsNewMessage, WsSystemNotification } from '../../src/types/websocket';
// 纯函数从 WebSocketContext 导入：该模块 import 链重（SessionContext/tauri/discovery/db…），
// 全部边界 mock 掉后仅做模块级求值，不渲染组件、不建连。
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: vi.fn(() => ({ session: null, api: {}, clearSession: vi.fn() })),
  useApi: vi.fn(() => ({})),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock('../../src/remote-control/devGate', () => ({ isRemoteControlEnabled: vi.fn(() => false) }));
vi.mock('../../src/remote-control/wsSender', () => ({ registerControlSessionWsSender: vi.fn() }));
vi.mock('../../src/services/rustWebSocket', async (importOriginal) => {
  // 保留真实模块：evaluateLiveness 的常量阈值与 RustWebSocket 静态字段（readyState 判定）是真实实现
  const actual = await importOriginal<typeof import('../../src/services/rustWebSocket')>();
  return actual;
});
vi.mock('../../src/services/discovery', () => ({
  resolveForSecureHttp: vi.fn(() => null),
  rediscoverOnFailure: vi.fn(),
  getActiveEndpoint: vi.fn(() => null),
}));
vi.mock('../../src/services/syncService', () => ({ setSyncedConversationListener: vi.fn() }));

import {
  evaluateLiveness,
  decideForegroundAction,
} from '../../src/contexts/WebSocketContext';

function makeCtx() {
  return {
    activeChatRef: { current: null as { type: 'friend' | 'group'; id: string } | null },
    currentUserId: 'me' as string | null,
    setUnreadSummary: vi.fn(),
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set<(msg: WsNewMessage) => void>() },
    recalledListeners: { current: new Set<(msg: WsMessageRecalled) => void>() },
    notificationListeners: { current: new Set<(msg: WsSystemNotification) => void>() },
    readSyncListeners: { current: new Set() },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  };
}

function dispatch(frame: unknown, ctx: ReturnType<typeof makeCtx>) {
  return handleWebSocketMessage(JSON.stringify(frame), ctx as unknown as MessageHandlerContext);
}

// ============================================================================
// ① 踢出/会话顶替帧显式处理（isKickServerFrame + result.kicked 触发信号）
// ============================================================================

describe('isKickServerFrame — 踢出/顶替语义判定（纯函数）', () => {
  it('kick 语义 code 命中', () => {
    expect(isKickServerFrame('kicked', '')).toBe(true);
    expect(isKickServerFrame('session_kicked', 'session replaced')).toBe(true);
  });

  it('session_replaced / force_logout 语义命中（code 或 message 任一）', () => {
    expect(isKickServerFrame('session_replaced', undefined)).toBe(true);
    expect(isKickServerFrame(undefined, '会话已被顶替 session_replaced')).toBe(true);
    expect(isKickServerFrame('force_logout', undefined)).toBe(true);
    expect(isKickServerFrame(undefined, 'You were kicked by another device')).toBe(true);
  });

  it('普通业务 error 不误判', () => {
    expect(isKickServerFrame('invalid_message', 'Failed to parse message')).toBe(false);
    expect(isKickServerFrame('invalid_group_id', 'Invalid group ID format')).toBe(false);
    expect(isKickServerFrame('E1', 'boom')).toBe(false);
    expect(isKickServerFrame(undefined, undefined)).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isKickServerFrame('KICKED', undefined)).toBe(true);
    expect(isKickServerFrame('Session_Replaced', undefined)).toBe(true);
  });
});

describe('handleWebSocketMessage — error 帧的 kicked 触发信号', () => {
  it('踢出语义 error 帧 → result.kicked=true（Context 据此 terminate+重连）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const result = dispatch({ type: 'error', code: 'session_replaced', message: '会话已被顶替' }, ctx);
      expect(result?.kicked).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('踢出/会话顶替'));
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('普通 error 帧 → 不置 kicked（既有契约保持：仅 eventSeq + console.error）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const result = dispatch({ type: 'error', code: 'invalid_message', message: 'boom', event_seq: 7 }, ctx);
      expect(result).toEqual({ eventSeq: 7 });
      expect(result?.kicked).toBeUndefined();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('heartbeat 帧零副作用（应用层活性基线的帧源之一，不被误判）', () => {
    const ctx = makeCtx();
    const result = dispatch({ type: 'heartbeat', timestamp: '2026-09-17T00:00:00Z', event_seq: 3 }, ctx);
    expect(result?.kicked).toBeUndefined();
    expect(result?.eventSeq).toBe(3);
  });
});

// ============================================================================
// ② 双层活性裁决 evaluateLiveness（看门狗断环修复点回归）
// ============================================================================

describe('evaluateLiveness — 双层活性裁决', () => {
  const NOW = 1_000_000;

  it('transport-stale：无任何入站帧（含协议层心跳）超 LIVENESS_TIMEOUT → 判死', () => {
    // 协议层 Ping 30s 一发；70s 阈值 + 1ms 无入站 → transport-stale
    expect(evaluateLiveness(NOW, NOW - 70_001, NOW - 1_000)).toBe('transport-stale');
  });

  it('app-silent：协议层心跳仍新鲜但应用层帧静默超窗（被顶替/路由摘除的假活特征）', () => {
    // lastActivityAt 每 30s 刷新（协议层 Ping 仍在流），但应用层帧 75s+ 没有 → 路由已死
    expect(evaluateLiveness(NOW, NOW - 30_000, NOW - 75_001)).toBe('app-silent');
  });

  it('healthy：两层都新鲜不误杀（安静但健康的空闲连接）', () => {
    expect(evaluateLiveness(NOW, NOW - 29_000, NOW - 25_000)).toBe('healthy');
  });

  it('healthy：应用层静默未超窗（紧贴阈值内）', () => {
    expect(evaluateLiveness(NOW, NOW - 31_000, NOW - 75_000)).toBe('healthy');
  });

  it('lastAppFrameAt=0（未基线化）不判 app-silent，交给 transport 层裁决', () => {
    expect(evaluateLiveness(NOW, NOW - 1_000, 0)).toBe('healthy');
    expect(evaluateLiveness(NOW, NOW - 70_001, 0)).toBe('transport-stale');
  });

  it('transport-stale 优先于 app-silent（真死连直接判死）', () => {
    expect(evaluateLiveness(NOW, NOW - 80_000, NOW - 90_000)).toBe('transport-stale');
  });
});

// ============================================================================
// ③ 前台/网络恢复决策 decideForegroundAction
// ============================================================================

describe('decideForegroundAction — 前台/网络恢复校验决策', () => {
  const base = {
    hasSession: true,
    socketOpen: true,
    verdict: 'healthy' as ReturnType<typeof evaluateLiveness> | null,
    connecting: false,
    reconnectScheduled: false,
  };

  it('连接打开 + 活性异常（transport-stale）→ terminate（走重连+补偿增量 sync）', () => {
    expect(decideForegroundAction({ ...base, verdict: 'transport-stale' })).toBe('terminate');
  });

  it('连接打开 + 活性异常（app-silent，被顶替假活）→ terminate', () => {
    expect(decideForegroundAction({ ...base, verdict: 'app-silent' })).toBe('terminate');
  });

  it('连接打开 + 看起来新鲜 → probe（立即补发应用层 ping 探测路由活性）', () => {
    expect(decideForegroundAction({ ...base, verdict: 'healthy' })).toBe('probe');
  });

  it('连接未打开 + 无重连在途/排队 → connect（后台冻结定时器丢失兜底，不依赖重登）', () => {
    expect(decideForegroundAction({ ...base, socketOpen: false, verdict: null })).toBe('connect');
  });

  it('连接未打开但重连已在途/排队 → noop（不重复建连）', () => {
    expect(decideForegroundAction({ ...base, socketOpen: false, verdict: null, connecting: true })).toBe('noop');
    expect(decideForegroundAction({ ...base, socketOpen: false, verdict: null, reconnectScheduled: true })).toBe('noop');
  });

  it('无会话 → noop（未登录不触发任何连接动作）', () => {
    expect(decideForegroundAction({ ...base, hasSession: false })).toBe('noop');
  });
});
