/**
 * 「左右滑动切图」的接线契约（静态扫描）
 *
 * 纯逻辑与手势判定各有自己的测试；这一份守的是**接线**——它们错了不会有任何红，
 * 只会表现为「功能整个不存在」或「只在某一端存在」：
 *
 * 1. 两条消息列表（私聊 / 群聊）都必须算出序列并用 MediaGalleryProvider 包住
 *    —— 少一条，那一端就永远只有单张序列，滑不动，而单测全绿
 * 2. 气泡里不许再自带全屏预览 —— 留着就是两个浮层，且旧的那个滑不动
 * 3. 桌面 handoff 必须带上 sequence + sequenceIndex，否则独立预览窗只有一张
 * 4. media/api.ts 必须把序列归一化成**恒非空**，否则预览窗要多一条"有没有序列"的分支
 *
 * 读源码用 __dirname（vitest 下 import.meta.url 不是 file: scheme），
 * 判定在**剥掉注释**的代码上做 —— 否则解释这些坑的注释本身会把门禁弄红
 * （见 .claude/rules/frontend-test.md「不变量口径写"禁裸写死"」）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../..', rel), 'utf-8');
}

/** 剥掉 // 行注释与 /* *\/ 块注释；跳过字符串/模板里的 // （如 `http://`） */
function stripComments(code: string): string {
  let out = '';
  let inBlock = false;
  for (const line of code.split('\n')) {
    let i = 0;
    let buf = '';
    let quote: string | null = null;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (inBlock) {
        if (two === '*/') { inBlock = false; i += 2; continue; }
        i += 1;
        continue;
      }
      const ch = line[i];
      if (quote) {
        buf += ch;
        if (ch === '\\') { buf += line[i + 1] ?? ''; i += 2; continue; }
        if (ch === quote) { quote = null; }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; buf += ch; i += 1; continue; }
      if (two === '//') { break; }
      if (two === '/*') { inBlock = true; i += 2; continue; }
      buf += ch;
      i += 1;
    }
    out += `${buf}\n`;
  }
  return out;
}

const LISTS = [
  'src/chat/friend/ChatMessages.tsx',
  'src/chat/group/GroupChatMessages.tsx',
] as const;

describe('判据自检（判据坏了要当场红，不能静默放行）', () => {
  it('stripComments 只吃注释、不吃代码与 URL 里的双斜杠', () => {
    const sample = "const u = 'http://a'; // 说明 MediaGalleryProvider\nconst b = 1; /* 块 */\n";
    const s = stripComments(sample);
    expect(s).toContain("const u = 'http://a';");
    expect(s).toContain('const b = 1;');
    expect(s).not.toContain('说明 MediaGalleryProvider');
    expect(s).not.toContain('块');
  });

  it('读到的源码非空（否则下面所有"含有"断言都是空判据）', () => {
    for (const rel of LISTS) {
      expect(stripComments(read(rel)).length).toBeGreaterThan(1000);
    }
  });
});

describe('① 两条消息列表都接了会话媒体序列', () => {
  it.each(LISTS)('%s：算出 galleryItems 并用 MediaGalleryProvider 包住', (rel) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/import \{ buildMediaGallery \} from '[^']*mediaGallery'/);
    expect(code).toMatch(/import \{ MediaGalleryProvider \} from '[^']*MediaGalleryProvider'/);
    // 序列真的算了，且真的递进 Provider（只 import 不用是最容易漏的形态）
    expect(code).toMatch(/buildMediaGallery\(renderNodes,/);
    expect(code).toMatch(/<MediaGalleryProvider items=\{galleryItems\}>/);
    expect(code).toContain('</MediaGalleryProvider>');
  });

  // 2026-08-21：私聊那边原本还带 `friendId: friend.friend_id`，随「好友文件 403 上报」
  // 整条删除（后端没有 /api/diagnostic 路由，上报恒 404）。urlType 才是选预签名端点的那一位。
  it('私聊序列声明 friend、群聊序列声明 group —— 预签名端点靠它选', () => {
    expect(stripComments(read(LISTS[0]))).toMatch(/\{ urlType: 'friend' \}/);
    expect(stripComments(read(LISTS[1]))).toMatch(/\{ urlType: 'group' \}/);
  });
});

describe('② 气泡不再自带全屏预览（否则是两个浮层，旧的那个滑不动）', () => {
  const bubble = stripComments(read('src/chat/shared/FileMessageContent.tsx'));

  it('FileMessageContent 里既不 import 也不渲染 MobileMediaPreview', () => {
    expect(bubble).not.toContain('MobileMediaPreview');
  });

  it('移动端点击走会话序列的 openAt，桌面端走独立预览窗', () => {
    expect(bubble).toMatch(/const gallery = useMediaGallery\(\);/);
    // 块内有界（[^}] 不跨出该 if 块）：移动端分支里必须是 openAt 后直接 return
    expect(bubble).toMatch(/if \(isMobile\(\)\) \{[^}]*gallery\.openAt\(item\);[^}]*return;[^}]*\}/);
    expect(bubble).toContain('openMediaWindow(');
  });
});

describe('③ 桌面 handoff 带序列（否则独立预览窗只有一张）', () => {
  const bubble = stripComments(read('src/chat/shared/FileMessageContent.tsx'));

  it('sequence / sequenceIndex 都出现在 openMediaWindow 的载荷里', () => {
    const start = bubble.indexOf('openMediaWindow(');
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = bubble.slice(start, bubble.indexOf('serverUrl:', start));
    expect(payload).toContain('sequence:');
    expect(payload).toContain('sequenceIndex: index');
  });

  it('位次由 locateInGallery 算 —— 与移动端 openAt 共用同一条定位口径', () => {
    expect(bubble).toMatch(/const \{ list, index \} = locateInGallery\(gallery\.items, item\);/);
  });
});

describe('④ handoff 载荷归一化成恒非空序列', () => {
  const api = stripComments(read('src/media/api.ts'));

  it('openMediaWindow 写进 localStorage 的是 { sequence, index, ... }', () => {
    const start = api.indexOf('saveMediaDataInternal({');
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = api.slice(start, api.indexOf('});', start));
    expect(payload).toMatch(/\bsequence,/);
    expect(payload).toMatch(/\bindex,/);
  });

  it('没给序列的调用方（「我的文件」/ 查找命中项）被归一化成长度 1 的序列', () => {
    expect(api).toMatch(/: \[entry\];/);
  });

  it('被点开的那一项用 entry 整条覆盖（只有它带主窗口已解析的 localPath / presignedUrl）', () => {
    expect(api).toMatch(/givenSequence\.map\(\(it, i\) => \(i === index \? entry : it\)\)/);
  });
});

describe('⑤ 独立预览窗按位次取当前项', () => {
  const page = stripComments(read('src/media/MediaPreviewPage.tsx'));

  it('当前项来自 sequence[index]，且 memo 住（否则加载 effect 会无限重取源）', () => {
    expect(page).toMatch(/const mediaState = useMemo<MediaState \| null>\(/);
    expect(page).toMatch(/const entry = handoff\.sequence\[index\];/);
  });

  it('键盘 ← → 切图，且到头不循环', () => {
    expect(page).toMatch(/e\.key === 'ArrowLeft'/);
    expect(page).toMatch(/e\.key === 'ArrowRight'/);
    // 块内有界：越界直接返回原位次（不取模、不回绕）
    expect(page).toMatch(/if \(next < 0 \|\| next >= total\) \{ return prev; \}/);
  });

  it('🔴 放大态下横向滑动是平移不是切图（与移动端同一条矩阵）', () => {
    // 块内有界：横向分支里 scale > 1 必须走 setPosition 后 return
    expect(page).toMatch(/if \(scale > 1\) \{[^}]*setPosition\(\(prev\) => \(\{ x: prev\.x - e\.deltaX, y: prev\.y \}\)\);[^}]*return;[^}]*\}/);
  });
});
