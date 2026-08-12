/**
 * 已读回执纯函数单元测试
 *
 * 覆盖：
 * - isReadBySeq（按 seq 判定：阅读者 last-read-seq >= 消息 seq → 已读；seq 缺失/占位 0 → 未读）
 * - maxGroupSeqOf（取群消息列表最大 seq）
 * - countReadersAtSeq（群聊：读到某 seq 的成员数，排除发送者）
 * - readersAtSeq（群聊：列出读到某 seq 的已读者，排除发送者，按已读时间升序，缺信息兜底）
 * - readReceiptText（群聊文案：全部已读 / N 人已读；无应读者 **或无人已读** → null 隐藏）
 * - groupReadReceiptText（群聊文案 + seq>0 守卫：占位 0 → null，防虚显"全部已读"）
 * - isReadReceiptEligible / latestOwnReceiptUuid（已读标记只挂"我发出的最新一条"的门控锚点）
 */

import { describe, it, expect } from 'vitest';
import { isReadBySeq } from '../../src/chat/friend/useFriendReadReceipt';
import { countReadersAtSeq, readersAtSeq, readReceiptText, groupReadReceiptText, maxGroupSeqOf } from '../../src/chat/group/useGroupReadReceipt';
import type { GroupReaderInfo } from '../../src/chat/group/useGroupReadReceipt';
import { isReadReceiptEligible, latestOwnReceiptUuid } from '../../src/chat/shared/readReceiptGate';
import type { ReceiptGateMessage } from '../../src/chat/shared/readReceiptGate';
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

  it('消息 seq 为占位 0（乐观发送窗口/旧本地消息）一律返回 false（防自己刚发的消息虚显已读，回归用例）', () => {
    // 若不挡 seq=0：readerLastReadSeq(>=0) >= 0 恒真 → 误判已读
    expect(isReadBySeq(0, 100)).toBe(false);
    expect(isReadBySeq(0, 0)).toBe(false);
  });
});

describe('maxGroupSeqOf（取最大 seq）', () => {
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

describe('readersAtSeq（群聊已读名单）', () => {
  const positions = { alice: 5, bob: 3, carol: 10, self: 8 };
  const readerInfo: Record<string, GroupReaderInfo> = {
    alice: { displayName: 'Alice', avatarUrl: 'a.png', lastReadAt: '2026-06-10T10:00:00Z' },
    bob: { displayName: 'Bob', avatarUrl: null, lastReadAt: '2026-06-10T09:00:00Z' },
    carol: { displayName: 'Carol', avatarUrl: null, lastReadAt: '2026-06-10T08:00:00Z' },
    self: { displayName: 'Self', avatarUrl: null, lastReadAt: '2026-06-10T11:00:00Z' },
  };

  it('列出读到该 seq 的已读者（排除发送者），合并展示信息', () => {
    const readers = readersAtSeq(positions, readerInfo, 4, 'self'); // alice(5) carol(10)
    expect(readers.map((r) => r.userId).sort()).toEqual(['alice', 'carol']);
    const alice = readers.find((r) => r.userId === 'alice');
    expect(alice?.displayName).toBe('Alice');
    expect(alice?.avatarUrl).toBe('a.png');
  });

  it('按已读时间升序排列', () => {
    // seq=1：alice(10:00) bob(09:00) carol(08:00) self(11:00,排除) → carol,bob,alice
    const readers = readersAtSeq(positions, readerInfo, 1, 'self');
    expect(readers.map((r) => r.userId)).toEqual(['carol', 'bob', 'alice']);
  });

  it('混合有/无已读时间：有时间者按升序在前，无时间者排末尾', () => {
    const pos = { a: 5, b: 5, c: 5, d: 5 };
    const info: Record<string, GroupReaderInfo> = {
      a: { displayName: 'A', avatarUrl: null, lastReadAt: '2026-06-10T10:00:00Z' },
      b: { displayName: 'B', avatarUrl: null, lastReadAt: '2026-06-10T09:00:00Z' },
      // c、d 无 readerInfo → lastReadAt 视为 null
    };
    const ids = readersAtSeq(pos, info, 1, 'self').map((r) => r.userId);
    expect(ids.slice(0, 2)).toEqual(['b', 'a']); // 有时间者升序在前
    expect(ids.slice(2).sort()).toEqual(['c', 'd']); // 无时间者排末尾
  });

  it('占位 seq<=0 返回空数组（防把默认 seq=0 全体误列为已读）', () => {
    expect(readersAtSeq(positions, readerInfo, 0, 'self')).toEqual([]);
    expect(readersAtSeq(positions, readerInfo, -1, 'self')).toEqual([]);
  });

  it('缺展示信息时 displayName 兜底为 userId、头像/时间为 null', () => {
    const readers = readersAtSeq({ ghost: 9 }, {}, 5, 'self');
    expect(readers).toEqual([{ userId: 'ghost', displayName: 'ghost', avatarUrl: null, lastReadAt: null }]);
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

  it('无人已读（readers<=0）返回 null —— 隐藏而不是显示"0 人已读"（产品口径回归用例）', () => {
    expect(readReceiptText(0, 2)).toBeNull();
    expect(readReceiptText(0, 99)).toBeNull();
    // 反向锚点：只要有 1 个人读过就必须显示，别把整条口径改成"永不显示"
    expect(readReceiptText(1, 99)).toBe('1 人已读');
  });
});

describe('groupReadReceiptText（含 seq>0 守卫的群消息文案）', () => {
  it('seq 为占位 0（乐观发送窗口/旧本地消息）→ null 不展示（防虚显"全部已读"，回归用例）', () => {
    // 若不挡：countReaders(0,_) 把默认 last_read_seq=0 全体计入 → readReceiptText 误显"全部已读"
    expect(groupReadReceiptText(0, 3, 3)).toBeNull();
    expect(groupReadReceiptText(0, 0, 3)).toBeNull();
  });

  it('seq>0 时按已读/应读人数走 readReceiptText（全部已读 / N 人已读）', () => {
    expect(groupReadReceiptText(5, 3, 3)).toBe('全部已读');
    expect(groupReadReceiptText(5, 1, 3)).toBe('1 人已读');
  });

  it('seq>0 但无应读者（eligible<=0，如单人群）→ null', () => {
    expect(groupReadReceiptText(5, 0, 0)).toBeNull();
  });

  it('seq>0、有应读者但一个人都没读 → null（隐藏，不显示"0 人已读"）', () => {
    expect(groupReadReceiptText(5, 0, 3)).toBeNull();
  });
});

describe('latestOwnReceiptUuid（已读标记只挂我发出的最新一条）', () => {
  /** 门控只看这四个字段；列表传进来的是**倒序（新→旧）**的渲染代表消息 */
  const msg = (uuid: string, over: Partial<ReceiptGateMessage> = {}): ReceiptGateMessage => ({
    message_uuid: uuid,
    sender_id: 'me',
    is_recalled: false,
    ...over,
  });

  it('三条自己的消息 → 取最新那条（倒序列表的第一条），不是最旧那条', () => {
    expect(latestOwnReceiptUuid([msg('u3'), msg('u2'), msg('u1')], 'me')).toBe('u3');
  });

  it('最新一条是对方发的 → 仍取我发出的最新一条（不因对方回话而消失）', () => {
    const list = [msg('p1', { sender_id: 'peer' }), msg('u2'), msg('u1')];
    expect(latestOwnReceiptUuid(list, 'me')).toBe('u2');
  });

  it('发送中 / 失败 / 已撤回的自己消息不参与锚点竞争（发送状态槽另有显示）', () => {
    const list = [
      msg('s1', { sendStatus: 'sending' }),
      msg('f1', { sendStatus: 'failed' }),
      msg('r1', { is_recalled: true }),
      msg('u1'),
    ];
    expect(latestOwnReceiptUuid(list, 'me')).toBe('u1');
  });

  it('没有任何自己发出的已送达消息 → null（一个标记都不挂）', () => {
    expect(latestOwnReceiptUuid([msg('p1', { sender_id: 'peer' })], 'me')).toBeNull();
    expect(latestOwnReceiptUuid([], 'me')).toBeNull();
  });

  it('容忍 undefined 项（相册空组的理论形态），跳过后继续找', () => {
    expect(latestOwnReceiptUuid([undefined, msg('u2'), msg('u1')], 'me')).toBe('u2');
  });
});

describe('isReadReceiptEligible（已读态显示资格）', () => {
  const base: ReceiptGateMessage = { message_uuid: 'u1', sender_id: 'me', is_recalled: false };

  it('自己发出 + 未撤回 + 已送达 → 有资格', () => {
    expect(isReadReceiptEligible(base, 'me')).toBe(true);
    expect(isReadReceiptEligible({ ...base, sendStatus: 'sent' }, 'me')).toBe(true);
  });

  it('对方的消息 / 已撤回 / 发送中 / 失败 → 无资格', () => {
    expect(isReadReceiptEligible({ ...base, sender_id: 'peer' }, 'me')).toBe(false);
    expect(isReadReceiptEligible({ ...base, is_recalled: true }, 'me')).toBe(false);
    expect(isReadReceiptEligible({ ...base, sendStatus: 'sending' }, 'me')).toBe(false);
    expect(isReadReceiptEligible({ ...base, sendStatus: 'failed' }, 'me')).toBe(false);
  });
});
