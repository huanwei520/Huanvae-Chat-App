/**
 * 无配文媒体上的昵称药丸必须给右上角「已存本地」角标让位
 *
 * ## 缺陷（本功能引入，2026-08-14 实测坐标）
 *
 * `.media-bubble-bare > .bubble-sender-name` 是浮在媒体左上角的半透明药丸，
 * 原先用 `max-width: calc(100% - 12px)` 收边 —— 那 12px 只是它自己左右两侧
 * 各 6px 的镜像，**没有把右上角 `.file-local-badge` 占的位置算进去**。
 * 于是昵称够长时药丸右端伸到角标底下：实测 280px 宽气泡上重叠 18x18 px
 * （药丸 right=670 / 角标 left=652，getBoundingClientRect 实采）。
 * 短昵称够不到 x=652 ⇒ 截图看不出来，只有长昵称才触发。
 *
 * ## 为什么是静态契约测试，不是渲染测试
 *
 * jsdom 没有布局引擎，`getBoundingClientRect()` 恒返回 0
 * （见 .claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」）——
 * 写一个「测重叠」的 vitest 会**恒绿**，正是那种假测试。
 * 所以这里扫 CSS 源码，把两件事钉住：
 *
 *   1. **算术**：药丸的宽度上限确实为角标留出了 >= 角标自身占位的空间；
 *   2. **真值源**：那份预留量是**从角标自己的 token 推导**的，不是又写一遍数字 ——
 *      本仓刚因为「同一个视觉量存在第二份真值源」栽过一次（药丸配色，ac4b235）。
 *
 * 单靠 (1) 挡不住有人把上限写成 `calc(100% - 34px)`（数字对、链断了，
 * 之后改角标尺寸药丸不跟）；单靠 (2) 挡不住 token 引对了但预留量算少了。两条都要。
 *
 * 静态扫用 __dirname（vitest 下 import.meta.url 不是 file: scheme，见 frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BADGE_CSS_PATH = resolve(__dirname, '../../src/styles/pages/main.css');
const BUBBLE_CSS_PATH = resolve(__dirname, '../../src/styles/components/chat-bubble-meta.css');

/**
 * 先剥注释再解析，两个理由（缺一都会出假 FAIL / 假 PASS）：
 *   1. 取规则块用 `[^}]*` 收尾，注释里出现一个 `}` 就会把块提前截断
 *      （.claude/rules/animation.md 记过这个坑，那边是靠"注释里不许写花括号"绕开的）；
 *   2. 本次的修法把「为什么这么算」写进了注释，注释里必然出现 `--file-local-badge-*`
 *      与像素数字 —— 不剥掉的话「这条规则里不许再出现裸 px」之类的断言会命中注释，
 *      逼着后人删掉正确的文档才能过门禁。
 * CSS 只有块注释一种形式，不存在 JS 那种 `//` 会把模板串里的 `//` 误当注释起点的问题。
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const BADGE_CSS = stripCssComments(readFileSync(BADGE_CSS_PATH, 'utf-8'));
const BUBBLE_CSS = stripCssComments(readFileSync(BUBBLE_CSS_PATH, 'utf-8'));

function escapeRe(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 取出某个选择器**那一个规则块**的正文（到第一个右花括号为止）。
 *
 * 选择器锚在行首（前面只许有空白），否则 `.bubble-sender-name` 会命中
 * `.media-bubble-bare > .bubble-sender-name` 的尾巴；块尾用 `[^}]` 收，
 * 所以不会跨出本规则（同 senderNameColor.test.ts 的取法）。
 */
function ruleBody(css: string, selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`));
  expect(m, `未找到规则 ${selector}`).not.toBeNull();
  return m![1];
}

/** 规则正文里某个属性/自定义属性的声明值 */
function decl(body: string, prop: string): string | undefined {
  const m = body.match(new RegExp(`(?:^|;|\\{)\\s*${escapeRe(prop)}\\s*:\\s*([^;]+)`));
  return m?.[1].trim();
}

/** 声明值必须存在，否则给出可读的失败信息 */
function requireDecl(body: string, prop: string, where: string): string {
  const v = decl(body, prop);
  expect(v, `${where} 缺 ${prop}`).toBeTruthy();
  return v!;
}

/** `--x: ...;` 形式的自定义属性表（只收本块内声明的） */
function customProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** 递归把 `var(--x)` 换成它的声明值（未定义即抛错 —— 静默变成 initial 才是真危险） */
function resolveVars(expr: string, dict: Record<string, string>, depth = 0): string {
  if (depth > 16) throw new Error(`var() 嵌套过深（循环引用？）: ${expr}`);
  const next = expr.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_m, name: string) => {
    const v = dict[name];
    if (v === undefined) throw new Error(`未定义的 token ${name}`);
    return `(${v})`;
  });
  return next === expr ? next : resolveVars(next, dict, depth + 1);
}

type Length = { px: number; pct: number };

/**
 * 解析 `calc()` 里的线性长度表达式（只支持 + / - / 括号 / `Npx` / `N%`）。
 *
 * 必须是**带括号的递归下降**，不能把括号拍平后按 +/- 顺序扫：
 * `100% - (4px + 20px)` 拍平会把 20px 的符号弄反 —— 而那正是本文件要算的形状。
 */
function parseLength(input: string): Length {
  const src = input.replace(/calc/g, ' ');
  let i = 0;
  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };
  const parseTerm = (): Length => {
    skip();
    if (src[i] === '(') {
      i += 1;
      const v = parseExpr();
      skip();
      if (src[i] !== ')') throw new Error(`括号不配对 @${i}: ${input}`);
      i += 1;
      return v;
    }
    const m = /^(-?\d+(?:\.\d+)?)(px|%)/.exec(src.slice(i));
    if (!m) throw new Error(`无法解析的项 @${i}: ${input}`);
    i += m[0].length;
    return m[2] === 'px' ? { px: Number(m[1]), pct: 0 } : { px: 0, pct: Number(m[1]) };
  };
  function parseExpr(): Length {
    let acc = parseTerm();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== '+' && op !== '-') return acc;
      i += 1;
      const rhs = parseTerm();
      acc =
        op === '+'
          ? { px: acc.px + rhs.px, pct: acc.pct + rhs.pct }
          : { px: acc.px - rhs.px, pct: acc.pct - rhs.pct };
    }
  }
  const out = parseExpr();
  skip();
  if (i !== src.length) throw new Error(`表达式有残留 @${i}: ${input}`);
  return out;
}

/** 角标 token 所在的那个 :root 块（main.css 里可能不止一个 :root） */
function badgeTokenBlock(): Record<string, string> {
  for (const m of BADGE_CSS.matchAll(/(?:^|\n)\s*:root\s*\{([^}]*)\}/g)) {
    const props = customProps(m[1]);
    if (props['--file-local-badge-inset'] !== undefined) return props;
  }
  throw new Error('main.css 里找不到声明 --file-local-badge-inset 的 :root 块');
}

const BADGE_TOKENS = badgeTokenBlock();
const BADGE_RULE = ruleBody(BADGE_CSS, '.file-local-badge');
const PILL_RULE = ruleBody(BUBBLE_CSS, ".media-bubble-bare > .bubble-sender-name");
const BASE_NAME_RULE = ruleBody(BUBBLE_CSS, '.bubble-sender-name');
const CAPTION_NAME_RULE = ruleBody(BUBBLE_CSS, '.media-bubble > .bubble-sender-name');

describe('角标（.file-local-badge）是自己占位量的唯一真值源', () => {
  it('正对照：三个规则块都真的扫到了内容（扫空时下面几条会以恒真的形式假绿）', () => {
    expect(BADGE_RULE.length).toBeGreaterThan(0);
    expect(PILL_RULE.length).toBeGreaterThan(0);
    expect(Object.keys(BADGE_TOKENS).length).toBeGreaterThan(0);
  });

  it('角标自己就用这套 token 定位与定尺寸（否则 token 只是装饰、改了角标不跟）', () => {
    expect(decl(BADGE_RULE, 'top')).toBe('var(--file-local-badge-inset)');
    expect(decl(BADGE_RULE, 'right')).toBe('var(--file-local-badge-inset)');
    expect(decl(BADGE_RULE, 'width')).toBe('var(--file-local-badge-size)');
    expect(decl(BADGE_RULE, 'height')).toBe('var(--file-local-badge-size)');
  });

  it('--file-local-badge-reserve 就是 inset + size，不是另写的数', () => {
    const reserve = BADGE_TOKENS['--file-local-badge-reserve'];
    expect(reserve, ':root 缺 --file-local-badge-reserve').toBeTruthy();
    expect(reserve).toContain('var(--file-local-badge-inset)');
    expect(reserve).toContain('var(--file-local-badge-size)');
    expect(reserve).not.toMatch(/\d+px/);

    const inset = parseLength(resolveVars('var(--file-local-badge-inset)', BADGE_TOKENS));
    const size = parseLength(resolveVars('var(--file-local-badge-size)', BADGE_TOKENS));
    const strip = parseLength(resolveVars(reserve!, BADGE_TOKENS));
    expect(inset.px).toBeGreaterThan(0);
    expect(size.px).toBeGreaterThan(0);
    expect(strip.px).toBe(inset.px + size.px);
    expect(strip.pct).toBe(0);
  });
});

describe('无配文媒体的昵称药丸：宽度上限给角标留了位置', () => {
  const dict = { ...BADGE_TOKENS, ...customProps(PILL_RULE) };
  const badgeStrip = parseLength(resolveVars('var(--file-local-badge-reserve)', BADGE_TOKENS));

  it('上限表达式引用角标的 reserve token，且不含任何裸 px 字面量', () => {
    const maxWidth = requireDecl(PILL_RULE, 'max-width', '药丸规则');
    // 链：预留量必须来自角标那一份真值源
    expect(maxWidth).toContain('var(--file-local-badge-reserve)');
    // 反向：一旦有人把角标那段宽度重新敲成数字，这里就红（第二份真值源）
    expect(maxWidth).not.toMatch(/\d+px/);
  });

  it('算术：药丸右端至少停在角标左边缘处（当前留了 4px 余量）', () => {
    const left = parseLength(resolveVars(requireDecl(PILL_RULE, 'left', '药丸规则'), dict));
    const maxWidth = parseLength(resolveVars(requireDecl(PILL_RULE, 'max-width', '药丸规则'), dict));

    // 上限是「容器宽 - 固定量」的形状：百分比项必须正好是 100%
    expect(maxWidth.pct).toBe(100);
    expect(left.pct).toBe(0);

    // 药丸右端 = left + maxWidth = W - (|maxWidth.px| - left.px)
    // 角标左边缘 = W - (inset + size)
    // 不相撞 <=> |maxWidth.px| - left.px >= inset + size
    const reservedFromRight = -maxWidth.px - left.px;
    expect(reservedFromRight).toBeGreaterThanOrEqual(badgeStrip.px);
  });

  it('截断行为仍在（上限变窄只是提前打省略号，不是换一种溢出方式）', () => {
    expect(decl(BASE_NAME_RULE, 'white-space')).toBe('nowrap');
    expect(decl(BASE_NAME_RULE, 'overflow')).toBe('hidden');
    expect(decl(BASE_NAME_RULE, 'text-overflow')).toBe('ellipsis');
    // 药丸自己不许把这三条改掉
    expect(PILL_RULE).not.toMatch(/white-space\s*:/);
    expect(PILL_RULE).not.toMatch(/text-overflow\s*:/);
  });
});

describe('只影响 .media-bubble-bare 这一路（另外两路昵称不许被牵连）', () => {
  it('文本气泡里的昵称（基础规则）上限仍是 100%，不给角标让位', () => {
    expect(decl(BASE_NAME_RULE, 'max-width')).toBe('100%');
    expect(BASE_NAME_RULE).not.toContain('--file-local-badge');
  });

  it('有配文媒体的昵称（.media-bubble > .bubble-sender-name）不带任何宽度上限', () => {
    expect(decl(CAPTION_NAME_RULE, 'max-width')).toBeUndefined();
    expect(CAPTION_NAME_RULE).not.toContain('--file-local-badge');
  });
});
