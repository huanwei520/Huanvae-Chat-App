/**
 * WebSocket 处理器辅助函数单元测试
 *
 * 测试 src/contexts/wsHandlers.ts 中导出的辅助函数：
 * - getMessagePreviewText
 * - updateFriendUnread
 * - updateGroupUnread
 */

import { describe, it, expect, vi } from 'vitest';
import type { UnreadSummary } from '../../src/types/websocket';

vi.mock('../../src/db', () => ({}));
vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn(),
  notifySystemEvent: vi.fn(),
}));

import {
  getMessagePreviewText,
  updateFriendUnread,
  updateGroupUnread,
} from '../../src/contexts/wsHandlers';

// ============================================================================
// 测试辅助
// ============================================================================

function createEmptySummary(): UnreadSummary {
  return {
    total_count: 0,
    friend_unreads: [],
    group_unreads: [],
  };
}

// ============================================================================
// getMessagePreviewText 测试
// ============================================================================

describe('getMessagePreviewText - 生成消息预览文本', () => {
  it('text 类型应返回 preview 字符串', () => {
    expect(getMessagePreviewText('text', '你好世界')).toBe('你好世界');
    expect(getMessagePreviewText('text', '')).toBe('');
  });

  it('image 类型应返回 [图片]', () => {
    expect(getMessagePreviewText('image', '任意预览')).toBe('[图片]');
  });

  it('video 类型应返回 [视频]', () => {
    expect(getMessagePreviewText('video', '任意预览')).toBe('[视频]');
  });

  it('file 类型应返回 [文件]', () => {
    expect(getMessagePreviewText('file', '任意预览')).toBe('[文件]');
  });
});

// ============================================================================
// updateFriendUnread 测试
// ============================================================================

describe('updateFriendUnread - 更新好友未读摘要', () => {
  it('应更新已存在的好友条目（increment true）', () => {
    const summary: UnreadSummary = {
      total_count: 2,
      friend_unreads: [
        { friend_id: 'f1', unread_count: 2, last_message_preview: '旧消息', last_message_time: '2026-01-01T00:00:00Z' },
      ],
      group_unreads: [],
    };

    const result = updateFriendUnread(summary, 'f1', '新消息', '2026-01-02T12:00:00Z', true);

    expect(result.friend_unreads[0].unread_count).toBe(3);
    expect(result.friend_unreads[0].last_message_preview).toBe('新消息');
    expect(result.friend_unreads[0].last_message_time).toBe('2026-01-02T12:00:00Z');
    expect(result.total_count).toBe(3);
  });

  it('应更新已存在的好友条目（increment false）', () => {
    const summary: UnreadSummary = {
      total_count: 2,
      friend_unreads: [
        { friend_id: 'f1', unread_count: 2, last_message_preview: '旧消息', last_message_time: '2026-01-01T00:00:00Z' },
      ],
      group_unreads: [],
    };

    const result = updateFriendUnread(summary, 'f1', '新消息', '2026-01-02T12:00:00Z', false);

    expect(result.friend_unreads[0].unread_count).toBe(2);
    expect(result.friend_unreads[0].last_message_preview).toBe('新消息');
    expect(result.total_count).toBe(2);
  });

  it('应添加新好友条目', () => {
    const summary = createEmptySummary();

    const result = updateFriendUnread(summary, 'f2', '第一条消息', '2026-01-01T00:00:00Z', true);

    expect(result.friend_unreads).toHaveLength(1);
    expect(result.friend_unreads[0].friend_id).toBe('f2');
    expect(result.friend_unreads[0].unread_count).toBe(1);
    expect(result.friend_unreads[0].last_message_preview).toBe('第一条消息');
    expect(result.total_count).toBe(1);
  });

  it('应正确重新计算 total_count（多好友）', () => {
    const summary: UnreadSummary = {
      total_count: 5,
      friend_unreads: [
        { friend_id: 'f1', unread_count: 2, last_message_preview: 'a', last_message_time: '' },
        { friend_id: 'f2', unread_count: 3, last_message_preview: 'b', last_message_time: '' },
      ],
      group_unreads: [],
    };

    const result = updateFriendUnread(summary, 'f1', '新', '', true);

    expect(result.total_count).toBe(6); // 2+1+3
  });
});

// ============================================================================
// updateGroupUnread 测试
// ============================================================================

describe('updateGroupUnread - 更新群聊未读摘要', () => {
  it('应更新已存在的群聊条目', () => {
    const summary: UnreadSummary = {
      total_count: 5,
      friend_unreads: [],
      group_unreads: [
        { group_id: 'g1', unread_count: 5, last_message_preview: '旧群消息', last_message_time: '2026-01-01T00:00:00Z' },
      ],
    };

    const result = updateGroupUnread(summary, 'g1', '新群消息', '2026-01-02T12:00:00Z', true);

    expect(result.group_unreads[0].unread_count).toBe(6);
    expect(result.group_unreads[0].last_message_preview).toBe('新群消息');
    expect(result.group_unreads[0].last_message_time).toBe('2026-01-02T12:00:00Z');
    expect(result.total_count).toBe(6);
  });

  it('应添加新群聊条目', () => {
    const summary = createEmptySummary();

    const result = updateGroupUnread(summary, 'g1', '群第一条消息', '2026-01-01T00:00:00Z', true);

    expect(result.group_unreads).toHaveLength(1);
    expect(result.group_unreads[0].group_id).toBe('g1');
    expect(result.group_unreads[0].unread_count).toBe(1);
    expect(result.group_unreads[0].last_message_preview).toBe('群第一条消息');
    expect(result.total_count).toBe(1);
  });

  it('应正确重新计算 total_count（好友+群聊）', () => {
    const summary: UnreadSummary = {
      total_count: 10,
      friend_unreads: [
        { friend_id: 'f1', unread_count: 3, last_message_preview: 'a', last_message_time: '' },
      ],
      group_unreads: [
        { group_id: 'g1', unread_count: 7, last_message_preview: 'b', last_message_time: '' },
      ],
    };

    const result = updateGroupUnread(summary, 'g1', '新', '', true);

    expect(result.total_count).toBe(11); // 3 + 7+1
  });
});
