/**
 * 全局搜索的六个分类页签（纯函数模块，无 React / 无 Tauri 依赖 ⇒ 单测零 mock）
 *
 * 六类与顺序是产品口径的一部分，**不许增删改名**：
 * 消息 · 视频 · 图片 · 用户 · 群聊 · 机器人。
 *
 * ## 两族 Tab，取数通路完全不同
 *
 * - **消息 / 视频 / 图片** —— 走本地 SQLite（`db_search_messages`），靠 `MessageSearchFilter`
 *   在 **SQL 层**过滤 content_type。必须下推到 SQL 而不是拿回结果再前端筛：limit 是在过滤
 *   **之后**生效的，前端筛会让"命中 50 条文字 + 2 张图片"时图片页签空掉
 *   （与 messageCategory.ts 同一条口径，那边的注释写了同一个坑）。
 * - **用户 / 群聊 / 机器人** —— 不查本地消息表；数据来自「本地会话名子串匹配」+
 *   「服务端 /api/discovery/search 的三个数组」。故 `tabToSearchFilter` 对它们返回 null。
 *
 * ## 「消息」为什么用黑名单而不是白名单
 *
 * 六个分类里没有「文件」，而 file（文档/压缩包）与 audio（语音）消息仍然搜得到，
 * 它们必须有归宿。黑名单（= 非 image / 非 video）让这两类落进「消息」，
 * 未来服务端新增的未知 content_type 同样不会从分类里凭空消失
 * （与 messageCategory.ts 文字类取补集是同一个理由）。
 */

import type { MessageSearchFilter } from '../../db';

/** 全局搜索的分类页签 key */
export type GlobalSearchTab = 'message' | 'video' | 'image' | 'user' | 'group' | 'bot';

/** 页签顺序（即 UI 从左到右的顺序），产品口径，勿动 */
export const GLOBAL_SEARCH_TAB_ORDER: readonly GlobalSearchTab[] = [
  'message',
  'video',
  'image',
  'user',
  'group',
  'bot',
] as const;

/** 页签文案（唯一真值源：页签栏与空态文案都取它，避免两处漂移） */
export const GLOBAL_SEARCH_TAB_LABEL: Record<GlobalSearchTab, string> = {
  message: '消息',
  video: '视频',
  image: '图片',
  user: '用户',
  group: '群聊',
  bot: '机器人',
};

export interface GlobalSearchTabDef {
  key: GlobalSearchTab;
  label: string;
}

/** 页签定义（顺序即 UI 顺序） */
export const GLOBAL_SEARCH_TABS: GlobalSearchTabDef[] = GLOBAL_SEARCH_TAB_ORDER.map((key) => ({
  key,
  label: GLOBAL_SEARCH_TAB_LABEL[key],
}));

/** 默认落在第一个页签 */
export const DEFAULT_GLOBAL_SEARCH_TAB: GlobalSearchTab = 'message';

/** 单独成页签、因而要从「消息」里排掉的媒体类型 */
const MEDIA_CONTENT_TYPES = ['image', 'video'] as const;

/** 是否是走本地消息表的页签（另三个是实体页签，不查消息） */
export function isMessageTab(tab: GlobalSearchTab): boolean {
  return tab === 'message' || tab === 'video' || tab === 'image';
}

/**
 * 页签 → SQL 过滤条件（下发给 Rust `db_search_messages`）
 *
 * 不含 `conversation_id` ⇒ 跨会话（Rust 侧该字段是 Option，省略即全库）。
 * 实体页签（用户 / 群聊 / 机器人）返回 null —— 它们不查消息表。
 */
export function tabToSearchFilter(tab: GlobalSearchTab): MessageSearchFilter | null {
  switch (tab) {
    case 'message':
      return { exclude_content_types: [...MEDIA_CONTENT_TYPES] };
    case 'video':
      return { include_content_types: ['video'] };
    case 'image':
      return { include_content_types: ['image'] };
    case 'user':
    case 'group':
    case 'bot':
      return null;
  }
}

/** 该页签搜不到东西时的提示文案（每个页签都要有空态，不能留一片空白） */
export function tabEmptyText(tab: GlobalSearchTab, query: string): string {
  return `未找到包含「${query}」的${GLOBAL_SEARCH_TAB_LABEL[tab]}`;
}
