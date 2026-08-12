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
  it('输入区把 onFilesSelect 交给附件按钮（不交 ⇒ 附件按钮的多选恒关，相册永远进不去）', () => {
    expect(INPUT_AREA).toMatch(/<FileAttachButton[^>]*onFilesSelect=\{onFilesSelect\}/);
  });

  it('桌面聊天面板：既把 onFilesSelect 透传给输入区，也渲染合成面板', () => {
    expect(CHAT_PANEL).toMatch(/<ChatInputArea[^>]*onFilesSelect=\{onFilesSelect\}/);
    expect(CHAT_PANEL).toMatch(/import\s*\{[^}]*\bAlbumComposer\b[^}]*\}\s*from\s*'\.\/AlbumComposer'/);
    expect(CHAT_PANEL).toMatch(/<AlbumComposer[^>]*picked=\{albumPicked\}[^>]*onSend=\{onAlbumSend\}/);
  });

  it('移动端聊天页：同样两件都接上（两端对齐是硬指标，只改一端等于没做）', () => {
    expect(MOBILE_VIEW).toMatch(/<ChatInputArea[^>]*onFilesSelect=\{onFilesSelect\}/);
    expect(MOBILE_VIEW).toMatch(/import\s*\{[^}]*\bAlbumComposer\b[^}]*\}\s*from\s*'\.\.\/\.\.\/chat\/shared\/AlbumComposer'/);
    expect(MOBILE_VIEW).toMatch(/<AlbumComposer[^>]*picked=\{albumPicked\}[^>]*onSend=\{onAlbumSend\}/);
  });

  it.each([
    ['桌面 Main', () => DESKTOP_MAIN, /<ChatPanel[\s\S]*?\/>/],
    ['移动 MobileMain', () => MOBILE_MAIN, /<MobileChatView[\s\S]*?\/>/],
  ])('%s 把 useMainPage 的相册五件套全接上（缺一件面板就开不起来或发不出去）', (_name, src, elementRe) => {
    const element = src().match(elementRe)?.[0] ?? '';
    expect(element).not.toBe('');
    expect(element).toMatch(/onFilesSelect=\{page\.handleFilesSelect\}/);
    expect(element).toMatch(/albumPicked=\{page\.albumPicked\}/);
    expect(element).toMatch(/albumSending=\{page\.albumSending\}/);
    expect(element).toMatch(/onAlbumSend=\{page\.handleAlbumSend\}/);
    expect(element).toMatch(/onAlbumCancel=\{page\.handleAlbumCancel\}/);
  });
});

describe('相册发送侧：自己发的那一组必须落到本地库（否则只有自己这边散架）', () => {
  it('上传落库带三件套，而不是写死 null', () => {
    // 自己发的消息服务端不会再经 WS 推回来，上传后紧跟的 loadXxxMessages() 直接读本地库；
    // 这里写 null 的话，对端是正常一组、自己屏幕上是 N 张散图。
    expect(USE_MAIN_PAGE).toMatch(/media_group_id:\s*mediaGroup\?\.id\s*\?\?\s*null/);
    expect(USE_MAIN_PAGE).toMatch(/media_group_index:\s*mediaGroup\?\.index\s*\?\?\s*null/);
    expect(USE_MAIN_PAGE).toMatch(/media_group_count:\s*mediaGroup\?\.count\s*\?\?\s*null/);
    // 反向断言：正向断言会被「新旧两行并存」蒙混过去（旧的写死 null 在后就仍然生效）
    expect(USE_MAIN_PAGE).not.toMatch(/media_group_id:\s*null/);
    expect(USE_MAIN_PAGE).not.toMatch(/media_group_index:\s*null/);
    expect(USE_MAIN_PAGE).not.toMatch(/media_group_count:\s*null/);
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
    expect(USE_MAIN_PAGE).toMatch(/content:\s*caption\?\.trim\(\)\s*\|\|\s*file\.name/);
    // 单发从不传 caption ⇒ 该表达式退回 file.name，与从前逐字一致
    expect(USE_MAIN_PAGE).toMatch(/caption: plan\.caption,/);
  });

  it('面板里删到只剩 1 个时退回单发，且类型按文件本身判（写死 image 会把视频记成图片）', () => {
    expect(USE_MAIN_PAGE).toMatch(
      /single\.file\.type\.startsWith\('video\/'\)\s*\?\s*'video'\s*:\s*'image'/,
    );
    expect(USE_MAIN_PAGE).not.toMatch(/handleFileSelect\([^)]*,\s*'image',/);
  });
});
