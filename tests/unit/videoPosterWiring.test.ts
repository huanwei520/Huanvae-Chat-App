/**
 * 视频封面接线契约（静态扫描）
 *
 * 守的是四条**只有真机才看得见、vitest 结构性测不出**的不变量：
 *
 *  A. 全仓当缩略图用的 `<video>` **有且只有一处** —— 共享组件 chat/shared/VideoThumbnail.tsx，
 *     且它的 src 必经 `videoPosterSrc(…)`、必带 `preload="metadata"` / `muted` / `playsInline`。
 *     漏 `videoPosterSrc` ⇒ WKWebView（macOS）与 Android WebView 不画首帧、缩略图是黑块
 *     （Windows 的 WebView2 会画，所以这个 bug 的分布恰好是「只有 Windows 有封面」）；
 *     漏 `playsInline` ⇒ iOS 把缩略图接管成全屏播放器。
 *  A2. 四个消费点只许**调用**该组件，不许自己写 `<video>`、也不许自己调 `videoPosterSrc`。
 *     这一条才是本次收敛的要害：在此之前四处**各自接线**（共享的只是「算 src 的纯函数」），
 *     于是「哪一处漏接」在结构上依然可能发生 —— 事实上 FilesModal 就漏了 muted / playsInline，
 *     一直没人复查。收敛后「四处都记得写对」变成「结构上只有一处可写」。
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
 * "src 属性上有这几个字符"，而本文件要守的是**全仓只剩这一处**、并且播放器那处没被误加 ——
 * 这是"全量枚举 + 反向断言"，静态扫描才做得到。
 *
 * ## 断言在【剥掉注释的代码】上做
 *
 * 本仓的源码注释里正当地写着 `#t=0.1` / `videoPosterSrc` / `<video>`（在解释这条设计），
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

/** 唯一允许渲染缩略图 `<video>` 的文件 */
const SHARED_THUMBNAIL = 'src/chat/shared/VideoThumbnail.tsx';

/**
 * 全仓**所有**会显示视频缩略图的消费点（完整枚举）。
 * 它们只许调 <VideoThumbnail>，自己不许碰 `<video>` / `videoPosterSrc`。
 */
const THUMBNAIL_CONSUMERS = [
  'src/chat/shared/FileMessageContent.tsx',
  'src/components/search/ConversationSearchHit.tsx',
  'src/components/files/FilesModal.tsx',
  'src/pages/mobile/MobileFilesPage.tsx',
] as const;

/**
 * 「当缩略图用的 <video>」的搜查范围：排除三个**播放器**页面
 * （会议两端 + 独立媒体预览窗）—— 它们渲染的是真播放器，不是封面，本契约不管。
 */
const PLAYER_PAGES = [
  'src/meeting/MeetingPage.tsx',
  'src/pages/mobile/MobileMeetingPage.tsx',
  'src/media/MediaPreviewPage.tsx',
];

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

describe('A. 缩略图 <video> 只有共享组件一处，且接线完整', () => {
  it('VideoThumbnail：src 经 videoPosterSrc，且 preload/muted/playsInline 一个不缺', () => {
    const code = stripComments(read(SHARED_THUMBNAIL));

    const exprs = srcExpressionsAfter(code, '<video');
    // 先证明扫到了东西 —— 空集合会让下面的 every 类断言假通过
    expect(exprs.length).toBe(1);
    expect(exprs[0]).toMatch(/^videoPosterSrc\(/);

    expect(code).toMatch(/import \{[^}]*\bvideoPosterSrc\b[^}]*\} from '[^']*videoPosterSrc'/);
    expect(code).toContain('preload="metadata"');
    expect(code).toMatch(/^\s*muted$/m);
    expect(code).toMatch(/^\s*playsInline$/m);
  });

  it.each(THUMBNAIL_CONSUMERS)('%s：只调 <VideoThumbnail>，自己不写 <video> / 不调 videoPosterSrc', (rel) => {
    const code = stripComments(read(rel));

    // 正向：确实用了共享组件，且 import 的是那个模块（不是同名局部组件）
    expect(code).toContain('<VideoThumbnail');
    expect(code).toMatch(/import \{[^}]*\bVideoThumbnail\b[^}]*\} from '[^']*VideoThumbnail'/);
    // 反向：自己不许再写第二处（这才是收敛真正要防的回退）
    expect(code).not.toContain('<video');
    expect(code).not.toContain('videoPosterSrc(');
  });

  it('全仓再没有第二处把 <video> 当缩略图用（播放器页面除外）', async () => {
    // 用 import.meta.glob 全量枚举，而不是维护一张会过期的手写清单 ——
    // 「哪一处漏了」正是本契约要防的东西，清单本身漏一行就前功尽弃。
    const modules = import.meta.glob('../../src/**/*.tsx', { query: '?raw', import: 'default', eager: true });
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(modules)) {
      const rel = path.replace('../../', '');
      if (rel === SHARED_THUMBNAIL || PLAYER_PAGES.includes(rel)) { continue; }
      if (stripComments(raw as string).includes('<video')) { offenders.push(rel); }
    }
    // 扫描面非空的正对照：否则 glob 写错时这条恒过
    expect(Object.keys(modules).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
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
    // 收敛后缩略图那侧的分叉点搬进了 <VideoThumbnail>（它内部才追片段），
    // 故这里断言的是「递进组件的是裸 src」+「递给播放器的也是裸 src」，
    // 真正的分叉由 A 组「组件内部必经 videoPosterSrc」那条守着。
    const code = stripComments(read('src/chat/shared/FileMessageContent.tsx'));
    expect(srcExpressionsAfter(code, '<VideoThumbnail')).toContain('src');
    expect(srcExpressionsAfter(code, '<MobileMediaPreview')).toContain('src');
  });
});

describe('C. 取源 / 反代层不得出现媒体片段', () => {
  it.each(RESOLVER_FILES)('%s：代码里不含 #t=', (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toContain('#t=');
  });
});
