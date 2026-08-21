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
 * 🔴 2026-08-21 重写（外部审计 idx=88）：
 *   合并逻辑已抽成 `src/chat/shared/mergeMessageList.ts` 的**一份**纯函数，
 *   因为「同一段合并在每个 hook 里出现两次」正是这条缺陷能只被修一半的原因：
 *   2026-05-13 只修了 `loadMessages`，`syncMessagesInBackground` 原样留着整段覆盖
 *   ⇒ 用户翻了 300 条历史、WS 抖一下重连触发同步，列表照样塌回 50 条。
 *
 *   于是本文件也从「扫源码里有没有那几行」改成两层：
 *     ① **行为测试**（真调 `mergeMessageList`，断言合并结果）—— 逻辑正确性归它；
 *     ② **接线扫描**（四个调用点都必须调那一份共享实现、且不得再出现整段覆盖形态）
 *        —— 完整 render 两个 hook 要 mock session/api/ws/db 全套，成本过高，
 *        接线这一层继续用静态扫描。
 */

import { describe, it, expect } from 'vitest';
import { mergeMessageList } from '../../src/chat/shared/mergeMessageList';
import type { MergeableMessage } from '../../src/chat/shared/mergeMessageList';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FRIEND_HOOK = resolve(__dirname, '../../src/chat/friend/useLocalFriendMessages.ts');
const GROUP_HOOK = resolve(__dirname, '../../src/chat/group/useLocalGroupMessages.ts');

const FRIEND_SRC = readFileSync(FRIEND_HOOK, 'utf-8');
const GROUP_SRC = readFileSync(GROUP_HOOK, 'utf-8');

describe('① mergeMessageList 行为（真调纯函数，不是扫源码）', () => {
  const m = (uuid: string, time: string, extra: Record<string, unknown> = {}): MergeableMessage => ({
    message_uuid: uuid,
    send_time: time,
    ...extra,
  });

  it('prev 为空 ⇒ 直接用 db 结果（首次进会话）', () => {
    const db = [m('b', '2026-01-02T00:00:00Z'), m('a', '2026-01-01T00:00:00Z')];
    expect(mergeMessageList([], db)).toEqual(db);
  });

  it('🔴 prev 里 db 窗口之外的更老消息必须保住（这条就是 idx=88 的核心）', () => {
    // prev = 用户 loadMore 翻回来的 3 条；db 窗口只回最新 1 条
    const prev = [
      m('c', '2026-01-03T00:00:00Z'),
      m('b', '2026-01-02T00:00:00Z'),
      m('a', '2026-01-01T00:00:00Z'),
    ];
    const db = [m('c', '2026-01-03T00:00:00Z')];
    const out = mergeMessageList(prev, db);
    expect(out.map((x) => x.message_uuid)).toEqual(['c', 'b', 'a']);
  });

  it('prev 里已存在的 uuid 用 db 版本替换（同步 is_recalled 等 SSOT 字段）', () => {
    const prev = [m('a', '2026-01-01T00:00:00Z', { is_recalled: false, message_content: 'hi' })];
    const db = [m('a', '2026-01-01T00:00:00Z', { is_recalled: true, message_content: '[消息已撤回]' })];
    const [out] = mergeMessageList(prev, db) as unknown as Array<Record<string, unknown>>;
    expect(out.is_recalled).toBe(true);
    expect(out.message_content).toBe('[消息已撤回]');
  });

  it('替换时保留 prev 的 clientId / sendStatus（db 版不带，丢了会让 React key 突变）', () => {
    const prev = [m('a', '2026-01-01T00:00:00Z', { clientId: 'client_1', sendStatus: 'sending' })];
    const db = [m('a', '2026-01-01T00:00:00Z')];
    const [out] = mergeMessageList(prev, db);
    expect(out.clientId).toBe('client_1');
    expect(out.sendStatus).toBe('sending');
  });

  it('db 新增的消息追加后按 send_time 降序 [新→旧]（升序会让 loadMore 取错页）', () => {
    const prev = [m('a', '2026-01-01T00:00:00Z')];
    const db = [m('c', '2026-01-03T00:00:00Z'), m('b', '2026-01-02T00:00:00Z')];
    expect(mergeMessageList(prev, db).map((x) => x.message_uuid)).toEqual(['c', 'b', 'a']);
  });

  it('没有新增时不重排、不产生重复（prev 全包含分支）', () => {
    const prev = [m('b', '2026-01-02T00:00:00Z'), m('a', '2026-01-01T00:00:00Z')];
    const db = [m('a', '2026-01-01T00:00:00Z')];
    const out = mergeMessageList(prev, db);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.message_uuid)).toEqual(['b', 'a']);
  });

  it('在途（sending）消息不在 db 里 ⇒ 原样保留，不被同步吞掉', () => {
    const prev = [
      m('client_9', '2026-01-04T00:00:00Z', { clientId: 'client_9', sendStatus: 'sending' }),
      m('a', '2026-01-01T00:00:00Z'),
    ];
    const db = [m('a', '2026-01-01T00:00:00Z')];
    const out = mergeMessageList(prev, db);
    expect(out.map((x) => x.message_uuid)).toContain('client_9');
  });
});

describe('② 四个调用点都接到那一份共享合并（接线扫描）', () => {
  for (const [label, SRC] of [['friend', FRIEND_SRC], ['group', GROUP_SRC]] as const) {
    it(`${label} hook：import 了 mergeMessageList，且 loadMessages / syncMessagesInBackground 两处都用它`, () => {
      expect(SRC).toMatch(/import \{ mergeMessageList \} from '\.\.\/shared\/mergeMessageList';/);
      // 两处调用点：loadMessages 一处、syncMessagesInBackground 一处
      const calls = SRC.match(/setMessages\(\(prev\) => mergeMessageList\(prev, uiMessages\)\)/g) ?? [];
      expect(calls).toHaveLength(2);
    });

    it(`${label} hook：syncMessagesInBackground 内不得再出现「整段覆盖」形态`, () => {
      // ⚠️ 断言必须**限定在这个函数块内**：locateMessage 里的 `setMessages(uiMessages)`
      // 是定位窗口的整段替换，那是刻意的语义，不是这条缺陷。
      const block = SRC.match(
        /const syncMessagesInBackground = useCallback[\s\S]*?setSyncing\(false\);/,
      );
      expect(block).not.toBeNull();
      expect(block![0]).not.toMatch(/setMessages\(uiMessages\)\s*;/);
      expect(block![0]).not.toMatch(/return mergedMessages;/);
      expect(block![0]).not.toMatch(/uiMessages\.map\(\(newMsg\)/);
    });

    it(`${label} hook：syncMessagesInBackground 也有窗口态护栏（否则窗口被最新 50 条顶掉）`, () => {
      const block = SRC.match(
        /const syncMessagesInBackground = useCallback[\s\S]*?setSyncing\(false\);/,
      );
      expect(block).not.toBeNull();
      expect(block![0]).toMatch(/if \(windowAnchorRef\.current\) \{/);
    });
  }
});

describe('③ 会话切换时从缓存读初值（既有契约，原样保留）', () => {
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
    // 必须从缓存读（friendId 三元 + cachedFriendMessages[friendId]）并经 cached 交给 setMessages，
    // 不能无脑 setMessages([]) 清空
    expect(block![0]).toMatch(/friendId\s*\?[\s\S]*?cachedFriendMessages\[friendId\]/);
    expect(block![0]).toMatch(/setMessages\(cached\)/);
    expect(block![0]).not.toMatch(/setMessages\(\[\]\)/);
    // 缓存未命中（cached 为空）时同步置 loading=true，使列表占位门控(!loading && 空)加载期不闪"暂无消息"
    expect(block![0]).toMatch(/setLoading\(cached\.length === 0/);
  });

  it('useLocalGroupMessages 切换 groupId 时从 cachedGroupMessages 读初值（不清空）', () => {
    const block = GROUP_SRC.match(
      /if\s*\(groupId\s*!==\s*prevGroupId\)[\s\S]*?currentGroupId\.current\s*=\s*groupId;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/groupId\s*\?[\s\S]*?cachedGroupMessages\[groupId\]/);
    expect(block![0]).toMatch(/setMessages\(cached\)/);
    expect(block![0]).not.toMatch(/setMessages\(\[\]\)/);
    // 缓存未命中（cached 为空）时同步置 loading=true，使列表占位门控(!loading && 空)加载期不闪"暂无消息"
    expect(block![0]).toMatch(/setLoading\(cached\.length === 0/);
  });
});
