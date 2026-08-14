/**
 * senderRunGate —— 群聊「同一人连发」的两个锚点纯逻辑
 *
 * 被测对象是 src/chat/shared/senderRunGate.ts 的 avatarAnchorKeys（头像挂组内**最新**那条）
 * 与 senderNameAnchorKeys（昵称挂组内**最旧**那条）—— 两者共用同一套分组、分处一组两端，
 * 正对着 huanwei 的验收口径「一人连发 3 条：昵称只在第一条、头像只在最后一条」。
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
import {
  avatarAnchorKeys,
  senderNameAnchorKeys,
  type SenderRunNode,
} from '../../src/chat/shared/senderRunGate';

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

/**
 * 昵称锚点：与头像锚点同一套分组，但挂在**另一端** —— 组内最旧那条（视觉最上面）。
 * 对着的验收口径是「一人连发 3 条，昵称只在第一条、头像只在最后一条」。
 */
describe('senderNameAnchorKeys（昵称锚点：组内最旧那条）', () => {
  it('一人连发 3 条 → 昵称只出现 1 次，且落在最旧那条（视觉最上面）', () => {
    // DESC：a3 最新（视觉最底）、a1 最旧（视觉最顶）
    const anchors = senderNameAnchorKeys(nodes(['a3', 'A'], ['a2', 'A'], ['a1', 'A']));

    expect([...anchors]).toEqual(['a1']);
    expect(anchors.has('a2')).toBe(false);
    expect(anchors.has('a3')).toBe(false);
  });

  it('与头像锚点分处同一组的两端：3 条连发时两个集合无交集', () => {
    const list = nodes(['a3', 'A'], ['a2', 'A'], ['a1', 'A']);
    const names = senderNameAnchorKeys(list);
    const avatars = avatarAnchorKeys(list);

    expect(names).toEqual(new Set(['a1']));
    expect(avatars).toEqual(new Set(['a3']));
    expect([...names].filter((k) => avatars.has(k))).toEqual([]);
  });

  it('单条自成一组时两端重合：同一条既显示昵称也挂头像', () => {
    const list = nodes(['a1', 'A'], ['b1', 'B']);

    expect(senderNameAnchorKeys(list)).toEqual(new Set(['a1', 'b1']));
    expect(avatarAnchorKeys(list)).toEqual(new Set(['a1', 'b1']));
  });

  it('A 发 2 条 → B 发 1 条 → A 又发 2 条：3 组、3 个昵称锚点，各落各组最旧那条', () => {
    // 时间顺序：a1 a2 b1 a3 a4 ⇒ DESC：a4 a3 b1 a2 a1
    const anchors = senderNameAnchorKeys(
      nodes(['a4', 'A'], ['a3', 'A'], ['b1', 'B'], ['a2', 'A'], ['a1', 'A']),
    );

    expect(anchors).toEqual(new Set(['a3', 'b1', 'a1']));
    // 较早那组 A 的最旧是 a1，不是 a2
    expect(anchors.has('a2')).toBe(false);
    // 较新那组 A 的最旧是 a3，不是 a4
    expect(anchors.has('a4')).toBe(false);
  });

  it('撤回行断组：它自己不显示昵称，且把上下拆成两组（两条都要显示昵称）', () => {
    const anchors = senderNameAnchorKeys(nodes(['a2', 'A'], ['r1', null], ['a1', 'A']));

    expect(anchors).toEqual(new Set(['a2', 'a1']));
    expect(anchors.has('r1')).toBe(false);
  });

  it('相册节点按一条算：与相邻同发送者的单条合并成一组', () => {
    // DESC：album-g1 最新、a1 次之、b1 最旧 ⇒ A 组最旧是 a1
    const anchors = senderNameAnchorKeys(
      nodes(['album-g1', 'A'], ['a1', 'A'], ['b1', 'B']),
    );

    expect(anchors).toEqual(new Set(['a1', 'b1']));
    expect(anchors.has('album-g1')).toBe(false);
  });

  it('undefined 项被跳过，不影响分组', () => {
    const withHole: Array<SenderRunNode | undefined> = [
      { key: 'a2', senderKey: 'A' },
      undefined,
      { key: 'a1', senderKey: 'A' },
    ];

    expect(senderNameAnchorKeys(withHole)).toEqual(new Set(['a1']));
  });

  it('空列表 → 空集合（不抛错）', () => {
    expect(senderNameAnchorKeys([])).toEqual(new Set());
  });
});
