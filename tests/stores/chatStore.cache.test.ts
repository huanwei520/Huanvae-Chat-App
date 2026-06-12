/**
 * chatStore 消息缓存 action 单测
 *
 * 验证：
 * 1. cacheFriendMessages 全量写入（不截断；切回会话向上翻历史无需重新请求）
 * 2. cacheGroupMessages 全量写入
 * 3. clearMessageCache 清空好友/群消息缓存
 * 4. 多个 key 隔离（不同会话不互相覆盖）
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

describe('chatStore 消息缓存', () => {
  beforeEach(() => {
    // 清空所有状态以隔离测试
    useChatStore.getState().clearMessageCache();
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
    // 全量保留：切回会话后向上翻历史无需重新请求（首帧即完整历史）
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

  it('clearMessageCache 清空好友/群消息缓存与群私有视图（登出/切号防残留）', () => {
    useChatStore.getState().cacheFriendMessages('friend-A', [makeMessage('m1')]);
    useChatStore.getState().cacheGroupMessages('group-X', [makeGroupMessage('gm1')]);
    // 群私有视图（屏蔽/特别关心/备注）同属会话级数据，登出/切号必须一并清空
    useChatStore.getState().setGroupMessageBlocks('group-X', ['u9']);
    useChatStore.getState().setGroupSpecialCares('group-X', ['u8']);
    useChatStore.getState().setGroupMemberRemarks('group-X', [{ user_id: 'u7', remark: 'r' }]);

    useChatStore.getState().clearMessageCache();

    expect(useChatStore.getState().cachedFriendMessages).toEqual({});
    expect(useChatStore.getState().cachedGroupMessages).toEqual({});
    expect(useChatStore.getState().groupMessageBlocks).toEqual({});
    expect(useChatStore.getState().groupSpecialCares).toEqual({});
    expect(useChatStore.getState().groupMemberRemarks).toEqual({});
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
