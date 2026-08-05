/**
 * handleWebSocketMessage — 帧类型分发副作用契约测试
 *
 * 锁定「20+ 帧类型分发的逐类型副作用契约」：此前仅 connected / new_message / read_sync
 * 有真 handler 驱动的测试（wsNotifySuppress / 各 connected 纠正测试），本文件补全其余
 * 无分发层测试的类型：
 *  - message_recalled（friend/group 的 conversationId 规则 + listener 分发 + DB 副作用）
 *  - message_deleted（DB 副作用 + 不惊动 recalled/notification listeners）
 *  - system_notification（计数器 updater 语义 + NOTIFIABLE_TYPES 通知门 + listener 分发解耦）
 *  - presence_update（写 chatStore.friendPresence，含覆盖更新）
 *  - heartbeat / error（仅回 eventSeq，零 DB/通知副作用）
 *  - 4 个 hg_*（no-op 契约：仅冒泡 Rust，前端零副作用、零跨窗广播）
 *  - hg_device_status_changed（跨窗广播契约：emit('hg:device-status-changed', {device_id,status})
 *    给独立的 HuanvaeGuard 窗口，其余副作用仍为零）
 *  - 非法 JSON → 返回 null
 *
 * 全部帧经 JSON.stringify 投给真实 handleWebSocketMessage；mock 仅限外部边界
 * （db / notificationService），chatStore 用真实 store。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// hg_device_status_changed 需要跨 Tauri 窗口广播给独立的 HuanvaeGuard 窗口。
// vi.mock 工厂被提升到 import 之前，引用外层变量必须走 vi.hoisted。
const eventMock = vi.hoisted(() => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => eventMock);

import { handleWebSocketMessage } from '../../src/contexts/wsHandlers';
import type { MessageHandlerContext } from '../../src/contexts/wsHandlers';
import type {
  WsMessageRecalled,
  WsNewMessage,
  WsReadSync,
  WsSystemNotification,
} from '../../src/types/websocket';
import { useChatStore } from '../../src/stores/chatStore';
import { getFriendConversationId } from '../../src/utils/conversationId';

function makeCtx() {
  return {
    activeChatRef: { current: null as { type: 'friend' | 'group'; id: string } | null },
    currentUserId: 'me' as string | null,
    setUnreadSummary: vi.fn(),
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: new Set<(msg: WsNewMessage) => void>() },
    recalledListeners: { current: new Set<(msg: WsMessageRecalled) => void>() },
    notificationListeners: { current: new Set<(msg: WsSystemNotification) => void>() },
    readSyncListeners: { current: new Set<(msg: WsReadSync) => void>() },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  };
}
type Ctx = ReturnType<typeof makeCtx>;

function dispatch(frame: unknown, ctx: Ctx) {
  const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
  return handleWebSocketMessage(data, ctx as unknown as MessageHandlerContext);
}

/** 冲刷 markMessageRecalled/markMessageDeleted 的 .then(async ...) 微任务链 */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type PendingCounts = { friendRequests: number; groupInvites: number; groupJoinRequests: number };

describe('handleWebSocketMessage — 帧类型分发副作用契约', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach((fn) => fn.mockClear());
    Object.values(notifMock).forEach((fn) => fn.mockClear());
    eventMock.emit.mockClear();
    useChatStore.setState({
      friendPresence: {},
      groupMessageBlocks: {},
      friendBlacklistTimes: {},
      groupSpecialCares: {},
      friends: [],
    });
  });

  // ==========================================
  // message_recalled
  // ==========================================

  it('message_recalled（friend）: 标记撤回 + 刷新 conv-规则预览 + 分发给 recalledListeners', async () => {
    const ctx = makeCtx();
    const probe = vi.fn();
    ctx.recalledListeners.current.add(probe);

    dispatch(
      {
        type: 'message_recalled',
        source_type: 'friend',
        source_id: 'f1',
        message_uuid: 'm1',
        recalled_by: 'f1',
      },
      ctx,
    );

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ message_uuid: 'm1', recalled_by: 'f1', source_type: 'friend' }),
    );
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m1');

    await flushMicrotasks();
    // friend 撤回：conversationId 必须按 getFriendConversationId(me, source_id) 拼，不能直接用 source_id
    expect(dbMock.refreshConversationPreview).toHaveBeenCalledWith(
      getFriendConversationId('me', 'f1'),
    );
  });

  it('message_recalled（group）: conversationId 直接 = source_id', async () => {
    const ctx = makeCtx();
    dispatch(
      {
        type: 'message_recalled',
        source_type: 'group',
        source_id: 'g1',
        message_uuid: 'm2',
        recalled_by: 'u7',
      },
      ctx,
    );

    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m2');
    await flushMicrotasks();
    expect(dbMock.refreshConversationPreview).toHaveBeenCalledWith('g1');
  });

  // ==========================================
  // message_deleted
  // ==========================================

  it('message_deleted（friend）: 标记删除 + 刷新预览；不惊动 recalled/notification listeners', async () => {
    const ctx = makeCtx();
    const recalledProbe = vi.fn();
    const notificationProbe = vi.fn();
    ctx.recalledListeners.current.add(recalledProbe);
    ctx.notificationListeners.current.add(notificationProbe);

    dispatch(
      {
        type: 'message_deleted',
        source_type: 'friend',
        source_id: 'f2',
        message_uuid: 'm3',
      },
      ctx,
    );

    expect(dbMock.markMessageDeleted).toHaveBeenCalledWith('m3');
    await flushMicrotasks();
    expect(dbMock.refreshConversationPreview).toHaveBeenCalledWith(
      getFriendConversationId('me', 'f2'),
    );
    // 删除是"本人多端同步"，不是撤回也不是系统通知——两类 listener 都不该被调用
    expect(recalledProbe).not.toHaveBeenCalled();
    expect(notificationProbe).not.toHaveBeenCalled();
  });

  // ==========================================
  // system_notification
  // ==========================================

  it('system_notification friend_request: 计数 updater 只 +1 friendRequests + 弹系统通知 + 分发 listener', () => {
    const ctx = makeCtx();
    const probe = vi.fn();
    ctx.notificationListeners.current.add(probe);

    dispatch(
      {
        type: 'system_notification',
        notification_type: 'friend_request',
        data: { from_id: 'u9', from_nickname: 'Bob' },
      },
      ctx,
    );

    expect(ctx.setPendingNotifications).toHaveBeenCalledTimes(1);
    const updater = ctx.setPendingNotifications.mock.calls[0][0] as (
      prev: PendingCounts,
    ) => PendingCounts;
    expect(updater({ friendRequests: 0, groupInvites: 1, groupJoinRequests: 2 })).toEqual({
      friendRequests: 1,
      groupInvites: 1,
      groupJoinRequests: 2,
    });

    expect(notifMock.notifySystemEvent).toHaveBeenCalledWith({
      type: 'friend_request',
      data: expect.objectContaining({ from_id: 'u9', from_nickname: 'Bob' }),
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ notification_type: 'friend_request' }),
    );
  });

  it.each([
    ['group_invite', 'groupInvites'],
    ['group_join_request', 'groupJoinRequests'],
  ] as const)('system_notification %s: 计数 updater 只 +1 %s', (notificationType, counterKey) => {
    const ctx = makeCtx();
    dispatch(
      {
        type: 'system_notification',
        notification_type: notificationType,
        data: { group_id: 'g1', group_name: 'G' },
      },
      ctx,
    );

    expect(ctx.setPendingNotifications).toHaveBeenCalledTimes(1);
    const updater = ctx.setPendingNotifications.mock.calls[0][0] as (
      prev: PendingCounts,
    ) => PendingCounts;
    const base: PendingCounts = { friendRequests: 5, groupInvites: 5, groupJoinRequests: 5 };
    expect(updater(base)).toEqual({ ...base, [counterKey]: 6 });
  });

  it('system_notification group_removed（可通知但无计数器）: 不动计数，但弹通知 + 分发 listener', () => {
    const ctx = makeCtx();
    const probe = vi.fn();
    ctx.notificationListeners.current.add(probe);

    dispatch(
      {
        type: 'system_notification',
        notification_type: 'group_removed',
        data: { group_id: 'g1', group_name: 'G', removed_by: 'owner1' },
      },
      ctx,
    );

    expect(ctx.setPendingNotifications).not.toHaveBeenCalled();
    expect(notifMock.notifySystemEvent).toHaveBeenCalledWith({
      type: 'group_removed',
      data: expect.objectContaining({ group_id: 'g1', group_name: 'G' }),
    });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ notification_type: 'group_removed' }),
    );
  });

  it('system_notification member_muted（不在 NOTIFIABLE_TYPES）: 不弹通知，但 listener 仍收到帧（分发与通知解耦）', () => {
    const ctx = makeCtx();
    const probe = vi.fn();
    ctx.notificationListeners.current.add(probe);

    dispatch(
      {
        type: 'system_notification',
        notification_type: 'member_muted',
        data: { group_id: 'g1', target_user_id: 'u3' },
      },
      ctx,
    );

    expect(notifMock.notifySystemEvent).not.toHaveBeenCalled();
    expect(ctx.setPendingNotifications).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ notification_type: 'member_muted' }),
    );
  });

  // ==========================================
  // presence_update
  // ==========================================

  it('presence_update: 写入 chatStore.friendPresence，后续帧覆盖更新', () => {
    const ctx = makeCtx();

    dispatch({ type: 'presence_update', user_id: 'u1', online: true }, ctx);
    expect(useChatStore.getState().friendPresence['u1']).toEqual({
      online: true,
      last_seen_at: undefined,
    });

    dispatch(
      { type: 'presence_update', user_id: 'u1', online: false, last_seen_at: '2026-07-01T00:00:00Z' },
      ctx,
    );
    expect(useChatStore.getState().friendPresence['u1']).toEqual({
      online: false,
      last_seen_at: '2026-07-01T00:00:00Z',
    });
  });

  // ==========================================
  // heartbeat / error
  // ==========================================

  it('heartbeat: 只回 eventSeq，零 DB/通知副作用', () => {
    const ctx = makeCtx();
    const result = dispatch(
      { type: 'heartbeat', timestamp: '2026-07-17T00:00:00Z', event_seq: 42 },
      ctx,
    );

    expect(result).toEqual({ eventSeq: 42 });
    expect(dbMock.markMessageRecalled).not.toHaveBeenCalled();
    expect(dbMock.markMessageDeleted).not.toHaveBeenCalled();
    expect(dbMock.refreshConversationPreview).not.toHaveBeenCalled();
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
    expect(dbMock.updateConversationLastSeq).not.toHaveBeenCalled();
    expect(dbMock.updateConversationLastMessage).not.toHaveBeenCalled();
    expect(notifMock.notifyNewMessage).not.toHaveBeenCalled();
    expect(notifMock.notifySystemEvent).not.toHaveBeenCalled();
  });

  it('error: 回 eventSeq + console.error 带 code 与 message', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const result = dispatch(
        { type: 'error', code: 'E1', message: 'boom', event_seq: 7 },
        ctx,
      );

      expect(result).toEqual({ eventSeq: 7 });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const args = errorSpy.mock.calls[0];
      expect(args).toContain('E1');
      expect(args).toContain('boom');
    } finally {
      errorSpy.mockRestore();
    }
  });

  // ==========================================
  // hg_*（no-op 契约）
  // ==========================================

  it.each([
    ['hg_topology_changed', { device_id: 'd1', added: ['a'], removed: [] }, 11],
    ['hg_node_migrated', { device_id: 'd1', from_node: 'n1', to_node: 'n2' }, 12],
    ['hg_group_toggled', { group_id: 'hg-g1', is_active: true }, 13],
    ['hg_obfs_config_changed', { obfs_hash: 'abc123' }, 14],
  ] as const)('%s: 仅回 eventSeq，前端零副作用（仅冒泡 Rust，不跨窗广播）', (type, fields, eventSeq) => {
    const ctx = makeCtx();
    const newMessageProbe = vi.fn();
    const recalledProbe = vi.fn();
    const notificationProbe = vi.fn();
    const readSyncProbe = vi.fn();
    ctx.newMessageListeners.current.add(newMessageProbe);
    ctx.recalledListeners.current.add(recalledProbe);
    ctx.notificationListeners.current.add(notificationProbe);
    ctx.readSyncListeners.current.add(readSyncProbe);

    const result = dispatch({ type, ...fields, event_seq: eventSeq }, ctx);

    expect(result).toEqual({ eventSeq });
    Object.values(dbMock).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    Object.values(notifMock).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(newMessageProbe).not.toHaveBeenCalled();
    expect(recalledProbe).not.toHaveBeenCalled();
    expect(notificationProbe).not.toHaveBeenCalled();
    expect(readSyncProbe).not.toHaveBeenCalled();
    expect(ctx.setUnreadSummary).not.toHaveBeenCalled();
    expect(ctx.setPendingNotifications).not.toHaveBeenCalled();
    // 只有 hg_device_status_changed 才跨窗广播；这四类误广播会让 HG 窗口平白重拉设备列表
    expect(eventMock.emit).not.toHaveBeenCalled();
  });

  // ==========================================
  // hg_device_status_changed（跨窗广播契约）
  // ==========================================

  it('hg_device_status_changed: emit 跨窗事件带 device_id/status，其余副作用仍为零', () => {
    const ctx = makeCtx();
    const newMessageProbe = vi.fn();
    const recalledProbe = vi.fn();
    const notificationProbe = vi.fn();
    const readSyncProbe = vi.fn();
    ctx.newMessageListeners.current.add(newMessageProbe);
    ctx.recalledListeners.current.add(recalledProbe);
    ctx.notificationListeners.current.add(notificationProbe);
    ctx.readSyncListeners.current.add(readSyncProbe);

    const result = dispatch(
      { type: 'hg_device_status_changed', device_id: 'd1', status: 'online', event_seq: 15 },
      ctx,
    );

    // HG 页面跑在独立 Tauri 窗口，主窗口必须把这帧原样转发过去
    expect(eventMock.emit).toHaveBeenCalledTimes(1);
    expect(eventMock.emit).toHaveBeenCalledWith('hg:device-status-changed', {
      device_id: 'd1',
      status: 'online',
    });

    expect(result).toEqual({ eventSeq: 15 });
    Object.values(dbMock).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    Object.values(notifMock).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(newMessageProbe).not.toHaveBeenCalled();
    expect(recalledProbe).not.toHaveBeenCalled();
    expect(notificationProbe).not.toHaveBeenCalled();
    expect(readSyncProbe).not.toHaveBeenCalled();
    expect(ctx.setUnreadSummary).not.toHaveBeenCalled();
    expect(ctx.setPendingNotifications).not.toHaveBeenCalled();
  });

  // ==========================================
  // 解析失败
  // ==========================================

  it('非法 JSON: 返回 null（不抛出）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const result = dispatch('this is {not json', ctx);
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
