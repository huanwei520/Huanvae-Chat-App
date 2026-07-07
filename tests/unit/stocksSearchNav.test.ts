/**
 * 搜索下拉键盘导航纯逻辑单测（零 mock）
 *
 * 覆盖 moveActiveIndex 的：空结果、无高亮起始、夹紧不循环边界；searchOptionId 稳定性。
 */

import { describe, it, expect } from 'vitest';
import { moveActiveIndex, searchOptionId, SEARCH_LISTBOX_ID } from '../../src/stocks/components/searchNav';

describe('moveActiveIndex', () => {
  it('空结果（len<=0）恒返回 -1', () => {
    expect(moveActiveIndex(-1, 0, 1)).toBe(-1);
    expect(moveActiveIndex(2, 0, -1)).toBe(-1);
    expect(moveActiveIndex(-1, -3, 1)).toBe(-1);
  });

  it('无高亮时：↓ 落首项 0、↑ 落末项 len-1', () => {
    expect(moveActiveIndex(-1, 5, 1)).toBe(0);
    expect(moveActiveIndex(-1, 5, -1)).toBe(4);
  });

  it('有高亮时：在 [0, len-1] 内加 delta', () => {
    expect(moveActiveIndex(1, 5, 1)).toBe(2);
    expect(moveActiveIndex(3, 5, -1)).toBe(2);
  });

  it('边界：末项再 ↓ 停在末项，首项再 ↑ 停在首项（不循环）', () => {
    expect(moveActiveIndex(4, 5, 1)).toBe(4);
    expect(moveActiveIndex(0, 5, -1)).toBe(0);
  });

  it('单条结果：任何方向都停在 0', () => {
    expect(moveActiveIndex(-1, 1, 1)).toBe(0);
    expect(moveActiveIndex(0, 1, 1)).toBe(0);
    expect(moveActiveIndex(0, 1, -1)).toBe(0);
  });
});

describe('searchOptionId', () => {
  it('基于 listbox id 前缀 + 下标生成稳定 id', () => {
    expect(searchOptionId(0)).toBe(`${SEARCH_LISTBOX_ID}-opt-0`);
    expect(searchOptionId(3)).toBe(`${SEARCH_LISTBOX_ID}-opt-3`);
    expect(searchOptionId(0)).not.toBe(searchOptionId(1));
  });
});
