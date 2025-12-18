/**
 * 群聊 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** 群聊基本信息 */
export interface Group {
  group_id: string;
  group_name: string;
  group_avatar_url: string;
  role: 'owner' | 'admin' | 'member';
  unread_count: number | null;
  last_message_content: string | null;
  last_message_time: string | null;
}

/** 群聊详情 */
export interface GroupDetail {
  group_id: string;
  group_name: string;
  group_avatar_url: string;
  group_description: string | null;
  creator_id: string;
  created_at: string;
  join_mode: string;
  status: string;
  member_count: number;
}

/** 群成员 */
export interface GroupMember {
  user_id: string;
  user_nickname: string;
  user_avatar_url: string;
  role: 'owner' | 'admin' | 'member';
  group_nickname: string | null;
  joined_at: string;
  join_method: string;
  muted_until: string | null;
}

/** 创建群聊请求 */
export interface CreateGroupRequest {
  group_name: string;
  group_description?: string;
  join_mode?: 'open' | 'approval_required' | 'invite_only' | 'admin_invite_only' | 'closed';
}

/** 创建群聊响应 */
export interface CreateGroupResponse {
  success: boolean;
  code: number;
  data: {
    group_id: string;
    group_name: string;
    created_at: string;
  };
}

/** 我的群聊列表响应 */
export interface MyGroupsResponse {
  success: boolean;
  code: number;
  data: Group[];
}

/** 群聊详情响应 */
export interface GroupDetailResponse {
  success: boolean;
  code: number;
  data: GroupDetail;
}

/** 群成员列表响应 */
export interface GroupMembersResponse {
  success: boolean;
  code: number;
  data: {
    members: GroupMember[];
    total: number;
  };
}

/** 收到的群邀请 */
export interface GroupInvitation {
  request_id: string;
  group_id: string;
  group_name: string;
  group_avatar_url: string;
  inviter_id: string;
  inviter_nickname: string;
  message: string | null;
  created_at: string;
  expires_at: string;
}

/** 收到的群邀请响应 */
export interface GroupInvitationsResponse {
  success: boolean;
  code: number;
  data: {
    invitations: GroupInvitation[];
  };
}

// ============================================
// API 函数
// ============================================

/**
 * 获取我的群聊列表
 */
export function getMyGroups(api: ApiClient): Promise<MyGroupsResponse> {
  return api.get<MyGroupsResponse>('/api/groups/my');
}

/**
 * 获取群聊详情
 */
export function getGroupDetail(api: ApiClient, groupId: string): Promise<GroupDetailResponse> {
  return api.get<GroupDetailResponse>(`/api/groups/${groupId}`);
}

/**
 * 创建群聊
 */
export function createGroup(api: ApiClient, data: CreateGroupRequest): Promise<CreateGroupResponse> {
  return api.post<CreateGroupResponse>('/api/groups', data as Record<string, unknown>);
}

/**
 * 获取群成员列表
 */
export function getGroupMembers(api: ApiClient, groupId: string): Promise<GroupMembersResponse> {
  return api.get<GroupMembersResponse>(`/api/groups/${groupId}/members`);
}

/**
 * 更新群聊信息
 */
export function updateGroup(
  api: ApiClient,
  groupId: string,
  data: {
    group_name?: string;
    group_description?: string;
    group_avatar_url?: string;
  },
): Promise<{ success: boolean }> {
  return api.put(`/api/groups/${groupId}`, data);
}

/**
 * 邀请成员入群
 */
export function inviteToGroup(
  api: ApiClient,
  groupId: string,
  userIds: string[],
  message?: string,
): Promise<{ success: boolean }> {
  return api.post(`/api/groups/${groupId}/invite`, {
    user_ids: userIds,
    message: message || '',
  });
}

/**
 * 退出群聊
 */
export function leaveGroup(
  api: ApiClient,
  groupId: string,
  reason?: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(`/api/groups/${groupId}/leave`, { reason: reason || '' });
}

/**
 * 获取收到的群邀请
 */
export function getGroupInvitations(api: ApiClient): Promise<GroupInvitationsResponse> {
  return api.get<GroupInvitationsResponse>('/api/groups/invitations');
}

/**
 * 接受群邀请
 */
export function acceptGroupInvitation(
  api: ApiClient,
  requestId: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(`/api/groups/invitations/${requestId}/accept`);
}

/**
 * 拒绝群邀请
 */
export function declineGroupInvitation(
  api: ApiClient,
  requestId: string,
): Promise<{ success: boolean }> {
  return api.post(`/api/groups/invitations/${requestId}/decline`);
}

/**
 * 通过邀请码入群
 */
export function joinGroupByCode(
  api: ApiClient,
  code: string,
): Promise<{ success: boolean; message: string }> {
  return api.post('/api/groups/join-by-code', { code });
}

// ============================================
// 群头像管理
// ============================================

/**
 * 上传群头像
 * 权限：群主或管理员
 */
export async function uploadGroupAvatar(
  api: ApiClient,
  groupId: string,
  file: File,
): Promise<{ success: boolean; data: { avatar_url: string } }> {
  const formData = new FormData();
  formData.append('avatar', file);

  // 使用原生 fetch 处理 FormData
  const response = await fetch(`${api.getBaseUrl()}/api/groups/${groupId}/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${api.getAccessToken()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || '上传群头像失败');
  }

  return response.json();
}

// ============================================
// 成员管理
// ============================================

/**
 * 移除成员
 * 权限：群主可移除任何成员，管理员只能移除普通成员
 */
export function removeMember(
  api: ApiClient,
  groupId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/api/groups/${groupId}/members/${userId}`);
}

/**
 * 设置管理员
 * 权限：仅群主
 */
export function setAdmin(
  api: ApiClient,
  groupId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(`/api/groups/${groupId}/admins`, { user_id: userId });
}

/**
 * 取消管理员
 * 权限：仅群主
 */
export function removeAdmin(
  api: ApiClient,
  groupId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/api/groups/${groupId}/admins/${userId}`);
}

/**
 * 转让群主
 * 权限：仅群主
 */
export function transferOwner(
  api: ApiClient,
  groupId: string,
  newOwnerId: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(`/api/groups/${groupId}/transfer`, { new_owner_id: newOwnerId });
}

// ============================================
// 禁言管理
// ============================================

/**
 * 禁言成员
 * 权限：群主可禁言任何成员，管理员只能禁言普通成员
 */
export function muteMember(
  api: ApiClient,
  groupId: string,
  userId: string,
  durationMinutes: number,
): Promise<{ success: boolean; message: string; muted_until: string }> {
  return api.post(`/api/groups/${groupId}/mute`, {
    user_id: userId,
    duration_minutes: durationMinutes,
  });
}

/**
 * 解除禁言
 * 权限：群主或管理员
 */
export function unmuteMember(
  api: ApiClient,
  groupId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/api/groups/${groupId}/mute/${userId}`);
}

/**
 * 解散群聊
 * 权限：仅群主
 */
export function disbandGroup(
  api: ApiClient,
  groupId: string,
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/api/groups/${groupId}`);
}
