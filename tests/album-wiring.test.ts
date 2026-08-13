/**
 * 相册接线的静态契约（两端 + 群聊/私聊四处都要接上）
 *
 * 为什么是静态扫描而不是渲染测试：
 * 消息列表（ChatMessages / GroupChatMessages）要拖起 store / useFileCache / 预签名 URL /
 * Tauri invoke 一整条链，渲染测试的 mock 成本远高于它能防住的回归；而这里真正要钉死的
 * 是**接线本身有没有做**——列表有没有走折叠、有没有把 album 交给气泡。
 * 折叠逻辑与相册渲染各自已有行为测试（mediaGroup / AlbumMessage），本文件只补"接上了没有"。
 *
 * 断言一律**块内有界**（用 [^}] 不跨出块），并对每条做过 node 变异验证：
 * 删掉目标 token 必须从 PASS 翻 FAIL —— 否则就是恒真的假测试。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

const FRIEND_LIST = read('src/chat/friend/ChatMessages.tsx');
const GROUP_LIST = read('src/chat/group/GroupChatMessages.tsx');
const FRIEND_BUBBLE = read('src/chat/friend/MessageBubble.tsx');
const GROUP_BUBBLE = read('src/chat/group/GroupMessageBubble.tsx');

// 发送侧接线（桌面 + 移动两条链各自独立，漏一条 = 那一端没有相册入口）
const INPUT_AREA = read('src/chat/shared/ChatInputArea.tsx');
const CHAT_PANEL = read('src/chat/shared/ChatPanel.tsx');
const MOBILE_VIEW = read('src/pages/mobile/MobileChatView.tsx');
const DESKTOP_MAIN = read('src/pages/Main.tsx');
const MOBILE_MAIN = read('src/pages/mobile/MobileMain.tsx');
const USE_MAIN_PAGE = read('src/hooks/useMainPage.ts');
/** 上传落库的**唯一**实现（M-5 起从 useMainPage 的私有函数收口到这里） */
const UPLOAD_PERSIST = read('src/chat/shared/uploadPersist.ts');

describe('相册折叠：两条消息列表都必须走 groupMessagesIntoAlbums', () => {
  it('私聊列表折叠后再渲染（而不是直接 map 原始消息）', () => {
    expect(FRIEND_LIST).toMatch(/import\s*\{[^}]*\bgroupMessagesIntoAlbums\b[^}]*\}\s*from\s*'\.\.\/shared\/mediaGroup'/);
    expect(FRIEND_LIST).toMatch(/groupMessagesIntoAlbums\(sortedMessages\)/);
    // 渲染循环遍历的是折叠后的节点
    expect(FRIEND_LIST).toMatch(/renderNodes\.map\(/);
  });

  it('群聊列表折叠后再渲染', () => {
    expect(GROUP_LIST).toMatch(/import\s*\{[^}]*\bgroupMessagesIntoAlbums\b[^}]*\}\s*from\s*'\.\.\/shared\/mediaGroup'/);
    expect(GROUP_LIST).toMatch(/groupMessagesIntoAlbums\(sortedMessages\)/);
    expect(GROUP_LIST).toMatch(/renderNodes\.map\(/);
  });

  it('两条列表都把 album 交给气泡（否则折叠了也渲染不出网格）', () => {
    expect(FRIEND_LIST).toMatch(/album=\{album\}/);
    expect(GROUP_LIST).toMatch(/album=\{album\}/);
  });

  it('相册节点用组 ID 作 React key（用代表消息的 uuid 会在组内成员到货时换 key → 整块重挂）', () => {
    expect(FRIEND_LIST).toMatch(/album-\$\{node\.groupId\}/);
    expect(GROUP_LIST).toMatch(/album-\$\{node\.groupId\}/);
  });
});

describe('相册渲染：两个气泡都必须接 AlbumMessage', () => {
  it('私聊气泡在 album 非空时渲染 AlbumMessage', () => {
    expect(FRIEND_BUBBLE).toMatch(/import\s*\{[^}]*\bAlbumMessage\b[^}]*\}\s*from\s*'\.\.\/shared\/AlbumMessage'/);
    expect(FRIEND_BUBBLE).toMatch(/<AlbumMessage\s+album=\{album\}/);
  });

  it('群聊气泡在 album 非空时渲染 AlbumMessage', () => {
    expect(GROUP_BUBBLE).toMatch(/import\s*\{[^}]*\bAlbumMessage\b[^}]*\}\s*from\s*'\.\.\/shared\/AlbumMessage'/);
    expect(GROUP_BUBBLE).toMatch(/<AlbumMessage\s+album=\{album\}/);
  });

  it('两个气泡的 urlType 各自正确（预签名 URL 归属类型，传错会取不到图）', () => {
    expect(FRIEND_BUBBLE).toMatch(/<AlbumMessage\s+album=\{album\}\s+urlType="friend"/);
    expect(GROUP_BUBBLE).toMatch(/<AlbumMessage\s+album=\{album\}\s+urlType="group"/);
  });
});

/**
 * 发送侧接线
 *
 * 这一段只钉「链有没有接上」——链上任一环断掉，用户侧的症状都是**同一个**：
 * 多选选不了 / 面板不出来，从现象无法反推是哪一环。而各环自身的行为另有测试：
 * 选择器决策 → tests/components/FileAttachButtonMultiSelect.test.tsx；
 * 面板交互   → tests/components/AlbumComposer.test.tsx；
 * 位次与配文 → tests/unit/albumSend.test.ts。本文件不重复它们。
 *
 * 断言一律块内有界（`[^;]` / `[^}]` 不跨出该 JSX 元素或该对象字面量），每条做过 node 变异验证。
 */
describe('相册发送侧：选择器 → 输入区 → 面板 → 编排，两端各自接上', () => {
  // ⚠️ M-5（预发送待发区）起：输入区不再把父级的 onFilesSelect 直接转给附件按钮，
  // 而是交给自己的 handleAttachPicked（选完先进待发区，回车才发）。
  // 「不交 ⇒ 附件按钮的多选恒关」这条因果没变，变的只是交给谁。
  it('输入区把选择结果交给自己的待发区入口（不交 ⇒ 附件按钮的多选恒关，附件永远进不去）', () => {
    expect(INPUT_AREA).toMatch(/<FileAttachButton[^>]*onFilesSelect=\{handleAttachPicked\}/);
  });

  /**
   * 🔴 口径变更（不是放宽）：桌面侧的旧相册合成面板**已删除**，断言随之翻成反向。
   *
   * 待发区（ComposerTray）上线后，桌面「多选 → 合成面板 → 串行上传」这条路已经无人可达：
   * ChatInputArea 不再读父级的 `onFilesSelect`（改走自己的 handleAttachPicked），
   * 于是 ChatPanel 里那块 `<AlbumComposer>` 永远拿不到 `albumPicked`，属死代码。
   * 按 .claude/CLAUDE.md「禁止保留兜底 / 死代码」删干净，这里改成钉「它不许回来」。
   *
   * 断言强度未降低：原来钉「必须有」，现在钉「必须没有」—— 同样是二值判据，
   * 且把「有人顺手把死路径恢复回去」也纳入了拦截面。
   */
  it('桌面聊天面板：旧相册合成面板已删干净（透传与渲染都不许再出现）', () => {
    expect(CHAT_PANEL).not.toMatch(/<ChatInputArea[^>]*onFilesSelect=/);
    expect(CHAT_PANEL).not.toMatch(/\bAlbumComposer\b/);
  });

  /**
   * 🔴 口径变更（不是放宽）：移动端那半边**也已删除**，断言随之翻成反向 ——
   * 至此两端重新对齐（此前"只删了桌面一半"是上一轮文件边界的结果）。
   *
   * 成因与桌面那条逐字相同：ChatInputArea 不再读父级的 `onFilesSelect`（改走自己的
   * handleAttachPicked），于是 MobileChatView 里那块 `<AlbumComposer>` 永远拿不到
   * `albumPicked`，属死代码。本轮把 ChatInputArea 那 6 个死 props 声明删干净之后，
   * `onFilesSelect` 连**传都传不进去**了（传未知 props = typecheck FAIL），
   * 于是这条链的最后一段也必须落地。**运行时行为零变化**：删掉的是本来就到不了的路径，
   * 移动端的多选/相册现在走待发区（ComposerTray + useComposerTrayOutbox），与桌面同一条。
   *
   * 断言强度未降低：原来 3 条钉「必须有」，现在 3 条钉「必须没有」，一一对应、同为二值判据，
   * 且把「有人顺手把死路径恢复回去」也纳入了拦截面。
   */
  it('移动端聊天页：旧相册合成面板已删干净（透传与渲染都不许再出现）', () => {
    expect(MOBILE_VIEW).not.toMatch(/<ChatInputArea[^>]*onFilesSelect=/);
    expect(MOBILE_VIEW).not.toMatch(/\bAlbumComposer\b/);
  });

  it('移动 MobileMain 不再向 MobileChatView 传相册五件套（旧路径删干净的另一半）', () => {
    const element = MOBILE_MAIN.match(/<MobileChatView[\s\S]*?\/>/)?.[0] ?? '';
    expect(element).not.toBe('');
    expect(element).not.toMatch(/onFilesSelect=/);
    expect(element).not.toMatch(/albumPicked=/);
    expect(element).not.toMatch(/albumSending=/);
    expect(element).not.toMatch(/onAlbumSend=/);
    expect(element).not.toMatch(/onAlbumCancel=/);
  });

  /** 桌面 Main 那一半随桌面面板一并删除，断言翻成反向（同上，强度未降低）。 */
  it('桌面 Main 不再向 ChatPanel 传相册五件套（旧路径删干净的另一半）', () => {
    const element = DESKTOP_MAIN.match(/<ChatPanel[\s\S]*?\/>/)?.[0] ?? '';
    expect(element).not.toBe('');
    expect(element).not.toMatch(/onFilesSelect=/);
    expect(element).not.toMatch(/albumPicked=/);
    expect(element).not.toMatch(/albumSending=/);
    expect(element).not.toMatch(/onAlbumSend=/);
    expect(element).not.toMatch(/onAlbumCancel=/);
  });
});

describe('相册发送侧：自己发的那一组必须落到本地库（否则只有自己这边散架）', () => {
  // ⚠️ M-5 起落库实现已从 useMainPage 的私有 processUploadSuccess 收口到
  // chat/shared/uploadPersist.ts（待发区新路径与这条旧路径共用同一份；两份并存必然漂移）。
  // 不变量没变，只是换了文件，故这两条断言改扫 UPLOAD_PERSIST。
  it('上传落库带三件套，而不是写死 null', () => {
    // 自己发的消息服务端不会再经 WS 推回来，上传后紧跟的 loadXxxMessages() 直接读本地库；
    // 这里写 null 的话，对端是正常一组、自己屏幕上是 N 张散图。
    expect(UPLOAD_PERSIST).toMatch(/media_group_id:\s*mediaGroup\?\.id\s*\?\?\s*null/);
    expect(UPLOAD_PERSIST).toMatch(/media_group_index:\s*mediaGroup\?\.index\s*\?\?\s*null/);
    expect(UPLOAD_PERSIST).toMatch(/media_group_count:\s*mediaGroup\?\.count\s*\?\?\s*null/);
    // 反向断言：正向断言会被「新旧两行并存」蒙混过去（旧的写死 null 在后就仍然生效）
    expect(UPLOAD_PERSIST).not.toMatch(/media_group_id:\s*null/);
    expect(UPLOAD_PERSIST).not.toMatch(/media_group_index:\s*null/);
    expect(UPLOAD_PERSIST).not.toMatch(/media_group_count:\s*null/);
    // 旧位置不许再留第二份实现
    expect(USE_MAIN_PAGE).not.toMatch(/async function processUploadSuccess/);
  });

  it('串行上传的每一项，喂给「上传请求」与「落库」的是同一个 meta（两处各写一份必然漂移）', () => {
    expect(USE_MAIN_PAGE).toMatch(
      /const meta: MediaGroupMeta = \{ id: plan\.groupId, index: plan\.index, count: plan\.count \}/,
    );
    expect(USE_MAIN_PAGE).toMatch(/uploadFriendFile\(plan\.file\.file, relatedId, meta, plan\.caption\)/);
    expect(USE_MAIN_PAGE).toMatch(/uploadGroupFile\(plan\.file\.file, relatedId, meta, plan\.caption\)/);
    expect(USE_MAIN_PAGE).toMatch(/mediaGroup: meta,/);
  });

  it('组首项的配文取代文件名成为本地正文（契约：index=0 那条的 message_content 即整组配文）', () => {
    // ⚠️ 口径已修正：原来写的是 `caption?.trim() || file.name` —— **少了后端派生正文的
    // `[图片]/[视频]/[文件] ` 前缀**（Rust 侧 upload.rs 的 resolve_content 才是真值），
    // 于是同一条消息「自己看到的正文」与「对方看到的正文」形状不同。
    // 现在两边都走 resolveUploadedContent，本条断言随之改扫它。
    expect(UPLOAD_PERSIST).toMatch(/content:\s*resolveUploadedContent\(caption,\s*messageType,\s*file\.name\)/);
    expect(UPLOAD_PERSIST).not.toMatch(/content:\s*caption\?\.trim\(\)\s*\|\|\s*file\.name/);
    // 相册路径把组首项的 caption 交下去（非首项恒 undefined，由 planAlbumUpload 保证）
    expect(USE_MAIN_PAGE).toMatch(/caption: plan\.caption,/);
  });

  it('面板里删到只剩 1 个时退回单发，且类型按文件本身判（写死 image 会把视频记成图片）', () => {
    expect(USE_MAIN_PAGE).toMatch(
      /single\.file\.type\.startsWith\('video\/'\)\s*\?\s*'video'\s*:\s*'image'/,
    );
    expect(USE_MAIN_PAGE).not.toMatch(/handleFileSelect\([^)]*,\s*'image',/);
  });
});
