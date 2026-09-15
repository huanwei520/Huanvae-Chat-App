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
 *
 * ## 第 3 级（2026-09-13 增）：`failed` 条目的**精确正文修复**（假阴性修复）
 *
 * 「图片/消息显示发送失败，但对方实际收到了」的假阴性，在文本这条路上的机制是：
 * `POST /api/messages` 已被服务端受理并回显，但 HTTP **响应**在回程丢了（连接被重置、
 * 网络切换）⇒ 客户端 catch ⇒ 把条目标成 `failed`（useLocalFriendMessages 的发送 catch）
 * ⇒ **随后到达的 WS 回显**在旧逻辑里只认 `sending` ⇒ 认领落空 ⇒ 掉进「新消息」分支：
 * 界面上留着红叹号的失败条 + 对方明明收到了。
 *
 * 而回显本身就是**服务端受理的实锤**（saveMessageToLocal 对自己的回显同样落库、
 * seq>=1 才推）：只要一条 `failed` 条目的「正文 + 类型」与回显**精确相等**，
 * 它就是那个「服务端已受理、只是没收到 HTTP 响应」的同一条 —— 修复它（调用方把
 * uuid/seq/sent 写回去）就是「实收不再标失败」。**只认精确匹配、不做兜底**：
 * 内容对不上的 failed 条目可能是真失败（服务端没收到），把兜底也放宽会把真失败
 * 也洗成已发送，那是撒谎。
 *
 * 顺序：sending 精确 > sending 兜底 > failed 精确。sending 在前是因为回显本该先
 * 认领在途项（既有行为，一字未动）；failed 修复排最后，只吃前两级都不认领的剩余回显。
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
  // 第一轮：sending 条目（从尾部/最旧往前），精确匹配优先，最早在途兜底
  let fallback = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.sendStatus !== 'sending') { continue; }
    if (fallback === -1) { fallback = i; }
    if (m.message_type === echo.message_type && m.message_content === echo.content) {
      return i;
    }
  }
  if (fallback !== -1) { return fallback; }

  // 第二轮：failed 条目只认「正文 + 类型」**精确**相等的（假阴性修复，见文件头第 3 级）。
  // 没有兜底 —— 精确匹配是「这条回显就是这条失败消息」的唯一安全证据。
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.sendStatus !== 'failed') { continue; }
    if (m.message_type === echo.message_type && m.message_content === echo.content) {
      return i;
    }
  }
  return -1;
}
