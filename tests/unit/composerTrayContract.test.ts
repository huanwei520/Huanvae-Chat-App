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

/**
 * 取两个标记之间的源码片段（用于「某个函数体内有没有 X」这类块内有界断言）。
 *
 * 用字符串定位而不是正则：这些 useCallback 的收尾形状各不相同
 * （`}, [dep],` / `},\n    [dep],`），一条正则套两处必然有一处静默匹空 ——
 * 而匹空的后果是**断言恒真**。所以每个调用点都必须先断言切片非空。
 */
function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const s = source.indexOf(startMarker);
  if (s < 0) { return ''; }
  const e = source.indexOf(endMarker, s + startMarker.length);
  if (e < 0) { return ''; }
  return source.slice(s, e);
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

describe('🔴 引用回复（reply_to）真的进了两个上传端点的 body 字面量', () => {
  // 修的缺陷：「用媒体（图片±文字）回复别人」时 reply_to 结构上从未离开客户端 ——
  // 媒体消息本身发出去了、后端也没理由报错（它压根没收到这个字段），
  // 于是用户看到的是「我在回复，回复发不出去」。
  //
  // 🔴 判据必须钉在 **body 字面量** 这一层，不是 interface：
  // 本仓踩过「改了类型 ≠ 传了字段」——`UploadRequestParams` 里加上 replyTo 而
  // `api.post` 的 body 不加，字段会被静默丢掉，typecheck / vitest 全绿。
  it('upload/request 的 body 字面量里真的有 reply_to（秒传分支的消息在这一步建）', () => {
    expect(bodyOf(USE_FILE_UPLOAD, '/api/storage/upload/request')).toMatch(/reply_to:\s*replyTo\s*\?\?\s*null/);
  });

  it('upload/confirm 的 body 字面量里也真的有 reply_to（非秒传分支的消息在这一步才建）', () => {
    // 两处同生同灭。只改一处 ⇒「小文件（秒传）能带引用、大文件不能带」这种半好半坏最难查。
    expect(bodyOf(USE_FILE_UPLOAD, '/api/storage/upload/confirm')).toMatch(/reply_to:\s*replyTo\s*\?\?\s*null/);
  });

  it('🔴 反向：群上传路径**结构上**递不进 replyTo（后端群分支硬编码丢弃）', () => {
    // 后端 storage/handlers/upload.rs 群分支写死 `reply_to: None`，backend-docs 参数表也明写
    // 「仅好友会话生效」⇒ 留一条「递得进去但不生效」的通路 = 造一个静默失效的假象。
    const friendFn = sliceBetween(USE_FILE_UPLOAD, 'const uploadFriendFile', 'const uploadGroupFile');
    const groupFn = sliceBetween(USE_FILE_UPLOAD, 'const uploadGroupFile', 'const resetUpload');
    // 先证明切片真切到了东西 —— 空字符串会让下面两条断言恒真
    expect(friendFn.length).toBeGreaterThan(100);
    expect(groupFn.length).toBeGreaterThan(100);

    expect(friendFn).toMatch(/replyTo:\s*opts\?\.replyTo/);
    expect(groupFn).not.toMatch(/replyTo/);
  });

  it('本地落库也写 reply_to（不写 ⇒ 对端看得到引用块、自己看不到）', () => {
    const PERSIST_SRC = stripComments(read('src/chat/shared/uploadPersist.ts'));
    expect(PERSIST_SRC).toMatch(/reply_to:\s*replyTo\s*\?\?\s*null/);
    // 反向：被修掉的那个硬编码不许回潮（`reply_to: replyTo ?? null` 不会命中这条）
    expect(PERSIST_SRC).not.toMatch(/reply_to:\s*null\b/);
  });
});

describe('🔴「用媒体回复」在输入区这一段：传值与清草稿必须同批', () => {
  const HAND_SEND = sliceBetween(INPUT_AREA, 'const handleSend = useCallback', 'const adjustTextareaHeight');

  it('切片非空（切空了下面两条会恒真）', () => {
    expect(HAND_SEND.length).toBeGreaterThan(100);
  });

  it('tray 分支把「正在回复」的 messageUuid 交给 outbox.send（此前只传两个实参）', () => {
    // 这条 tray 分支 return 掉了，永远走不到下面的 onSendMessage() ——
    // 而后者是纯文本路径里唯一读 replyDraft 的入口。所以不在这里传，reply_to 就永远发不出去。
    expect(HAND_SEND).toMatch(/outbox\.send\(trayItems,\s*messageInput,\s*activeReplyDraft\?\.messageUuid\)/);
  });

  it('🔴 同批：enqueued > 0 的那个块里清掉草稿（块内有界，别 latch 到 JSX 里的 onCancel）', () => {
    // 只传值不清草稿 ⇒ 用户下一条纯文本会意外带上上一次的引用（useMainPage 只按
    // conversationKey 匹配草稿、不管新旧）——把一个看得见的缺陷换成一个更隐蔽的。
    expect(HAND_SEND).toMatch(/if \(outcome\.enqueued > 0\) \{[^}]*setReplyDraft\(null\);[^}]*\}/);
  });
});

describe('🔴 在途（乐观）气泡也要带引用块，否则落库那一刻它会突然冒出来', () => {
  // 与同一个对象字面量里 message_content 那条注释完全同源：形状在「确认落库」那一刻突变 =
  // 肉眼可见地闪一下。7-A 的定位只数到 4 段，这是第 6 段（本单实现时现查发现）。
  const FRIEND_HOOK = stripComments(read('src/chat/friend/useLocalFriendMessages.ts'));
  const GROUP_HOOK = stripComments(read('src/chat/group/useLocalGroupMessages.ts'));

  function outboxMapper(source: string): string {
    return sliceBetween(source, 'const outboxToMessage = useCallback', 'const messagesWithSending');
  }

  it('切片非空（切空了下面两条会恒真）', () => {
    expect(outboxMapper(FRIEND_HOOK).length).toBeGreaterThan(100);
    expect(outboxMapper(GROUP_HOOK).length).toBeGreaterThan(100);
  });

  it('好友侧乐观条目带 entry.replyTo（不带 ⇒ 引用块在落库那一帧才出现）', () => {
    expect(outboxMapper(FRIEND_HOOK)).toMatch(/reply_to:\s*entry\.replyTo\s*\?\?\s*null/);
  });

  it('🔴 群侧刻意保持 null（后端群分支丢弃 ⇒ 带了会显示一个落库后就消失的引用块）', () => {
    expect(outboxMapper(GROUP_HOOK)).toMatch(/reply_to:\s*null\b/);
    expect(outboxMapper(GROUP_HOOK)).not.toMatch(/reply_to:\s*entry\.replyTo/);
  });
});

describe('🔴 引用回复的位次判定与 caption 复用同一个 isFirstOfBatch（不许造第二套）', () => {
  const PLAN = stripComments(read('src/chat/shared/composerTrayPlan.ts'));

  it('全文只有一处「第一个形态的第一项」判定', () => {
    const hits = PLAN.match(/shapeIndex === 0 && indexInShape === 0/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it('replyTo 由那个 isFirstOfBatch 变量派生，不是另写一遍条件', () => {
    expect(PLAN).toMatch(/const thisReplyTo = isFirstOfBatch \? replyTo : undefined;/);
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
