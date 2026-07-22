/**
 * handleWebSocketMessage — shelf_updated 帧分发副作用契约测试
 *
 * shelf_updated 帧只含条目引用（无卡片内容），handler 把 msg.items 逐条经 isShelfItem
 * 校验后整组写入 shelfStore（按 shelfKey(scope, scope_key) 分桶）。锁定两点：
 *  - position 升序整组入桶
 *  - WS 为跨进程不可信输入，非法条目被 isShelfItem 过滤，不污染桶
 *
 * 帧经 JSON.stringify 投给真实 handleWebSocketMessage；db / notificationService 仅为
 * 满足模块顶层 import 的外部边界 mock（本帧类型不触达它们）。fixture 内容用中性占位。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  markMessageRecalled: vi.fn().mockResolvedValue(undefined),
  markMessageDeleted: vi.fn().mockResolvedValue(undefined),
  refreshConversationPreview: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);

const notifMock = vi.hoisted(() => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/notificationService', () => notifMock);

import { handleWebSocketMessage } from '../../src/contexts/wsHandlers';
import type { MessageHandlerContext } from '../../src/contexts/wsHandlers';
import { useShelfStore, shelfKey } from '../../src/stores/shelfStore';
import type { ShelfItem } from '../../src/api/shelf';

/** shelf_updated 分发只触达 useShelfStore，ctx 不被读取 → 最小 stub 即可 */
const ctx = { currentUserId: null } as unknown as MessageHandlerContext;

function makeItem(overrides: Partial<ShelfItem> = {}): ShelfItem {
  return {
    item_id: 'i1',
    message_uuid: 'm1',
    pinned_by: 'u1',
    note: null,
    position: 0,
    created_at: '2026-07-21T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  useShelfStore.getState().clear();
});

describe('handleWebSocketMessage — shelf_updated', () => {
  it('合法帧：2 条引用按 position 升序入 shelfStore 对应桶', () => {
    handleWebSocketMessage(
      JSON.stringify({
        type: 'shelf_updated',
        scope: 'bot',
        scope_key: 'u1:b1',
        items: [
          makeItem({ item_id: 'later', position: 1 }),
          makeItem({ item_id: 'first', position: 0 }),
        ],
      }),
      ctx,
    );

    const stored = useShelfStore.getState().itemsByConv[shelfKey('bot', 'u1:b1')];
    expect(stored).toHaveLength(2);
    expect(stored.map((x) => x.item_id)).toEqual(['first', 'later']);
  });

  it('非法条目被 isShelfItem 过滤（不可信 WS 输入）：仅合法条目入桶', () => {
    handleWebSocketMessage(
      JSON.stringify({
        type: 'shelf_updated',
        scope: 'bot',
        scope_key: 'u1:b1',
        items: [makeItem({ item_id: 'ok' }), { garbage: true }],
      }),
      ctx,
    );

    const stored = useShelfStore.getState().itemsByConv[shelfKey('bot', 'u1:b1')];
    expect(stored).toHaveLength(1);
    expect(stored[0].item_id).toBe('ok');
  });
});
