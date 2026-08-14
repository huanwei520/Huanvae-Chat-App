/**
 * 昵称进气泡后的**尺寸契约**：长昵称不许撑破气泡，短正文不许被挤掉。
 *
 * 背景（huanwei 2026-08-14 12:16「群聊的昵称让其放在气泡里，参考 Telegram」）：
 * `.bubble-sender-name` 从 `.bubble-content` 的直接子节点（飘在气泡外的一行）
 * 挪进了**气泡本体**，落点有三个，各自的宿主不同：
 *
 *   ① 文本气泡      -> `.bubble-text` 的第一个孩子
 *   ② 媒体 + 配文    -> `.media-bubble` 的第一个孩子
 *   ③ 无配文纯媒体    -> `.media-bubble-bare` 内的绝对定位药丸
 *
 * 昵称是 `white-space: nowrap` 的，**它的 min-content 就是整串名字的宽度** ——
 * 换句话说它会把宿主往宽里顶。原来只有 ① 一个落点、且它的截断契约写在
 * `.bubble-sender-name` 一条规则里就够了；现在有三个宿主，**每个宿主都必须自己
 * 有一顶帽子**（宽度上界 + 溢出裁剪），少一个就会出现「这一路的长名把气泡撑破 /
 * 顶出容器」，而另外两路看着是好的。
 *
 * 🔴 为什么是静态扫 CSS 而不是渲染测：jsdom 没有布局引擎，
 * `getBoundingClientRect()` / `scrollWidth` 恒 0，"撑没撑破"在 vitest 里
 * **没有任何可观测量**（见 .claude/rules/frontend-test.md「滚动 / 布局相关行为：
 * vitest 结构性测不出」）。所以这里能守的是**声明层**：三个宿主各自的帽子还在不在。
 * 真实像素只能靠真机复核，本文件不冒充它。
 *
 * 静态扫用 __dirname（vitest 下 import.meta.url 不是 file: scheme，见 frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const META_CSS = readFileSync(resolve(ROOT, 'src/styles/components/chat-bubble-meta.css'), 'utf-8');
const MAIN_CSS = readFileSync(resolve(ROOT, 'src/styles/pages/main.css'), 'utf-8');
const MEDIA_CSS = readFileSync(resolve(ROOT, 'src/styles/components/media-bubble.css'), 'utf-8');

/**
 * 先把 CSS 注释整段剥掉再抠规则块。
 *
 * 🔴 不剥不行：本仓 animation-conflict 的抠块是「到第一个右花括号为止」，
 * **注释里出现一个花括号就会把它后面的声明挡在块外** —— 那条登记项于是静默空转、恒 PASS
 * （见 .claude/rules/animation.md「CSS 注释里不许出现花括号」，是变异验证才发现的）。
 * 这里从源头绕开：注释先没了，块里剩下的一定是真声明。
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 抠出 `selector { ... }` 基础规则块的正文；抠不到返回 null（调用方一律断言非 null） */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`);
  const m = stripCssComments(css).match(re);
  return m ? m[1] : null;
}

/** 规则块里某个属性的值；没有该属性返回 null */
function decl(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`));
  return m ? m[1] : null;
}

describe('昵称尺寸契约：抠块工具自检（判据先证明自己会响也会静）', () => {
  it('抠得到确知存在的规则，抠不到确知不存在的规则', () => {
    // 正对照：这条规则确实在 chat-bubble-meta.css 里
    expect(ruleBody(META_CSS, '.bubble-sender-name')).not.toBeNull();
    // 负对照：一个绝不存在的选择器必须返回 null（否则本文件所有断言都零判别力）
    expect(ruleBody(META_CSS, '.zzq-nonexistent-selector-9x7')).toBeNull();
  });

  it('剥注释是真的在剥（注释里的声明不算数）', () => {
    const fake = '/* .fake { color: red; } */\n.fake { color: blue; }';
    // 若不剥注释，第一个匹配会是注释里那个 red
    expect(decl(ruleBody(fake, '.fake')!, 'color')).toBe('blue');
  });
});

describe('昵称尺寸契约：昵称自身必须能被截断（三个落点共用的那一顶帽子）', () => {
  const body = () => {
    const b = ruleBody(META_CSS, '.bubble-sender-name');
    expect(b, '.bubble-sender-name 基础规则不见了').not.toBeNull();
    return b!;
  };

  it('nowrap + overflow:hidden + text-overflow:ellipsis 三件套齐全', () => {
    const b = body();
    expect(decl(b, 'white-space')).toBe('nowrap');
    expect(decl(b, 'overflow')).toBe('hidden');
    expect(decl(b, 'text-overflow')).toBe('ellipsis');
  });

  it('max-width:100% + min-width:0 —— 不许把宿主顶出它自己的上界', () => {
    const b = body();
    expect(decl(b, 'max-width')).toBe('100%');
    // flex 项的自动最小尺寸 = min-content = 整串名字；不置 0 就压不下去
    expect(decl(b, 'min-width')).toBe('0');
  });
});

describe('昵称尺寸契约：三个落点的宿主各自都有宽度上界', () => {
  it('① 文本气泡 .bubble-text：max-width + overflow:hidden（名字最多把气泡撑到 .message-bubble 的帽子）', () => {
    const b = ruleBody(MAIN_CSS, '.bubble-text');
    expect(b, '.bubble-text 基础规则不见了').not.toBeNull();
    expect(decl(b!, 'max-width')).toBe('100%');
    expect(decl(b!, 'overflow')).toBe('hidden');
  });

  it('① 的最终上界来自 .message-bubble 的 max-width（百分比得有个可解析的祖先）', () => {
    const b = ruleBody(MAIN_CSS, '.message-bubble');
    expect(b, '.message-bubble 基础规则不见了').not.toBeNull();
    expect(decl(b!, 'max-width')).toMatch(/\d/);
  });

  it('② 媒体大气泡 .media-bubble：max-width + overflow:hidden', () => {
    const b = ruleBody(MEDIA_CSS, '.media-bubble');
    expect(b, '.media-bubble 基础规则不见了').not.toBeNull();
    expect(decl(b!, 'max-width')).toMatch(/\d/);
    expect(decl(b!, 'overflow')).toBe('hidden');
  });

  it('② 名字在媒体气泡里自带内边距 ⇒ 必须 border-box，否则 max-width:100% 会被 padding 顶出去', () => {
    const b = ruleBody(META_CSS, '.media-bubble > .bubble-sender-name');
    expect(b, '.media-bubble > .bubble-sender-name 规则不见了').not.toBeNull();
    expect(decl(b!, 'padding')).toBeTruthy();
    expect(decl(b!, 'box-sizing')).toBe('border-box');
  });

  it('③ 药丸浮层：自己带 max-width(含左右余量) + border-box，且宿主 .media-bubble-bare 也有帽子', () => {
    const pill = ruleBody(META_CSS, '.media-bubble-bare > .bubble-sender-name');
    expect(pill, '.media-bubble-bare > .bubble-sender-name 规则不见了').not.toBeNull();
    // 绝对定位 + 左右各留 6px ⇒ 帽子必须扣掉这 12px，直接 100% 会顶出媒体右缘
    expect(decl(pill!, 'position')).toBe('absolute');
    expect(decl(pill!, 'max-width')).toBe('calc(100% - 12px)');
    expect(decl(pill!, 'box-sizing')).toBe('border-box');

    const shell = ruleBody(META_CSS, '.media-bubble-bare');
    expect(shell, '.media-bubble-bare 基础规则不见了').not.toBeNull();
    // 百分比要有可解析的参照系：定位壳自己是 relative 且不超过 .bubble-content
    expect(decl(shell!, 'position')).toBe('relative');
    expect(decl(shell!, 'max-width')).toBe('100%');
  });
});
