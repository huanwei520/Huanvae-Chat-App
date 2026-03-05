/**
 * 会话 ID 工具函数单元测试
 *
 * 测试 src/utils/conversationId.ts 中的函数
 *
 * 包含测试：
 * - getFriendConversationId: 字典序排序、双向一致性
 * - parseFriendIdFromConversationId: 解析、无效格式、非 conv 前缀
 * - isFriendConversationId: conv- 前缀判断
 * - getGroupConversationId: 透传
 */

import { describe, it, expect } from 'vitest';
import {
  getFriendConversationId,
  parseFriendIdFromConversationId,
  isFriendConversationId,
  getGroupConversationId,
} from '../../src/utils/conversationId';

describe('会话 ID 工具函数 (utils/conversationId)', () => {
  describe('getFriendConversationId - 生成好友会话 ID', () => {
    it('应按字典序排序生成 ID', () => {
      expect(getFriendConversationId('userB', 'userA')).toBe('conv-userA-userB');
      expect(getFriendConversationId('userA', 'userB')).toBe('conv-userA-userB');
    });

    it('双向调用应产生相同结果', () => {
      const id1 = getFriendConversationId('alice', 'bob');
      const id2 = getFriendConversationId('bob', 'alice');
      expect(id1).toBe(id2);
      expect(id1).toBe('conv-alice-bob');
    });

    it('相同用户 ID 时仍应正确生成', () => {
      expect(getFriendConversationId('user1', 'user1')).toBe('conv-user1-user1');
    });
  });

  describe('parseFriendIdFromConversationId - 解析好友 ID', () => {
    it('应从 conv-id 中解析当前用户在第一位时的好友 ID', () => {
      expect(parseFriendIdFromConversationId('conv-alice-bob', 'alice')).toBe('bob');
    });

    it('应从 conv-id 中解析当前用户在第二位时的好友 ID', () => {
      expect(parseFriendIdFromConversationId('conv-alice-bob', 'bob')).toBe('alice');
    });

    it('无效格式应返回 null（缺少部分）', () => {
      expect(parseFriendIdFromConversationId('conv-onlyone', 'alice')).toBeNull();
    });

    it('无效格式应返回 null（多余部分）', () => {
      expect(parseFriendIdFromConversationId('conv-a-b-c', 'alice')).toBeNull();
    });

    it('非 conv- 前缀应返回 null', () => {
      expect(parseFriendIdFromConversationId('group-123', 'alice')).toBeNull();
      expect(parseFriendIdFromConversationId('abc-alice-bob', 'alice')).toBeNull();
    });
  });

  describe('isFriendConversationId - 判断是否为好友会话 ID', () => {
    it('conv- 前缀应返回 true', () => {
      expect(isFriendConversationId('conv-alice-bob')).toBe(true);
      expect(isFriendConversationId('conv-123-456')).toBe(true);
    });

    it('群 ID 应返回 false', () => {
      expect(isFriendConversationId('group-123')).toBe(false);
      expect(isFriendConversationId('g123')).toBe(false);
    });
  });

  describe('getGroupConversationId - 群聊会话 ID', () => {
    it('应原样透传 groupId', () => {
      expect(getGroupConversationId('group-123')).toBe('group-123');
      expect(getGroupConversationId('g456')).toBe('g456');
    });
  });
});
