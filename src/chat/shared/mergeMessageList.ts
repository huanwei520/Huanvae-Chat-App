/**
 * 消息列表增量合并（私聊 / 群聊共用同一份）
 *
 * @module chat/shared
 * @location src/chat/shared/mergeMessageList.ts
 *
 * ## 为什么必须抽出来
 *
 * 「用 db 的最新 N 条去更新内存列表」这件事在**每个 hook 里出现两次**：
 * `loadMessages`（进会话 / 切回会话）与 `syncMessagesInBackground`（增量同步 / WS 重连）。
 * 两个 hook × 两处 = 四份。2026-05-13 只把 `loadMessages` 那两份从「整段覆盖」改成了增量合并，
 * `syncMessagesInBackground` 那两份**原样留着覆盖写法** —— 于是同一个缺陷在同一个文件里
 * 活了下来：用户向上翻了 300 条历史，WS 抖一下重连触发同步 ⇒ 列表瞬间塌回 50 条、
 * 滚动位置一起丢（外部审计 idx=88）。
 *
 * 🔴 **一份实现四个调用点**，就是为了让「只修了其中一处」这件事在结构上不可能再发生。
 *
 * ## 合并规则（三分支，缺一不可，对齐 .claude/rules/common.md「缓存与数据库 SSOT 协同」）
 *
 * 1. `prev` 为空 ⇒ 直接用 db 结果（首次进会话，没有缓存）
 * 2. `prev` 里已存在的 uuid ⇒ **用 db 版本替换**（同步离线期间发生的 `is_recalled` /
 *    正文脱敏等 SSOT 字段变化），但**保留 `clientId` / `sendStatus`**：
 *    db 版（`localMessageToMessage`）不带这两个字段，丢了会让自己发的消息 React key
 *    从 `client_xxx` 突变成真 uuid ⇒ AnimatePresence 卸载重挂 ⇒ 退/入场动画 churn + 布局位移
 * 3. `prev` 里没有、db 里有的 ⇒ 追加，并按 `send_time` **降序**（[新→旧]）重排
 *    —— 数组约定是 [新→旧]，`loadMore` 取 `messages[length-1]` 当最旧，升序会让分页取错页
 */

/** 合并所需的最小消息形状（私聊 `Message` / 群聊 `GroupMessage` 都满足） */
export interface MergeableMessage {
  message_uuid: string;
  send_time: string;
  clientId?: string;
  sendStatus?: 'sending' | 'sent' | 'failed';
}

/**
 * 把 db 的一段消息并进内存列表。
 *
 * @param prev     内存里现有的列表（[新→旧]），可能含 `loadMore` 翻回来的更老消息
 * @param incoming db 刚读出来的一段（[新→旧]），通常是「最新 N 条」窗口
 * @returns 合并后的列表；`prev` 为空时直接返回 `incoming`
 */
export function mergeMessageList<T extends MergeableMessage>(prev: T[], incoming: T[]): T[] {
  if (prev.length === 0) {
    return incoming;
  }

  const dbByUuid = new Map(incoming.map((m) => [m.message_uuid, m]));
  const updated = prev.map((m) => {
    const dbVer = dbByUuid.get(m.message_uuid);
    return dbVer ? { ...dbVer, clientId: m.clientId, sendStatus: m.sendStatus } : m;
  });

  const existingUuids = new Set(prev.map((m) => m.message_uuid));
  const newOnes = incoming.filter((m) => !existingUuids.has(m.message_uuid));
  if (newOnes.length === 0) {
    return updated;
  }

  return [...updated, ...newOnes].sort(
    (a, b) => new Date(b.send_time).getTime() - new Date(a.send_time).getTime(),
  );
}
