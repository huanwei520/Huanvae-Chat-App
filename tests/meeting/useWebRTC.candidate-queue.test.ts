/**
 * pending ICE candidate 队列单元测试（src/meeting/webrtcCore.ts PendingCandidates）
 *
 * 回归重点（R3）：remoteDescription 未就绪时候选者入队；就绪后 drain 全部（按序）并清队，
 * 保证零丢弃。
 */

import { describe, it, expect } from 'vitest';
import { PendingCandidates } from '../../src/meeting/webrtcCore';

const cand = (mid: string): RTCIceCandidateInit => ({ candidate: `c-${mid}`, sdpMid: mid, sdpMLineIndex: 0 });

describe('PendingCandidates', () => {
  it('入队后 count 递增，drain 按 FIFO 顺序返回全部并清队', () => {
    const q = new PendingCandidates();
    q.add('peer1', cand('0'));
    q.add('peer1', cand('1'));
    q.add('peer1', cand('2'));
    expect(q.count('peer1')).toBe(3);

    const drained = q.drain('peer1');
    expect(drained).toEqual([cand('0'), cand('1'), cand('2')]); // 按到达顺序
    expect(q.count('peer1')).toBe(0); // 清队

    // 二次 drain 无残留
    expect(q.drain('peer1')).toEqual([]);
  });

  it('未入队的 peer：count 为 0，drain 返回空数组', () => {
    const q = new PendingCandidates();
    expect(q.count('unknown')).toBe(0);
    expect(q.drain('unknown')).toEqual([]);
  });

  it('不同 peer 的队列相互隔离', () => {
    const q = new PendingCandidates();
    q.add('peerA', cand('a0'));
    q.add('peerB', cand('b0'));
    q.add('peerB', cand('b1'));
    expect(q.count('peerA')).toBe(1);
    expect(q.count('peerB')).toBe(2);

    expect(q.drain('peerA')).toEqual([cand('a0')]);
    // drain peerA 不影响 peerB
    expect(q.count('peerB')).toBe(2);
  });

  it('remove 只清指定 peer；clear 清全部', () => {
    const q = new PendingCandidates();
    q.add('peerA', cand('a0'));
    q.add('peerB', cand('b0'));

    q.remove('peerA');
    expect(q.count('peerA')).toBe(0);
    expect(q.count('peerB')).toBe(1); // remove 不影响其他 peer

    q.clear();
    expect(q.count('peerB')).toBe(0);
  });
});
