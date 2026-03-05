/**
 * 会话卡片最新消息预览刷新测试
 *
 * 验证消息删除/撤回后，会话卡片的最新消息预览能正确同步更新。
 *
 * 覆盖场景：
 * - refreshPreviewInSummary 仅更新已存在的 unreadSummary 条目
 * - 好友/群聊两种会话类型的预览刷新
 * - 空数据和边界条件处理
 * - 不会为不存在的会话创建新条目
 */

import { describe, it, expect, vi } from 'vitest';
import { refreshPreviewInSummary } from '../../src/contexts/wsHandlers';
import type { UnreadSummary } from '../../src/types/websocket';

// ============================================================================
// 测试辅助
// ============================================================================

function createMockSummary(overrides?: Partial<UnreadSummary>): UnreadSummary {
  return {
    total_count: 0,
    friend_unreads: [],
    group_unreads: [],
    ...overrides,
  };
}

// ============================================================================
// refreshPreviewInSummary 测试
// ============================================================================

describe('refreshPreviewInSummary', () => {
  // ------------------------------------------
  // 好友会话
  // ------------------------------------------
  describe('好友会话预览更新', () => {
    it('应更新已存在的好友会话预览', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 3, last_message_preview: '旧消息', last_message_time: '2026-01-01T00:00:00Z' },
          { friend_id: 'f2', unread_count: 1, last_message_preview: '其他消息', last_message_time: '2026-01-01T01:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '新的最新消息', '2026-01-02T00:00:00Z');

      expect(mockSetState).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      const f1 = result!.friend_unreads.find(u => u.friend_id === 'f1');
      expect(f1?.last_message_preview).toBe('新的最新消息');
      expect(f1?.last_message_time).toBe('2026-01-02T00:00:00Z');
      expect(f1?.unread_count).toBe(3);

      const f2 = result!.friend_unreads.find(u => u.friend_id === 'f2');
      expect(f2?.last_message_preview).toBe('其他消息');
    });

    it('当好友条目不存在时不应修改 summary', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 1, last_message_preview: '消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f999', '新消息', '2026-01-02T00:00:00Z');

      expect(result).toBe(initial);
    });

    it('删除最后一条消息后应将预览设为空字符串', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 0, last_message_preview: '最后一条消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '', '');

      const f1 = result!.friend_unreads.find(u => u.friend_id === 'f1');
      expect(f1?.last_message_preview).toBe('');
      expect(f1?.last_message_time).toBe('');
    });
  });

  // ------------------------------------------
  // 群聊会话
  // ------------------------------------------
  describe('群聊会话预览更新', () => {
    it('应更新已存在的群聊会话预览', () => {
      const initial = createMockSummary({
        group_unreads: [
          { group_id: 'g1', unread_count: 5, last_message_preview: '旧群消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'group', 'g1', '新群消息', '2026-01-02T00:00:00Z');

      const g1 = result!.group_unreads.find(u => u.group_id === 'g1');
      expect(g1?.last_message_preview).toBe('新群消息');
      expect(g1?.last_message_time).toBe('2026-01-02T00:00:00Z');
      expect(g1?.unread_count).toBe(5);
    });

    it('当群聊条目不存在时不应修改 summary', () => {
      const initial = createMockSummary({
        group_unreads: [
          { group_id: 'g1', unread_count: 1, last_message_preview: '消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'group', 'g999', '新消息', '2026-01-02T00:00:00Z');

      expect(result).toBe(initial);
    });

    it('删除最后一条群消息后应将预览设为空字符串', () => {
      const initial = createMockSummary({
        group_unreads: [
          { group_id: 'g1', unread_count: 0, last_message_preview: '最后群消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'group', 'g1', '', '');

      const g1 = result!.group_unreads.find(u => u.group_id === 'g1');
      expect(g1?.last_message_preview).toBe('');
      expect(g1?.last_message_time).toBe('');
    });
  });

  // ------------------------------------------
  // 边界条件
  // ------------------------------------------
  describe('边界条件', () => {
    it('当 summary 为 null 时不应抛出错误', () => {
      let result: UnreadSummary | null = null;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '消息', '2026-01-01T00:00:00Z');

      expect(result).toBeNull();
    });

    it('更新不应影响其他类型的未读条目', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 2, last_message_preview: '好友消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
        group_unreads: [
          { group_id: 'g1', unread_count: 3, last_message_preview: '群消息', last_message_time: '2026-01-01T01:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '新好友消息', '2026-01-02T00:00:00Z');

      const g1 = result!.group_unreads.find(u => u.group_id === 'g1');
      expect(g1?.last_message_preview).toBe('群消息');
      expect(g1?.last_message_time).toBe('2026-01-01T01:00:00Z');
    });

    it('连续多次刷新应始终反映最新状态', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 5, last_message_preview: '消息A', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '消息B', '2026-01-02T00:00:00Z');
      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '消息C', '2026-01-03T00:00:00Z');
      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '', '');

      const f1 = result!.friend_unreads.find(u => u.friend_id === 'f1');
      expect(f1?.last_message_preview).toBe('');
      expect(f1?.unread_count).toBe(5);
    });

    it('不应改变 unread_count（仅更新预览）', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 10, last_message_preview: '旧消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
        group_unreads: [
          { group_id: 'g1', unread_count: 7, last_message_preview: '旧群消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '新消息', '2026-01-02T00:00:00Z');
      refreshPreviewInSummary(mockSetState as any, 'group', 'g1', '新群消息', '2026-01-02T00:00:00Z');

      expect(result!.friend_unreads[0].unread_count).toBe(10);
      expect(result!.group_unreads[0].unread_count).toBe(7);
    });

    it('图片类消息应显示 [图片] 预览', () => {
      const initial = createMockSummary({
        friend_unreads: [
          { friend_id: 'f1', unread_count: 1, last_message_preview: '旧消息', last_message_time: '2026-01-01T00:00:00Z' },
        ],
      });

      let result: UnreadSummary | null = initial;
      const mockSetState = vi.fn((updater: (prev: UnreadSummary | null) => UnreadSummary | null) => {
        result = updater(result);
      });

      refreshPreviewInSummary(mockSetState as any, 'friend', 'f1', '[图片]', '2026-01-02T00:00:00Z');

      expect(result!.friend_unreads[0].last_message_preview).toBe('[图片]');
    });
  });
});
