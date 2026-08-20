/**
 * 图片查看器「双指手势归谁」的静态契约
 *
 * 守的不变量（回归形态就是 huanwei 报的那个 bug）：
 *   预览浮层里的双指手势必须由 App 的 JS 手势层独占，**不得**交回浏览器 ——
 *   交回去 = 页面级 visual viewport 缩放 = 双指放大的是整个 App，而不是那张图片。
 *
 * 三条判据各守一段链路：
 *   ① CSS 不得再把 touch-action 设成任何允许浏览器做双指缩放的值（pinch-zoom / manipulation）；
 *      浮层本体必须显式 `touch-action: none`。
 *   ② 承载 transform 的那一层不得声明 transition/animation（会与逐帧写入抢帧）。
 *   ③ 手势监听必须走 addEventListener + `{ passive: false }` ——
 *      React 的 onTouchStart/onTouchMove 是 passive，里面 preventDefault 无效
 *      （本仓 src/styles/mobile/profile-page.css 已记过这个坑）。
 *
 * 口径注意（对齐 .claude/rules/frontend-test.md「不变量口径写"禁裸写死"，不是"禁出现该数字"」）：
 * 判定一律在**剥掉注释的 CSS** 上做 —— 否则解释这个坑的注释本身会把门禁弄红，
 * 逼后人删掉正确的文档才能过。stripCssComments 自带自检用例，防它静默失效。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = process.cwd();
/* eslint-enable no-undef */

const CSS_PATH = 'src/styles/mobile/chat-view.css';
const PREVIEW_PATH = 'src/chat/shared/MobileMediaPreview.tsx';
const HOOK_PATH = 'src/chat/shared/useImageZoom.ts';

function read(rel: string): string {
  return readFileSync(resolve(PROJECT_ROOT, rel), 'utf-8');
}

/**
 * 剥掉 CSS 的块注释
 *
 * CSS 只有块注释一种形态，不存在 common.md 里那个「朴素 //.*$ 会吃掉 URL 双斜杠」的坑。
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 剥掉 TS/TSX 的注释，**字符串感知**
 *
 * 为什么不能用朴素的 //.*$：本文件被扫的源码里有 `src.startsWith('https://')`、
 * 模板串 `` `${x}` `` 之类，双斜杠在字符串里 —— 朴素写法会把半行代码一起吃掉，
 * 反而制造假 FAIL（见 .claude/rules/common.md 与 frontend-test.md 同名坑）。
 *
 * 为什么必须剥：判据口径是「**代码里**不得出现 onTouchMove=」，
 * 而解释这条规则的注释本身会写出这个串。不剥就等于逼后人删掉正确的文档才能过门禁。
 */
function stripJsComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (c === quote) { quote = null; }
      out += c;
      i += 1;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 取 selector 的基础规则块（不含伪类）；抓不到返回 null */
function baseRuleBlock(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  return m ? m[1] : null;
}

const CSS = read(CSS_PATH);
const CSS_CODE = stripCssComments(CSS);

/**
 * 🔴 对源码的断言一律用剥掉注释的版本
 *
 * 变异自证时实测过：只写 `{ passive: false }` 的断言可以被**文件头注释里那句解释**满足 ——
 * 把代码改成 passive: true 守卫仍然绿。剥注释后这条变异立刻翻红。
 */
const HOOK_CODE = stripJsComments(read(HOOK_PATH));

describe('判据自检（判据坏了要当场红，不能静默放行）', () => {
  it('stripCssComments 只吃注释、不吃声明', () => {
    const sample = '.a { color: red; /* touch-action: pinch-zoom 说明文字 */ touch-action: none; }';
    const stripped = stripCssComments(sample);
    expect(stripped).not.toContain('pinch-zoom');
    expect(stripped).toContain('touch-action: none');
    expect(stripped).toContain('color: red');
  });

  it('baseRuleBlock 抓得到块、且抓不到时返回 null', () => {
    expect(baseRuleBlock('.a { color: red; }', '.a')).toContain('color: red');
    expect(baseRuleBlock('.a { color: red; }', '.nope-not-here')).toBeNull();
  });

  it('stripJsComments 剥注释但不碰字符串里的双斜杠', () => {
    const sample = [
      '/* 说明里写了 onTouchMove= 也不算数 */',
      'const a = src.startsWith(\'https://x\'); // 行注释里写 onTouchMove= 同理',
      'const b = 1;',
    ].join('\n');
    const stripped = stripJsComments(sample);
    expect(stripped).not.toContain('onTouchMove=');
    expect(stripped).toContain('\'https://x\'');
    expect(stripped).toContain('const b = 1;');
  });

  it('剥完注释后源码仍在（否则下面的"没出现"是空判据）', () => {
    const code = stripJsComments(read(PREVIEW_PATH));
    expect(code).toContain('mobile-media-preview-image-stage');
    expect(code).toContain('onTouchStart=');
  });

  it('CSS 文件读到了非空内容（否则下面所有"没出现"都是空判据）', () => {
    expect(CSS_CODE.length).toBeGreaterThan(1000);
    expect(CSS_CODE).toContain('.mobile-media-preview-overlay');
    expect(CSS_CODE).toContain('.mobile-media-preview-image');
  });
});

describe('① 预览浮层不得把双指交回浏览器', () => {
  it('剥注释后的 CSS 里没有任何允许浏览器双指缩放的 touch-action 值', () => {
    // pinch-zoom / manipulation 都保留了浏览器的双指缩放能力，二者都算违规
    expect(CSS_CODE).not.toMatch(/touch-action\s*:[^;}]*\b(pinch-zoom|manipulation)\b/);
  });

  it('.mobile-media-preview-overlay 显式声明 touch-action: none', () => {
    const block = baseRuleBlock(CSS_CODE, '.mobile-media-preview-overlay');
    expect(block, '.mobile-media-preview-overlay 规则块抓不到 —— 这条判据是空转的').not.toBeNull();
    expect(block as string).toMatch(/touch-action\s*:\s*none\s*;/);
  });
});

describe('② transform 承载层单一所有权', () => {
  it('.mobile-media-preview-image-stage 不声明 transition / animation', () => {
    const block = baseRuleBlock(CSS_CODE, '.mobile-media-preview-image-stage');
    expect(block, '.mobile-media-preview-image-stage 规则块抓不到 —— 这条判据是空转的').not.toBeNull();
    expect(block as string).not.toMatch(/\btransition\b/);
    expect(block as string).not.toMatch(/\banimation\b/);
  });

  it('图片本体外层套着 stage，且 stage 拿到 useImageZoom 的 ref', () => {
    const src = read(PREVIEW_PATH);
    expect(src).toMatch(
      /<div className="mobile-media-preview-image-stage" ref=\{stageRef\}>[\s\S]{0,300}<motion\.img/,
    );
  });
});

describe('③ 手势监听必须是 non-passive 手挂（React 合成事件的 preventDefault 无效）', () => {
  it('touchstart / touchmove 都用 { passive: false } 注册', () => {
    expect(HOOK_CODE).toMatch(/const options = \{ passive: false, capture: false \};/);
    expect(HOOK_CODE).toMatch(/addEventListener\('touchstart', handleTouchStart, options\)/);
    expect(HOOK_CODE).toMatch(/addEventListener\('touchmove', handleTouchMove, options\)/);
  });

  it('MobileMediaPreview 不用 React 的 onTouchMove 做手势（那是 passive 的）', () => {
    // 口径是「代码里不得出现」，不是「文件里不得出现」——注释解释这条规则时会写出这个串
    expect(stripJsComments(read(PREVIEW_PATH))).not.toMatch(/onTouchMove=/);
  });
});

describe('对外接口：放大态必须写进 mediaZoomState（横向切图层的唯一读口）', () => {
  it('缩放层是 mediaZoomState 的写方', () => {
    expect(HOOK_CODE).toMatch(/import \{ setMediaZoomed \} from '\.\/mediaZoomState';/);
    // 必须真的调它，而不是只 import 不用
    expect(HOOK_CODE).toMatch(/setMediaZoomed\(isZoomedScale\(scaleRef\.current\)\)/);
  });

  it('未激活的预览实例不许写真值源（列表里每条图片消息都挂着一个）', () => {
    // 块内有界：写调用必须被 enabledRef 守着
    expect(HOOK_CODE).toMatch(/if \(enabledRef\.current\) \{[^}]*setMediaZoomed\([^}]*\}/);
  });

  it('未放大时单指手势不被本层截走（留给切图层）', () => {
    // 块内有界（[^}] 不跨出该 if 块）：块里必须是 pan = null 后直接 return，
    // 不许改成在这里 preventDefault —— 那会把横向滑动一并吞掉，切图手势就永远收不到
    expect(HOOK_CODE).toMatch(
      /if \(!isZoomedScale\(scaleRef\.current\)\) \{[^}]*pan = null;[^}]*return;[^}]*\}/,
    );
  });
});
