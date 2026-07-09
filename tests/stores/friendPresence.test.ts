/**
 * chatStore 好友在线状态（presence）reducer 测试
 *
 * 覆盖：快照批量 seed（setFriendPresences）+ 增量单条更新（setFriendPresence），
 * 对应 GET /api/friends/presence 首屏 + WS presence_update 增量。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';

beforeEach(() => {
  // 清空 presence，避免用例间污染
  useChatStore.getState().setFriendPresences([]);
});

describe('friendPresence reducers', () => {
  it('setFriendPresences 用快照全量替换（含 online 与离线的 last_seen_at）', () => {
    useChatStore.getState().setFriendPresences([
      { user_id: 'a', online: true },
      { user_id: 'b', online: false, last_seen_at: '2026-07-08T09:30:00Z' },
    ]);
    const map = useChatStore.getState().friendPresence;
    expect(map.a).toEqual({ online: true, last_seen_at: undefined });
    expect(map.b).toEqual({ online: false, last_seen_at: '2026-07-08T09:30:00Z' });
  });

  it('setFriendPresences 二次调用整表替换（旧项被清除）', () => {
    useChatStore.getState().setFriendPresences([{ user_id: 'a', online: true }]);
    useChatStore.getState().setFriendPresences([{ user_id: 'b', online: true }]);
    const map = useChatStore.getState().friendPresence;
    expect(map.a).toBeUndefined();
    expect(map.b).toEqual({ online: true, last_seen_at: undefined });
  });

  it('setFriendPresence 增量更新单个好友，不影响其他项', () => {
    useChatStore.getState().setFriendPresences([
      { user_id: 'a', online: false, last_seen_at: '2026-07-08T09:30:00Z' },
      { user_id: 'b', online: true },
    ]);
    // a 上线（增量）
    useChatStore.getState().setFriendPresence('a', { online: true });
    const map = useChatStore.getState().friendPresence;
    expect(map.a).toEqual({ online: true });
    expect(map.b).toEqual({ online: true, last_seen_at: undefined });
  });

  it('setFriendPresence 下线附带 last_seen_at', () => {
    useChatStore.getState().setFriendPresence('a', { online: true });
    useChatStore.getState().setFriendPresence('a', { online: false, last_seen_at: '2026-07-08T10:00:00Z' });
    expect(useChatStore.getState().friendPresence.a).toEqual({
      online: false,
      last_seen_at: '2026-07-08T10:00:00Z',
    });
  });

  it('clearMessageCache（登出会话级清理收口）清空 friendPresence，防跨账号在线态残留', () => {
    useChatStore.getState().setFriendPresences([
      { user_id: 'a', online: true },
      { user_id: 'b', online: false, last_seen_at: '2026-07-08T09:30:00Z' },
    ]);
    expect(Object.keys(useChatStore.getState().friendPresence).length).toBe(2);
    // 登出统一收口（clearSession → clearMessageCache）
    useChatStore.getState().clearMessageCache();
    expect(useChatStore.getState().friendPresence).toEqual({});
  });
});
