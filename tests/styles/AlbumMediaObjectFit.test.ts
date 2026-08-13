/**
 * 相册格子 / 查找记录九宫格「每一张都要完整可见」的 CSS 防回归（静态守卫）
 *
 * 硬判据（huanwei 2026-08-12 原话「每一张都能看到完整的缩略图」）：
 *   任取一张，**原图的四条边在缩略图里都在**，与宽高比无关。
 * 满足它的唯一 paint 层写法是 `object-fit: contain`；`cover` 会把超出容器的部分居中裁掉。
 *
 * ⚠️ 本文件只是**声明层**守卫，拦的是"有人把 contain 改回 cover"这类回退。
 * 真正证明"四条边都在"的是真实浏览器像素判据 e2e-album/album-crop.spec.ts ——
 * jsdom 没有布局/绘制引擎，`object-fit` 在 vitest 里没有任何可观测行为
 * （同 .claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」一族）。
 * 两条判据缺一不可：静态守卫防回退，像素判据证语义。
 *
 * 规则块抠法沿用 tests/styles/ImageMessageStyle.test.ts：从选择器起到**第一个右花括号**为止。
 * ⇒ 被扫的 CSS 注释里不许出现花括号（.claude/rules/animation.md 实例末尾那条已实证过的坑）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALBUM_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/album.css'),
  'utf-8',
);
const SEARCH_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/search.css'),
  'utf-8',
);
const MAIN_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/pages/main.css'),
  'utf-8',
);

/** 从选择器开头抠到第一个右花括号；抠不到直接让用例失败（选择器被改名也算回归） */
function ruleBlock(css: string, selectorPattern: RegExp): string {
  const m = css.match(selectorPattern);
  expect(m, `规则块没找到：${selectorPattern}`).not.toBeNull();
  return m![0];
}

describe('相册格子内的媒体必须完整可见（不裁切）', () => {
  it('.album-cell 内的图片与视频封面都用 object-fit: contain，且不得声明 cover', () => {
    const block = ruleBlock(
      ALBUM_CSS,
      /\.album-cell\s+\.image-message\s+\.message-image\s*,[^}]*\{[^}]*\}/,
    );

    // 同一条规则同时管图片与视频封面 —— 视频封面帧也是一张图，同口径
    expect(block).toMatch(/\.album-cell\s+\.video-message\s+\.message-video-thumbnail/);
    expect(block).toMatch(/object-fit\s*:\s*contain\s*;/);
    expect(block).not.toMatch(/object-fit\s*:\s*cover\s*;/);
  });

  it('.album-cell 仍用 aspect-ratio 预留格高（不裁切不能以引入布局跳变为代价）', () => {
    // 消息列表是 column-reverse：格高若等图片加载完再撑开，会把用户正在看的位置顶走。
    // 这条与上一条是一对——只改 paint 层，不动占位层。
    const block = ruleBlock(ALBUM_CSS, /\.album-cell\s*\{[^}]*\}/);
    expect(block).toMatch(/aspect-ratio\s*:\s*1\s*\/\s*1\s*;/);
  });
});

describe('查找聊天记录九宫格的封面必须完整可见（与相册同口径）', () => {
  it('.conv-msg-search-cover 用 object-fit: contain，且不得声明 cover', () => {
    const block = ruleBlock(SEARCH_CSS, /\.conv-msg-search-cover\s*\{[^}]*\}/);
    expect(block).toMatch(/object-fit\s*:\s*contain\s*;/);
    expect(block).not.toMatch(/object-fit\s*:\s*cover\s*;/);
  });

  it('九宫格的 grid-auto-rows: max-content 一个字都没被动（v1.1.31 修重叠那一行）', () => {
    // 本次只许动 paint 层。grid-auto-rows 一旦回到 auto，隐式行会被容器高度压扁成
    // min-content（实测 21px），条数一超过一屏就整片重叠——那是 v1.1.31 刚修掉的缺陷。
    const block = ruleBlock(SEARCH_CSS, /\.conv-msg-search-list--grid\s*\{[^}]*\}/);
    expect(block).toMatch(/grid-auto-rows\s*:\s*max-content\s*;/);
  });

  it('.conv-msg-search-cell 仍是 aspect-ratio 1 / 1 的定比格子（排版层未被改动）', () => {
    const block = ruleBlock(SEARCH_CSS, /\.conv-msg-search-cell\s*\{[^}]*\}/);
    expect(block).toMatch(/aspect-ratio\s*:\s*1\s*\/\s*1\s*;/);
  });
});

/**
 * 单条视频气泡的封面 —— 与相册 / 单图同一条需求的第三处落点。
 *
 * 同文件里单图那条（`.image-message .message-image`）早就是 contain，视频这条是漏网的：
 * 不改的话同一会话里会同时出现「单图完整 / 单视频裁切 / 相册完整」三种行为。
 *
 * ⚠️ 行为差异要分清（两种情形只有一种看得出来）：
 * 容器尺寸由 calculateDisplaySize 按宽高比算，**有元数据**时容器比例 == 画面比例，
 * contain 与 cover 视觉等价；**无元数据**时容器退回默认 280x160，与真实封面比例不符 ——
 * 那才是 cover 真正在裁切、contain 真正生效（不裁但有留白）的情形。
 * 视频消息的 image_width / image_height 常为 null，所以这一处不是理论问题。
 */
describe('单条视频气泡的封面必须完整可见（与单图 / 相册同口径）', () => {
  it('.video-message .message-video-thumbnail 用 object-fit: contain，且不得声明 cover', () => {
    const block = ruleBlock(
      MAIN_CSS,
      /\.video-message\s+\.message-video-thumbnail\s*\{[^}]*\}/,
    );
    expect(block).toMatch(/object-fit\s*:\s*contain\s*;/);
    expect(block).not.toMatch(/object-fit\s*:\s*cover\s*;/);
  });

  it('正对照：同文件里单图那条本来就是 contain（证明这套抠块 + 匹配在 main.css 上真能命中）', () => {
    const block = ruleBlock(MAIN_CSS, /\.image-message\s+\.message-image\s*\{[^}]*\}/);
    expect(block).toMatch(/object-fit\s*:\s*contain\s*;/);
  });
});
