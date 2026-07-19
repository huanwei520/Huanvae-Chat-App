/**
 * conversationSort 共享排序纯函数测试（L1：纯函数，无 DOM/mock）
 *
 * 防回归契约：
 * 1. shuffle 不变性 —— 任意输入序输出序唯一（逼出 uniqueKey tie-break，
 *    无 tie-break 时并列项顺序 = 输入数组序，会随上游数组整体替换翻动）
 * 2. 同时间并列 → 按 uniqueKey localeCompare 稳定排序
 * 3. 非法时间串（NaN）/ null 时间 → 不抛、按 0 处理确定落底
 * 4. compareByTimeDesc（friends tab 内层等）：纯时间降序，完全忽略未读
 * 5. 缺陷②回归：清未读（unread N→0）不改变排序序列（红点仅徽标，不参与排序）
 * 6. comparePinnedThenTime（chat/group tab）：置顶分层在前，同层内时间降序；
 *    全员未置顶时与 compareByTimeDesc 完全等价
 */

import { describe, it, expect } from 'vitest';
import {
  compareByTimeDesc,
  comparePinnedThenTime,
  type SortableCard,
} from '../../src/components/unified/conversationSort';

function card(
  uniqueKey: string,
  lastMessageTime: string | null,
  unreadCount = 0,
  isPinned = false,
): SortableCard {
  return { uniqueKey, lastMessageTime, unreadCount, isPinned };
}

/** 确定性 Fisher-Yates（LCG 种子），避免随机种子导致测试不可复现 */
function deterministicShuffle<T>(input: T[], seed: number): T[] {
  const arr = [...input];
  let state = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 混合形态卡片集：含重复时间、null、非法时间串、未读分层
const CARDS: SortableCard[] = [
  card('friend-f1', '2026-03-01T10:00:00Z'),
  card('group-g1', '2026-03-01T10:00:00Z'), // 与 f1 同时间 → 并列
  card('friend-f2', '2026-03-02T10:00:00Z', 3), // 未读
  card('group-g2', 'not-a-date'), // 非法时间 → NaN → 0
  card('friend-f3', null), // null 时间 → 0
  card('group-g3', '2026-01-01T00:00:00Z', 1), // 未读但时间较旧
  card('friend-f4', '2026-03-03T10:00:00Z'),
];

describe('conversationSort shuffle 不变性', () => {
  it('compareByTimeDesc：任意输入序输出序唯一', () => {
    const baseline = [...CARDS].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    const permutations = [
      [...CARDS].reverse(),
      deterministicShuffle(CARDS, 7),
      deterministicShuffle(CARDS, 99),
    ];
    for (const perm of permutations) {
      const sorted = perm.sort(compareByTimeDesc).map((c) => c.uniqueKey);
      expect(sorted).toEqual(baseline);
    }
  });
});

describe('同时间并列 tie-break', () => {
  it('同时间按 uniqueKey localeCompare 升序', () => {
    const a = card('group-g1', '2026-03-01T10:00:00Z');
    const b = card('friend-f1', '2026-03-01T10:00:00Z');
    // 'friend-f1' < 'group-g1' → f1 排前
    const sorted = [a, b].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(sorted).toEqual(['friend-f1', 'group-g1']);
    // 反向输入同样输出
    const sorted2 = [b, a].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(sorted2).toEqual(['friend-f1', 'group-g1']);
  });

  it('比较器满足反对称性：compare(a,b) 与 compare(b,a) 符号相反', () => {
    const a = card('friend-f1', '2026-03-01T10:00:00Z');
    const b = card('group-g1', '2026-03-01T10:00:00Z');
    expect(compareByTimeDesc(a, b)).toBeLessThan(0);
    expect(compareByTimeDesc(b, a)).toBeGreaterThan(0);
    expect(compareByTimeDesc(a, a)).toBe(0);
  });
});

describe('非法/缺失时间硬化', () => {
  it('非法时间串与 null 不抛，确定落底', () => {
    const valid = card('friend-f1', '2026-03-01T10:00:00Z');
    const invalid = card('group-g2', 'not-a-date');
    const nullTime = card('friend-f3', null);
    const sorted = [invalid, valid, nullTime].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    // 有效时间在前；NaN 与 null 同为 0 落底，按 uniqueKey 稳定排序
    expect(sorted).toEqual(['friend-f1', 'friend-f3', 'group-g2']);
  });

  it('全员非法时间也输出确定序（不退化为输入序）', () => {
    const cards = [card('c', 'garbage'), card('a', 'NaN'), card('b', null)];
    const sorted = [...cards].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(sorted).toEqual(['a', 'b', 'c']);
    const sortedReversed = [...cards].reverse().sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(sortedReversed).toEqual(['a', 'b', 'c']);
  });
});

describe('未读不参与排序', () => {
  it('compareByTimeDesc 忽略未读，纯时间降序（未读但更旧的卡仍排在后面）', () => {
    const unreadOld = card('group-g3', '2026-01-01T00:00:00Z', 5);
    const readNew = card('friend-f4', '2026-03-03T10:00:00Z');
    const sorted = [unreadOld, readNew].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(sorted).toEqual(['friend-f4', 'group-g3']);
  });
});

describe('清未读不改变排序（缺陷②回归）', () => {
  // 核心验收点：点击带红点的消息卡片 → markRead → 该卡 unread N→0，
  // 列表顺序必须保持不变（与微信一致：红点仅徽标，不参与排序）。
  //
  // 用例刻意放一张「时间居中但有未读」的卡（group-b）：
  // - 纯时间排序（compareByTimeDesc）下，清未读不影响任何卡片位置 → A === B（PASS）
  // - 若排序依赖未读（如旧的 compareByUnreadThenTimeDesc），未读时 group-b 会被提到队首，
  //   清未读后跌回时间序中段 → A !== B（FAIL）。这保证本测试能拦下「排序依赖 unread」的回归。
  it('某卡 unread 5→0 后 compareByTimeDesc 排序序列完全不变', () => {
    const before: SortableCard[] = [
      card('friend-a', '2026-03-05T10:00:00Z', 0), // 最新
      card('group-b', '2026-03-03T10:00:00Z', 5),  // 未读，时间居中
      card('friend-c', '2026-03-01T10:00:00Z', 0), // 最旧
    ];
    const orderA = [...before].sort(compareByTimeDesc).map((c) => c.uniqueKey);

    // 模拟点击带红点的卡片 → markRead → 未读归零
    const after = before.map((c) =>
      c.uniqueKey === 'group-b' ? { ...c, unreadCount: 0 } : c,
    );
    const orderB = [...after].sort(compareByTimeDesc).map((c) => c.uniqueKey);

    // 清未读前后顺序完全一致，且就是纯时间降序
    expect(orderB).toEqual(orderA);
    expect(orderA).toEqual(['friend-a', 'group-b', 'friend-c']);
  });
});

describe('comparePinnedThenTime 置顶分层', () => {
  it('置顶卡排在所有未置顶卡之前（即使时间更旧）', () => {
    const pinnedOld = card('group-pinned', '2026-01-01T00:00:00Z', 0, true);
    const unpinnedNew = card('friend-new', '2026-03-05T10:00:00Z');
    const sorted = [unpinnedNew, pinnedOld].sort(comparePinnedThenTime).map((c) => c.uniqueKey);
    expect(sorted).toEqual(['group-pinned', 'friend-new']);
  });

  it('同层内时间降序，同层同时间按 uniqueKey tie-break', () => {
    const cards = [
      card('friend-p-old', '2026-01-01T00:00:00Z', 0, true),
      card('friend-p-new', '2026-03-01T00:00:00Z', 0, true),
      card('group-u-new', '2026-03-05T00:00:00Z'),
      card('friend-u-old', '2026-02-01T00:00:00Z'),
      // 未置顶层同时间并列 → uniqueKey tie-break
      card('friend-tie-b', '2026-02-01T00:00:00Z'),
    ];
    const sorted = [...cards].sort(comparePinnedThenTime).map((c) => c.uniqueKey);
    expect(sorted).toEqual([
      'friend-p-new',   // 置顶层：时间降序
      'friend-p-old',
      'group-u-new',    // 未置顶层：时间降序
      'friend-tie-b',   // 与 friend-u-old 同时间 → localeCompare 升序
      'friend-u-old',
    ]);
  });

  it('比较器满足反对称性（置顶 vs 未置顶）', () => {
    const pinned = card('friend-p', '2026-01-01T00:00:00Z', 0, true);
    const unpinned = card('friend-u', '2026-03-01T00:00:00Z');
    expect(comparePinnedThenTime(pinned, unpinned)).toBeLessThan(0);
    expect(comparePinnedThenTime(unpinned, pinned)).toBeGreaterThan(0);
    expect(comparePinnedThenTime(pinned, pinned)).toBe(0);
  });

  it('全员未置顶时与 compareByTimeDesc 完全等价', () => {
    const byPinned = [...CARDS].sort(comparePinnedThenTime).map((c) => c.uniqueKey);
    const byTime = [...CARDS].sort(compareByTimeDesc).map((c) => c.uniqueKey);
    expect(byPinned).toEqual(byTime);
  });

  it('任意输入序输出序唯一（shuffle 不变性，含置顶混排）', () => {
    const mixed = [
      ...CARDS,
      card('group-pin-1', '2026-01-15T00:00:00Z', 0, true),
      card('friend-pin-2', null, 0, true), // 置顶但无时间 → 置顶层落底
    ];
    const baseline = [...mixed].sort(comparePinnedThenTime).map((c) => c.uniqueKey);
    const permutations = [
      [...mixed].reverse(),
      deterministicShuffle(mixed, 7),
      deterministicShuffle(mixed, 99),
    ];
    for (const perm of permutations) {
      expect(perm.sort(comparePinnedThenTime).map((c) => c.uniqueKey)).toEqual(baseline);
    }
    // 置顶两张恒在最前
    expect(baseline.slice(0, 2)).toEqual(['group-pin-1', 'friend-pin-2']);
  });
});
