/**
 * 已读回执纯函数单元测试
 *
 * 覆盖：
 * - isReadBySeq（按 seq 判定：阅读者 last-read-seq >= 消息 seq → 已读；seq 缺失 → 未读）
 * - maxSeqOf / maxGroupSeqOf（取消息列表最大 seq）
 * - countReadersAtSeq（群聊：读到某 seq 的成员数，排除发送者）
 * - readReceiptText（群聊文案：全部已读 / N 人已读 / 无应读者 null）
 */

import { describe, it, expect } from 'vitest';
import { isReadBySeq, maxSeqOf } from '../../src/chat/friend/useFriendReadReceipt';
import { countReadersAtSeq, readReceiptText, maxGroupSeqOf } from '../../src/chat/group/useGroupReadReceipt';
import type { Message } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';

describe('isReadBySeq（按 seq 已读判定）', () => {
  it('消息 seq 缺失（如发送中）返回 false', () => {
    expect(isReadBySeq(undefined, 100)).toBe(false);
  });

  it('阅读者位置 > 消息 seq 返回 true', () => {
    expect(isReadBySeq(5, 8)).toBe(true);
  });

  it('阅读者位置 == 消息 seq 返回 true（边界）', () => {
    expect(isReadBySeq(5, 5)).toBe(true);
  });

  it('阅读者位置 < 消息 seq 返回 false', () => {
    expect(isReadBySeq(5, 4)).toBe(false);
  });
});

describe('maxSeqOf / maxGroupSeqOf（取最大 seq）', () => {
  it('私聊：取最大 seq，忽略 undefined', () => {
    const msgs = [{ seq: 3 }, { seq: undefined }, { seq: 7 }] as unknown as Message[];
    expect(maxSeqOf(msgs)).toBe(7);
  });

  it('私聊：空列表返回 0', () => {
    expect(maxSeqOf([])).toBe(0);
  });

  it('群聊：取最大 seq', () => {
    const msgs = [{ seq: 10 }, { seq: 42 }, { seq: 5 }] as unknown as GroupMessage[];
    expect(maxGroupSeqOf(msgs)).toBe(42);
  });

  it('群聊：空列表返回 0', () => {
    expect(maxGroupSeqOf([])).toBe(0);
  });
});

describe('countReadersAtSeq（群聊已读人数统计）', () => {
  const positions = { alice: 5, bob: 3, carol: 10, self: 8 };

  it('统计 last-read-seq >= 消息 seq 的成员数，排除发送者本人', () => {
    expect(countReadersAtSeq(positions, 4, 'self')).toBe(2); // alice(5) carol(10)，self 排除，bob(3) 不达标
  });

  it('发送者自己达标也不计入', () => {
    expect(countReadersAtSeq(positions, 8, 'self')).toBe(1); // carol(10)，self 排除
  });

  it('无人读到该 seq 返回 0', () => {
    expect(countReadersAtSeq(positions, 100, 'self')).toBe(0);
  });

  it('空位置映射返回 0', () => {
    expect(countReadersAtSeq({}, 1, 'self')).toBe(0);
  });

  it('排除别的发送者：sender=alice 时不计 alice', () => {
    // seq=3：alice(5,排除) bob(3) carol(10) self(8) → 3
    expect(countReadersAtSeq(positions, 3, 'alice')).toBe(3);
  });
});

describe('readReceiptText（群聊文案）', () => {
  it('无应读者（eligible<=0）返回 null（不展示）', () => {
    expect(readReceiptText(0, 0)).toBeNull();
    expect(readReceiptText(0, -1)).toBeNull();
  });

  it('已读人数达到应读人数显示"全部已读"', () => {
    expect(readReceiptText(2, 2)).toBe('全部已读');
    expect(readReceiptText(3, 2)).toBe('全部已读'); // 防御：超出也算全部
  });

  it('部分已读显示"N 人已读"', () => {
    expect(readReceiptText(1, 2)).toBe('1 人已读');
  });

  it('无人已读显示"0 人已读"', () => {
    expect(readReceiptText(0, 2)).toBe('0 人已读');
  });
});
