/**
 * 视频封面接线契约（静态扫描）
 *
 * 守的是三条**只有真机才看得见、vitest 结构性测不出**的不变量：
 *
 *  A. 四处视频**缩略图**的 `<video src={…}>` 必须经 `videoPosterSrc(…)`
 *     —— 否则 WKWebView（macOS）与 Android WebView 不画首帧，缩略图是黑块；
 *        Windows 的 WebView2 会画，所以这个 bug 的分布恰好是「只有 Windows 有封面」。
 *  B. **全屏播放**递给 MobileMediaPreview 的 src 必须是**裸**的
 *     —— 带上 `#t=0.1` 会让视频从 0.1 秒开始播，用户永远看不到开头。
 *  C. 取源 / 反代那一层（resolver）里不得出现 `#t=`
 *     —— ① 同一个 src 会被同时递给缩略图和播放器，在 resolver 里加等于污染播放；
 *        ② secureProxy 的 pathAndQueryOf 走 `pathname + search`，fragment 根本传不出去，
 *           在那里加是**加了个寂寞**且会误导后来者以为已经加过了。
 *
 * ## 为什么必须是静态扫描而不是渲染断言
 *
 * jsdom 的 `<video>` 不解码、不 seek、不画帧；真 webview + 真 Range 的行为这套门禁一点也测不到
 * （同 .claude/rules/frontend-test.md「所有 X 必经 Y」的结构性盲区）。渲染断言最多能证明
 * "src 属性上有这几个字符"，而本文件要守的是**每一处**缩略图都没漏、并且播放器那处没被误加 ——
 * 这是"全量枚举 + 反向断言"，静态扫描才做得到。
 *
 * ## 断言在【剥掉注释的代码】上做
 *
 * 本仓的源码注释里正当地写着 `#t=0.1` / `videoPosterSrc`（在解释这条设计），
 * 直接扫原文会把准确的文档判成违规，逼后来的人删注释才能过门禁
 * （见 frontend-test.md「不变量口径写"禁裸写死"…且要在【剥掉注释的代码】上判」）。
 * `stripComments` 额外认 JSX 注释的起手式（左花括号紧跟斜杠星号）—— 那种行不以斜杠星号开头，
 * 沿用既有实现会漏掉。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8');

/**
 * 剥掉行注释 / 块注释 / JSX 注释。
 * 与 tests/huanvaeguard-port-resolution.test.ts 的同名函数同思路，但多认 `{/*` 开头
 * （JSX 里的注释形态），否则本仓那几条解释性的 JSX 注释会被当成代码扫进来。
 */
function stripComments(src: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) { inBlock = false; }
      continue;
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
      if (!trimmed.includes('*/')) { inBlock = true; }
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) { continue; }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * 抓出某个 JSX 标签每次出现时，紧随其后的第一个 `src={…}` 里的表达式原文。
 *
 * 用「标签名 → 其后第一个 src={}」而不是解析整个标签：`videoPosterSrc(src)` / `src` 里都没有 `}`，
 * `[^}]` 足以圈住表达式；而本仓这几处 `src` 恰好都是该标签的首个 `src=` 属性。
 */
function srcExpressionsAfter(code: string, tag: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf(tag, from);
    if (at === -1) { break; }
    from = at + tag.length;
    const m = /src=\{([^}]*)\}/.exec(code.slice(at));
    if (m) { found.push(m[1].trim()); }
  }
  return found;
}

/** 四处视频缩略图（全仓 `<video>` 缩略图的完整枚举，会议 / 独立预览窗不在此列） */
const THUMBNAIL_FILES = [
  'src/chat/shared/FileMessageContent.tsx',
  'src/components/search/ConversationSearchHit.tsx',
  'src/components/files/FilesModal.tsx',
  'src/pages/mobile/MobileFilesPage.tsx',
] as const;

/** 把裸 src 递给全屏播放器的那几处 */
const PLAYER_HOST_FILES = [
  'src/chat/shared/FileMessageContent.tsx',
  'src/components/search/ConversationSearchHit.tsx',
  'src/pages/mobile/MobileFilesPage.tsx',
] as const;

/** 取源 / 反代层：这一层碰 `#t=` 就是把片段加错了地方 */
const RESOLVER_FILES = [
  'src/services/secureProxy.ts',
  'src/services/fileCache.ts',
  'src/hooks/useFileCache.ts',
] as const;

describe('A. 视频缩略图的 src 必须经 videoPosterSrc', () => {
  it.each(THUMBNAIL_FILES)('%s：每个 <video> 的 src 都是 videoPosterSrc(...)', (rel) => {
    const code = stripComments(read(rel));
    const exprs = srcExpressionsAfter(code, '<video');

    // 先证明扫到了东西 —— 空集合会让下面的 every 类断言假通过
    expect(exprs.length).toBeGreaterThan(0);
    for (const expr of exprs) {
      expect(expr).toMatch(/^videoPosterSrc\(/);
    }
  });

  it.each(THUMBNAIL_FILES)('%s：确实 import 了 videoPosterSrc（不是同名局部变量）', (rel) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/import \{[^}]*\bvideoPosterSrc\b[^}]*\} from '[^']*videoPosterSrc'/);
  });
});

describe('B. 全屏播放拿到的是裸 src（#t=0.1 只给缩略图）', () => {
  it.each(PLAYER_HOST_FILES)('%s：<MobileMediaPreview> 的 src 不经 videoPosterSrc', (rel) => {
    const code = stripComments(read(rel));
    const exprs = srcExpressionsAfter(code, '<MobileMediaPreview');

    expect(exprs.length).toBeGreaterThan(0);
    for (const expr of exprs) {
      expect(expr).not.toContain('videoPosterSrc');
    }
  });

  it('FileMessageContent：同一个 src 变量既喂缩略图又喂播放器，两者形态必须不同', () => {
    // 这条是 B 的**要害**：缩略图与播放器共用一个 `src`，所以"在 resolver 里统一加"会连播放一起污染。
    // 断言两处取值形态确实分叉，而不是碰巧都对。
    const code = stripComments(read('src/chat/shared/FileMessageContent.tsx'));
    expect(srcExpressionsAfter(code, '<video')).toContain('videoPosterSrc(src)');
    expect(srcExpressionsAfter(code, '<MobileMediaPreview')).toContain('src');
  });
});

describe('C. 取源 / 反代层不得出现媒体片段', () => {
  it.each(RESOLVER_FILES)('%s：代码里不含 #t=', (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toContain('#t=');
  });
});
