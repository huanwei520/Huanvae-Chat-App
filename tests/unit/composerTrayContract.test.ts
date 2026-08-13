/**
 * 契约传值 + 判据复用 的静态守卫（M-5 预发送待发区）
 *
 * 为什么必须是静态扫描：本仓明确记载过「**有类型、没传值，TS 也不报错**」——
 * `sendMessage` 是**逐键构造 body** 的，类型里加了字段而 body 字面量里不加，
 * 字段会被静默丢掉，typecheck / vitest 全绿（.claude/CLAUDE.md「第 ③ 处不止一个文件」）。
 * 所以这里直接扫源码，断言键**真的出现在 `api.post(...)` 的 body 字面量里**。
 *
 * ## 后端契约（核过原文，不是猜的）
 * - `caption` **只有 storage 上传链路一条通道**：`upload/request` + `upload/confirm` 各带一次
 *   （秒传分支在 request 建消息、非秒传在 confirm 建消息，两处都带才两条分支都生效）。
 *   **两个消息端点都没有 caption 字段** —— backend-docs/messages/好友消息.md
 *   「创建入口（两条）」第 1 条：「`caption` 只有这一条通道（两个消息端点都没有 caption 字段）」。
 *   ⇒ 本文件同时有**反向**断言：谁把 caption 加进 `/api/messages` 的 body 就翻红。
 * - 媒体组三件套两个消息端点都收（私聊侧已补齐），且**同生同灭**。
 *
 * ## 断言写法（.claude/rules/frontend-test.md「块内有界」）
 * 一律用 `[^}]*` 把匹配限制在 body 字面量的花括号内，绝不用 `[\s\S]*?` 跨段惰性匹配 ——
 * 后者会 latch 到文件里任意一个下游同名 token，删掉目标行仍 PASS（恒真的假测试）。
 * 计数 / 反向断言都在**剥掉注释**的代码上做，否则注释里正当写出的 `caption`
 * 会把「消息端点不许带 caption」这条判成违规，逼着后来的人删掉正确的文档。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

/**
 * 剥掉注释（行注释 + 块注释），字符串内部的 `//` 不算注释起点。
 *
 * 朴素的 `//.*$` 会把模板串里的 `http://...` 当注释起点，把后面的内容一起吃掉 → 假 FAIL。
 */
function stripComments(source: string): string {
  let out = '';
  let inBlock = false;
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; continue; }
      if (c === quote) { quote = null; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { i++; }
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

const USE_FILE_UPLOAD = stripComments(read('src/hooks/useFileUpload.ts'));
const MESSAGES_API = stripComments(read('src/api/messages.ts'));
const GROUP_MESSAGES_API = stripComments(read('src/api/groupMessages.ts'));
const OUTBOX = stripComments(read('src/chat/shared/useComposerTrayOutbox.ts'));
const MERGE = stripComments(read('src/chat/shared/useSendingOutboxMerge.ts'));
const INPUT_AREA = stripComments(read('src/chat/shared/ChatInputArea.tsx'));

/** 抓出某个 `api.post('<路径>', { ... })` 的 body 字面量（块内有界，不跨出花括号） */
function bodyOf(source: string, endpoint: string): string {
  const re = new RegExp(`${endpoint.replace(/\//g, '\\/')}'\\s*,\\s*\\{([^}]*)\\}`);
  const m = source.match(re);
  return m ? m[1] : '';
}

describe('caption 只走 storage 上传链路，且两处都要带', () => {
  it('upload/request 的 body 字面量里真的有 caption', () => {
    expect(bodyOf(USE_FILE_UPLOAD, '/api/storage/upload/request')).toMatch(/caption:\s*caption\s*\?\?\s*null/);
  });

  it('upload/confirm 的 body 字面量里也真的有 caption（非秒传分支的消息在这一步才建）', () => {
    expect(bodyOf(USE_FILE_UPLOAD, '/api/storage/upload/confirm')).toMatch(/caption:\s*caption\s*\?\?\s*null/);
  });

  it('两处 body 都带齐媒体组三件套（三者同生同灭，缺一后端 400）', () => {
    for (const endpoint of ['/api/storage/upload/request', '/api/storage/upload/confirm']) {
      const body = bodyOf(USE_FILE_UPLOAD, endpoint);
      expect(body).toMatch(/media_group_id:\s*mediaGroup\?\.id\s*\?\?\s*null/);
      expect(body).toMatch(/media_group_index:\s*mediaGroup\?\.index\s*\?\?\s*null/);
      expect(body).toMatch(/media_group_count:\s*mediaGroup\?\.count\s*\?\?\s*null/);
    }
  });

  it('🔴 反向：/api/messages 的 body 里**不许**出现 caption（后端该端点无此字段，加了会 400 或被忽略）', () => {
    expect(bodyOf(MESSAGES_API, '/api/messages')).not.toMatch(/\bcaption\b/);
  });

  it('🔴 反向：群消息端点同样不许带 caption', () => {
    expect(GROUP_MESSAGES_API).not.toMatch(/caption/);
  });
});

describe('媒体组三件套真的进了消息端点的 body（"有类型没传值"是本仓踩过的坑）', () => {
  it('sendMessage 逐键构造的 body 里三件套齐全', () => {
    const body = bodyOf(MESSAGES_API, '/api/messages');
    expect(body).toMatch(/media_group_id:\s*request\.media_group_id\s*\?\?\s*null/);
    expect(body).toMatch(/media_group_index:\s*request\.media_group_index\s*\?\?\s*null/);
    expect(body).toMatch(/media_group_count:\s*request\.media_group_count\s*\?\?\s*null/);
  });

  it('sendGroupMessage 整体透传 data（不逐键重建 ⇒ 不会静默丢字段），且类型里有三件套', () => {
    expect(GROUP_MESSAGES_API).toMatch(/api\.post<SendGroupMessageResponse>\('\/api\/group_messages',\s*data\b/);
    expect(GROUP_MESSAGES_API).toMatch(/media_group_id\?:\s*string;/);
    expect(GROUP_MESSAGES_API).toMatch(/media_group_index\?:\s*number;/);
    expect(GROUP_MESSAGES_API).toMatch(/media_group_count\?:\s*number;/);
  });
});

describe('🔴「单条不包相册」在上传参数这一段的机器口径', () => {
  it('mediaGroupOf 对非 album 形态返回 undefined（不产出三件套）', () => {
    // 块内有界：`[^}]*` 不跨出这个 if 块
    expect(OUTBOX).toMatch(/if\s*\(shape\.kind\s*!==\s*'album'[^}]*\)\s*\{[^}]*return undefined;[^}]*\}/);
  });

  it('🔴 单媒体 + 文字这一格真的发得出去：caption 与 mediaGroup 一起进上传调用', () => {
    // 单条形态下 mediaGroup 恒 undefined、caption 仍照传 —— 后端「不成组的单条可带 caption」那条
    // （好友消息.md:754）就是靠这一行落地的。少了 entry.caption 这一格就永远只能显示文件名。
    expect(OUTBOX).toMatch(/upFriend\(entry\.file,\s*entry\.targetId,\s*mediaGroup,\s*entry\.caption/);
    expect(OUTBOX).toMatch(/upGroup\(entry\.file,\s*entry\.targetId,\s*mediaGroup,\s*entry\.caption/);
  });
});

describe('🔴 本地正文与后端 resolve_content 同口径（含 [标签] 前缀）', () => {
  const PERSIST = stripComments(read('src/chat/shared/uploadPersist.ts'));
  const FRIEND_HOOK = stripComments(read('src/chat/friend/useLocalFriendMessages.ts'));
  const GROUP_HOOK = stripComments(read('src/chat/group/useLocalGroupMessages.ts'));

  it('派生正文的三个标签与后端 upload.rs:465-469 逐字一致', () => {
    expect(PERSIST).toMatch(/image:\s*'\[图片\]'/);
    expect(PERSIST).toMatch(/video:\s*'\[视频\]'/);
    expect(PERSIST).toMatch(/file:\s*'\[文件\]'/);
  });

  it('落库正文走 resolveUploadedContent，不再是裸 file.name', () => {
    expect(PERSIST).toMatch(/content:\s*resolveUploadedContent\(caption,\s*messageType,\s*file\.name\)/);
    // 反向：裸 `caption?.trim() || file.name` 就是被修掉的那个写法，不许回潮
    expect(PERSIST).not.toMatch(/content:\s*caption\?\.trim\(\)\s*\|\|\s*file\.name/);
  });

  it('乐观插入的正文用同一个解析器（否则确认落库那一刻正文形状会突变）', () => {
    for (const hook of [FRIEND_HOOK, GROUP_HOOK]) {
      expect(hook).toMatch(/message_content:\s*resolveUploadedContent\(entry\.caption,\s*entry\.preview\.kind,\s*entry\.preview\.name\)/);
    }
  });

  it('useMainPage 不再自带第二份落库实现（两份并存必然漂移）', () => {
    const MAIN = stripComments(read('src/hooks/useMainPage.ts'));
    expect(MAIN).toMatch(/import\s*\{\s*persistUploadedMessage\s*\}\s*from\s*'\.\.\/chat\/shared\/uploadPersist'/);
    expect(MAIN).not.toMatch(/async function processUploadSuccess/);
  });
});

describe('🔴 待发区预览不裁切（与 M-1「每张完整可见」同一条需求的发送侧）', () => {
  const CSS = read('src/styles/components/album-composer.css');

  it('两处缩略图都用 object-fit: contain，全文件不出现 cover', () => {
    // 用户在"决定发不发"那一刻看到的必须是完整那张，不是裁过的
    expect(CSS).toMatch(/\.album-composer-thumb img \{[^}]*object-fit:\s*contain;[^}]*\}/);
    expect(CSS).toMatch(/\.composer-tray-thumb img \{[^}]*object-fit:\s*contain;[^}]*\}/);
    expect(CSS).not.toMatch(/object-fit:\s*cover/);
  });
});

describe('🔴 滚底复用既有唯一判据 useStickToBottom，不新写一套', () => {
  it('乐观条目的 clientId 由 newLocalSendClientId 产生（前缀 client_ 是"本机发送"的唯一物证）', () => {
    expect(OUTBOX).toMatch(/import\s*\{[^}]*\bnewLocalSendClientId\b[^}]*\}\s*from\s*'\.\/useStickToBottom'/);
    expect(OUTBOX).toMatch(/clientId:\s*newLocalSendClientId\(\)/);
  });

  it('本单新增/改动的这三个文件里没有任何自写的滚动判据', () => {
    for (const src of [OUTBOX, MERGE, INPUT_AREA]) {
      expect(src).not.toMatch(/scrollIntoView/);
      expect(src).not.toMatch(/scrollTop\s*=/);
    }
  });
});

describe('待发区接管了三条入口（粘贴 / 拖入 / 附件按钮），不再有绕过它的直发路径', () => {
  it('粘贴、拖入、附件选择都调 addToTray', () => {
    // 块内有界：`(?:(?!\}, \[)[\s\S])*?` 不跨过该 useCallback 的收尾 `}, [deps]`，
    // 所以把某个 handler 里的 addToTray 删掉时，它不会 latch 到下一个 handler 的那一处。
    // （`[^}]*` 在这里不够用 —— 这些 handler 体内本来就有 `{ return; }` 之类的花括号。）
    expect(INPUT_AREA).toMatch(/const handleDrop = useCallback\((?:(?!\}, \[)[\s\S])*?addToTray\(/);
    expect(INPUT_AREA).toMatch(/const handleAttachPicked = useCallback\((?:(?!\}, \[)[\s\S])*?addToTray\(/);
    expect(INPUT_AREA).toMatch(/const handlePaste = useCallback\(async(?:(?!\}, \[)[\s\S])*?addToTray\(/);
  });

  it('ChatInputArea 不再调用被待发区取代的 onFileSelect / onFilesSelect', () => {
    expect(INPUT_AREA).not.toMatch(/\bonFileSelect\(/);
    expect(INPUT_AREA).not.toMatch(/\bonFilesSelect\(/);
  });

  it('回车与发送按钮都走 handleSend（附件 + 文字一起）', () => {
    // Enter 分支体内有 `if (composing) { return; }`，故同样用「不跨出本 useCallback 收尾」的界
    expect(INPUT_AREA).toMatch(/if \(e\.key === 'Enter' && !e\.shiftKey\) \{(?:(?!\}, \[)[\s\S])*?handleSend\(\);/);
    expect(INPUT_AREA).toMatch(/onClick=\{\(\) => \{[^}]*handleSend\(\);[^}]*\}\}/);
  });
});
