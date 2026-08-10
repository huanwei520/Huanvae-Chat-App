/**
 * getSearchConversationId —— ChatTarget → 会话内查找用的 conversation_id
 *
 * 覆盖任务要求的三种会话（好友私聊 / bot / 群聊）都能解析出 id，
 * 且 AI 会话返回 null（AI 消息不落本地 messages 表，给入口只会搜出空结果）。
 */

import { describe, it, expect } from 'vitest';
import { getSearchConversationId } from '../../src/components/search/conversationSearchTarget';
import { getFriendConversationId } from '../../src/utils/conversationId';
import type { ChatTarget, Friend, Group } from '../../src/types/chat';

const buildFriend = (friendId: string): Friend => ({
  friend_id: friendId,
  username: friendId,
  nickname: friendId,
  avatar_url: null,
  status: 'accepted',
  created_at: '2026-05-11T00:00:00Z',
} as unknown as Friend);

const buildGroup = (groupId: string): Group => ({
  group_id: groupId,
  group_name: 'G',
  avatar_url: null,
  owner_id: 'u1',
  member_count: 3,
  role: 'member',
  created_at: '2026-05-11T00:00:00Z',
} as unknown as Group);

describe('getSearchConversationId', () => {
  it('好友私聊：走 getFriendConversationId（两 ID 字典序）', () => {
    const target: ChatTarget = { type: 'friend', data: buildFriend('u9') };
    expect(getSearchConversationId(target, 'u1')).toBe(getFriendConversationId('u1', 'u9'));
    // 与调用顺序无关：拿到的必须是同一个会话 id
    expect(getSearchConversationId(target, 'u1')).toBe('conv-u1-u9');
  });

  it('bot 会话：与好友同一条私聊链路，不能落进群分支', () => {
    const target: ChatTarget = { type: 'bot', data: buildFriend('bot_x') };
    expect(getSearchConversationId(target, 'u1')).toBe(getFriendConversationId('u1', 'bot_x'));
  });

  it('群聊：conversation_id 即 group_id', () => {
    const target: ChatTarget = { type: 'group', data: buildGroup('g-42') };
    expect(getSearchConversationId(target, 'u1')).toBe('g-42');
  });

  it('AI 会话：返回 null（不落本地 messages 表，调用方据此不给查找入口）', () => {
    const target: ChatTarget = { type: 'ai' };
    expect(getSearchConversationId(target, 'u1')).toBeNull();
  });
});
