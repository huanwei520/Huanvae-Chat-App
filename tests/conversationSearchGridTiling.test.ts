/**
 * 会话内查找「图片 / 视频」九宫格：行高不得被容器压扁（静态 CSS 契约）
 *
 * ## 它在防的那个真实缺陷
 *
 * `.conv-msg-search-list--grid` 是**定高**滚动容器（继承 `.conv-msg-search-list` 的
 * `flex: 1` + `min-height: 0` + `overflow-y: auto`），而格子 `.conv-msg-search-cell` 的高度
 * **只**来自 `aspect-ratio: 1 / 1` —— 它唯一的子元素是 `height: 100%` 的 `<img>` / `<video>`，
 * 百分比高度对「尚未定高的行」是循环引用 ⇒ 格子的 min-content 高度约等于 0（实测 21px）。
 *
 * 隐式行默认 `auto`，而 auto 行的下界正是项的 min-content 高度。于是**一旦结果条数多到
 * 自然总高超过容器高度**，行就被压到 21px，而每个格子仍按 aspect-ratio 铺满 ~120px
 * ⇒ 每格溢出自己的行 ~100px、压住下面 4~5 行 = huanwei 报的「一张压着另一张，
 * 很多张只能看到一部分」。
 *
 * 实测（Playwright，同一份线上 CSS）：
 *   - 12 条（装得下）→ 行高 121px、**0 对**重叠  ← 所以它一直没被发现
 *   - 60 条（装不下）→ 行高 21px、**210 对**重叠、行进距仅 25px
 *   - Chromium 与 WebKit **同款**，不是引擎特异
 *   - 加上 `grid-auto-rows: max-content` → 210 → **0 对**，行进距回到 126px，格子仍是正方形
 *
 * ## 为什么必须是静态 CSS 扫描
 *
 * jsdom 没有布局引擎，`getBoundingClientRect()` 恒为 0 —— 这类「重叠 / 行高」缺陷
 * **vitest 结构性测不出**（见 .claude/rules/frontend-test.md「滚动 / 布局相关行为」）。
 * 所以这里只守「声明层」：那条能让行不被压扁的声明必须在，且不能被改回会压扁的值。
 * 「视觉上真的平铺」仍必须靠真机截图验收，本文件不冒充覆盖了它。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(__dirname, '../src/styles/search.css'), 'utf-8');

/**
 * 取某个选择器的声明块正文（第一处）。
 * 用 `[^}]*` 圈在块内，避免跨块惰性匹配把下游同名声明算进来
 * （见 .claude/rules/frontend-test.md「静态扫描断言要"块内有界"」）。
 */
function ruleBody(selector: string): string {
  const m = new RegExp(`${selector.replace(/[.\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(CSS);
  return m ? m[1] : '';
}

/** 只保留声明，剥掉块内注释（本仓注释里正当地写着 `auto` / `1fr` 在解释为什么不能用它们） */
function declarationsOf(selector: string): string {
  return ruleBody(selector).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('九宫格行高契约', () => {
  it('扫描面正对照：能取到网格与格子两条规则（正则写歪时不许假通过）', () => {
    expect(ruleBody('.conv-msg-search-list--grid')).not.toBe('');
    expect(ruleBody('.conv-msg-search-cell')).not.toBe('');
  });

  it('格子的高度确实只来自 aspect-ratio —— 这正是行会被压扁的前提', () => {
    const cell = declarationsOf('.conv-msg-search-cell');

    expect(cell).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
    // 没有任何写死的高度兜底 ⇒ min-content 高度约等于 0，行一旦是 auto 就会被压
    expect(cell).not.toMatch(/(^|[\s;])height:/);
    expect(cell).not.toMatch(/(^|[\s;])min-height:/);
  });

  it('网格必须显式声明 grid-auto-rows，且不是会被压扁的 auto / 会被绑死的 1fr', () => {
    const grid = declarationsOf('.conv-msg-search-list--grid');

    const m = /grid-auto-rows:\s*([^;]+);/.exec(grid);
    expect(m, 'grid-auto-rows 被删了：隐式行会退回 auto，结果超过一屏就整片重叠').not.toBeNull();

    const value = m![1].trim();
    // auto → 被容器高度压到 min-content(≈21px)；1fr → 行高被绑死到容器高度，换一种压扁方式
    expect(value).not.toBe('auto');
    expect(value).not.toMatch(/\bfr\b/);
    // max-content / min-content 都实测有效（两端均 210 → 0 对重叠），此处不锁死其中一个
    expect(value).toMatch(/^(max|min)-content$/);
  });

  it('三列 + 定高滚动容器这两个前提仍在（前提变了本契约要重新论证）', () => {
    const grid = declarationsOf('.conv-msg-search-list--grid');
    const list = declarationsOf('.conv-msg-search-list');

    expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,\s*1fr\)/);
    expect(list).toMatch(/flex:\s*1/);
    expect(list).toMatch(/overflow-y:\s*auto/);
  });
});
