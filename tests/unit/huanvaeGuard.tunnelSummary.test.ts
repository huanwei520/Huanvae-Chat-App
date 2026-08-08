/**
 * HuanvaeGuard 隧道摘要取数单测（零 mock 纯函数）
 *
 * 钉的是 213cc60 的行为契约：「正常但空闲」不许被显示成「坏了」。
 *
 * `last_handshake` 是**距今秒数**，且 `0` 有歧义（从未握手 / 刚握手不到 1 秒）。
 * 天真的 `Math.min(...ages)` 会被任意一个 age=0 的空闲对端拖成 0 →
 * 状态冠据此写出「尚未握手」，而同一时刻对端表里另一行明明是「4 秒前」。
 * 下面第二、三条就是那个回归的直接复现（在旧写法下必 FAIL）。
 */

import { describe, it, expect } from 'vitest';
import { freshestHandshakeAge } from '../../src/huanvaeGuard/tunnelSummary';

/** 只有 last_handshake 参与判定，构造最小对象即可 */
function peersOf(...ages: number[]): { last_handshake: number }[] {
  return ages.map((last_handshake) => ({ last_handshake }));
}

describe('freshestHandshakeAge', () => {
  it('没有对端 → null', () => {
    expect(freshestHandshakeAge([])).toBeNull();
  });

  it('所有对端都是 0（一个都没握过手）→ null', () => {
    expect(freshestHandshakeAge(peersOf(0))).toBeNull();
    expect(freshestHandshakeAge(peersOf(0, 0, 0))).toBeNull();
  });

  it('混合 [4, 0] → 4（空闲对端不许把结论拖成"尚未握手"）', () => {
    // 旧写法 Math.min(4, 0) = 0 → 冠上写「尚未握手」，而对端表里明明有「4 秒前」
    expect(freshestHandshakeAge(peersOf(4, 0))).toBe(4);
    expect(freshestHandshakeAge(peersOf(0, 4))).toBe(4);
  });

  it('多个握过手的对端取最新（最小 age）：[0, 9, 3] → 3', () => {
    expect(freshestHandshakeAge(peersOf(0, 9, 3))).toBe(3);
  });

  it('全部握过手时就是普通最小值', () => {
    expect(freshestHandshakeAge(peersOf(120, 7, 45))).toBe(7);
    expect(freshestHandshakeAge(peersOf(1))).toBe(1);
  });

  it('不修改入参', () => {
    const peers = peersOf(0, 9, 3);
    freshestHandshakeAge(peers);
    expect(peers.map((p) => p.last_handshake)).toEqual([0, 9, 3]);
  });
});
