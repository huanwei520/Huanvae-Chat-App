/**
 * 已读回执纯函数单元测试
 *
 * 覆盖：
 * - isMessageReadByPeer（私聊：对方已读时间 >= 消息发送时间 → 已读）
 * - countReadersAtSeq（群聊：统计读到某 seq 的成员数，排除发送者本人）
 */

import { describe, it, expect } from 'vitest';
import { isMessageReadByPeer } from '../../src/chat/friend/useFriendReadReceipt';
import { countReadersAtSeq } from '../../src/chat/group/useGroupReadReceipt';

describe('isMessageReadByPeer（私聊已读判定）', () => {
  const sendTime = '2026-06-08T10:00:00.000Z';

  it('对方未读（peerReadAt 为 null）返回 false', () => {
    expect(isMessageReadByPeer(sendTime, null)).toBe(false);
  });

  it('对方已读时间晚于发送时间返回 true', () => {
    expect(isMessageReadByPeer(sendTime, '2026-06-08T10:00:05.000Z')).toBe(true);
  });

  it('对方已读时间等于发送时间返回 true', () => {
    expect(isMessageReadByPeer(sendTime, '2026-06-08T10:00:00.000Z')).toBe(true);
  });

  it('对方已读时间早于发送时间返回 false（消息发送在对方上次已读之后）', () => {
    expect(isMessageReadByPeer(sendTime, '2026-06-08T09:59:59.000Z')).toBe(false);
  });

  it('按时间戳比较而非字符串字典序（同一时刻不同时区表示视为已读）', () => {
    // 18:00:00+08:00 与 10:00:00Z 是同一时刻；字典序 '1' < '2' 会误判，getTime 比较则相等→已读
    expect(isMessageReadByPeer(sendTime, '2026-06-08T18:00:00.000+08:00')).toBe(true);
  });
});

describe('countReadersAtSeq（群聊 N 人已读统计）', () => {
  const positions = { alice: 5, bob: 3, carol: 10, self: 8 };

  it('统计 last-read-seq >= 消息 seq 的成员数，排除发送者本人', () => {
    // seq=4：alice(5)✓ carol(10)✓ self(8 但被排除) bob(3)✗ → 2
    expect(countReadersAtSeq(positions, 4, 'self')).toBe(2);
  });

  it('发送者自己达标也不计入', () => {
    // seq=8：carol(10)✓ self(8 排除) alice(5)✗ → 1
    expect(countReadersAtSeq(positions, 8, 'self')).toBe(1);
  });

  it('无人读到该 seq 返回 0', () => {
    expect(countReadersAtSeq(positions, 100, 'self')).toBe(0);
  });

  it('空位置映射返回 0', () => {
    expect(countReadersAtSeq({}, 1, 'self')).toBe(0);
  });

  it('排除的发送者不在映射中时不影响统计', () => {
    // sender='nobody' 不在 map；seq=3 → alice(5) bob(3) carol(10) self(8) 全部 >=3 → 4
    expect(countReadersAtSeq(positions, 3, 'nobody')).toBe(4);
  });
});
