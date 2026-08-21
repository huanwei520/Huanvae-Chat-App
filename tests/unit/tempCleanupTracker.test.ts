/**
 * Android 临时文件清理时机（src/lanTransfer/tempCleanupTracker.ts）
 *
 * 🔴 回归目标（外部审计 idx=98）：原实现是 `setTimeout(cleanup, 60000)` ——
 * 注释写「传输完成后清理」，代码做的是「无条件 60 秒后清理」。传一个大文件远不止 60 秒，
 * 定时器到点删掉的正是传输正在读的源文件；而且它没有任何 cleanup，页面卸载后照样触发。
 *
 * 下面四条钉住替代判据的四个关键点：
 *   1. 只在「出现过又消失」时才删（= batch_transfer_completed）；
 *   2. **还没出现过**就不算完成 —— 会话刚建、第一条进度未到时它也不在表里，
 *      用「不在表里」当完成判据会立刻删掉正要传的文件（比 60 秒还糟）；
 *   3. 结算一次即出账，不会重复删；
 *   4. abandon 放弃全部（页面卸载时传输还在跑，删源文件会砍断它）。
 */

import { describe, it, expect } from 'vitest';
import { createTempCleanupTracker } from '../../src/lanTransfer/tempCleanupTracker';

describe('createTempCleanupTracker', () => {
  it('会话出现在进度表里、随后消失 ⇒ 结算出这一批', () => {
    const t = createTempCleanupTracker();
    t.register('s1', ['/tmp/a', '/tmp/b']);

    expect(t.settle(new Set(['s1']))).toEqual([]); // 传输中：不动
    expect(t.settle(new Set())).toEqual([['/tmp/a', '/tmp/b']]); // 传完：删
  });

  it('从未出现在进度表里 ⇒ 绝不结算（这正是「立刻删掉正要传的文件」那一档）', () => {
    const t = createTempCleanupTracker();
    t.register('s1', ['/tmp/a']);

    expect(t.settle(new Set())).toEqual([]);
    expect(t.settle(new Set())).toEqual([]);
    // 直到它真的跑起来又结束
    expect(t.settle(new Set(['s1']))).toEqual([]);
    expect(t.settle(new Set())).toEqual([['/tmp/a']]);
  });

  it('结算过的批次不再出账（不会重复调用删除）', () => {
    const t = createTempCleanupTracker();
    t.register('s1', ['/tmp/a']);
    t.settle(new Set(['s1']));

    expect(t.settle(new Set())).toEqual([['/tmp/a']]);
    expect(t.settle(new Set())).toEqual([]);
  });

  it('多会话并行时各自独立结算', () => {
    const t = createTempCleanupTracker();
    t.register('s1', ['/tmp/a']);
    t.register('s2', ['/tmp/b']);
    t.settle(new Set(['s1', 's2']));

    expect(t.settle(new Set(['s2']))).toEqual([['/tmp/a']]);
    expect(t.settle(new Set())).toEqual([['/tmp/b']]);
  });

  it('abandon 放弃全部待清理项（页面卸载：传输还在跑，不能删源文件）', () => {
    const t = createTempCleanupTracker();
    t.register('s1', ['/tmp/a']);
    t.settle(new Set(['s1']));

    t.abandon();
    expect(t.settle(new Set())).toEqual([]);
  });

  it('空路径批次不登记（没有东西要删）', () => {
    const t = createTempCleanupTracker();
    t.register('s1', []);
    t.settle(new Set(['s1']));
    expect(t.settle(new Set())).toEqual([]);
  });
});
