/**
 * AI Agent 工具确认机制测试
 *
 * 测试 src/api/ai.ts 和 src/types/chat.ts 中新增的 Agent 写操作工具确认功能
 *
 * 包含测试：
 * - PendingToolCall 类型结构验证
 * - AIToolCallPendingEvent 类型结构验证
 * - AIStreamCallbacks 新增 onToolCallPending 回调
 * - confirmToolCall / rejectToolCall / getPendingToolCalls API 函数存在性
 * - AIStatus 类型验证（thinking / reasoning / responding / tool_calling）
 * - AIPendingToolCall 前端状态类型验证
 * - AIToolStatus 新增 pending_confirm 状态
 */

import { describe, it, expect } from 'vitest';
import type { PendingToolCall } from '../../src/types/chat';
import type { AIToolCallPendingEvent, AIStreamCallbacks, AIStatus } from '../../src/api/ai';
import { confirmToolCall, rejectToolCall, getPendingToolCalls } from '../../src/api/ai';
import type { AIPendingToolCall, AIToolStatus } from '../../src/chat/ai/useAIMessages';

describe('AI Agent 工具确认机制', () => {

  // ============================================
  // 类型验证
  // ============================================

  describe('PendingToolCall 类型', () => {
    it('包含所有必填字段', () => {
      const pending: PendingToolCall = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversation_id: '660e8400-e29b-41d4-a716-446655440000',
        tool_name: 'send_message',
        arguments: '{"friend_id":"xiaoming","content":"你好"}',
        status: 'pending',
        created_at: '2026-01-27T12:00:00Z',
        expires_at: '2026-01-27T12:05:00Z',
      };

      expect(pending.id).toBeTruthy();
      expect(pending.conversation_id).toBeTruthy();
      expect(pending.tool_name).toBe('send_message');
      expect(pending.status).toBe('pending');
      expect(pending.expires_at).toBeTruthy();
    });

    it('status 支持所有有效值', () => {
      const statuses: PendingToolCall['status'][] = [
        'pending', 'confirmed', 'rejected', 'expired',
      ];

      statuses.forEach(status => {
        const pending: PendingToolCall = {
          id: 'id',
          conversation_id: 'cid',
          tool_name: 'tool',
          arguments: '{}',
          status,
          created_at: '',
          expires_at: '',
        };
        expect(pending.status).toBe(status);
      });
    });
  });

  describe('AIToolCallPendingEvent 类型', () => {
    it('SSE 事件结构正确', () => {
      const event: AIToolCallPendingEvent = {
        pending_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        tool_name: 'send_message',
        arguments: '{"friend_id":"xiaoming","content":"你好"}',
        expires_at: '2026-01-27T12:05:00Z',
      };

      expect(event.pending_id).toBeTruthy();
      expect(event.tool_name).toBe('send_message');
      expect(event.arguments).toContain('friend_id');
      expect(event.expires_at).toBeTruthy();
    });
  });

  describe('AIStatus 类型', () => {
    it('支持所有阶段状态值', () => {
      const statuses: AIStatus[] = [
        'thinking', 'reasoning', 'responding', 'tool_calling',
      ];

      expect(statuses).toHaveLength(4);
      expect(statuses).toContain('thinking');
      expect(statuses).toContain('tool_calling');
    });
  });

  describe('AIStreamCallbacks 接口', () => {
    it('包含 onToolCallPending 回调', () => {
      const callbacks: AIStreamCallbacks = {
        onToolCallPending: (info) => {
          expect(info.pending_id).toBeDefined();
          expect(info.tool_name).toBeDefined();
        },
      };

      expect(callbacks.onToolCallPending).toBeDefined();
    });

    it('包含 onStatus 回调', () => {
      const callbacks: AIStreamCallbacks = {
        onStatus: (status) => {
          expect(status).toBeDefined();
        },
      };

      expect(callbacks.onStatus).toBeDefined();
    });

    it('所有回调都是可选的', () => {
      const empty: AIStreamCallbacks = {};
      expect(empty).toEqual({});
    });
  });

  // ============================================
  // API 函数存在性
  // ============================================

  describe('API 函数导出', () => {
    it('confirmToolCall 函数已导出', () => {
      expect(typeof confirmToolCall).toBe('function');
    });

    it('rejectToolCall 函数已导出', () => {
      expect(typeof rejectToolCall).toBe('function');
    });

    it('getPendingToolCalls 函数已导出', () => {
      expect(typeof getPendingToolCalls).toBe('function');
    });
  });

  // ============================================
  // 前端状态类型
  // ============================================

  describe('AIPendingToolCall 前端状态类型', () => {
    it('结构正确（解析后的参数）', () => {
      const pending: AIPendingToolCall = {
        pendingId: 'a1b2c3d4',
        toolName: 'send_message',
        arguments: { friend_id: 'xiaoming', content: '你好' },
        expiresAt: '2026-01-27T12:05:00Z',
      };

      expect(pending.pendingId).toBe('a1b2c3d4');
      expect(pending.toolName).toBe('send_message');
      expect(pending.arguments).toHaveProperty('friend_id');
      expect(pending.arguments).toHaveProperty('content');
    });
  });

  describe('AIToolStatus pending_confirm 状态', () => {
    it('支持 pending_confirm 状态值', () => {
      const status: AIToolStatus = {
        name: 'send_message',
        status: 'pending_confirm',
      };

      expect(status.status).toBe('pending_confirm');
    });

    it('仍然支持 calling 和 done 状态', () => {
      const calling: AIToolStatus = { name: 'get_friend_list', status: 'calling' };
      const done: AIToolStatus = { name: 'get_friend_list', status: 'done' };

      expect(calling.status).toBe('calling');
      expect(done.status).toBe('done');
    });
  });
});
