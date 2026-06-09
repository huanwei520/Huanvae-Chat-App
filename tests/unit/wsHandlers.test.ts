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
  computeConnectedReadCorrection,
} from '../../src/contexts/wsHandlers';
import { getFriendConversationId } from '../../src/utils/conversationId';

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

// ============================================================================
// computeConnectedReadCorrection - 用本地持久化已读位置纠正 connected 快照 + 算 resync
// 真值口径迁移后(unread-count 计数器 → last-read-seq 派生)的客户端自愈：
//   本地 last_read_seq >= last_seq(>0) ⇒ 该会话视为已读 ⇒ 清 0 + 回传 resync_read_positions
// 取代旧 active-only 兜底 mergeConnectedSnapshotWithActiveRead(覆盖所有会话、不止 active)
// ============================================================================

describe('computeConnectedReadCorrection - 本地已读位置纠正 connected 快照', () => {
  const ME = 'me';
  function makeFriend(id: string, count: number) {
    return {
      friend_id: id,
      unread_count: count,
      last_message_preview: `friend-${id}`,
      last_message_time: '2026-06-09T00:00:00Z',
    };
  }
  function makeGroup(id: string, count: number) {
    return {
      group_id: id,
      unread_count: count,
      last_message_preview: `group-${id}`,
      last_message_time: '2026-06-09T00:00:00Z',
    };
  }
  // 本地会话记录(只取 compute 需要的三字段)
  function conv(id: string, last_seq: number, last_read_seq: number) {
    return { id, last_seq, last_read_seq };
  }
  const fconv = (friendId: string, last_seq: number, last_read_seq: number) =>
    conv(getFriendConversationId(ME, friendId), last_seq, last_read_seq);

  it('好友本地已读到最新(last_read_seq>=last_seq>0) → 清 0 且回传 resync', () => {
    const snap: UnreadSummary = {
      total_count: 5,
      friend_unreads: [makeFriend('A', 5)],
      group_unreads: [],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(
      snap,
      [fconv('A', 7, 7)],
      ME,
    );
    expect(corrected.friend_unreads[0].unread_count).toBe(0);
    expect(corrected.total_count).toBe(0);
    // 仅清 unread_count，preview 保留
    expect(corrected.friend_unreads[0].last_message_preview).toBe('friend-A');
    expect(resyncPositions).toEqual([{ target_type: 'friend', target_id: 'A', last_read_seq: 7 }]);
  });

  it('好友本地未读完(last_read_seq < last_seq) → 不动、不 resync', () => {
    const snap: UnreadSummary = {
      total_count: 3,
      friend_unreads: [makeFriend('A', 3)],
      group_unreads: [],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(
      snap,
      [fconv('A', 9, 6)],
      ME,
    );
    expect(corrected.friend_unreads[0].unread_count).toBe(3);
    expect(corrected.total_count).toBe(3);
    expect(resyncPositions).toEqual([]);
  });

  it('last_seq=0(本地还没收到任何消息) → 不视为已读、不 resync(防把没收到的清掉)', () => {
    const snap: UnreadSummary = {
      total_count: 2,
      friend_unreads: [makeFriend('A', 2)],
      group_unreads: [],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(
      snap,
      [fconv('A', 0, 0)],
      ME,
    );
    expect(corrected.friend_unreads[0].unread_count).toBe(2);
    expect(resyncPositions).toEqual([]);
  });

  it('群本地已读到最新 → 清 0 且回传 group resync', () => {
    const snap: UnreadSummary = {
      total_count: 6,
      friend_unreads: [],
      group_unreads: [makeGroup('G1', 6)],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(
      snap,
      [conv('G1', 4, 4)],
      ME,
    );
    expect(corrected.group_unreads[0].unread_count).toBe(0);
    expect(corrected.total_count).toBe(0);
    expect(resyncPositions).toEqual([{ target_type: 'group', target_id: 'G1', last_read_seq: 4 }]);
  });

  it('混合：A 已读 / B 未读 / G 已读 → 只清 A、G，resync 只含 A、G，total 重算', () => {
    const snap: UnreadSummary = {
      total_count: 10,
      friend_unreads: [makeFriend('A', 5), makeFriend('B', 3)],
      group_unreads: [makeGroup('G', 2)],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(
      snap,
      [fconv('A', 5, 5), fconv('B', 8, 2), conv('G', 2, 9)],
      ME,
    );
    expect(corrected.friend_unreads.find(u => u.friend_id === 'A')?.unread_count).toBe(0);
    expect(corrected.friend_unreads.find(u => u.friend_id === 'B')?.unread_count).toBe(3);
    expect(corrected.group_unreads[0].unread_count).toBe(0);
    expect(corrected.total_count).toBe(3); // 0 + 3 + 0
    expect(resyncPositions).toEqual([
      { target_type: 'friend', target_id: 'A', last_read_seq: 5 },
      { target_type: 'group', target_id: 'G', last_read_seq: 9 },
    ]);
  });

  it('无本地会话记录(currentUserId 为 null) → 好友条目不动、无 resync', () => {
    const snap: UnreadSummary = {
      total_count: 5,
      friend_unreads: [makeFriend('A', 5)],
      group_unreads: [],
    };
    const { corrected, resyncPositions } = computeConnectedReadCorrection(snap, [fconv('A', 7, 7)], null);
    expect(corrected.friend_unreads[0].unread_count).toBe(5);
    expect(resyncPositions).toEqual([]);
  });

  it('结果是新引用，不修改输入(避免 setState 引用相等绕过 React 渲染)', () => {
    const snap: UnreadSummary = {
      total_count: 5,
      friend_unreads: [makeFriend('A', 5)],
      group_unreads: [],
    };
    const originalFriendRef = snap.friend_unreads[0];
    const { corrected } = computeConnectedReadCorrection(snap, [fconv('A', 5, 5)], ME);
    expect(corrected).not.toBe(snap);
    expect(corrected.friend_unreads).not.toBe(snap.friend_unreads);
    expect(corrected.friend_unreads[0]).not.toBe(originalFriendRef);
    expect(snap.friend_unreads[0].unread_count).toBe(5); // 输入未被改写
  });
});
