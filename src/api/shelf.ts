/**
 * 顶置架（Conversation Shelf）API 封装
 *
 * 顶置架 = 对一条真实卡片消息的引用集合，挂在 bot 会话 / 群会话头部。
 * 契约真值源在后端；本文件逐字镜像后端 struct 字段名。
 * 端点：/api/conversations/{scope}/{scope_key}/shelf（数据面经 secureFetch）。
 * 授权/隔离全在服务端（bot=authorship SQL；群=verify_owner）；前端只调用+渲染。
 */

import type { ApiClient } from './client';

/** 顶置架作用域：bot 会话 或 群会话（好友 1:1 无架） */
export type ShelfScope = 'bot' | 'group';

/**
 * 顶置架条目 —— 对一条真实卡片消息的引用（不含卡片内容本身）。
 * 内容经既有 message / cardLiveStore 通道，本条目只持引用。
 */
export interface ShelfItem {
  item_id: string;
  message_uuid: string;
  pinned_by: string;
  note: string | null;
  position: number;
  created_at: string;
}

/** GET .../shelf 响应（position 升序） */
export interface ShelfItemsResponse {
  items: ShelfItem[];
}

/** 上架请求体 */
export interface PinToShelfRequest {
  message_uuid: string;
  note?: string;
}

/** scope_key：bot 会话 = "{userId}:{botUserId}"；群 = groupId */
function shelfBase(scope: ShelfScope, scopeKey: string): string {
  return `/api/conversations/${encodeURIComponent(scope)}/${encodeURIComponent(scopeKey)}/shelf`;
}

/** 拉取顶置架（会话成员可读；无权/不存在 404 同形） */
export function getShelf(
  api: ApiClient,
  scope: ShelfScope,
  scopeKey: string,
): Promise<ShelfItemsResponse> {
  return api.get<ShelfItemsResponse>(shelfBase(scope, scopeKey));
}

/**
 * 上架一条卡片消息（幂等）。
 * 注：bot 会话里的上架执行者是 bot（凭 token，App 普通用户不调此）；群会话由群主调用。
 * 服务端二次强制权限 + authorship；前端入口显隐仅 UX。
 */
export function pinToShelf(
  api: ApiClient,
  scope: ShelfScope,
  scopeKey: string,
  req: PinToShelfRequest,
): Promise<ShelfItem> {
  return api.post<ShelfItem>(shelfBase(scope, scopeKey), {
    message_uuid: req.message_uuid,
    note: req.note ?? null,
  });
}

/** 取消上架（群主 / bot；服务端强制） */
export function unpinFromShelf(
  api: ApiClient,
  scope: ShelfScope,
  scopeKey: string,
  itemId: string,
): Promise<void> {
  return api.delete<void>(`${shelfBase(scope, scopeKey)}/${encodeURIComponent(itemId)}`);
}

/** 重排顺序（传全量有序 item_id 列表），返回排序后的完整列表 */
export function reorderShelf(
  api: ApiClient,
  scope: ShelfScope,
  scopeKey: string,
  orderedItemIds: string[],
): Promise<ShelfItemsResponse> {
  return api.patch<ShelfItemsResponse>(`${shelfBase(scope, scopeKey)}/order`, {
    ordered_item_ids: orderedItemIds,
  });
}
