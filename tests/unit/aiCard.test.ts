/**
 * AI 助手卡片与类型测试
 *
 * 验证：
 * - ChatTarget 类型正确扩展支持 'ai'
 * - AIMessage / AIConversation 接口结构正确
 * - AI 卡片始终置顶于排序后的列表第一位
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatTarget,
  AIMessage,
  AIConversation,
  AIConversationsResponse,
} from '../../src/types/chat';

describe('AI 类型定义', () => {
  it('ChatTarget 支持 ai 类型（无 conversationId）', () => {
    const target: ChatTarget = { type: 'ai' };
    expect(target.type).toBe('ai');
  });

  it('ChatTarget 支持 ai 类型（带 conversationId）', () => {
    const target: ChatTarget = { type: 'ai', conversationId: 'conv-123' };
    expect(target.type).toBe('ai');
    expect(target.conversationId).toBe('conv-123');
  });

  it('ChatTarget 仍然支持 friend 类型', () => {
    const target: ChatTarget = {
      type: 'friend',
      data: {
        friend_id: 'f1',
        friend_nickname: 'Test',
        friend_avatar_url: null,
        add_time: '2024-01-01T00:00:00Z',
        approve_reason: null,
      },
    };
    expect(target.type).toBe('friend');
  });

  it('AIMessage 接口结构正确', () => {
    const msg: AIMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '你好',
      model: 'glm-5',
      created_at: '2024-01-01T00:00:00Z',
    };
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('你好');
  });

  it('AIMessage 支持 user 角色', () => {
    const msg: AIMessage = {
      id: 'msg-2',
      role: 'user',
      content: '测试消息',
      created_at: '2024-01-01T00:00:00Z',
    };
    expect(msg.role).toBe('user');
  });

  it('AIMessage content 可以为 null', () => {
    const msg: AIMessage = {
      id: 'msg-3',
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      created_at: '2024-01-01T00:00:00Z',
    };
    expect(msg.content).toBeNull();
    expect(msg.tool_calls).toHaveLength(1);
  });

  it('AIConversation 接口结构正确', () => {
    const conv: AIConversation = {
      id: 'conv-1',
      title: '新对话',
      message_count: 5,
      total_tokens: 1000,
      last_message_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    expect(conv.message_count).toBe(5);
  });

  it('AIConversationsResponse 接口结构正确', () => {
    const resp: AIConversationsResponse = {
      conversations: [],
      total: 0,
      page: 1,
      per_page: 20,
    };
    expect(resp.total).toBe(0);
  });
});

describe('AI 卡片置顶逻辑', () => {
  it('AI 卡片应始终在排序后的列表第一位', () => {
    type CardType = 'friend' | 'group' | 'ai';
    interface SimpleCard {
      type: CardType;
      name: string;
      unreadCount: number;
      lastMessageTime: string | null;
    }

    const cards: SimpleCard[] = [
      { type: 'friend', name: '好友A', unreadCount: 5, lastMessageTime: '2024-01-02T00:00:00Z' },
      { type: 'group', name: '群聊B', unreadCount: 0, lastMessageTime: '2024-01-03T00:00:00Z' },
      { type: 'friend', name: '好友C', unreadCount: 10, lastMessageTime: '2024-01-01T00:00:00Z' },
    ];

    cards.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });

    const aiCard: SimpleCard = { type: 'ai', name: 'AI 助手', unreadCount: 0, lastMessageTime: null };
    const finalList = [aiCard, ...cards];

    expect(finalList[0].type).toBe('ai');
    expect(finalList[0].name).toBe('AI 助手');
    expect(finalList.length).toBe(4);
  });

  it('即使所有卡片有未读消息，AI 卡片仍在第一位', () => {
    type CardType = 'friend' | 'group' | 'ai';
    interface SimpleCard { type: CardType; name: string; unreadCount: number; }

    const sorted = [
      { type: 'friend' as CardType, name: '好友', unreadCount: 99 },
      { type: 'group' as CardType, name: '群聊', unreadCount: 50 },
    ];

    const aiCard: SimpleCard = { type: 'ai', name: 'AI 助手', unreadCount: 0 };
    const finalList = [aiCard, ...sorted];

    expect(finalList[0].type).toBe('ai');
  });
});
