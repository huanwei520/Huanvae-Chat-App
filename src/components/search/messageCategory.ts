/**
 * 会话内搜索的消息分类映射（纯函数，无 React / 无 Tauri 依赖）
 *
 * 真值源：`messages.content_type` 是服务端 message_type 的**原样透传**
 * （见 src/types/chat.ts `MessageType` / `GroupMessageType`），本地 SQLite 列是无 CHECK 的
 * TEXT，服务端随时可能新增类型。因此：
 *
 * - 图片 / 视频 / 文件 三类用**白名单**（枚举已知 content_type）
 * - 文字类用**黑名单**（= 非文件类）——这样未来新增的未知类型（以及 `system` /
 *   `card` / `meeting_invite` 这些非文件的特殊类型）仍会落进「文字」，
 *   不会从四个分类里凭空消失。
 *
 * 该口径与全局搜索的既有拆分一致（GlobalMessageSearchResults 的 FILE_TYPES）。
 */

import type { MessageSearchFilter } from '../../db';

/** 会话内搜索的分类页签 */
export type MessageCategory = 'all' | 'text' | 'image' | 'video' | 'file' | 'member';

/**
 * 文件类 content_type 集合
 *
 * `audio` 目前无任何发送路径产出，但历史上全局搜索已把它算作文件类；
 * 保留它使两处口径一致，且服务端一旦启用语音消息即自动归位。
 */
export const FILE_CONTENT_TYPES = ['image', 'video', 'file', 'audio'] as const;

/** 页签定义（顺序即 UI 顺序） */
export const MESSAGE_CATEGORY_TABS: { key: MessageCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文字' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'file', label: '文件' },
];

/**
 * 分类 → SQL 过滤条件（下发给 Rust `db_search_messages`）
 *
 * 必须在 SQL 层过滤而不是拿回结果再前端筛：limit 是在过滤**之后**生效的，
 * 前端筛会让"某会话有 500 条文字命中 + 2 张图片"时图片页签空掉。
 */
export function categoryToSearchFilter(category: MessageCategory): MessageSearchFilter {
  switch (category) {
    case 'text':
      return { exclude_content_types: [...FILE_CONTENT_TYPES] };
    case 'image':
      return { include_content_types: ['image'] };
    case 'video':
      return { include_content_types: ['video'] };
    case 'file':
      // 「文件」= 文件类里去掉单独成页签的图片 / 视频
      return { include_content_types: FILE_CONTENT_TYPES.filter((t) => t !== 'image' && t !== 'video') };
    case 'all':
    default:
      return {};
  }
}

/** content_type → 所属分类（用于结果条目上的类型标记） */
export function contentTypeToCategory(contentType: string): Exclude<MessageCategory, 'all'> {
  switch (contentType) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    default:
      return (FILE_CONTENT_TYPES as readonly string[]).includes(contentType) ? 'file' : 'text';
  }
}

/** 结果条目上的类型徽标文案（文字类不加徽标 → null） */
export function contentTypeBadge(contentType: string): string | null {
  switch (contentTypeToCategory(contentType)) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'file':
      return '文件';
    default:
      return null;
  }
}
