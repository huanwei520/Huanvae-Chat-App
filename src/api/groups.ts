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

/** 创建群聊响应（client.ts 已解包 ApiResponse.data） */
export interface CreateGroupResponse {
  group_id: string;
  group_name: string;
  created_at: string;
}

/** 我的群聊列表响应（client.ts 已解包 ApiResponse.data，这里直接是数组） */
export type MyGroupsResponse = Group[];

/** 群成员列表响应（client.ts 已解包 ApiResponse.data） */
export interface GroupMembersResponse {
  members: GroupMember[];
  total: number;
}

/** 群成员已读位置（用于群已读回执"N 人已读"统计 + 已读名单展示） */
export interface ReadPosition {
  user_id: string;
  /** 该成员在本群已读到的消息序列号 */
  last_read_seq: number;
  /** 已读者展示名（群昵称优先，否则用户昵称，再否则用户 id） */
  display_name: string;
  /** 头像 URL（未设置则为 null） */
  avatar_url: string | null;
  /** 精确已读时间（RFC3339；从未推进过已读位置则为 null） */
  last_read_at: string | null;
}

/** 群已读位置响应（client.ts 已解包 ApiResponse.data） */
export interface GroupReadPositionsResponse {
  positions: ReadPosition[];
  /** 群活跃成员总数（含发送者）；某条消息应读人数 = member_count − 1（排除发送者） */
  member_count: number;
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

/** 收到的群邀请响应（client.ts 已解包 ApiResponse.data） */
export interface GroupInvitationsResponse {
  invitations: GroupInvitation[];
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
 * 创建群聊
 */
export function createGroup(api: ApiClient, data: CreateGroupRequest): Promise<CreateGroupResponse> {
  return api.post<CreateGroupResponse>('/api/groups', data as unknown as Record<string, unknown>);
}

/**
 * 获取群成员列表
 */
export function getGroupMembers(api: ApiClient, groupId: string): Promise<GroupMembersResponse> {
  return api.get<GroupMembersResponse>(`/api/groups/${groupId}/members`);
}

/**
 * 获取群已读位置（各成员 last-read-seq + 成员总数），用于群已读回执"N 人已读"
 */
export function getGroupReadPositions(api: ApiClient, groupId: string): Promise<GroupReadPositionsResponse> {
  return api.get<GroupReadPositionsResponse>(`/api/groups/${groupId}/read-positions`);
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
 * 修改我的群内昵称
 * @param nickname 新昵称，传空字符串或 null 清除昵称
 */
export function updateGroupNickname(
  api: ApiClient,
  groupId: string,
  nickname: string | null,
): Promise<{ success: boolean; message: string }> {
  return api.put(`/api/groups/${groupId}/nickname`, { nickname: nickname || null });
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
  return api.post('/api/groups/join_by_code', { code });
}

// ============================================
// 群头像管理
// ============================================

import type { ProgressCallback } from '../types/api';
import { uploadWithProgress } from './upload';

/**
 * 上传群头像
 *
 * 权限：群主或管理员
 * 使用通用上传函数，支持上传进度回调
 */
export function uploadGroupAvatar(
  api: ApiClient,
  groupId: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; data: { avatar_url: string } }> {
  return uploadWithProgress(
    `${api.getBaseUrl()}/api/groups/${groupId}/avatar`,
    api.getAccessToken(),
    file,
    'avatar',
    onProgress,
  );
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

// ============================================
// 群内特别关心某成员（M3，单向、仅本群、仅自己可见）
// 效果：被关心成员在本群发言时，本地通知标题带 ⭐ 强提醒（判定在客户端）。
// ============================================

/** 群内被特别关心成员项（client.ts 已解包 ApiResponse.data 为数组） */
export interface GroupSpecialCare {
  user_id: string;
  user_nickname: string | null;
  user_avatar_url: string | null;
  created_at: string;
}

export type GroupSpecialCaresResponse = GroupSpecialCare[];

/**
 * 群内特别关心某成员（仅本群、仅自己可见；不能关心自己；仅限本群成员）
 */
export function addGroupSpecialCare(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  return api.post(`/api/groups/${groupId}/special-care`, { target_user_id: targetUserId });
}

/**
 * 取消群内特别关心
 */
export function removeGroupSpecialCare(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  return api.delete(`/api/groups/${groupId}/special-care/${encodeURIComponent(targetUserId)}`);
}

/**
 * 获取本人在该群特别关心的成员名单
 */
export function getGroupSpecialCares(
  api: ApiClient,
  groupId: string,
): Promise<GroupSpecialCaresResponse> {
  return api.get<GroupSpecialCaresResponse>(`/api/groups/${groupId}/special-care`);
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

// ============================================
// 群公告管理
// ============================================

/** 群公告 */
export interface GroupNotice {
  id: string;
  title: string;
  content: string;
  publisher_id: string;
  publisher_nickname: string;
  published_at: string;
  is_pinned: boolean;
  updated_at: string;
}

/** 群公告列表响应（client.ts 已解包 ApiResponse.data） */
export interface GroupNoticesResponse {
  notices: GroupNotice[];
}

/**
 * 获取群公告列表
 */
export function getGroupNotices(
  api: ApiClient,
  groupId: string,
): Promise<GroupNoticesResponse> {
  return api.get(`/api/groups/${groupId}/notices`);
}

/**
 * 发布群公告
 * 权限：群主或管理员
 */
export function createGroupNotice(
  api: ApiClient,
  groupId: string,
  data: { title: string; content: string; is_pinned?: boolean },
): Promise<{ success: boolean; data: { id: string; published_at: string } }> {
  return api.post(`/api/groups/${groupId}/notices`, data as Record<string, unknown>);
}

/**
 * 删除群公告
 * 权限：群主或管理员
 */
export function deleteGroupNotice(
  api: ApiClient,
  groupId: string,
  noticeId: string,
): Promise<{ success: boolean }> {
  return api.delete(`/api/groups/${groupId}/notices/${noticeId}`);
}

// ============================================
// 邀请码管理
// ============================================

/** 邀请码 */
export interface InviteCode {
  id: string;
  code: string;
  code_type: 'direct' | 'normal';
  creator_id: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
}

/** 邀请码列表响应（client.ts 已解包 ApiResponse.data） */
export interface InviteCodesResponse {
  codes: InviteCode[];
}

/** 生成邀请码响应（client.ts 已解包 ApiResponse.data） */
export interface GenerateInviteCodeResponse {
  id: string;
  code: string;
  code_type: 'direct' | 'normal';
  expires_at: string;
}

/**
 * 生成邀请码
 * 权限：
 * - 群主/管理员：生成"直通"邀请码（direct），使用者可直接入群
 * - 普通成员：生成"普通"邀请码（normal），使用者需审核
 */
export function generateInviteCode(
  api: ApiClient,
  groupId: string,
  options?: { max_uses?: number; expires_in_hours?: number },
): Promise<GenerateInviteCodeResponse> {
  return api.post(`/api/groups/${groupId}/invite_codes`, options || {});
}

/**
 * 获取邀请码列表
 * 权限：群主或管理员
 */
export function getInviteCodes(
  api: ApiClient,
  groupId: string,
): Promise<InviteCodesResponse> {
  return api.get(`/api/groups/${groupId}/invite_codes`);
}

/**
 * 撤销邀请码
 * 权限：邀请码创建者或群主/管理员
 */
export function revokeInviteCode(
  api: ApiClient,
  groupId: string,
  codeId: string,
): Promise<{ success: boolean }> {
  return api.delete(`/api/groups/${groupId}/invite_codes/${codeId}`);
}
