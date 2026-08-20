/**
 * 消息转发的语义边界与请求构造（纯函数，无 React / 无 API 依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/forwardMessage.ts
 *
 * 三条边界都是**现查后端契约定下的**，不是"看起来能发就行"：
 *
 * 1. **非文本消息复用 `file_uuid`** —— 后端两个消息端点显式接受已上传的 `file_uuid`，
 *    用途就写着「转发/重发场景」（backend-docs/messages/好友消息.md 的
 *    `file_uuid` 字段说明 + 「创建入口（两条）」第 2 条）。无归属校验一说 ⇒
 *    图片 / 视频 / 文件按原样转发，带上 file_uuid + file_url + file_size。
 *
 * 2. **不带 `reply_to`** —— 转发出去的是新会话里的一条新消息；后端要求被引用消息
 *    「必须存在且属于同一会话，否则 400」，原引用目标不在新会话里 ⇒ 一律不继承。
 *
 * 3. **丢弃媒体组三件套（相册拆成逐条独立媒体消息）** —— 后端规则：三者同生同灭，
 *    且同组须 count 一致、index 不重复、成组项必须带 file_uuid。转发时用户完全可能
 *    只选中一个组里的部分项，把原 `media_group_count` 原样带过去就会在对方那边留下
 *    「按 count 排版却永远填不上的洞」（这正是后端规则 7 要防的形态）。
 *    A 版规格本来就是「多条消息一律按原样逐条发出」，所以逐条独立发既简单又不会
 *    发出一条对方点开是坏的消息。**代价如实记账：相册转发后在对方那里不再成组。**
 *
 * 4. **`card` / `system` 不给转发入口** —— 可交互卡片的回调走
 *    `POST /api/messages/interact`，参数是 `message_uuid`（src/api/messages.ts）：
 *    转发后 action 会绑到新消息的 uuid，发卡方根本收不到 ⇒ 对方点开就是坏的。
 *    群系统消息（入群/退群）不是用户内容，同理不转发。
 */

import { mediaFilenameFromContent } from './mediaGallery';
import type { SendMessageRequest } from '../../types/chat';
import type { SendGroupMessageRequest } from '../../api/groupMessages';

/**
 * 可被转发的消息类型（`card` / `system` 不在内，见文件头第 4 条）
 *
 * 🔴 `group_card` **刻意不在内**（不是漏了）：转发一张群名片本质上仍是"把那个群拿出去"，
 * 后端会按**被分享群**的 `card_share_scope` 门控（`backend-docs/groups/群聊管理.md` §八），
 * 于是转发按钮对档位不够的人是「点了必然 403」——而通用转发面板给不出"你在**另一个**群里
 * 权限不够"这句话。分享群名片有自己的专用入口（群详情面板「分享该群」→ ShareGroupCardModal，
 * 那里三态文案是分开的）。要把它变成可转发，必须先把 403 的归因文案带进转发面板。
 */
export const FORWARDABLE_TYPES = ['text', 'image', 'video', 'file', 'meeting_invite'] as const;

export type ForwardableType = (typeof FORWARDABLE_TYPES)[number];

/**
 * 转发源消息的归一形状 —— 私聊 `Message` 与群聊 `GroupMessage` 各自映射到它，
 * 于是转发逻辑只写一遍。`senderName` 由调用方给（私聊消息本身不带发送者昵称）。
 */
export interface ForwardSource {
  message_uuid: string;
  message_content: string;
  message_type: string;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  send_time: string;
  /** 原发送者显示名（预览条上「谁说的」） */
  senderName: string;
  /** 必填而非可选：两端消息都恒带该字段，写成可选只会让「忘了带」静默变成「未撤回」 */
  is_recalled: boolean;
  /** 客户端发送态：仍在途 / 已失败的消息没有服务端身份，不能转发 */
  sendStatus?: 'sending' | 'sent' | 'failed' | string;
}

/** 私聊 `Message` 与群聊 `GroupMessage` 共有的那部分形状（两者都结构满足） */
export interface ForwardableLike {
  message_uuid: string;
  message_content: string;
  message_type: string;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  send_time: string;
  is_recalled: boolean;
  sendStatus?: string;
}

/**
 * 消息 → 转发源。逐键显式映射（不用展开）——多带的键会顺着请求体漏到后端去，
 * 而 `sendMessage` 是逐键构造 body 的，多余键不会被发出但会让类型面变脏。
 */
export function toForwardSource(m: ForwardableLike, senderName: string): ForwardSource {
  return {
    message_uuid: m.message_uuid,
    message_content: m.message_content,
    message_type: m.message_type,
    file_uuid: m.file_uuid,
    file_url: m.file_url,
    file_size: m.file_size,
    send_time: m.send_time,
    senderName,
    is_recalled: m.is_recalled,
    sendStatus: m.sendStatus,
  };
}

const TYPE_TAG: Record<string, string> = {
  image: '[图片]',
  video: '[视频]',
  file: '[文件]',
  meeting_invite: '[会议邀请]',
};

/**
 * 这条消息能不能转发。
 *
 * 不可转发一律**不给入口**（不是发出去再失败）——
 * 已撤回 / 在途 / 发送失败 / 类型不在白名单 / 媒体类但没有 file_uuid（无从复用文件）。
 */
export function canForwardMessage(m: ForwardSource): boolean {
  if (m.is_recalled) { return false; }
  if (m.sendStatus === 'sending' || m.sendStatus === 'failed') { return false; }
  if (!(FORWARDABLE_TYPES as readonly string[]).includes(m.message_type)) { return false; }
  if (m.message_type !== 'text' && m.message_type !== 'meeting_invite' && !m.file_uuid) { return false; }
  return true;
}

/**
 * 预览条上那一行内容摘要。
 *
 * 媒体消息的 `message_content` 本身就是 `[图片] a.png` 形态（见 mediaFilenameFromContent），
 * 这里统一重建成「标签 + 文件名」，避免某些路径没带前缀时预览成一个裸文件名。
 */
export function summarizeForwardSource(m: ForwardSource): string {
  if (m.message_type === 'text') { return m.message_content; }
  const tag = TYPE_TAG[m.message_type] ?? '[消息]';
  if (m.message_type === 'meeting_invite') { return tag; }
  const name = mediaFilenameFromContent(m.message_content).trim();
  return name ? `${tag} ${name}` : tag;
}

/**
 * 私聊转发请求体。
 *
 * 媒体组三件套一律不带（文件头第 3 条）；`reply_to` 一律不带（第 2 条）。
 * `sendMessage` 是逐键构造 body 的，这里少给一个键就等于该字段不会被发出去，
 * 所以「不带」必须靠**不写**而不是靠调用方记得删。
 */
export function buildFriendForwardRequest(m: ForwardSource, receiverId: string): SendMessageRequest {
  return {
    receiver_id: receiverId,
    message_content: m.message_content,
    message_type: m.message_type as SendMessageRequest['message_type'],
    file_uuid: m.file_uuid,
    file_url: m.file_url,
    file_size: m.file_size,
  };
}

/**
 * 多选批量转发：从消息列表里挑出被选中且**可转发**的那些，按发送时间升序。
 *
 * 排序不能省：列表数组的方向随实现而变（消息区是 column-reverse），
 * 不排序就会把"逐条按原顺序发出"发成倒序。
 */
export function collectForwardSources<T extends ForwardableLike>(
  messages: T[],
  selected: Set<string>,
  senderNameOf: (m: T) => string,
): ForwardSource[] {
  return messages
    .filter((m) => selected.has(m.message_uuid))
    .map((m) => toForwardSource(m, senderNameOf(m)))
    .filter(canForwardMessage)
    .sort((a, b) => new Date(a.send_time).getTime() - new Date(b.send_time).getTime());
}

/** 群转发请求体。群端点直接透传对象 ⇒ 用 undefined 表示"不带该字段" */
export function buildGroupForwardRequest(m: ForwardSource, groupId: string): SendGroupMessageRequest {
  return {
    group_id: groupId,
    message_content: m.message_content,
    message_type: m.message_type as SendGroupMessageRequest['message_type'],
    file_uuid: m.file_uuid ?? undefined,
    file_url: m.file_url ?? undefined,
    file_size: m.file_size ?? undefined,
  };
}
