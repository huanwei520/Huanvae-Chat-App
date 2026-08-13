/**
 * 单项发送态覆盖层的**宿主要求**（CSS 静态守卫）
 *
 * `.sending-media-overlay` 是 `position: absolute; inset: 0`，它会铺满**最近的定位祖先**。
 * 所以每一个会挂它的容器都必须是非 static —— 这是接线契约里对宿主的**唯一**要求。
 *
 * 三个宿主（对应 FileMessageContent 里那三支）：
 * `.image-message` / `.video-message` 本来就是 relative（它们要放播放按钮、下载进度层）；
 * `.document-message` 此前**不是**，本轮补上 —— 不补的话，待发区里的文档在上传时那圈进度
 * 会跑到更外层的定位祖先上（气泡甚至整个消息列表），而不是盖在这张卡片上。
 *
 * ⚠️ 这只是**声明层**守卫。「覆盖层是不是真的盖在媒体上」需要布局引擎，
 * jsdom 里没有任何可观测量（`getBoundingClientRect()` 恒 0，见
 * .claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」）——
 * **那一半必须真机看**，不在本仓门禁的能力范围内。
 *
 * 规则块抠法沿用 tests/styles/AlbumMediaObjectFit.test.ts：从选择器起到第一个右花括号为止。
 * ⇒ 被扫的 CSS 注释里不许出现花括号。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/pages/main.css'),
  'utf-8',
);
const OVERLAY_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/album-composer.css'),
  'utf-8',
);

function ruleBlock(css: string, selectorPattern: RegExp): string {
  const m = css.match(selectorPattern);
  expect(m, `规则块没找到：${selectorPattern}`).not.toBeNull();
  return m![0];
}

describe('覆盖层本身：absolute 铺满宿主', () => {
  it('.sending-media-overlay 仍是 position: absolute + inset: 0', () => {
    // 它一旦不再 absolute，下面三条"宿主必须 relative"就失去意义 —— 先把前提钉住
    const block = ruleBlock(OVERLAY_CSS, /\.sending-media-overlay\s*\{[^}]*\}/);
    expect(block).toMatch(/position\s*:\s*absolute\s*;/);
    expect(block).toMatch(/inset\s*:\s*0\s*;/);
  });
});

describe('三个宿主容器都必须是定位祖先（否则覆盖层跑到别处去）', () => {
  it.each([
    ['.image-message', /\.image-message\s*\{[^}]*\}/],
    ['.video-message', /\.video-message\s*\{[^}]*\}/],
    ['.document-message', /\.document-message\s*\{[^}]*\}/],
  ])('%s 声明了 position: relative', (_name, pattern) => {
    expect(ruleBlock(MAIN_CSS, pattern)).toMatch(/position\s*:\s*relative\s*;/);
  });
});
