/**
 * 顶置架 Store (shelfStore) 测试
 *
 * 覆盖：
 * - shelfKey 组合键拼接（scope|scopeKey，scopeKey 原样保留冒号）
 * - setItems 按 position 升序整组替换 + 按 shelfKey 独立分桶
 * - isShelfItem 运行时守卫（WS 跨进程输入逐条校验）
 * - clear 清空
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useShelfStore, shelfKey, isShelfItem } from '../../src/stores/shelfStore';
import type { ShelfItem } from '../../src/api/shelf';

/** 构造一个合法 ShelfItem，允许字段覆盖 */
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

describe('shelfKey 组合键', () => {
  it('scopeKey 内的冒号原样保留（不编码），键为 scope|scopeKey', () => {
    expect(shelfKey('bot', 'u1:b1')).toBe('bot|u1:b1');
  });

  it('群会话键 = group|groupId', () => {
    expect(shelfKey('group', 'g1')).toBe('group|g1');
  });
});

describe('setItems 排序与分桶', () => {
  it('按 position 升序整组存入（乱序输入被排序）', () => {
    useShelfStore.getState().setItems('group', 'g1', [
      makeItem({ item_id: 'a', position: 2 }),
      makeItem({ item_id: 'b', position: 0 }),
      makeItem({ item_id: 'c', position: 1 }),
    ]);
    const stored = useShelfStore.getState().itemsByConv[shelfKey('group', 'g1')];
    expect(stored.map((x) => x.position)).toEqual([0, 1, 2]);
    expect(stored.map((x) => x.item_id)).toEqual(['b', 'c', 'a']);
  });

  it('不同 shelfKey 独立分桶，互不覆盖', () => {
    const a = makeItem({ item_id: 'a' });
    const b = makeItem({ item_id: 'b' });
    useShelfStore.getState().setItems('bot', 'k1', [a]);
    useShelfStore.getState().setItems('group', 'k2', [b]);
    const conv = useShelfStore.getState().itemsByConv;
    expect(conv[shelfKey('bot', 'k1')].map((x) => x.item_id)).toEqual(['a']);
    expect(conv[shelfKey('group', 'k2')].map((x) => x.item_id)).toEqual(['b']);
  });

  it('对同一桶二次 setItems 是整组替换（非合并）', () => {
    useShelfStore.getState().setItems('group', 'g1', [makeItem({ item_id: 'old' })]);
    useShelfStore.getState().setItems('group', 'g1', [makeItem({ item_id: 'new' })]);
    const stored = useShelfStore.getState().itemsByConv[shelfKey('group', 'g1')];
    expect(stored.map((x) => x.item_id)).toEqual(['new']);
  });
});

describe('isShelfItem 运行时守卫', () => {
  it('完整合法条目 → true', () => {
    expect(isShelfItem(makeItem())).toBe(true);
  });

  it('缺 message_uuid → false', () => {
    const bad = makeItem();
    delete (bad as Partial<ShelfItem>).message_uuid;
    expect(isShelfItem(bad)).toBe(false);
  });

  it('note 为 null → true（允许可空）', () => {
    expect(isShelfItem(makeItem({ note: null }))).toBe(true);
  });

  it('note 为数字 → false', () => {
    expect(isShelfItem({ ...makeItem(), note: 5 })).toBe(false);
  });

  it('position 为字符串 → false', () => {
    expect(isShelfItem({ ...makeItem(), position: '1' })).toBe(false);
  });

  it('非对象 / null → false', () => {
    expect(isShelfItem(null)).toBe(false);
    expect(isShelfItem('nope')).toBe(false);
    expect(isShelfItem(42)).toBe(false);
    expect(isShelfItem(undefined)).toBe(false);
  });
});

describe('clear', () => {
  it('清空 itemsByConv', () => {
    useShelfStore.getState().setItems('group', 'g1', [makeItem()]);
    expect(Object.keys(useShelfStore.getState().itemsByConv).length).toBe(1);
    useShelfStore.getState().clear();
    expect(useShelfStore.getState().itemsByConv).toEqual({});
  });
});
