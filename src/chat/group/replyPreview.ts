/**
 * 群消息「回复引用」预览纯逻辑
 *
 * @module chat/group
 * @location src/chat/group/replyPreview.ts
 *
 * 后端只在群消息上存 `reply_to`（被引用消息的 message_uuid），**不下发被引用消息的内容快照**。
 * 所以气泡里要显示「引用了谁的什么」，必须由客户端拿 uuid 去当前已加载的消息窗口里反查。
 *
 * 本模块是纯函数层（零 React / 零 Tauri 依赖），负责三件事：
 * 1. 把任意类型的群消息压成一行可读摘要（图片/视频/文件/卡片等非文本类给类型标签）
 * 2. 用已加载消息列表建 uuid → { 发送者显示名, 摘要 } 索引
 * 3. 按 reply_to 解析引用块要显示什么；命中不到时给出「未加载」占位而不是隐藏引用块
 *    —— 隐藏会让用户以为这条消息不是回复，占位则让他知道「原消息在更早的历史里，点一下去定位」
 */

import type { GroupMessage } from '../../api/groupMessages';

/** 引用摘要最大字符数（超出截断加省略号） */
export const REPLY_PREVIEW_MAX_LEN = 60;

/** 被引用原消息不在已加载窗口内时的占位文案（仍可点击，点击会拉历史去定位） */
export const REPLY_UNRESOLVED_TEXT = '原消息未加载，点击定位';

/** 引用块内容解析不出可读文本时的兜底（例如空文本消息） */
export const REPLY_EMPTY_TEXT = '[空消息]';

/** 单条被引用消息的预览条目 */
export interface ReplyPreviewEntry {
  /** 被引用消息发送者的显示名（已套用群内私有备注） */
  senderName: string;
  /** 单行摘要 */
  text: string;
}

/** 引用块最终要渲染的内容 */
export interface ResolvedReplyQuote {
  /** 命中时为发送者显示名；未命中为 null（此时只显示占位文案） */
  senderName: string | null;
  /** 要显示的摘要文本 */
  text: string;
  /** 是否在已加载窗口内命中了原消息 */
  resolved: boolean;
}

/**
 * 折叠空白 + 截断到 max 字符
 *
 * 折叠空白是必须的：多行文本原样塞进单行引用块会把换行渲染成一堆空格，
 * 也会让 60 字的预算被空白吃掉。
 */
export function truncateReplyText(raw: string, max: number = REPLY_PREVIEW_MAX_LEN): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max)}…`;
}

/**
 * 把一条群消息压成引用块用的单行摘要
 *
 * 已撤回优先于类型判断——撤回后原内容对所有人不可见，引用块不能继续泄露旧内容。
 */
export function summarizeGroupMessageForReply(message: GroupMessage): string {
  if (message.is_recalled) {
    return '消息已撤回';
  }

  switch (message.message_type) {
    case 'image':
      return '[图片]';
    case 'video':
      return '[视频]';
    case 'file': {
      const name = truncateReplyText(message.message_content);
      return name ? `[文件] ${name}` : '[文件]';
    }
    case 'meeting_invite':
      return '[会议邀请]';
    case 'card':
      return '[卡片]';
    default:
      return truncateReplyText(message.message_content) || REPLY_EMPTY_TEXT;
  }
}

/**
 * 用已加载的消息列表建 uuid → 预览 索引
 *
 * @param messages 当前会话已加载的全部消息（含 loadMore 拉回来的历史）
 * @param resolveSenderName 发送者显示名解析器（调用方注入群内私有备注逻辑）；
 *        不传则退化为消息自带的 sender_nickname
 */
export function buildReplyPreviewIndex(
  messages: readonly GroupMessage[],
  resolveSenderName?: (message: GroupMessage) => string,
): Map<string, ReplyPreviewEntry> {
  const index = new Map<string, ReplyPreviewEntry>();
  for (const message of messages) {
    index.set(message.message_uuid, {
      senderName: resolveSenderName ? resolveSenderName(message) : message.sender_nickname,
      text: summarizeGroupMessageForReply(message),
    });
  }
  return index;
}

/**
 * 解析一条消息的引用块要显示什么
 *
 * @returns 非回复消息返回 null（不渲染引用块）；是回复但原消息不在窗口内返回 resolved:false 占位
 */
export function resolveReplyQuote(
  index: ReadonlyMap<string, ReplyPreviewEntry> | undefined,
  replyTo: string | null | undefined,
): ResolvedReplyQuote | null {
  if (!replyTo) {
    return null;
  }
  const hit = index?.get(replyTo);
  if (!hit) {
    return { senderName: null, text: REPLY_UNRESOLVED_TEXT, resolved: false };
  }
  return { senderName: hit.senderName, text: hit.text, resolved: true };
}
