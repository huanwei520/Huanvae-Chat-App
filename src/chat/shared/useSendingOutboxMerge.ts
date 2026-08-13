/**
 * 把「在途的媒体消息」并进消息列表（私聊 / 群共用）
 *
 * @module chat/shared
 * @location src/chat/shared/useSendingOutboxMerge.ts
 *
 * spec §三：回车后消息**立刻出现在列表最新处**（乐观插入），上传完成后从最新处重新渲染。
 * 本 hook 是那两句话在消息列表侧的落点，两条会话链路（useLocalFriendMessages /
 * useLocalGroupMessages）各调一次，合并口径只有 {@link mergeSendingIntoMessages} 一处。
 *
 * ## 三件事，顺序不能换
 * 1. **合并**：乐观条目排在最前（列表 index 0 = 最新）。它们的 `clientId` 前缀是 `client_`，
 *    于是 useStickToBottom 判成「本机这次发送动作」⇒ 无条件滚到底 —— 全仓判贴底仍然只有那一处。
 * 2. **重灌**：某项上传成功（有了真 uuid）但真实消息还没进列表 ⇒ 读一次本地库。
 *    每个 uuid **只重灌一次**（`reloadedRef`）：DB 窗口不一定覆盖得到那条（比如用户正处在
 *    历史定位窗口态），不设防会变成"重灌→还是没有→再重灌"的死循环。
 * 3. **收口**：真实消息确实到了列表里，才把乐观条目摘掉。**先增后减**，
 *    交叉窗口里两者共存但被 uuid 去重，所以画面上永远只有一条 —— 不闪、不重。
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  useSendingMediaStore,
  pickSendingEntries,
  mergeSendingIntoMessages,
  type SendingMediaEntry,
} from '../../stores/sendingMediaStore';

export function useSendingOutboxMerge<M extends { message_uuid: string; clientId?: string }>(
  /** 本会话的 outbox key；null = 不参与合并（如切会话中途） */
  outboxKey: string | null,
  messages: readonly M[],
  /** 条目 → 列表元素。**调用方必须用 useCallback 稳定它**，否则每次 render 都会重算合并 */
  toMessage: (entry: SendingMediaEntry) => M,
  /** 重灌本地库（调用方的 loadMessages），同样需要引用稳定 */
  reload: () => void,
): M[] {
  // 两个 map 都是稳定引用（只在 store 写入时换新），可以安全地各订阅一次
  const entries = useSendingMediaStore((s) => s.entries);
  const order = useSendingMediaStore((s) => s.orderByConversation);

  const sendingEntries = useMemo(
    () => pickSendingEntries(entries, order, outboxKey),
    [entries, order, outboxKey],
  );

  const merged = useMemo(
    () => mergeSendingIntoMessages(messages, sendingEntries, toMessage),
    [messages, sendingEntries, toMessage],
  );

  // 已重灌过的真 uuid（防死循环，见文件头第 2 点）
  const reloadedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!outboxKey || sendingEntries.length === 0) { return; }
    const present = new Set(messages.map((m) => m.message_uuid));

    // 2) 需要重灌？
    const needReload = sendingEntries.some(
      (e) => e.status === 'done'
        && e.realUuid !== null
        && !present.has(e.realUuid)
        && !reloadedRef.current.has(e.realUuid),
    );
    if (needReload) {
      sendingEntries.forEach((e) => {
        if (e.status === 'done' && e.realUuid) { reloadedRef.current.add(e.realUuid); }
      });
      reload();
      return;
    }

    // 3) 真实消息已到位 ⇒ 收掉乐观条目
    useSendingMediaStore.getState().pruneConfirmed(outboxKey, present);
  }, [outboxKey, sendingEntries, messages, reload]);

  return merged;
}
