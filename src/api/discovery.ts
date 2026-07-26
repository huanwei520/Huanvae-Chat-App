/**
 * Discovery（统一发现搜索）API 封装
 *
 * 一次调用同时返回「人 / 群 / bot」三类结果（bot 独立成段，不并入 people）。
 * 字段镜像后端 src/discovery/models/mod.rs，冲突以后端为准。
 */
import type { ApiClient } from './client';

/** 匹配到的普通用户（不含 bot） */
export interface PersonCard {
  user_id: string;
  nickname: string;
  /** 头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  avatar_url: string | null;
  /** 当前 viewer 是否已与其为好友 */
  is_friend: boolean;
}

/** 匹配到的群 */
export interface GroupCard {
  group_id: string;
  group_name: string;
  /** 群头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  avatar_url: string | null;
  member_count: number;
  /** open/approval_required/invite_only/admin_invite_only/closed */
  join_mode: string;
  /** 当前 viewer 是否已在该群 */
  is_member: boolean;
}

/** 匹配到的 bot */
export interface BotCard {
  bot_user_id: string;
  username: string;
  nickname: string;
  /** bot 头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  avatar_url: string | null;
  /** 当前 viewer 是否已加该 bot 为好友 */
  is_friend: boolean;
}

/** 统一发现搜索响应（client.ts 已解包 ApiResponse.data） */
export interface DiscoverySearchResponse {
  people: PersonCard[];
  groups: GroupCard[];
  bots: BotCard[];
}

/**
 * 统一关键词发现搜索（后端 R2 起为「完全匹配」：昵称/群名/username 完全匹配或 id 精确匹配，
 * 不再子串联想）。keyword trim 后为空后端返回 400（前端应在调用前守空）。
 * @param limit 每类结果各自条数上限，默认后端 20，钳制 1..=50（服务端钳制）
 */
export function searchDiscovery(
  api: ApiClient,
  keyword: string,
  limit?: number,
): Promise<DiscoverySearchResponse> {
  const params = new URLSearchParams({ keyword });
  if (limit !== undefined) { params.set('limit', String(limit)); }
  return api.get<DiscoverySearchResponse>(`/api/discovery/search?${params.toString()}`);
}
