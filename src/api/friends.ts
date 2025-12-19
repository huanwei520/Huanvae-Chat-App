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
}

export interface PendingRequestsResponse {
  items: PendingRequest[];
}

export function getPendingRequests(api: ApiClient): Promise<PendingRequestsResponse> {
  return api.get<PendingRequestsResponse>('/api/friends/requests/pending');
}

/**
 * 同意好友请求
 * @param userId 当前用户 ID
 * @param applicantUserId 申请人用户 ID
 * @param approvedReason 同意原因（可选）
 */
export function approveFriendRequest(
  api: ApiClient,
  userId: string,
  applicantUserId: string,
  approvedReason?: string,
): Promise<void> {
  const body: Record<string, string> = {
    user_id: userId,
    applicant_user_id: applicantUserId,
    approved_time: new Date().toISOString(),
  };
  if (approvedReason) {
    body.approved_reason = approvedReason;
  }
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
