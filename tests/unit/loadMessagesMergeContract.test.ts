/**
 * useLocalFriendMessages / useLocalGroupMessages loadMessages 增量合并契约测试
 *
 * 防回归目标：
 *   loadMessages 不再 `setMessages(uiMessages)` 直接覆盖，而是用增量合并函数
 *   `setMessages((prev) => merge(prev, uiMessages))`：
 *     - prev=[] → 用 uiMessages（首次进入会话）
 *     - prev 含 uiMessages 全部 → 保持 prev（缓存优先，保留 loadMore 历史）
 *     - prev 有缺失 → prev + 新消息按 send_time 排序
 *
 * 历史 bug（2026-05-13）：
 *   - 原实现直接 `setMessages(uiMessages)` 覆盖
 *   - 用户翻历史触发 loadMore（messages 含 200+ 条）→ 切走再切回 → useMainPage
 *     的 useEffect 调 loadFriendMessages → db.getMessages(50) → 覆盖为 50 条
 *   - 缓存中保存的 200+ 条 + 滚动锚点 uuid 失效 → 切回回到最底部
 *
 * 测试形式：源码静态扫描
 * 原因：完整 render useLocalFriendMessages 需要 mock session/api/ws/db 全套，
 * 成本极高。结构性 grep 验证两个 hook 的 setMessages 调用形态足以防回退。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FRIEND_HOOK = resolve(__dirname, '../../src/chat/friend/useLocalFriendMessages.ts');
const GROUP_HOOK = resolve(__dirname, '../../src/chat/group/useLocalGroupMessages.ts');

const FRIEND_SRC = readFileSync(FRIEND_HOOK, 'utf-8');
const GROUP_SRC = readFileSync(GROUP_HOOK, 'utf-8');

describe('loadMessages 增量合并防回归', () => {
  it('useLocalFriendMessages 不直接 setMessages(uiMessages) 覆盖', () => {
    // 用宽松锚点找 loadMessages 函数体（容忍 prettier 缩进变化）
    const loadMessagesBlock = FRIEND_SRC.match(
      /const\s+loadMessages\s*=\s*useCallback[\s\S]*?\[friendId\]\);/,
    );
    expect(loadMessagesBlock).not.toBeNull();
    expect(loadMessagesBlock![0]).not.toMatch(/setMessages\(uiMessages\)\s*;/);
    expect(loadMessagesBlock![0]).toMatch(/setMessages\(\(prev\)\s*=>/);
  });

  it('useLocalFriendMessages 合并按 send_time 排序', () => {
    expect(FRIEND_SRC).toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>\s*new\s+Date\(a\.send_time\)\.getTime\(\)\s*-\s*new\s+Date\(b\.send_time\)\.getTime\(\)/);
  });

  it('useLocalFriendMessages 合并含"prev 全包含分支"', () => {
    // 防回退：避免合并退化为简单 concat 引入重复
    expect(FRIEND_SRC).toMatch(/newOnes\.length\s*===\s*0/);
  });

  it('useLocalFriendMessages 用 db 版本更新 prev 中已存在 uuid（同步撤回/删除状态）', () => {
    // 防回退：阻止"跳过已存在 uuid"退化为不同步状态。必须有 dbByUuid + prev.map(... dbByUuid.get)
    expect(FRIEND_SRC).toMatch(/dbByUuid\s*=\s*new\s+Map\(/);
    expect(FRIEND_SRC).toMatch(/dbByUuid\.get\(m\.message_uuid\)\s*\?\?\s*m/);
  });

  it('useLocalGroupMessages 不直接 setMessages(uiMessages) 覆盖', () => {
    const loadMessagesBlock = GROUP_SRC.match(
      /const\s+loadMessages\s*=\s*useCallback[\s\S]*?\[groupId\]\);/,
    );
    expect(loadMessagesBlock).not.toBeNull();
    expect(loadMessagesBlock![0]).not.toMatch(/setMessages\(uiMessages\)\s*;/);
    expect(loadMessagesBlock![0]).toMatch(/setMessages\(\(prev\)\s*=>/);
  });

  it('useLocalGroupMessages 合并按 send_time 排序', () => {
    expect(GROUP_SRC).toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>\s*new\s+Date\(a\.send_time\)\.getTime\(\)\s*-\s*new\s+Date\(b\.send_time\)\.getTime\(\)/);
  });

  it('useLocalGroupMessages 用 db 版本更新 prev 中已存在 uuid', () => {
    expect(GROUP_SRC).toMatch(/dbByUuid\s*=\s*new\s+Map\(/);
    expect(GROUP_SRC).toMatch(/dbByUuid\.get\(m\.message_uuid\)\s*\?\?\s*m/);
  });

  // ============================================
  // friendId / groupId 切换时从缓存读初值（核心修复）
  // ============================================
  //
  // 防回退目标：切换会话时不能 setMessages([]) 直接清空，必须从
  // cachedFriend/GroupMessages[id] 读取（含 loadMore 加载的全量历史）。
  //
  // 该重置已从 useEffect（paint 后）改为【渲染期同步】（prop 变更即调整 state 模式，
  // 用 prevFriendId/prevGroupId 触发），使按 key 重挂的 ChatMessages 首帧即正确内容、
  // 只滚一次（修 bug② "两次跳转" + bug③ "不滚到最新"）。
  //
  // 历史 bug（2026-05-13）：useState lazy initializer 仅在 hook 第一次 mount 时跑一次，
  // friendId 切换不重新跑；若切换分支直接清空 messages，缓存中的 200+ 条永远读不出。

  it('useLocalFriendMessages 切换 friendId 时从 cachedFriendMessages 读初值（不清空）', () => {
    // 匹配渲染期同步重置块（prevFriendId 触发，以 currentFriendId.current 赋值收尾）
    const block = FRIEND_SRC.match(
      /if\s*\(friendId\s*!==\s*prevFriendId\)[\s\S]*?currentFriendId\.current\s*=\s*friendId;/,
    );
    expect(block).not.toBeNull();
    // 必须从缓存读（friendId 三元 + cachedFriendMessages[friendId]），不能无脑 setMessages([]) 清空
    expect(block![0]).toMatch(/setMessages\(\s*friendId\s*\?[\s\S]*?cachedFriendMessages\[friendId\]/);
  });

  it('useLocalGroupMessages 切换 groupId 时从 cachedGroupMessages 读初值（不清空）', () => {
    const block = GROUP_SRC.match(
      /if\s*\(groupId\s*!==\s*prevGroupId\)[\s\S]*?currentGroupId\.current\s*=\s*groupId;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/setMessages\(\s*groupId\s*\?[\s\S]*?cachedGroupMessages\[groupId\]/);
  });
});
