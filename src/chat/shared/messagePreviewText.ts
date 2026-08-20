/**
 * 会话卡片预览文案的唯一映射（离线同步 与 撤回/删除后刷新 两条路径共用）
 *
 * @location src/chat/shared/messagePreviewText.ts
 *
 * 为什么要抽出来：会话列表那一行「最后一条消息」有多条互相独立的写入路径，各自维护一张
 * `type → 文案` 的表。表一分叉，同一条消息在「刚收到」「离线同步回来」「撤回后刷新」三种
 * 时机就会显示成三种样子；更糟的是**漏一行的后果不是报错，而是静默回落到 content 原文**。
 *
 * 🔴 本模块的核心不变量：**未知类型绝不回落到 content 原文。**
 *
 * 这不是洁癖，是一条真实的信息泄露：`meeting_invite` 的 `message_content` 是一段 JSON，
 * 里面带 `password`（见 meeting/components/ShareMeetingModal.tsx 的发送体）。
 * 原先 `syncService.getMessagePreviewText` 的 `default: return content` ⇒ 离线同步回来后，
 * **会议密码就直接印在会话列表上**（任何看得见这台机器屏幕的人都拿得到）。
 * `card` / 未来任何 JSON 载荷型 message_type 同理。
 * 所以这里用**白名单**而不是黑名单：只有明确「正文本身就是给人看的」那几种才允许原文，
 * 其余一律走映射表，映射表没有的落 {@link UNKNOWN_MESSAGE_PREVIEW_TEXT}。
 * 新增一个 message_type 时忘了登记，代价只是显示成「[消息]」——不会再泄露任何东西。
 *
 * ⚠️ 本模块**不含**发送者前缀（群聊的 `昵称: `）与长度截断，那两件各自属于调用方：
 * 前缀只有群会话要（见 hooks/useLocalConversations.ts），截断只有系统通知要
 * （见 services/notificationService.ts）。
 */

import { GROUP_CARD_PREVIEW_TEXT } from './groupCard';

/**
 * 正文本身就是给人看的、可以直接当预览的类型。
 *
 * - `text`：用户打的字
 * - `system`：入群/退群/改名等系统提示，content 就是完整中文句子
 *   （与 hooks/useLocalConversations.ts 的既有行为一致 —— 它对 system 也是回落 content）
 */
const RAW_CONTENT_TYPES: ReadonlySet<string> = new Set(['text', 'system']);

/** 非文本消息类型 → 用户可读的预览文案 */
export const MESSAGE_PREVIEW_TEXT: Readonly<Record<string, string>> = {
  image: '[图片]',
  video: '[视频]',
  file: '[文件]',
  meeting_invite: '[会议邀请]',
  card: '[卡片]',
  group_card: GROUP_CARD_PREVIEW_TEXT,
};

/** 白名单外、映射表里也没有的类型的兜底。**刻意不回落 content**，见文件头。 */
export const UNKNOWN_MESSAGE_PREVIEW_TEXT = '[消息]';

/**
 * 把 `message_type` + `message_content` 转成会话卡片上那一行。
 *
 * @param messageType 消息类型（后端 `message_type` / 本地 `content_type`，两者取值同一套）
 * @param content     消息正文；**只有白名单类型**会用到它
 */
export function conversationPreviewText(
  messageType: string | null | undefined,
  content: string | null | undefined,
): string {
  if (messageType && RAW_CONTENT_TYPES.has(messageType)) {
    return content || UNKNOWN_MESSAGE_PREVIEW_TEXT;
  }
  return MESSAGE_PREVIEW_TEXT[messageType ?? ''] ?? UNKNOWN_MESSAGE_PREVIEW_TEXT;
}
