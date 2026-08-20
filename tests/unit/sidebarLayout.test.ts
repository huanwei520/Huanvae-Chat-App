/**
 * sidebarLayout 纯函数矩阵测试（侧边栏双区拖放布局的持久化层）
 *
 * 覆盖：
 * 1. normalizeLayout：非法结构（null/字符串/数字/数组/pinned 非数组/more 非数组）
 *    → defaultLayout；非法 key 与非字符串元素过滤；跨区重复留 pinned；同区重复留首个；
 *    部分保存补缺到 more 末尾；合法完整双区往返不变；全 7 项 pinned 合法保持
 * 2. loadLayout：无保存 / 损坏 JSON → defaultLayout；合法 JSON → normalizeLayout 清洗
 * 3. saveLayout：以 (LAYOUT_STORAGE_KEY, JSON 串) 精确写入 localStorage
 *
 * 分层决策：dnd-kit 的真实拖拽手势（PointerSensor 需要真 pointer 事件序列）jsdom
 * 无法模拟，拖拽编排行为由本纯函数矩阵 + 真机自测覆盖，不写假拖拽测试。
 *
 * 注意：tests/setup.ts 把 window.localStorage 整体替换成 vi.fn() stub（getItem
 * 默认返回 undefined），所以"本地保存"场景通过 vi.mocked(getItem).mockReturnValue
 * 驱动，写入用 vi.mocked(setItem) 断言。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SIDEBAR_ITEM_KEYS,
  LAYOUT_STORAGE_KEY,
  defaultLayout,
  normalizeLayout,
  loadLayout,
  saveLayout,
  type SidebarLayout,
} from '../../src/components/sidebar/sidebarLayout';

const mockedGetItem = vi.mocked(window.localStorage.getItem);
const mockedSetItem = vi.mocked(window.localStorage.setItem);

beforeEach(() => {
  mockedGetItem.mockReset();
  mockedSetItem.mockReset();
  mockedGetItem.mockReturnValue(null);
});

describe('normalizeLayout', () => {
  it('非法结构（null/字符串/数字/数组/pinned 非数组/more 非数组）均返回 defaultLayout 值', () => {
    const invalids: unknown[] = [
      null,
      'files',
      42,
      ['files', 'lan'],
      { pinned: 'x', more: [] },
      { pinned: [], more: 42 },
    ];
    for (const input of invalids) {
      const result = normalizeLayout(input);
      expect(result).toEqual(defaultLayout());
      expect(result).toEqual({
        pinned: [],
        more: ['files', 'lan', 'meeting', 'miniapps', 'bots', 'guard', 'stocks'],
      });
      // more 是全新数组，不与常量 SIDEBAR_ITEM_KEYS 共享引用
      expect(result.more).not.toBe(SIDEBAR_ITEM_KEYS);
    }
    // 每次调用返回新引用（互不共享，防止调用方原地修改互相污染）
    const a = normalizeLayout(null);
    const b = normalizeLayout(null);
    expect(a).not.toBe(b);
    expect(a.more).not.toBe(b.more);
    expect(a.pinned).not.toBe(b.pinned);
  });

  it('过滤非法 key 与非字符串元素，缺失 key 按默认顺序补到 more 末尾', () => {
    const result = normalizeLayout({
      pinned: ['files', 'bogus', 42],
      more: [null, 'stocks', { key: 'lan' }, 'guard'],
    });
    expect(result).toEqual({
      pinned: ['files'],
      more: ['stocks', 'guard', 'lan', 'meeting', 'miniapps', 'bots'],
    });
  });

  it('跨区重复（同 key 同时在 pinned 与 more）时留 pinned', () => {
    const result = normalizeLayout({
      pinned: ['guard'],
      more: ['guard', 'files', 'lan', 'meeting', 'miniapps', 'bots', 'stocks'],
    });
    expect(result).toEqual({
      pinned: ['guard'],
      more: ['files', 'lan', 'meeting', 'miniapps', 'bots', 'stocks'],
    });
  });

  it('同区重复留首个出现位置', () => {
    // pinned 区内重复
    expect(
      normalizeLayout({ pinned: ['guard', 'guard', 'files', 'guard'], more: [] }),
    ).toEqual({
      pinned: ['guard', 'files'],
      more: ['lan', 'meeting', 'miniapps', 'bots', 'stocks'],
    });
    // more 区内重复
    expect(
      normalizeLayout({ pinned: [], more: ['stocks', 'files', 'stocks', 'files'] }),
    ).toEqual({
      pinned: [],
      more: ['stocks', 'files', 'lan', 'meeting', 'miniapps', 'bots', 'guard'],
    });
  });

  it('部分保存缺 key 时按 SIDEBAR_ITEM_KEYS 顺序补到 more 末尾', () => {
    const result = normalizeLayout({ pinned: ['guard'], more: ['stocks'] });
    expect(result).toEqual({
      pinned: ['guard'],
      more: ['stocks', 'files', 'lan', 'meeting', 'miniapps', 'bots'],
    });
  });

  it('合法完整双区布局往返不变', () => {
    const input: SidebarLayout = {
      pinned: ['lan', 'files'],
      more: ['stocks', 'guard', 'bots', 'miniapps', 'meeting'],
    };
    expect(normalizeLayout(input)).toEqual({
      pinned: ['lan', 'files'],
      more: ['stocks', 'guard', 'bots', 'miniapps', 'meeting'],
    });
  });

  it('全 7 项 pinned + 空 more 是合法布局，原样保持', () => {
    const allPinned: SidebarLayout = {
      pinned: ['stocks', 'guard', 'bots', 'miniapps', 'meeting', 'lan', 'files'],
      more: [],
    };
    expect(normalizeLayout(allPinned)).toEqual({
      pinned: ['stocks', 'guard', 'bots', 'miniapps', 'meeting', 'lan', 'files'],
      more: [],
    });
  });
});

describe('loadLayout', () => {
  it('localStorage 无保存（getItem 返回 null）时返回默认布局', () => {
    expect(loadLayout()).toEqual(defaultLayout());
    expect(mockedGetItem).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
  });

  it('损坏 JSON 时返回默认布局，且以 LAYOUT_STORAGE_KEY 读取', () => {
    mockedGetItem.mockReturnValue('not-json{{{');
    expect(loadLayout()).toEqual(defaultLayout());
    expect(mockedGetItem).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
  });

  it('合法 JSON 经 normalizeLayout 清洗（非法 key 剔除 + 补缺）', () => {
    mockedGetItem.mockReturnValue(
      JSON.stringify({ pinned: ['files', 'bogus'], more: ['stocks'] }),
    );
    expect(loadLayout()).toEqual({
      pinned: ['files'],
      more: ['stocks', 'lan', 'meeting', 'miniapps', 'bots', 'guard'],
    });
  });
});

describe('saveLayout', () => {
  it('以 (LAYOUT_STORAGE_KEY, JSON.stringify(布局)) 精确写入 localStorage', () => {
    const layout: SidebarLayout = {
      pinned: ['guard', 'files'],
      more: ['lan', 'meeting', 'miniapps', 'stocks'],
    };
    saveLayout(layout);
    expect(mockedSetItem).toHaveBeenCalledTimes(1);
    expect(mockedSetItem).toHaveBeenCalledWith(
      LAYOUT_STORAGE_KEY,
      '{"pinned":["guard","files"],"more":["lan","meeting","miniapps","stocks"]}',
    );
  });
});
