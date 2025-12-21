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

/** 进度回调类型 */
export type ProgressCallback = (progress: number) => void;

/**
 * 上传群头像
 * 权限：群主或管理员
 * 使用 XMLHttpRequest 以获取上传进度
 */
export function uploadGroupAvatar(
  api: ApiClient,
  groupId: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; data: { avatar_url: string } }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('avatar', file);

    const xhr = new XMLHttpRequest();

    // 监听上传进度
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    // 完成时处理响应
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || '上传群头像失败'));
        }
      } catch {
        reject(new Error('解析响应失败'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('网络错误'));
    };

    xhr.open('POST', `${api.getBaseUrl()}/api/groups/${groupId}/avatar`);
    xhr.setRequestHeader('Authorization', `Bearer ${api.getAccessToken()}`);
    xhr.send(formData);
  });
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

/** 群公告列表响应 */
export interface GroupNoticesResponse {
  success: boolean;
  code: number;
  data: {
    notices: GroupNotice[];
  };
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

/** 邀请码列表响应 */
export interface InviteCodesResponse {
  success: boolean;
  code: number;
  data: {
    codes: InviteCode[];
  };
}

/** 生成邀请码响应 */
export interface GenerateInviteCodeResponse {
  success: boolean;
  code: number;
  data: {
    id: string;
    code: string;
    code_type: 'direct' | 'normal';
    expires_at: string;
  };
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
