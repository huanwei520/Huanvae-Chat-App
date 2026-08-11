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
  /** 邀请人头像相对路径（users JOIN；需经 resolveServerAvatarUrl 收口；未设为 null） */
  inviter_avatar_url: string | null;
  message: string | null;
  created_at: string;
  expires_at: string;
}

/** 收到的群邀请响应（client.ts 已解包 ApiResponse.data） */
export interface GroupInvitationsResponse {
  invitations: GroupInvitation[];
}

/** 群聊公开信息（GET /api/groups/{id}/public 与 /search 返回；未加入群的详情弹窗数据源） */
export interface GroupInfo {
  group_id: string;
  group_name: string;
  /** 群头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  group_avatar_url: string | null;
  group_description: string | null;
  creator_id: string;
  created_at: string;
  /** open/approval_required/invite_only/admin_invite_only/closed */
  join_mode: string;
  status: string;
  member_count: number;
}

/** 我发出的加群申请项（GET /api/groups/requests/sent，恒 pending，无撤回接口） */
export interface SentJoinRequestInfo {
  request_id: string;
  group_id: string;
  group_name: string;
  /** 群头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  group_avatar_url: string | null;
  message: string | null;
  /** 恒为 pending（本接口只返回待审核申请） */
  status: string;
  created_at: string;
}

/** 我发出的加群申请响应（client.ts 已解包 ApiResponse.data） */
export interface SentJoinRequestsResponse {
  requests: SentJoinRequestInfo[];
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
 * 获取未加入群聊的公开信息（群详情弹窗数据源）。无成员门控，任意登录用户可查。
 * 群不存在 / 已解散（status != active）→ 404（同形）。
 */
export function getPublicGroupInfo(api: ApiClient, groupId: string): Promise<GroupInfo> {
  return api.get<GroupInfo>(`/api/groups/${encodeURIComponent(groupId)}/public`);
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
 * 对可发现的群发起加入/加群申请（搜索方式）。按群 join_mode 分流：
 * open→直接入群；approval_required→创建待审核申请；closed/invite_only/admin_invite_only→400。
 * 已是成员 / 已有 pending 申请 → 400。返回 { message }。
 */
export function applyToJoinGroup(
  api: ApiClient,
  groupId: string,
  message?: string,
): Promise<{ message: string }> {
  return api.post(`/api/groups/${encodeURIComponent(groupId)}/apply`, { message: message || '' });
}

/**
 * 获取我主动发起、仍 pending 的加群申请（供"我发出的"待通过列表）。无撤回接口（by design）。
 */
export function getSentJoinRequests(api: ApiClient): Promise<SentJoinRequestsResponse> {
  return api.get<SentJoinRequestsResponse>('/api/groups/requests/sent');
}

// ============================================
// 入群申请审批（群主 / 管理员侧）
// ============================================

/**
 * 一条待审批的入群申请
 *
 * 字段严格镜像后端 `JoinRequestInfo`
 * （`Huanvae-Chat-Rust/src/groups/models/response.rs:73`）—— 后端 struct 是唯一真值源。
 */
export interface GroupJoinRequestInfo {
  request_id: string;
  group_id: string;
  group_name: string | null;
  user_id: string;
  user_nickname: string | null;
  /** 'apply'（用户主动申请）/ 'invite'（被邀请）等，由后端下发 */
  request_type: string;
  inviter_id: string | null;
  inviter_nickname: string | null;
  message: string | null;
  user_accepted: boolean;
  status: string;
  created_at: string;
}

/** `GET /api/groups/{group_id}/requests` 响应（client.ts 已解包 ApiResponse.data） */
export interface GroupJoinRequestListResponse {
  requests: GroupJoinRequestInfo[];
}

/**
 * 拉取本群待审批的入群申请（**仅群主 / 管理员**，后端 `verify_admin_or_owner` 校验，
 * 非管理员调用返回 403）
 *
 * 这三个端点后端一直都在，但客户端此前**从未接过** —— 后果是
 * `join_mode = approval_required` 的群，用户申请后群主在 App 里**根本看不到**，
 * 申请永久 pending。
 */
export function getGroupJoinRequests(
  api: ApiClient,
  groupId: string,
): Promise<GroupJoinRequestListResponse> {
  return api.get<GroupJoinRequestListResponse>(
    `/api/groups/${encodeURIComponent(groupId)}/requests`,
  );
}

/**
 * 通过一条入群申请
 *
 * 返回体镜像后端 `SuccessResponse`（`Huanvae-Chat-Rust/src/common/response.rs:31`）：
 * `{ success: bool, message: String }` —— `message` 非 Option，故这里也不是可选。
 * 当前调用方不读它，但类型必须与真值源逐字段对齐（工作区 CLAUDE.md 核心规则一）。
 */
export function approveGroupJoinRequest(
  api: ApiClient,
  groupId: string,
  requestId: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(
    `/api/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(requestId)}/approve`,
  );
}

/**
 * 拒绝一条入群申请
 *
 * 后端 body 是 `ProcessJoinRequestBody { reason: Option<String> }`
 * （`Huanvae-Chat-Rust/src/groups/models/request.rs:105`）—— 必须带 body，
 * 不传理由时也要发 `{}`，否则 axum 的 `Json<T>` 提取会因缺 body 而 400。
 *
 * 返回体同 [`approveGroupJoinRequest`]：镜像后端 `SuccessResponse { success, message }`。
 */
export function rejectGroupJoinRequest(
  api: ApiClient,
  groupId: string,
  requestId: string,
  reason?: string,
): Promise<{ success: boolean; message: string }> {
  return api.post(
    `/api/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(requestId)}/reject`,
    { reason: reason ?? null },
  );
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
// 群内屏蔽某人消息（D6，单向、仅本群、仅自己可见）
// ============================================

/** 群内被屏蔽成员项（client.ts 已解包 ApiResponse.data 为数组） */
export interface GroupMessageBlock {
  user_id: string;
  user_nickname: string | null;
  user_avatar_url: string | null;
  created_at: string;
}

export type GroupMessageBlocksResponse = GroupMessageBlock[];

/**
 * 群内屏蔽某成员的消息（仅本群、仅自己可见；不能屏蔽自己；仅限本群成员）
 */
export function addGroupMessageBlock(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  return api.post(`/api/groups/${groupId}/message-blocks`, { target_user_id: targetUserId });
}

/**
 * 取消群内屏蔽
 */
export function removeGroupMessageBlock(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  return api.delete(`/api/groups/${groupId}/message-blocks/${encodeURIComponent(targetUserId)}`);
}

/**
 * 获取本人在该群屏蔽的成员名单
 */
export function getGroupMessageBlocks(
  api: ApiClient,
  groupId: string,
): Promise<GroupMessageBlocksResponse> {
  return api.get<GroupMessageBlocksResponse>(`/api/groups/${groupId}/message-blocks`);
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

// ============================================
// 群内私有备注（D7，单向、仅本群、仅自己可见）
// 效果：被备注成员在本群的显示名（气泡/成员列表/已读名单）对我显示为备注（备注→群昵称→用户昵称）。
// ============================================

/** 群内私有备注项（client.ts 已解包 ApiResponse.data 为数组；user_id = 被备注成员） */
export interface GroupMemberRemark {
  user_id: string;
  remark: string;
}

export type GroupMemberRemarksResponse = GroupMemberRemark[];

/**
 * 设置/更新群内备注（仅本群、仅自己可见；不能给自己设；空/超 50 字符拒绝；仅限本群成员；upsert）
 */
export function setGroupMemberRemark(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
  remark: string,
): Promise<void> {
  return api.put(`/api/groups/${groupId}/member-remarks`, { target_user_id: targetUserId, remark });
}

/**
 * 清除群内备注
 */
export function removeGroupMemberRemark(
  api: ApiClient,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  return api.delete(`/api/groups/${groupId}/member-remarks/${encodeURIComponent(targetUserId)}`);
}

/**
 * 获取本人在该群设置的备注名单
 */
export function getGroupMemberRemarks(
  api: ApiClient,
  groupId: string,
): Promise<GroupMemberRemarksResponse> {
  return api.get<GroupMemberRemarksResponse>(`/api/groups/${groupId}/member-remarks`);
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
