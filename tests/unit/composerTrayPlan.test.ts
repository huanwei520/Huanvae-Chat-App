/**
 * 待发区 → 发送计划：四格矩阵 + 「单条不包相册」硬约束的机器守卫
 *
 * 四格矩阵是 huanwei 2026-08-12 11:01 定死的产品口径（spec §二），
 * 其中「单个 ⇒ 保持原样、**不包相册**」是硬约束 —— 相册折叠会抹掉组内非代表成员的
 * DOM 锚点，把单条也包进去等于把「定位报『原消息不在本地记录中』」那个缺陷扩大到所有媒体消息。
 * 所以这里对四格各写一条，并对两个「单个」格子**显式反向断言**三件套不存在。
 */

import { describe, it, expect } from 'vitest';
import {
  planComposerTraySend,
  splitIntoShapes,
  splitByCapacity,
  familyOf,
  ALBUM_MAX_ITEMS,
  type TrayItemKind,
} from '../../src/chat/shared/composerTrayPlan';

interface Item { id: string; kind: TrayItemKind }
const img = (id: string): Item => ({ id, kind: 'image' });
const vid = (id: string): Item => ({ id, kind: 'video' });
const doc = (id: string): Item => ({ id, kind: 'file' });

describe('四格矩阵（spec §二）', () => {
  it('多个 + 无文字 ⇒ 合成相册（三件套齐全、无 caption）', () => {
    const plan = planComposerTraySend([img('a'), img('b'), vid('c')], '', ['G1']);
    expect(plan.albumCount).toBe(1);
    expect(plan.standaloneText).toBeNull();
    expect(plan.items.map((p) => p.shapeKind)).toEqual(['album', 'album', 'album']);
    expect(plan.items.map((p) => p.groupId)).toEqual(['G1', 'G1', 'G1']);
    expect(plan.items.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(plan.items.map((p) => p.count)).toEqual([3, 3, 3]);
    expect(plan.items.map((p) => p.caption)).toEqual([undefined, undefined, undefined]);
  });

  it('多个 + 有文字 ⇒ 相册 + 文字，caption 只挂 index 0（其余位次带 caption 后端直接 400）', () => {
    const plan = planComposerTraySend([img('a'), img('b')], '  合影  ', ['G1']);
    expect(plan.items.map((p) => p.caption)).toEqual(['合影', undefined]);
    // 顺带钉死 trim：前后空白不该被当成正文
    expect(plan.items[0].caption).toBe('合影');
  });

  it('🔴 单个 + 无文字 ⇒ 保持原样：single 形态，media_group 三件套一个都不带', () => {
    const plan = planComposerTraySend([img('only')], '', []);
    expect(plan.albumCount).toBe(0);
    expect(plan.items).toHaveLength(1);
    const p = plan.items[0];
    expect(p.shapeKind).toBe('single');
    expect(p.groupId).toBeUndefined();
    expect(p.index).toBeUndefined();
    expect(p.count).toBeUndefined();
    expect(p.caption).toBeUndefined();
  });

  it('🔴 单个 + 有文字 ⇒ 该媒体 + 文字：caption 直接作正文，仍然不带三件套', () => {
    const plan = planComposerTraySend([vid('only')], '看这个', []);
    const p = plan.items[0];
    expect(p.shapeKind).toBe('single');
    expect(p.caption).toBe('看这个');
    // 反向断言：不成组的单条**可以**带 caption（后端契约），但**绝不能**带三件套
    expect(p.groupId).toBeUndefined();
    expect(p.index).toBeUndefined();
    expect(p.count).toBeUndefined();
  });

  it('没有附件 ⇒ 文字走原来的纯文本路径（standaloneText），不产出任何上传计划', () => {
    const plan = planComposerTraySend<Item>([], ' 你好 ', []);
    expect(plan.items).toEqual([]);
    expect(plan.standaloneText).toBe('你好');
  });

  it('没有附件也没有文字 ⇒ 什么都不发', () => {
    const plan = planComposerTraySend<Item>([], '   ', []);
    expect(plan.items).toEqual([]);
    expect(plan.standaloneText).toBeNull();
  });
});

describe('类型分族（后端强制：file 只能与 file 同组）', () => {
  it('familyOf：image / video 同族，file 自成一族', () => {
    expect(familyOf('image')).toBe('media');
    expect(familyOf('video')).toBe('media');
    expect(familyOf('file')).toBe('file');
  });

  it('混选「2 图 + 2 文档」切成两个相册，各自 count=2、各自独立 groupId', () => {
    const plan = planComposerTraySend(
      [img('a'), img('b'), doc('c'), doc('d')],
      '说明',
      ['G1', 'G2'],
    );
    expect(plan.albumCount).toBe(2);
    expect(plan.items.map((p) => p.groupId)).toEqual(['G1', 'G1', 'G2', 'G2']);
    expect(plan.items.map((p) => p.count)).toEqual([2, 2, 2, 2]);
    // caption 只挂**整批**第一项，不是每个形态各挂一次（否则同一句话会出现两遍）
    expect(plan.items.map((p) => p.caption)).toEqual(['说明', undefined, undefined, undefined]);
  });

  it('混选「2 图 + 1 文档」⇒ 图成相册、文档是 single（不带三件套）', () => {
    const plan = planComposerTraySend([img('a'), img('b'), doc('c')], '', ['G1']);
    expect(plan.items.map((p) => p.shapeKind)).toEqual(['album', 'album', 'single']);
    expect(plan.items[2].groupId).toBeUndefined();
    expect(plan.items[2].count).toBeUndefined();
  });

  it('splitIntoShapes 保序按族分段：图-文档-图 切成三段（不会把两段图合并）', () => {
    const shapes = splitIntoShapes([img('a'), doc('b'), img('c')]);
    expect(shapes.map((s) => s.map((i) => i.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('groupId 不够时当场抛错，绝不静默降级成单条', () => {
    expect(() => planComposerTraySend([img('a'), img('b'), doc('c'), doc('d')], '', ['G1']))
      .toThrow(/需要 2 个 groupId/);
  });
});

describe('容量切分', () => {
  it('已有 8 个、再来 5 个 ⇒ 收 2 个、挡 3 个（不静默截断，调用方要报给用户）', () => {
    const incoming = [1, 2, 3, 4, 5];
    const { accepted, overflow } = splitByCapacity(8, incoming, ALBUM_MAX_ITEMS);
    expect(accepted).toEqual([1, 2]);
    expect(overflow).toEqual([3, 4, 5]);
  });

  it('已满 ⇒ 一个都不收', () => {
    const { accepted, overflow } = splitByCapacity(ALBUM_MAX_ITEMS, [1, 2], ALBUM_MAX_ITEMS);
    expect(accepted).toEqual([]);
    expect(overflow).toEqual([1, 2]);
  });
});
