/**
 * senderRunGate —— 群聊「同一人连发只在最新那条挂头像」的纯逻辑（方案 C）
 *
 * 被测对象是 src/chat/shared/senderRunGate.ts 的 avatarAnchorKeys。
 * 输入约定：**DESC（新 → 旧）**，与 GroupChatMessages 的 renderNodes 同序；
 * 列表是 column-reverse ⇒ index 0 落在视觉最底 ⇒ 「组内最新那条」= 每组第一个遇到的节点。
 *
 * 四条用例正对着 huanwei 的验收口径：
 *   1. 一人连发 3 条 ⇒ 只有 1 个锚点，且落在最新那条
 *   2. A 发 2 条 → B 发 1 条 → A 又发 2 条 ⇒ 3 组、3 个锚点，两组 A 各自挂自己那组的最新
 *   3. 撤回行断组，且它自己永不成为锚点
 *   4. 相册按一条算（调用方递进来的已经是折叠后的节点，这里只验它被当成普通一条对待）
 */

import { describe, it, expect } from 'vitest';
import { avatarAnchorKeys, type SenderRunNode } from '../../src/chat/shared/senderRunGate';

/** 便捷构造：DESC 顺序写，第一个是最新的 */
function nodes(...pairs: Array<[key: string, sender: string | null]>): SenderRunNode[] {
  return pairs.map(([key, senderKey]) => ({ key, senderKey }));
}

describe('avatarAnchorKeys（方案 C 头像锚点）', () => {
  it('一人连发 3 条 → 只有最新那条挂头像', () => {
    // DESC：a3 最新（视觉最底）、a1 最旧
    const anchors = avatarAnchorKeys(nodes(['a3', 'A'], ['a2', 'A'], ['a1', 'A']));

    expect([...anchors]).toEqual(['a3']);
    expect(anchors.has('a2')).toBe(false);
    expect(anchors.has('a1')).toBe(false);
  });

  it('A 发 2 条 → B 发 1 条 → A 又发 2 条：正确断成 3 组，两组 A 各挂自己那组的最新', () => {
    // 时间顺序：a1 a2 b1 a3 a4 ⇒ DESC：a4 a3 b1 a2 a1
    const anchors = avatarAnchorKeys(
      nodes(['a4', 'A'], ['a3', 'A'], ['b1', 'B'], ['a2', 'A'], ['a1', 'A']),
    );

    expect(anchors).toEqual(new Set(['a4', 'b1', 'a2']));
    // 第二组 A（较早那组）的最新是 a2，不是 a1
    expect(anchors.has('a1')).toBe(false);
    // 第一组 A（较新那组）的最新是 a4，不是 a3
    expect(anchors.has('a3')).toBe(false);
  });

  it('撤回行断组：它自己不挂头像，且把上下拆成两组', () => {
    // DESC：a2（A）、r1（撤回）、a1（A）—— 若不断组则只会有 1 个锚点
    const anchors = avatarAnchorKeys(nodes(['a2', 'A'], ['r1', null], ['a1', 'A']));

    expect(anchors).toEqual(new Set(['a2', 'a1']));
    expect(anchors.has('r1')).toBe(false);
  });

  it('相册节点按一条算：与相邻同发送者的单条合并成一组', () => {
    const anchors = avatarAnchorKeys(
      nodes(['album-g1', 'A'], ['a1', 'A'], ['b1', 'B']),
    );

    expect(anchors).toEqual(new Set(['album-g1', 'b1']));
  });

  it('undefined 项被跳过（相册空组的理论形态），不影响分组', () => {
    const withHole: Array<SenderRunNode | undefined> = [
      { key: 'a2', senderKey: 'A' },
      undefined,
      { key: 'a1', senderKey: 'A' },
    ];

    expect(avatarAnchorKeys(withHole)).toEqual(new Set(['a2']));
  });

  it('空列表 → 空集合（不抛错）', () => {
    expect(avatarAnchorKeys([])).toEqual(new Set());
  });
});
