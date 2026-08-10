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
