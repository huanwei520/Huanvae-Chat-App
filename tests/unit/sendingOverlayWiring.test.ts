/**
 * 单项发送态覆盖层的**接线契约**（静态扫描）
 *
 * 与 tests/components/SendingMediaBubbleWiring.test.tsx 分工：那份测**行为**
 * （有条目才走这一支、重试/取消真的落到 store）；本份守**结构** ——
 *
 *  A. **三个渲染点都把自己那条消息的 clientId 递下去**：私聊气泡 / 群聊气泡 /
 *     相册的每一个格子。漏一处，那一处的媒体在上传期间就只会显示「文件不可用」，
 *     而且**四处的症状完全相同**，从现象反推不出是哪一处漏了
 *     （同 .claude/rules/common.md「数据要穿过几段就得验几段」那一族）。
 *  B. **覆盖层的渲染点全仓只有一处**：只有 FileMessageContent 能画它。
 *     多一处就多一处会漂的接线。
 *  C. 🔴 **气泡侧不许再起 `useComposerTrayOutbox` 实例**。它的两个 `useRef`
 *     （串行闸 `pumpingRef` / 取消用的 `abortsRef`）是**实例内状态**：
 *     多一个实例就多一个泵 ⇒ 同一批附件被并发上传 ⇒ 组内 seq 乱序 ⇒ 相册在对端被拆散；
 *     而 abort 表在气泡那份实例里恒为空，取消也照样打不到在途请求。
 *     ⇒ 全仓只允许 ChatInputArea 持有它，气泡侧走 sendingMediaActions 的模块级函数。
 *  D. **不在气泡里再写一套滚底**（接线契约「三条不要踩」第 3 条）：
 *     乐观条目的 `client_` 前缀已经让 useStickToBottom 无条件滚底。
 *
 * 断言在**剥掉注释的代码**上做：本仓的注释里正当地写着 `useComposerTrayOutbox`、
 * `<SendingMediaOverlay>`（在解释这条设计），直接扫原文会把准确的文档判成违规
 * （见 .claude/rules/frontend-test.md「不变量口径…且要在【剥掉注释的代码】上判」）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8');

/** 剥掉行注释 / 块注释 / JSX 注释（与 videoPosterPersistenceWiring.test.ts 同款实现） */
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

/** 抓出每个 `<FileMessageContent …/>` 标签内 `clientId={…}` 的表达式原文 */
function clientIdPropsOf(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/<FileMessageContent([^>]*)>/g)) {
    const hit = /clientId=\{([^}]*)\}/.exec(m[1]);
    found.push(hit ? hit[1].trim() : '<缺失>');
  }
  return found;
}

const OVERLAY_HOST = 'src/chat/shared/FileMessageContent.tsx';
const ACTIONS = 'src/chat/shared/sendingMediaActions.ts';
const INPUT_AREA = 'src/chat/shared/ChatInputArea.tsx';

/** 三个渲染点，以及各自应当递的 clientId 表达式 */
const RENDER_SITES: Array<[string, string]> = [
  ['src/chat/friend/MessageBubble.tsx', 'message.clientId'],
  ['src/chat/group/GroupMessageBubble.tsx', 'message.clientId'],
  ['src/chat/shared/AlbumMessage.tsx', 'item.clientId'],
];

describe('A. 三个渲染点都把 clientId 递给 FileMessageContent', () => {
  it.each(RENDER_SITES)('%s 递的是 %s', (rel, expected) => {
    const props = clientIdPropsOf(stripComments(read(rel)));
    // 先证明扫到了标签 —— 空集合会让下面的 toContain 假通过
    expect(props.length).toBeGreaterThan(0);
    expect(props).toContain(expected);
    expect(props).not.toContain('<缺失>');
  });

  it('相册那处递的是**每一格自己**的 clientId（不是整组一个）', () => {
    const code = stripComments(read('src/chat/shared/AlbumMessage.tsx'));
    // item 是 cells.map 的元素 ⇒ 每格一个键；写成 album.xxx 就成了整组共用一个
    expect(clientIdPropsOf(code)).toEqual(['item.clientId']);
    expect(code).toMatch(/clientId\?:\s*string;/);
  });
});

describe('B. 覆盖层的渲染点全仓只有 FileMessageContent 一处', () => {
  it('只有它画 <SendingMediaOverlay>', async () => {
    const modules = import.meta.glob('../../src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(modules)) {
      const rel = path.replace('../../', '');
      if (rel === OVERLAY_HOST) { continue; }
      if (/<SendingMediaOverlay\b/.test(stripComments(raw as string))) {
        offenders.push(rel);
      }
    }
    // 扫描面非空的正对照：glob 写错时这条会恒过
    expect(Object.keys(modules).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('它递给覆盖层的回调来自 sendingMediaActions（模块级函数，不是新起的 hook 实例）', () => {
    const code = stripComments(read(OVERLAY_HOST));
    expect(code).toMatch(
      /import \{[^}]*\bretrySendingItem\b[^}]*\bcancelSendingItem\b[^}]*\} from '\.\/sendingMediaActions'/,
    );
    // 块内有界：`[^>]` 不跨出这个 JSX 标签
    expect(code).toMatch(/<SendingMediaOverlay[^>]*onRetry=\{retrySendingItem\}[^>]*>/);
    expect(code).toMatch(/<SendingMediaOverlay[^>]*onCancel=\{cancelSendingItem\}[^>]*>/);
    // 🔴 接线契约「不要踩」第 1 条：不许给覆盖层传 percent
    expect(code).not.toMatch(/<SendingMediaOverlay[^>]*percent=/);
  });
});

describe('C. useComposerTrayOutbox 全仓只有输入区一个实例', () => {
  it('气泡 / 相册 / 覆盖层宿主都不许调它（多一个实例 = 多一个泵 = 并发上传）', async () => {
    const modules = import.meta.glob('../../src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const allowed = new Set(['src/chat/shared/useComposerTrayOutbox.ts', INPUT_AREA]);
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(modules)) {
      const rel = path.replace('../../', '');
      if (allowed.has(rel)) { continue; }
      if (/\buseComposerTrayOutbox\s*\(/.test(stripComments(raw as string))) {
        offenders.push(rel);
      }
    }
    expect(Object.keys(modules).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('正对照：输入区确实持有那唯一的一个实例（证明上面的 0 不是判据坏了）', () => {
    expect(stripComments(read(INPUT_AREA))).toMatch(/\buseComposerTrayOutbox\s*\(/);
  });

  it('sendingMediaActions 只碰 store，不 import 那个 hook', () => {
    const code = stripComments(read(ACTIONS));
    expect(code).toMatch(/useSendingMediaStore\.getState\(\)\.retry\(/);
    expect(code).toMatch(/useSendingMediaStore\.getState\(\)\.cancel\(/);
    expect(code).not.toMatch(/useComposerTrayOutbox/);
  });
});

describe('D. 气泡侧没有第二套滚底', () => {
  it.each([...RENDER_SITES.map(([rel]) => rel), OVERLAY_HOST, ACTIONS])(
    '%s 里没有 scrollIntoView / scrollTop 赋值',
    (rel) => {
      const code = stripComments(read(rel));
      expect(code).not.toMatch(/scrollIntoView\s*\(/);
      expect(code).not.toMatch(/scrollTop\s*=/);
    },
  );
});
