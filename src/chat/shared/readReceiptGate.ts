/**
 * 已读标记的「挂在哪一条」门控（私聊 / 群聊共用纯逻辑）
 *
 * @module chat/shared
 * @location src/chat/shared/readReceiptGate.ts
 *
 * 产品口径：已读标记**只挂在「我发出的最新一条」上**，更早的自己消息一律不挂。
 * 依据：已读位置是单调推进的（私聊 peer last-read-seq / 群成员 last-read-seq），
 * 「最新一条已读」蕴含「它之前的都已读」——逐条重复标记既冗余，又把气泡列表堆满绿勾。
 *
 * 为什么锚点是「我发出的最新一条」而不是「整个会话的最新一条」：已读标记本就只出现在
 * 自己的消息上（挂到对方消息上无意义），若锚整个会话最新一条，只要对方最后回了一句，
 * 我的已读态就整个消失。
 *
 * ⚠️ 性能：锚点必须在列表 map **之外**算一次（O(n)），不能每条消息各扫一遍全量（O(n²)）。
 */

import type { MessageSendStatus } from '../../types/chat';

/** 门控所需的最小消息形状（私聊 Message / 群聊 GroupMessage 都满足） */
export interface ReceiptGateMessage {
  message_uuid: string;
  sender_id: string;
  is_recalled: boolean;
  sendStatus?: MessageSendStatus;
}

/**
 * 本条是否有资格显示「已读态」：仅自己发出、未撤回、且已送达。
 *
 * sending / failed 显示的是**发送状态**（时钟 / 红叹号），由气泡内的状态槽按 sendStatus 渲染，
 * 不属于已读态，故在此排除——它们不参与「最新一条」锚点的竞争，也不受本门控影响。
 */
export function isReadReceiptEligible(message: ReceiptGateMessage, myUserId: string): boolean {
  return (
    message.sender_id === myUserId
    && !message.is_recalled
    && message.sendStatus !== 'sending'
    && message.sendStatus !== 'failed'
  );
}

/**
 * 在**倒序（新→旧）**的渲染代表消息列表里取「我发出的最新一条」的 message_uuid；没有则 null。
 *
 * 传入的必须是列表**真正渲染**的那一组代表消息（相册节点取组内代表），顺序即渲染顺序——
 * 否则锚点会落到一条根本没渲染出来的消息上，标记就整个消失。
 * 允许 undefined 项（相册空组的理论形态），与调用方 map 里的 `if (!message) return null` 同频。
 */
export function latestOwnReceiptUuid(
  messagesDesc: readonly (ReceiptGateMessage | undefined)[],
  myUserId: string,
): string | null {
  const latest = messagesDesc.find((m) => m !== undefined && isReadReceiptEligible(m, myUserId));
  return latest ? latest.message_uuid : null;
}
