/**
 * #7 控制按钮「两端各自一份」的静态契约（owner 2026-09-14 二次评审①后重写）
 *
 * ## 历史病历（仍然守着，不能丢）
 * 2026-09-14 真机实测发现：`src/meeting/styles.css` 里为触屏兜底写的
 * `@media (hover: none) { .tile-control-pill { opacity: 1 } }` 会在安卓 WebView
 * （hover:none）下把**移动端**会议页的胶囊钉成常显，于是「点按 tile 伸出 / 再点或点别处
 * 收回」的 `--open` 开关完全失效 —— 安卓端看到的是常显胶囊。
 * 同日的第二个病历：`.mobile-video-grid` 的 onClick 把 controlPillId 置 null，而同一次
 * 冒泡里对端 tile 的 onClick 刚把它设上 ⇒ 净效果是胶囊永远点不开。
 *
 * ## 本轮架构变更（owner 二次评审①）
 * 「两端视觉分别适配：移动端样式独立设计、不再复用桌面组件」⇒ 移动端不再给桌面胶囊加
 * `--mobile` 修饰符，而是用自己的组件 `MobileControlPill` + 自己的类名命名空间
 * `.mob-control-pill`。于是上面第一个病历在结构上不可能复发（触碰不到桌面那条媒体查询），
 * 本文件把这条**结构性保证**也锁下来：不锁就会有人图省事又去复用桌面类名。
 *
 * 这类缺陷 vitest 的组件测试抓不到（jsdom 不做 media query 求值），只能静态扫 CSS。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DESKTOP_CSS = resolve(__dirname, '../../src/meeting/styles.css');
const MOBILE_CSS = resolve(__dirname, '../../src/styles/mobile/meeting-page.css');
const MOBILE_PAGE = resolve(__dirname, '../../src/pages/mobile/MobileMeetingPage.tsx');
const MOBILE_PILL = resolve(__dirname, '../../src/meeting/components/MobileControlPill.tsx');
const DESKTOP_PAGE = resolve(__dirname, '../../src/meeting/MeetingPage.tsx');

/** 取出 `@media (hover: none) { ... }` 整块（含选择器） */
function hoverNoneBlock(css: string): string {
  const at = css.indexOf('@media (hover: none)');
  expect(at).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  throw new Error('未闭合的 @media (hover: none) 块');
}

/** 剥注释后的源码（避免注释里的关键词让断言假过） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('#7 控制按钮：桌面胶囊与移动端按钮各自一份', () => {
  const desktopCss = readFileSync(DESKTOP_CSS, 'utf8');
  const mobileCss = readFileSync(MOBILE_CSS, 'utf8');
  const mobilePage = stripComments(readFileSync(MOBILE_PAGE, 'utf8'));
  const mobilePill = stripComments(readFileSync(MOBILE_PILL, 'utf8'));
  const desktopPage = stripComments(readFileSync(DESKTOP_PAGE, 'utf8'));

  it('桌面胶囊基础规则默认隐藏（向下移出 + 透明 + 不可点）', () => {
    const base = desktopCss.slice(desktopCss.indexOf('.tile-control-pill {'));
    const rule = base.slice(0, base.indexOf('}'));
    expect(rule).toMatch(/opacity:\s*0/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).toMatch(/translate\(\s*-50%\s*,\s*calc\(100%\s*\+\s*20px\)\s*\)/);
  });

  it('触屏兜底不得触及移动端按钮：媒体查询只作用在桌面类名上', () => {
    const block = hoverNoneBlock(desktopCss);
    const selector = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    // 只允许作用在桌面类名命名空间（.tile-control-pill 开头的选择器）
    expect(selector).toMatch(/\.tile-control-pill/);
    // 结构性保证：移动端按钮的类名不在这个媒体查询里 ⇒ 永远不会被钉成常显
    expect(selector).not.toContain('.mob-control-pill');
  });

  it('移动端按钮用自己的类名命名空间，不继承桌面胶囊的类名', () => {
    expect(mobilePill).toContain('mob-control-pill');
    expect(mobilePill).not.toContain('tile-control-pill');
    expect(mobilePage).not.toContain('tile-control-pill');
    // 反向：桌面页不得渲染移动端按钮
    expect(desktopPage).not.toContain('MobileControlPill');
  });

  it('移动端伸出态只由 .mob-control-pill--open 驱动（不依赖 :hover / :focus-within）', () => {
    expect(mobileCss).toMatch(/\.mob-control-pill--open\s*\{[^}]*opacity:\s*1/);
    expect(mobileCss).toMatch(/\.mob-control-pill--open\s*\{[^}]*transform:\s*translate\(-50%,\s*0\)/);
    // 移动端 CSS 里不得出现任何 .tile-control-pill 规则（那是桌面命名空间）
    expect(mobileCss).not.toMatch(/^\s*\.tile-control-pill/m);
  });

  it('移动端页面：--open 由 controlOpen 条件驱动', () => {
    expect(mobilePage).toMatch(/open=\{controlOpen\}/);
    expect(mobilePage).toMatch(/controlOpen=\{controlPillId === participant\.id\}/);
  });

  it('点击对端 tile 不得被父容器的「点别处收回」当场清掉', () => {
    // 病历二（同日双机实测）：父容器 onClick 清空，同一次冒泡又把 tile 设上 ⇒ 净效果点不开。
    expect(mobilePage).toMatch(/closest\?\.\('\.mobile-participant-video'\)/);
    expect(mobilePage).toMatch(/if \(tile && !tile\.classList\.contains\('local'\)\) \{ return; \}/);
  });

  it('移动端按钮自身吞掉冒泡（否则父级会立刻收回）', () => {
    expect(mobilePill).toMatch(/e\.stopPropagation\(\)/);
  });
});
