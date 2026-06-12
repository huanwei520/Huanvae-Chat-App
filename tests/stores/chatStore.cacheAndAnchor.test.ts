/**
 * chatStore 缓存与滚动锚点 action 单测
 *
 * 验证：
 * 1. cacheFriendMessages 全量写入（不截断；锚点对应的较老消息必须保留）
 * 2. cacheGroupMessages 全量写入
 * 3. saveScrollAnchor 写入 message_uuid
 * 4. clearCacheAndAnchors 清空所有三个字段
 * 5. 多个 key 隔离（不同会话不互相覆盖）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';
import type { Message } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';

function makeMessage(uuid: string): Message {
  return {
    message_uuid: uuid,
    sender_id: 'u1',
    receiver_id: 'u2',
    message_content: `msg-${uuid}`,
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    send_time: '2026-05-13T00:00:00Z',
    is_recalled: false,
  };
}

function makeGroupMessage(uuid: string): GroupMessage {
  return {
    message_uuid: uuid,
    group_id: 'g1',
    sender_id: 'u1',
    sender_nickname: 'User1',
    sender_avatar_url: '',
    message_content: `gmsg-${uuid}`,
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    send_time: '2026-05-13T00:00:00Z',
    reply_to: null,
    is_recalled: false,
    seq: 1,
  };
}

describe('chatStore 缓存与滚动锚点', () => {
  beforeEach(() => {
    // 清空所有状态以隔离测试
    useChatStore.getState().clearCacheAndAnchors();
  });

  it('cacheFriendMessages 写入并按 key 隔离', () => {
    const msgs = [makeMessage('m1'), makeMessage('m2')];
    useChatStore.getState().cacheFriendMessages('friend-A', msgs);
    expect(useChatStore.getState().cachedFriendMessages['friend-A']).toEqual(msgs);
    expect(useChatStore.getState().cachedFriendMessages['friend-B']).toBeUndefined();

    const msgsB = [makeMessage('m3')];
    useChatStore.getState().cacheFriendMessages('friend-B', msgsB);
    // friend-A 不受影响
    expect(useChatStore.getState().cachedFriendMessages['friend-A']).toEqual(msgs);
    expect(useChatStore.getState().cachedFriendMessages['friend-B']).toEqual(msgsB);
  });

  it('cacheFriendMessages 全量写入（含 loadMore 加载的历史，不截断）', () => {
    // 模拟用户向上翻历史触发 loadMore 后，messages 共 100 条
    const msgs = Array.from({ length: 100 }, (_, i) => makeMessage(`m${i}`));
    useChatStore.getState().cacheFriendMessages('friend-A', msgs);
    const cached = useChatStore.getState().cachedFriendMessages['friend-A'];
    // 全量保留，让滚动锚点（可能指向较老消息）切回时仍能定位
    expect(cached).toHaveLength(100);
    expect(cached![0].message_uuid).toBe('m0');
    expect(cached![99].message_uuid).toBe('m99');
  });

  it('cacheGroupMessages 全量写入', () => {
    const msgs = Array.from({ length: 80 }, (_, i) => makeGroupMessage(`gm${i}`));
    useChatStore.getState().cacheGroupMessages('group-X', msgs);
    const cached = useChatStore.getState().cachedGroupMessages['group-X'];
    expect(cached).toHaveLength(80);
    expect(cached![0].message_uuid).toBe('gm0');
    expect(cached![79].message_uuid).toBe('gm79');
  });

  it('saveScrollAnchor 写入并支持多 key 隔离', () => {
    useChatStore.getState().saveScrollAnchor('friend-A', 'msg-uuid-1');
    useChatStore.getState().saveScrollAnchor('group-X', 'msg-uuid-2');
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBe('msg-uuid-1');
    expect(useChatStore.getState().scrollAnchors['group-X']).toBe('msg-uuid-2');
  });

  it('saveScrollAnchor 重复写入同一 key 覆盖旧值', () => {
    useChatStore.getState().saveScrollAnchor('friend-A', 'msg-old');
    useChatStore.getState().saveScrollAnchor('friend-A', 'msg-new');
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBe('msg-new');
  });

  it('clearCacheAndAnchors 清空缓存/锚点/群关心集（登出/切号防残留）', () => {
    useChatStore.getState().cacheFriendMessages('friend-A', [makeMessage('m1')]);
    useChatStore.getState().cacheGroupMessages('group-X', [makeGroupMessage('gm1')]);
    useChatStore.getState().saveScrollAnchor('friend-A', 'anchor-1');
    useChatStore.getState().setGroupSpecialCares('group-X', ['u2']);

    useChatStore.getState().clearCacheAndAnchors();

    expect(useChatStore.getState().cachedFriendMessages).toEqual({});
    expect(useChatStore.getState().cachedGroupMessages).toEqual({});
    expect(useChatStore.getState().scrollAnchors).toEqual({});
    expect(useChatStore.getState().groupSpecialCares).toEqual({});
  });

  it('cacheFriendMessages 多次写入累积不互相覆盖', () => {
    useChatStore.getState().cacheFriendMessages('friend-A', [makeMessage('m1')]);
    useChatStore.getState().cacheFriendMessages('friend-B', [makeMessage('m2')]);
    useChatStore.getState().cacheFriendMessages('friend-C', [makeMessage('m3')]);

    expect(Object.keys(useChatStore.getState().cachedFriendMessages)).toEqual([
      'friend-A',
      'friend-B',
      'friend-C',
    ]);
  });
});
