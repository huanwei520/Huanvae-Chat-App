/**
 * 「气泡底色只落在最下方那条 caption 上」的 CSS 防回归（静态守卫）
 *
 * huanwei 2026-08-13 03:01 原话（唯一真值源）：
 *   「气泡包裹不是这么包裹，三张图那种奇数图就让其自适应排列铺满，
 *     **不要让背景有蓝色**，**只让最下方的标题气泡有蓝色**就行，类比单图加文字的效果」
 *
 * 被否掉的形态是：`.media-bubble` 这一层把主色渐变刷在**整个 frame** 上 ——
 * 媒体区与配文条一起变蓝。于是相册的 3px 格缝、以及每张图 `object-fit: contain`
 * 留下的 letterbox 带（当时底色是半透明的）全都透出蓝色，整块看着像一坨蓝底。
 *
 * 本文件钉两件事：
 *   1. **frame 不 painted** —— `.media-bubble` 的 own/other 两条规则里一个 background 都没有；
 *      底色只出现在 `.media-bubble-caption` 上。
 *   2. **媒体区里所有会露出来的底色都是不透明中性值** —— 格缝（`.album-grid` 自己的背景）、
 *      letterbox 带（`.album-cell`）、未到货占位（`.album-cell-placeholder`）三处。
 *      半透明就意味着「下面是什么颜色就透什么颜色」，正是这次要根治的病。
 *
 * ⚠️ 本文件只是**声明层**守卫（同 tests/styles/AlbumMediaObjectFit.test.ts 的定位）：
 * jsdom 无布局无绘制，「看上去是不是还有蓝」在 vitest 里没有任何可观测量
 * （.claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」一族）。
 * 真正的视觉判据是真机截图，由 huanwei 终验。
 *
 * 规则块抠法沿用 tests/styles/ImageMessageStyle.test.ts：从选择器起到**第一个右花括号**为止。
 * ⇒ 被扫的 CSS 注释里不许出现花括号（.claude/rules/animation.md 末尾那条已实证过的坑）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MEDIA_BUBBLE_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/media-bubble.css'),
  'utf-8',
);
const ALBUM_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/album.css'),
  'utf-8',
);
const VARIABLES_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/variables.css'),
  'utf-8',
);

/** 从选择器开头抠到第一个右花括号；抠不到直接让用例失败（选择器被改名也算回归） */
function ruleBlock(css: string, selectorPattern: RegExp): string {
  const m = css.match(selectorPattern);
  expect(m, `规则块没找到：${selectorPattern}`).not.toBeNull();
  return m![0];
}

/**
 * `.media-bubble\s*\{` 里的 `\s*\{` 要求紧跟花括号，
 * 所以它匹配不到 `.media-bubble-caption`（`-` 既不是空白也不是花括号）—— 两条规则不会串。
 */
const OWN_FRAME = /\.message-bubble\.own\s+\.media-bubble\s*\{[^}]*\}/;
const OTHER_FRAME = /\.message-bubble\.other\s+\.media-bubble\s*\{[^}]*\}/;
const OWN_CAPTION = /\.message-bubble\.own\s+\.media-bubble-caption\s*\{[^}]*\}/;
const OTHER_CAPTION = /\.message-bubble\.other\s+\.media-bubble-caption\s*\{[^}]*\}/;

describe('底色只在 caption 那一条上：媒体区不许被涂色', () => {
  it('自己发的：.media-bubble 这一层一个 background 都不声明（媒体区无蓝）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, OWN_FRAME);
    expect(block).not.toMatch(/background\s*:/);
    expect(block).not.toMatch(/var\(--primary/);
    // 形状仍归 frame：尾角 4px 留在这里，靠 overflow: hidden 把 caption 的底色裁成这个形状
    expect(block).toMatch(/border-bottom-right-radius\s*:\s*4px\s*;/);
  });

  it('自己发的：主色渐变只出现在 .media-bubble-caption 上（只有最下方那条是蓝的）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, OWN_CAPTION);
    expect(block).toMatch(/background\s*:\s*linear-gradient\([^;]*var\(--primary\)[^;]*;/);
  });

  it('对方发的：.media-bubble 这一层同样不声明 background / border', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, OTHER_FRAME);
    expect(block).not.toMatch(/background\s*:/);
    // 边框也算「给媒体区上色」：留着它，对方那侧的媒体区会被一圈白描边框住
    expect(block).not.toMatch(/border\s*:/);
    expect(block).toMatch(/border-bottom-left-radius\s*:\s*4px\s*;/);
  });

  it('对方发的：白底只出现在 .media-bubble-caption 上（与自己发的那侧对称）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, OTHER_CAPTION);
    expect(block).toMatch(/background\s*:\s*var\(--white-alpha-70\)\s*;/);
  });
});

describe('媒体区里会露出来的底色必须是不透明的（不是半透明蓝）', () => {
  // 半透明 = 下面是什么颜色就透什么颜色。frame 的蓝正是这么渗进 letterbox 带与格缝的，
  // 所以这几处一律不认 rgba()。
  const OPAQUE_NEUTRAL = /background\s*:\s*var\(--bg-tertiary\)\s*;/;

  /**
   * 🔴 2026-08-13 04:49 huanwei 就地纠正了「格」这一层的取值：
   *   「我说的是**图片视频展示出来的对于图片视频那一个方格的背景把透明改为黑色**而已，
   *     我要的是 Telegram 那种效果」，并明说间隔就是底部灰白背景的颜色、不动。
   * ⇒ **格**（.album-cell，contain 留白露的就是它）改黑；
   *   **缝**（.album-grid，3px gap 露的是网格容器）保持灰白 —— 下面两条就是防做过头的判据：
   *   谁要是把网格容器一起涂黑，`.album-grid` 那条立刻翻红。
   */
  it('.album-cell 的 letterbox 带底色是字面黑色（contain 留白处露的就是它）', () => {
    const block = ruleBlock(ALBUM_CSS, /\.album-cell\s*\{[^}]*\}/);
    expect(block).toMatch(/background\s*:\s*#000000\s*;/);
    // token 会跟着主题走（浅色主题下近白），半透明会把下面的颜色透出来 —— 都不是他要的黑
    expect(block).not.toMatch(/var\(--/);
    expect(block).not.toMatch(/rgba\(/);
  });

  it('.album-grid 的格缝底色仍是灰白中性、绝不是黑（3px gap 露的是网格容器自己的背景）', () => {
    const block = ruleBlock(ALBUM_CSS, /\.album-grid\s*\{[^}]*\}/);
    expect(block).toMatch(OPAQUE_NEUTRAL);
    expect(block).not.toMatch(/rgba\(/);
    // 防做过头：把「格」涂黑时顺手把「网格容器」也涂了 ⇒ 3px 缝一起变黑，
    // 那正是 huanwei 明确说不要的（「其间隔不就是底部的灰白色背景的颜色」）
    expect(block).not.toMatch(/#000/);
  });

  it('.album-cell-placeholder（未到货位次）与格缝同口径：灰白中性，不是黑', () => {
    // 它盖在已经变黑的 .album-cell 上，但它**不是**「展示图片视频的方格」——
    // 那一格里一张图都没有，涂黑会让「还没翻到那一页」看起来像一张坏掉的黑图。
    const block = ruleBlock(ALBUM_CSS, /\.album-cell-placeholder\s*\{[^}]*\}/);
    expect(block).toMatch(OPAQUE_NEUTRAL);
    expect(block).not.toMatch(/rgba\(/);
    expect(block).not.toMatch(/#000/);
  });

  it('--bg-tertiary 本身是 6 位 hex（证明上面选的 token 真的不带 alpha）', () => {
    // 运行期由 ThemeProvider 注入 semantic.bg.tertiary = neutralScale[N]，
    // 而 neutralScale 出自 formatHex（src/theme/utils.ts），同样是不透明 hex；
    // 这里钉住的是 variables.css 里的 fallback 值。
    expect(VARIABLES_CSS).toMatch(/--bg-tertiary\s*:\s*#[0-9a-fA-F]{6}\s*;/);
  });
});
