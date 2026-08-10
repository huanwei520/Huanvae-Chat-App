/**
 * LocalMessage → UI Message 转换的**字段不丢**契约（私聊 + 群聊）
 *
 * 背景（真踩过，不是假想）：
 * 消息列表是 DB-first 的。相册三件套 / reply_to 这条链有三段，缺任何一段都表现为
 * 「实时收到时好好的，重启或切会话后静默消失」，且**不报任何错**：
 *   ① 后端下发        ② 本地 SQLite 落库        ③ LocalMessage → UI Message 转换
 * 前两段修好之后，第 ③ 段仍在丢：
 *   - 私聊 localMessageToMessage 连 reply_to 都没带（私聊引用从 DB 读出来不渲染引用块）
 *   - 群聊 localMessageToGroupMessage 带了 reply_to、但没带三件套
 *
 * 这类「少写一个字段」的缺陷，行为测试很难覆盖到（要拖起 db + hook + 渲染整条链），
 * 但它恰恰是最容易犯、后果最隐蔽的。故用静态扫描把**转换函数必须提到这些字段**钉死。
 *
 * 断言均在函数体内有界（[^}] 不跨出函数），并做过 node 变异验证：
 * 删掉任一字段行必须 PASS → FAIL。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
}

const FRIEND_HOOK = read('src/chat/friend/useLocalFriendMessages.ts');
const GROUP_HOOK = read('src/chat/group/useLocalGroupMessages.ts');

/** 取出某个转换函数的函数体（到第一个顶格 `}` 为止） */
function bodyOf(source: string, fnName: string): string {
  const start = source.indexOf(`function ${fnName}(`);
  expect(start, `找不到函数 ${fnName}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `${fnName} 没有闭合`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('私聊 localMessageToMessage — 字段不丢', () => {
  const body = bodyOf(FRIEND_HOOK, 'localMessageToMessage');

  it('带上 reply_to（否则私聊引用从 DB 读出来不渲染引用块）', () => {
    expect(body).toMatch(/reply_to:\s*local\.reply_to/);
  });

  it('带上相册三件套（否则相册从 DB 读出来散成 N 条独立图片）', () => {
    expect(body).toMatch(/media_group_id:\s*local\.media_group_id/);
    expect(body).toMatch(/media_group_index:\s*local\.media_group_index/);
    expect(body).toMatch(/media_group_count:\s*local\.media_group_count/);
  });
});

describe('群聊 localMessageToGroupMessage — 字段不丢', () => {
  const body = bodyOf(GROUP_HOOK, 'localMessageToGroupMessage');

  it('带上 reply_to', () => {
    expect(body).toMatch(/reply_to:\s*local\.reply_to/);
  });

  it('带上相册三件套', () => {
    expect(body).toMatch(/media_group_id:\s*local\.media_group_id/);
    expect(body).toMatch(/media_group_index:\s*local\.media_group_index/);
    expect(body).toMatch(/media_group_count:\s*local\.media_group_count/);
  });
});

describe('WS 实时推送 → 内存 Message：字段不丢（不经 DB 的那条路）', () => {
  // 这条路绕过 SQLite 直接进 UI state。它丢字段的表现是「对方回复/发相册时我这边
  // **当场**就渲染不出引用块与网格」—— 与 DB 那条路的「重启后消失」是两个独立缺陷。
  it('私聊：WS 构造的 Message 带 reply_to 与三件套', () => {
    const body = FRIEND_HOOK.slice(FRIEND_HOOK.indexOf('const newMessage: Message = {'));
    const obj = body.slice(0, body.indexOf('};'));
    expect(obj).toMatch(/reply_to:\s*wsMsg\.reply_to/);
    expect(obj).toMatch(/media_group_id:\s*wsMsg\.media_group_id/);
    expect(obj).toMatch(/media_group_count:\s*wsMsg\.media_group_count/);
  });

  it('群聊：WS 构造的 GroupMessage 带 reply_to 与三件套（原先写死 null）', () => {
    const body = GROUP_HOOK.slice(GROUP_HOOK.indexOf('const newMessage: GroupMessage = {'));
    const obj = body.slice(0, body.indexOf('};'));
    expect(obj).toMatch(/reply_to:\s*wsMsg\.reply_to/);
    expect(obj).not.toMatch(/reply_to:\s*null/);
    expect(obj).toMatch(/media_group_id:\s*wsMsg\.media_group_id/);
  });
});

describe('写入路径 — 服务端字段必须落库', () => {
  it('WS 实时推送落库时带 reply_to 与三件套（原先写死 null，重启后引用/相册消失）', () => {
    const ws = read('src/contexts/wsHandlers.ts');
    expect(ws).toMatch(/reply_to:\s*msg\.reply_to/);
    expect(ws).toMatch(/media_group_id:\s*msg\.media_group_id/);
  });

  it('历史加载落库时带 reply_to 与三件套（两个分支都要，群聊那条是 v1.1.25 就存在的既有缺陷）', () => {
    const hist = read('src/services/historyService.ts');
    // 两个分支（好友 / 群）各一处
    expect(hist.match(/reply_to:\s*msg\.reply_to/g) ?? []).toHaveLength(2);
    expect(hist.match(/media_group_id:\s*msg\.media_group_id/g) ?? []).toHaveLength(2);
  });

  it('增量同步落库时带三件套', () => {
    const sync = read('src/services/syncService.ts');
    expect(sync).toMatch(/media_group_id:\s*msg\.media_group_id/);
  });
});
