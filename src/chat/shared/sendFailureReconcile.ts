/**
 * 媒体假阴性失败的服务端对账（「显示发送失败，但对方实收」的修复件）
 *
 * @module chat/shared
 * @location src/chat/shared/sendFailureReconcile.ts
 *
 * ## 病灶：媒体发送的「响应回程丢失」型假阴性
 *
 * 媒体消息的「建消息」动作发生在服务端的两处 HTTP 响应里：
 * `upload/request` 的秒传分支、`upload/confirm`（见 uploadPersist.ts 文件头）。
 * 若请求已被服务端受理并派发给对端、但**响应在回程丢失**（连接重置 / 网络切换 /
 * 反代 502），客户端 catch 后把条目标成 `failed` —— 而对端明明收到了。
 * 与文本路径不同（POST /api/messages 的回显经 WS 折返、由 wsEchoClaim 第 3 级修复），
 * **存储路径服务端不把自己的消息推回本机**（uploadPersist.ts 文件头同一条结论），
 * 所以这条路上唯一的真值来源是**服务端历史**：发一条只读的历史查询，找到
 * 「自己发的、同类型、同派生正文、时间在发送时刻之后」的那条，它就是这次上传建出来的消息。
 *
 * 匹配身份沿用 wsEchoClaim 的同一原则（正文 + 类型），再加两个媒体独有的强条件：
 * - `sender_id === 本机用户`（历史里有对端发的同正文消息，不算数）；
 * - `send_time >= 入队时刻 - 容差`（同文件昨天发过一次，不能拿旧消息冒领；容差
 *   5 分钟吸收本地/服务端时钟偏差）。
 *
 * 对账是**尽力而为**：查不到（真失败）、网络仍不可用、字段对不上 —— 一律保持
 * `failed` 原状（重试按钮还在），绝不把「没找到」洗成已发送。
 */

import type { ApiClient } from '../../api/client';
import { getMessages } from '../../api/messages';
import { getGroupMessages } from '../../api/groupMessages';
import { saveMessage } from '../../db';
import { useSendingMediaStore, type SendingMediaEntry } from '../../stores/sendingMediaStore';
import { resolveUploadedContent } from './uploadPersist';
import { getFriendConversationId } from '../../utils/conversationId';

/** 对账落库时的发送者展示信息（与 uploadPersist 的 session 形状一致） */
export interface ReconcileSender {
  userId: string;
  profile: { user_nickname: string; user_avatar_url: string | null };
}

/** send_time 下界的时钟偏差容差（毫秒） */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** 历史回看条数：只看最新一页（对账只关心「刚发的那条」，翻旧账没有意义） */
const RECENT_LIMIT = 30;

/** 服务端历史行里对账需要的最小字段（好友 / 群两个响应形状的交集） */
export interface ServerMediaCandidate {
  message_uuid: string;
  sender_id: string;
  message_content: string;
  message_type: string;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  image_width?: number | null;
  image_height?: number | null;
  seq: number;
  send_time: string;
  is_recalled: boolean;
}

export interface MediaProbe {
  conversationType: 'friend' | 'group';
  targetId: string;
  /** 'image' | 'video' | 'file'（SendingMediaEntry.preview.kind 的媒体三值） */
  kind: string;
  /** 本项配文（组首项才有；与 uploadPersist 同一口径参与派生正文） */
  caption?: string;
  /** 原始文件名（派生正文的另一半） */
  filename: string;
  /** 入队时刻（ISO）；匹配下界 = 它 - 容差 */
  sendTimeIso: string;
  /** 本机用户 id（只认自己发的） */
  userId: string;
}

/**
 * 在服务端最新历史里找这条上传建出来的消息。
 *
 * @returns 命中的服务端行；找不到返回 null（调用方保持 failed 原状）
 */
export async function probeSentMedia(
  api: ApiClient,
  probe: MediaProbe,
): Promise<ServerMediaCandidate | null> {
  const expectedContent = resolveUploadedContent(probe.caption, probe.kind as 'image' | 'video' | 'file', probe.filename);
  const lowerBound = Date.parse(probe.sendTimeIso) - CLOCK_SKEW_TOLERANCE_MS;

  const rows: ServerMediaCandidate[] = (probe.conversationType === 'friend'
    ? (await getMessages(api, probe.targetId, { limit: RECENT_LIMIT })).messages
    : (await getGroupMessages(api, probe.targetId, { limit: RECENT_LIMIT })).messages
  ).map((row) => (
    // 历史 Message.seq 在类型上是可选的（发送侧乐观行才是必填）；对账只关心服务端行，
    // 缺 seq 视为 0（seq 不参与匹配，仅落库展示，真正送达与法由命中本身保证）。
    { ...row, seq: row.seq ?? 0 }
  ));

  // 多条命中（极小概率：对账窗口内重发了同文件）取**最早**的那条 —— 它才是这次
  // 上传建出来的；晚的那条是后续动作，不该冒领。
  let best: ServerMediaCandidate | null = null;
  for (const row of rows) {
    if (row.sender_id !== probe.userId) { continue; }
    if (row.message_type !== probe.kind) { continue; }
    if (row.message_content !== expectedContent) { continue; }
    const t = Date.parse(row.send_time);
    if (!Number.isFinite(t) || t < lowerBound) { continue; }
    if (!best || t < Date.parse(best.send_time)) { best = row; }
  }
  return best;
}

/** 文本路径（POST /api/messages）的对账探针入参 */
export interface TextProbe {
  conversationType: 'friend' | 'group';
  targetId: string;
  /** 原始正文（文本路径无派生，直接等值比较） */
  content: string;
  /** 服务端 message_type：'text' / 'meeting_invite' / … */
  messageType: string;
  /** 入队时刻（ISO）；匹配下界 = 它 - 容差 */
  sendTimeIso: string;
  /** 本机用户 id（只认自己发的） */
  userId: string;
}

/**
 * 文本路径的服务端对账探针。
 *
 * 与媒体版的差别只有两点：正文不做派生（`message_content` 原样等值），类型由调用方
 * 传入（文本是 `text`，会议邀请是 `meeting_invite`）。其余匹配原则同源：
 * `sender_id === 本机` + 类型相等 + 正文相等 + `send_time >= 入队时刻 - 容差`；
 * 多条命中取最早那条（对账窗口内的重发不该被后来的冒领）。
 *
 * 存在理由：增量同步接口返回的是「我收到的消息」，**不含自己发的**（实测：发送失败后
 * 连续 sync 与点击横幅重试都不会让 `send-failed` 自愈），所以这条路上唯一的真值来源
 * 就是历史查询本身。
 *
 * @returns 命中的服务端行；找不到返回 null（调用方保持 failed 原状）
 */
export async function probeSentText(
  api: ApiClient,
  probe: TextProbe,
): Promise<ServerMediaCandidate | null> {
  const lowerBound = Date.parse(probe.sendTimeIso) - CLOCK_SKEW_TOLERANCE_MS;

  const rows: ServerMediaCandidate[] = (probe.conversationType === 'friend'
    ? (await getMessages(api, probe.targetId, { limit: RECENT_LIMIT })).messages
    : (await getGroupMessages(api, probe.targetId, { limit: RECENT_LIMIT })).messages
  ).map((row) => ({ ...row, seq: row.seq ?? 0 }));

  let best: ServerMediaCandidate | null = null;
  for (const row of rows) {
    if (row.sender_id !== probe.userId) { continue; }
    if (row.message_type !== probe.messageType) { continue; }
    if (row.message_content !== probe.content) { continue; }
    const t = Date.parse(row.send_time);
    if (!Number.isFinite(t) || t < lowerBound) { continue; }
    if (!best || t < Date.parse(best.send_time)) { best = row; }
  }
  return best;
}

/**
 * 对一条已标 `failed` 的在途媒体条目做服务端对账：
 * 命中 ⇒ 本地落库（供列表重灌/重启后仍在）+ `markSent`（气泡回到已发送、乐观条目
 * 随真实消息到位被 prune）。任何一步失败都只记日志、保持 failed 原状 —— 本函数
 * **永不抛错**（它在发送的 catch 链里被调，抛错只会把真失败吞成别的形状）。
 */
export async function reconcileFailedSendingEntry(
  api: ApiClient,
  entry: SendingMediaEntry,
  sender: ReconcileSender,
): Promise<void> {
  try {
    const hit = await probeSentMedia(api, {
      conversationType: entry.conversationType,
      targetId: entry.targetId,
      kind: entry.preview.kind,
      caption: entry.caption,
      filename: entry.preview.name,
      sendTimeIso: entry.sendTime,
      userId: sender.userId,
    });
    if (!hit) {
      return;
    }

    // 先落库再 markSent：useSendingOutboxMerge 见到 done+realUuid 会重灌本地库，
    // 落库在前保证重灌读得到，乐观条目顺次被 prune（先增后减，画面不闪）。
    await saveMessage({
      message_uuid: hit.message_uuid,
      conversation_id: entry.conversationType === 'friend'
        // 与 uploadPersist/uploadOne 同一份拼法（字典序规则）
        ? getFriendConversationId(sender.userId, entry.targetId)
        : entry.targetId,
      conversation_type: entry.conversationType,
      sender_id: sender.userId,
      sender_name: sender.profile.user_nickname,
      sender_avatar: sender.profile.user_avatar_url,
      content: resolveUploadedContent(entry.caption, entry.preview.kind as 'image' | 'video' | 'file', entry.preview.name),
      content_type: entry.preview.kind,
      file_uuid: hit.file_uuid,
      file_url: hit.file_url,
      file_size: hit.file_size ?? entry.preview.size,
      image_width: hit.image_width ?? entry.preview.width,
      image_height: hit.image_height ?? entry.preview.height,
      // 服务端历史行带真实 seq：写它，对齐「ws 推送必然已送达」的口径
      seq: hit.seq,
      reply_to: null,
      media_group_id: entry.shape.groupId,
      media_group_index: entry.shape.index,
      media_group_count: entry.shape.count,
      is_recalled: hit.is_recalled || false,
      is_deleted: false,
      send_time: hit.send_time,
    });

    useSendingMediaStore.getState().markSent(entry.clientId, hit.message_uuid);
    // eslint-disable-next-line no-console
    console.info('[SendReconcile] 假阴性修复：服务端历史命中本次上传，已恢复为已发送', {
      clientId: entry.clientId,
      uuid: hit.message_uuid,
      seq: hit.seq,
    });
  } catch (err) {
    // 尽力而为：对账失败不影响 failed 状态本身（用户仍有重试按钮）
    console.warn('[SendReconcile] 对账未命中或失败，保持失败原状', err);
  }
}
