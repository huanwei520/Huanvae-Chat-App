/**
 * WS 回显认领：这条「自己发的」回显，对应内存里哪一条在途消息？
 *
 * @module chat/shared
 * @location src/chat/shared/wsEchoClaim.ts
 *
 * ## 病灶（2026-08-21 修，外部审计 idx=89）
 *
 * 私聊 / 群聊两个 hook 里原本都是同一行：
 *
 * ```ts
 * const sendingIndex = prev.findIndex((m) => m.sendStatus === 'sending');
 * ```
 *
 * `prev` 的约定是 **[新→旧]**，乐观消息是 `[tempMessage, ...prev]` 压进去的
 * ⇒ `findIndex` 取到的是**最新插入的那一条**，与本次 WS 事件毫无对应关系。
 *
 * 快速连发 A、B 两条时列表是 `[B(sending), A(sending)]`；A 的 WS 回显先到
 * ⇒ A 的 `message_uuid` / `seq` 被写进了 **B** 的条目。随后 A 的 HTTP 响应按
 * `clientId` 精确命中 A 的条目、也写上同一个 uuid ⇒ 列表里**两条消息共享同一个
 * message_uuid** ⇒ `ChatMessages` 的 `seen.has(msg.message_uuid)` 去重把后一条整个滤掉，
 * B 从界面上消失，且 B 的 seq 永远是 A 的。
 *
 * ## 认领规则（两级，顺序不能反）
 *
 * 1. **正文 + 类型精确匹配**：回显带回了 `content` 与 `message_type`，
 *    乐观条目手里也有同样的两个值 —— 这是回显与在途项之间**唯一**可用的对应关系。
 *    命中多条（连发两条一模一样的文字）时取**最早发出**的那条。
 * 2. **兜底取最早的在途项**：正文对不上（媒体消息的本地正文与服务端派生正文可能不同形）时，
 *    退回「数组尾部第一个 sending」= 最早发出的那条。服务端按到达顺序处理并回显，
 *    所以「最早未认领的」是最可能的主人 —— 这在任何情况下都不比原来的「随便抓最新那条」更差。
 *
 * ⚠️ 为什么不用 `clientId` 直接配对：`clientId` 是**本机生成**的，服务端不认识、
 * 也不会在 WS 回显里带回来。它只能给 HTTP 响应那条通路用（那条通路本来就一直是对的）。
 */

/** 认领所需的最小消息形状（私聊 `Message` / 群聊 `GroupMessage` 都满足） */
export interface ClaimableMessage {
  message_content: string;
  message_type: string;
  sendStatus?: 'sending' | 'sent' | 'failed';
}

/** WS 回显里可用于配对的那两个字段 */
export interface EchoIdentity {
  /** `wsMsg.content || wsMsg.preview || ''` —— 与调用方喂给乐观条目的正文同口径 */
  content: string;
  message_type: string;
}

/**
 * 在 [新→旧] 的消息列表里，为一条 WS 回显挑出该被认领的在途条目下标。
 *
 * @returns 下标；列表里一条在途消息都没有时返回 `-1`（调用方据此走「新消息」分支）
 */
export function pickSendingEchoIndex<T extends ClaimableMessage>(
  list: readonly T[],
  echo: EchoIdentity,
): number {
  // 从尾部（最旧）往前找：同样条件下优先认领最早发出的那条
  let fallback = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.sendStatus !== 'sending') { continue; }
    if (fallback === -1) { fallback = i; }
    if (m.message_type === echo.message_type && m.message_content === echo.content) {
      return i;
    }
  }
  return fallback;
}
