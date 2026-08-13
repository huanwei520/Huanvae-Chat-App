/**
 * 「单媒体 + 配文：媒体区与配文严格同宽，图居中，余下补黑」的 CSS 防回归（静态守卫）
 *
 * huanwei 2026-08-13 04:32 原话（唯一真值源）：
 *   「这个图片**单张图**我需要它的**宽度和文字一致**，塞不满的让其以**黑色背景**显示图片
 *     **居中**，不要出现图只有文字一半的情况，要**全部对齐**」
 *
 * 被否掉的形态：9:16 竖图在 280px 的气泡里只有 169px 宽（`calculateDisplaySize` 先卡宽
 * 280、再卡高 300，卡高那一步把宽度按比例缩了回去），右边空出 111px ——
 * 媒体与配文左右边缘对不齐，看着「图只有文字一半」。
 *
 * 本文件钉三件事（三条缺一条，形态就回退成被否的那个）：
 *   1. **气泡钉到上限** —— `.media-bubble--single` 声明 `width`，否则气泡是
 *      max(媒体宽, 配文宽)：短配文会把它拉回媒体自身的窄宽度，媒体带又变窄。
 *   2. **窄屏能跟着缩** —— 同一块里 `max-width: 100%`，否则视口装不下 280px 时气泡溢出
 *      `.bubble-content`（那一层 `overflow: hidden`，溢出部分会被直接切掉）。
 *   3. **媒体带居中 + 黑底** —— `.media-bubble-media` 的 `justify-content: center`
 *      与**字面黑色**。黑是 huanwei 点名要的，不许换成主题 token：本仓的中性 token
 *      跟着主题走，浅色主题下是近白色，那就成了「白底留白」而不是他要的黑。
 *
 * ⚠️ 本文件只是**声明层**守卫（同 tests/styles/MediaBubbleCaptionTint.test.ts 的定位）：
 * jsdom 无布局无绘制，「媒体区到底有没有跟文字对齐」在 vitest 里没有任何可观测量
 * （.claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」一族）。
 * 真正的判据是真机截图上的像素测量，最终由 huanwei 终验。
 *
 * 「图不许被裁」那一半不在这里：`object-fit: contain` 由既有的
 * tests/styles/ImageMessageStyle.test.ts（图片）与 tests/styles/AlbumMediaObjectFit.test.ts
 * （视频封面 + 相册）守着，本文件不重复一遍，免得两处判据漂移。
 *
 * 相册那一侧的同族判据也不在这里（同样为了不重复）：
 * huanwei 2026-08-13 04:49 把规则收敛成一条 ——「**格**（展示图片视频的那个方格）的背景
 * 由透明改黑，**缝**保持灰白」。单媒体这一路的「格」就是本文件盯的 `.media-bubble-media`；
 * 相册那一路的「格」是 `.album-cell`、「缝」是 `.album-grid`，
 * 两者由 tests/styles/MediaBubbleCaptionTint.test.ts 成对钉住
 * （格必须是 `#000000`、缝必须**不是** `#000` —— 后者是「防做过头」那条）。
 *
 * 规则块抠法沿用同目录既有文件：从选择器起到**第一个右花括号**为止。
 * ⇒ 被扫的 CSS 注释里不许出现花括号（.claude/rules/animation.md 末尾那条已实证过的坑）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MEDIA_BUBBLE_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/media-bubble.css'),
  'utf-8',
);

/** 从选择器开头抠到第一个右花括号；抠不到直接让用例失败（选择器被改名也算回归） */
function ruleBlock(css: string, selectorPattern: RegExp): string {
  const m = css.match(selectorPattern);
  expect(m, `规则块没找到：${selectorPattern}`).not.toBeNull();
  return m![0];
}

const SINGLE_FRAME = /\.media-bubble--single\s*\{[^}]*\}/;
const MEDIA_BAND = /\.media-bubble-media\s*\{[^}]*\}/;

describe('单媒体 + 配文：气泡钉到上限，媒体带才可能与配文同宽', () => {
  it('.media-bubble--single 声明确定宽度（短配文时不塌回媒体自身宽度）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, SINGLE_FRAME);
    // 只认「确定长度」：auto / fit-content / max-content 都会让气泡退回 shrink-to-fit，
    // 那正是「图只有文字一半」那个被否形态的成因。
    expect(block).toMatch(/(^|[^-])width\s*:\s*\d+px\s*;/m);
  });

  it('.media-bubble--single 同时给 max-width: 100%（窄屏跟着气泡缩，不被切掉）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, SINGLE_FRAME);
    expect(block).toMatch(/max-width\s*:\s*100%\s*;/);
  });
});

describe('媒体带：图居中，塞不满的部分是黑色', () => {
  it('.media-bubble-media 是 flex 且水平居中（图在带内居中，不是靠左）', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, MEDIA_BAND);
    expect(block).toMatch(/display\s*:\s*flex\s*;/);
    expect(block).toMatch(/justify-content\s*:\s*center\s*;/);
  });

  it('.media-bubble-media 的底色是字面黑色，不是主题 token、不是半透明', () => {
    const block = ruleBlock(MEDIA_BUBBLE_CSS, MEDIA_BAND);
    // huanwei 点名「黑色背景」。token 会跟着主题走（浅色主题下近白），
    // 半透明会把下面的东西透出来 —— 两者都不是他要的那个黑。
    expect(block).toMatch(/background\s*:\s*#000000\s*;/);
    expect(block).not.toMatch(/var\(--/);
    expect(block).not.toMatch(/rgba\(/);
  });
});
