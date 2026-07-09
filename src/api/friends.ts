/**
 * 好友 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';
import type { FriendsResponse } from '../types/chat';

/**
 * 获取好友列表
 * 返回格式：{ items: Friend[] }
 */
export function getFriends(api: ApiClient): Promise<FriendsResponse> {
  return api.get<FriendsResponse>('/api/friends');
}

/**
 * 发送好友请求
 * @param userId 当前用户 ID
 * @param targetUserId 目标用户 ID
 * @param reason 请求原因（可选）
 */
export function sendFriendRequest(
  api: ApiClient,
  userId: string,
  targetUserId: string,
  reason?: string,
): Promise<void> {
  return api.post('/api/friends/requests', {
    user_id: userId,
    target_user_id: targetUserId,
    reason: reason || '',
    request_time: new Date().toISOString(),
  });
}

/**
 * 获取待处理的好友请求
 * 返回格式：{ items: PendingRequest[] }
 */
export interface PendingRequest {
  request_id: string;
  request_user_id: string;
  request_message: string | null;
  request_time: string;
  /** 申请人昵称（users JOIN；未设/用户不存在为 null）。申请卡直接渲染，无需逐条补拉 public profile */
  requester_nickname: string | null;
  /** 申请人头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  requester_avatar_url: string | null;
}

/** client.ts 已解包 ApiResponse.data，直接是数组 */
export type PendingRequestsResponse = PendingRequest[];

export function getPendingRequests(api: ApiClient): Promise<PendingRequestsResponse> {
  return api.get<PendingRequestsResponse>('/api/friends/requests/pending');
}

/**
 * 同意好友请求
 * @param userId 当前用户 ID
 * @param applicantUserId 申请人用户 ID
 */
export function approveFriendRequest(
  api: ApiClient,
  userId: string,
  applicantUserId: string,
): Promise<void> {
  const body = {
    user_id: userId,
    applicant_user_id: applicantUserId,
  };
  return api.post('/api/friends/requests/approve', body);
}

/**
 * 拒绝好友请求
 * @param userId 当前用户 ID
 * @param applicantUserId 申请人用户 ID
 * @param rejectReason 拒绝原因（可选）
 */
export function rejectFriendRequest(
  api: ApiClient,
  userId: string,
  applicantUserId: string,
  rejectReason?: string,
): Promise<void> {
  const body: Record<string, string> = {
    user_id: userId,
    applicant_user_id: applicantUserId,
  };
  if (rejectReason) {
    body.reject_reason = rejectReason;
  }
  return api.post('/api/friends/requests/reject', body);
}

/**
 * 删除好友
 * @param userId 当前用户 ID
 * @param friendUserId 好友用户 ID
 * @param removeReason 删除原因（可选）
 */
export function removeFriend(
  api: ApiClient,
  userId: string,
  friendUserId: string,
  removeReason?: string,
): Promise<void> {
  return api.post('/api/friends/remove', {
    user_id: userId,
    friend_user_id: friendUserId,
    remove_time: new Date().toISOString(),
    remove_reason: removeReason || '',
  });
}

/**
 * 设置/清除好友备注（仅自己可见）
 *
 * @param userId 当前用户 ID
 * @param friendUserId 好友用户 ID
 * @param remark 备注名（空串=清除，≤30 字符）
 */
export function setFriendRemark(
  api: ApiClient,
  userId: string,
  friendUserId: string,
  remark: string,
): Promise<void> {
  return api.post('/api/friends/remark', {
    user_id: userId,
    friend_user_id: friendUserId,
    remark,
  });
}

/**
 * 黑名单成员（GET /api/friends/blacklist 返回项，client.ts 已解包 ApiResponse.data 为数组）
 */
export interface BlacklistedUser {
  user_id: string;
  user_nickname: string | null;
  user_avatar_url: string | null;
  created_at: string;
}

export type BlacklistResponse = BlacklistedUser[];

/**
 * 拉黑某用户（双向静默：拉黑后双方互发消息均被静默丢弃，对方收不到）
 * @param targetUserId 被拉黑方用户 ID
 */
export function addBlacklist(api: ApiClient, targetUserId: string): Promise<void> {
  return api.post('/api/friends/blacklist', { target_user_id: targetUserId });
}

/**
 * 取消拉黑
 * @param targetUserId 被拉黑方用户 ID
 */
export function removeBlacklist(api: ApiClient, targetUserId: string): Promise<void> {
  return api.delete(`/api/friends/blacklist/${encodeURIComponent(targetUserId)}`);
}

/**
 * 获取黑名单列表（含昵称/头像/拉黑时间）
 */
export function getBlacklist(api: ApiClient): Promise<BlacklistResponse> {
  return api.get<BlacklistResponse>('/api/friends/blacklist');
}

/**
 * 拉取黑名单并构建 user_id → 拉黑时间(服务器 created_at) 映射。
 * 群消息「只折叠拉黑此刻之后发的」按服务器时间比较，必须用 created_at 而非客户端时钟，
 * 否则时钟漂移会让折叠边界错判。useFriends 后台同步与 useChatMenu 拉黑动作共用此函数。
 */
export async function getBlacklistTimes(api: ApiClient): Promise<Record<string, string>> {
  const blacklist = await getBlacklist(api);
  const times: Record<string, string> = {};
  (Array.isArray(blacklist) ? blacklist : []).forEach((u) => { times[u.user_id] = u.created_at; });
  return times;
}

/**
 * 好友在线状态项（GET /api/friends/presence 与 WS presence_update 共用）。
 * online=true 时 last_seen_at 缺省（后端 skip_serializing_if）；离线时为最后断开时刻。
 */
export interface PresenceEntry {
  user_id: string;
  online: boolean;
  last_seen_at?: string;
}

/**
 * 获取全部好友在线状态首屏快照（App 打开时拉一次，之后靠 WS presence_update 增量维护）。
 */
export function getPresence(api: ApiClient): Promise<PresenceEntry[]> {
  return api.get<PresenceEntry[]>('/api/friends/presence');
}

/**
 * 特别关心某好友（标星；仅限好友，单向私有）
 * @param targetUserId 被特别关心的好友用户 ID
 */
export function addSpecialCare(api: ApiClient, targetUserId: string): Promise<void> {
  return api.post('/api/friends/special-care', { target_user_id: targetUserId });
}

/**
 * 取消特别关心
 * @param targetUserId 被特别关心的好友用户 ID
 */
export function removeSpecialCare(api: ApiClient, targetUserId: string): Promise<void> {
  return api.delete(`/api/friends/special-care/${encodeURIComponent(targetUserId)}`);
}
