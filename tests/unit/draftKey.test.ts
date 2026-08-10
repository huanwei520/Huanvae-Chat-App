/**
 * 会话草稿 key（draftKeyOf）单测
 *
 * 背景：输入框内容此前是**全局一份**，所有会话共用 —— 切走再切回会串台/丢失。
 * 改为按会话 key 存草稿后，这个 key 的**唯一性**就是「草稿不串台」的根本保证：
 * 两个不同会话若算出同一个 key，就会互相覆盖对方的草稿。故逐分支覆盖 + 唯一性断言。
 */
import { describe, it, expect } from 'vitest';
import { draftKeyOf } from '../../src/hooks/useMainPage';
import type { ChatTarget, Friend, Group } from '../../src/types/chat';

const friend = (id: string): Friend => ({
  friend_id: id,
  friend_nickname: 'n',
  friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
});

const group = (id: string): Group => ({
  group_id: id,
  group_name: 'g',
  group_avatar_url: '',
  role: 'member',
  unread_count: 0,
  last_message_content: null,
  last_message_time: null,
});

describe('draftKeyOf', () => {
  it('无会话时返回 null（此时输入框不属于任何会话）', () => {
    expect(draftKeyOf(null)).toBeNull();
    expect(draftKeyOf(undefined)).toBeNull();
  });

  it('好友 / bot / 群 / AI 各分支都有 key', () => {
    expect(draftKeyOf({ type: 'friend', data: friend('f1') })).toBe('friend:f1');
    expect(draftKeyOf({ type: 'bot', data: friend('bot_1') })).toBe('bot:bot_1');
    expect(draftKeyOf({ type: 'group', data: group('g1') })).toBe('group:g1');
    expect(draftKeyOf({ type: 'ai' })).toBe('ai:default');
    expect(draftKeyOf({ type: 'ai', conversationId: 'c9' })).toBe('ai:c9');
  });

  it('🔴 不同会话的 key 必须互不相同（相同即草稿串台）', () => {
    const targets: ChatTarget[] = [
      { type: 'friend', data: friend('x') },
      { type: 'bot', data: friend('x') },     // 同 id 不同类型：也必须区分开
      { type: 'group', data: group('x') },    // 同 id 不同类型
      { type: 'friend', data: friend('y') },
      { type: 'ai' },
      { type: 'ai', conversationId: 'c1' },
    ];
    const keys = targets.map(draftKeyOf);
    expect(new Set(keys).size).toBe(targets.length);
  });

  it('同一会话重复求值必须稳定（否则切回来取不到自己的草稿）', () => {
    const t: ChatTarget = { type: 'group', data: group('same') };
    expect(draftKeyOf(t)).toBe(draftKeyOf({ type: 'group', data: group('same') }));
  });
});
