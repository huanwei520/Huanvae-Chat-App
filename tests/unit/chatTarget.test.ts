/**
 * chatTarget 纯函数单测
 *
 * 覆盖：
 * - friendChatTarget：bot_ 前缀好友分派为 { type: 'bot' }，其余为 { type: 'friend' }
 *   （整对象 toEqual 比对，防止只断言 type 漏掉 data 引用错误）
 * - isFriendLikeTarget：friend / bot 目标 → true；group / ai / null / undefined → false
 *   （bot 绝不能落进 group 分支的不变量由该判别函数收口）
 */

import { describe, it, expect } from 'vitest';
import { friendChatTarget, isFriendLikeTarget } from '../../src/utils/chatTarget';
import type { Friend, Group, ChatTarget } from '../../src/types/chat';

function friend(id: string): Friend {
  return {
    friend_id: id,
    friend_nickname: `nick-${id}`,
    friend_avatar_url: '',
    add_time: '2026-07-01T10:00:00Z',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  };
}

const GROUP: Group = {
  group_id: 'g1',
  group_name: '测试群',
  group_avatar_url: '',
  role: 'member',
  unread_count: 0,
  last_message_content: null,
  last_message_time: null,
};

describe('friendChatTarget', () => {
  it('bot_ 前缀好友 → { type: "bot", data }（整对象比对）', () => {
    const bot = friend('bot_abc123');
    expect(friendChatTarget(bot)).toEqual({ type: 'bot', data: bot });
  });

  it('普通好友 → { type: "friend", data }（整对象比对）', () => {
    const alice = friend('alice');
    expect(friendChatTarget(alice)).toEqual({ type: 'friend', data: alice });
  });

  it('前缀必须是 bot_（含下划线）：id 为 "botless" 仍是 friend', () => {
    const notBot = friend('botless');
    expect(friendChatTarget(notBot)).toEqual({ type: 'friend', data: notBot });
  });
});

describe('isFriendLikeTarget', () => {
  it('friend 目标 → true', () => {
    const t: ChatTarget = { type: 'friend', data: friend('alice') };
    expect(isFriendLikeTarget(t)).toBe(true);
  });

  it('bot 目标 → true', () => {
    const t: ChatTarget = { type: 'bot', data: friend('bot_abc') };
    expect(isFriendLikeTarget(t)).toBe(true);
  });

  it('group 目标 → false（bot 不落 group 分支的判别收口）', () => {
    const t: ChatTarget = { type: 'group', data: GROUP };
    expect(isFriendLikeTarget(t)).toBe(false);
  });

  it('ai 目标 → false', () => {
    const t: ChatTarget = { type: 'ai' };
    expect(isFriendLikeTarget(t)).toBe(false);
  });

  it('null / undefined → false', () => {
    expect(isFriendLikeTarget(null)).toBe(false);
    expect(isFriendLikeTarget(undefined)).toBe(false);
  });
});
