/**
 * 视频封面**本地持久化**的接线契约（静态扫描）
 *
 * 与同目录的 videoPosterWiring.test.ts 分工：那份守「全仓当缩略图用的 `<video>` 只有一处、
 * 且四个消费点只调共享组件」；本份守**封面持久化这条新链路**的三件事 ——
 *
 *  A. **气泡与「查找记录 → 视频」收敛到同一条封面路径**：两处都把**同一个 `file_hash`**
 *     递给 `<VideoThumbnail>` 当键。这是验收「同一个视频在两处的封面是同一帧」的结构前提 ——
 *     键一样 ⇒ 命中同一个封面文件 ⇒ 必然同一帧。任一处漏传，那一处就退回「每次重新截」。
 *  B. **解析入口只有一个**：只有 `<VideoThumbnail>` 能碰 `useVideoPoster` / 封面服务。
 *     全仓出现第二处自己解析封面即违规（同 A2 那条收敛纪律：把"四处都记得写对"
 *     变成"结构上只有一处可写"）。
 *  C. **键是 `file_hash`，不是显示 URL**。远程 src 带每次重签都变的 SigV4 参数、
 *     每会话可变的回环端口；本地 src 还会随平台在 asset 协议与本地媒体服务器间切换 ——
 *     拿它当键 = 每次都 miss = 正好复现要根治的 bug。这条负向断言把它钉死。
 *
 * ## 为什么是静态扫描
 *
 * 与 videoPosterWiring.test.ts 同因：jsdom 不解码不 seek，真机行为这套门禁测不到；
 * 而本文件要守的是「**全仓**只剩这一处解析入口」+「两处递的是同一把键」，
 * 属于全量枚举 + 反向断言，只有静态扫描做得到。
 *
 * ## 断言在【剥掉注释的代码】上做
 *
 * 本仓的源码注释里正当地写着 `fileHash` / `useVideoPoster` / `<video>`（在解释这条设计），
 * 直接扫原文会把准确的文档判成违规，逼后来的人删注释才能过门禁
 * （见 .claude/rules/frontend-test.md「不变量口径写"禁裸写死"…且要在【剥掉注释的代码】上判」）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8');

/** 剥掉行注释 / 块注释 / JSX 注释（与 videoPosterWiring.test.ts 同款实现） */
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
 * 抓出每个 `<VideoThumbnail …/>` 标签内 `fileHash={…}` 的表达式原文。
 * `[^>]` 把匹配限制在标签内（JSX 属性值里不会出现 `>`），不会跨到别的标签去。
 */
function fileHashPropsOf(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/<VideoThumbnail([^>]*)>/g)) {
    const attrs = m[1];
    const hit = /fileHash=\{([^}]*)\}/.exec(attrs);
    found.push(hit ? hit[1].trim() : '<缺失>');
  }
  return found;
}

const SHARED_THUMBNAIL = 'src/chat/shared/VideoThumbnail.tsx';
const POSTER_HOOK = 'src/chat/shared/useVideoPoster.ts';
const POSTER_SERVICE = 'src/services/videoPoster.ts';

/**
 * 必须接上封面持久化的**全部**消费点，以及各自应当递的键表达式。
 *
 * 前两条是气泡与「查找记录 → 视频」；后两条是「我的文件」桌面 / 移动两处 ——
 * 它们此前不传 fileHash（行为退回「每次挂载重新 seek」），本轮补上。
 * 四处递的都是同一行数据的 `file_hash` ⇒ 同一个视频在四个入口命中**同一个封面文件**。
 */
const WIRED_CONSUMERS: Array<[string, string]> = [
  ['src/chat/shared/FileMessageContent.tsx', 'fileHash'],
  ['src/components/search/ConversationSearchHit.tsx', 'message.file_hash'],
  ['src/components/files/FilesModal.tsx', 'file.file_hash'],
  ['src/pages/mobile/MobileFilesPage.tsx', 'file.file_hash'],
];

describe('A. 气泡与查找记录递同一把键 ⇒ 两处必然是同一帧', () => {
  it.each(WIRED_CONSUMERS)('%s 把 %s 递给 <VideoThumbnail> 当封面键', (rel, expected) => {
    const code = stripComments(read(rel));
    const props = fileHashPropsOf(code);

    // 先证明扫到了标签 —— 空集合会让下面的 toContain 假通过
    expect(props.length).toBeGreaterThan(0);
    expect(props).toContain(expected);
    // 漏传即退化成「每次重新截」，这条把它翻红
    expect(props).not.toContain('<缺失>');
  });

  it('两处的键同源：都取自消息行的 file_hash（而不是各自另造一个标识）', () => {
    const bubble = stripComments(read('src/chat/shared/FileMessageContent.tsx'));
    const search = stripComments(read('src/components/search/ConversationSearchHit.tsx'));

    // 气泡侧：VideoMessage 的 fileHash prop 由消息行的 file_hash 传入（见 FileMessageContent
    // 的分发处），故这里断言该 prop 在组件签名里存在且被递了出去
    expect(bubble).toMatch(/fileHash:\s*string \| null \| undefined/);
    expect(fileHashPropsOf(bubble)).toContain('fileHash');
    // 查找记录侧：同一行消息的 file_hash（与 useFileCache 取源用的是同一个字段）
    expect(search).toMatch(/fileHash:\s*message\.file_hash/);
    expect(fileHashPropsOf(search)).toContain('message.file_hash');
  });
});

describe('B. 封面解析入口全仓只有 <VideoThumbnail> 一处', () => {
  it('VideoThumbnail 经 useVideoPoster 解析，命中时渲染 <img src={posterSrc}>', () => {
    const code = stripComments(read(SHARED_THUMBNAIL));

    expect(code).toMatch(/import \{[^}]*\buseVideoPoster\b[^}]*\} from '\.\/useVideoPoster'/);
    // 恰一处调用（多处 = 同一组件里两套状态机）
    expect(code.match(/useVideoPoster\(/g)).toHaveLength(1);
    expect(code).toMatch(/useVideoPoster\(fileHash,\s*src\)/);
    // 命中分支渲染的是 <img>，src 绑到解析出来的 posterSrc
    expect(code).toMatch(/<img[^>]*src=\{posterSrc\}/);
  });

  it('全仓再没有第二处自己解析封面（只有共享组件与它的 Hook 能碰）', async () => {
    const modules = import.meta.glob('../../src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const allowed = new Set([SHARED_THUMBNAIL, POSTER_HOOK, POSTER_SERVICE]);
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(modules)) {
      const rel = path.replace('../../', '');
      if (allowed.has(rel)) { continue; }
      const code = stripComments(raw as string);
      if (/\buseVideoPoster\b|\bloadVideoPosterSrc\b|\bcaptureAndSaveVideoPoster\b/.test(code)) {
        offenders.push(rel);
      }
    }
    // 扫描面非空的正对照：glob 写错时这条会恒过
    expect(Object.keys(modules).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});

describe('C. 封面的键是 file_hash，不是显示 URL', () => {
  const service = stripComments(read(POSTER_SERVICE));

  it('读侧：get_video_poster_path 的参数只有 fileHash', () => {
    expect(service).toMatch(/'get_video_poster_path',\s*\{\s*fileHash\s*\}/);
  });

  it('写侧：save_video_poster 的参数块里有 fileHash，且不含 src / url（回归守卫）', () => {
    // `[^}]` 把匹配限制在那个参数对象字面量内部，不会吞到下游别的对象去
    const m = /'save_video_poster',\s*\{([^}]*)\}/.exec(service);
    expect(m).not.toBeNull();
    const args = m![1];
    expect(args).toMatch(/\bfileHash\b/);
    expect(args).not.toMatch(/\bsrc\b/);
    expect(args).not.toMatch(/\burl\b/);
  });

  it('Rust 侧同一把键：video_posters 表主键是 file_hash', () => {
    const schema = read('src-tauri/src/db/video_posters.rs');
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS video_posters[\s\S]{0,120}file_hash TEXT PRIMARY KEY/);
  });
});
