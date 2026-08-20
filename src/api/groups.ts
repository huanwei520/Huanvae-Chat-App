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
  /** 是否需要入群审核；不传时服务端按 `true`（需审核）处理 */
  join_approval_required?: boolean;
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

/**
 * 三档可见性范围 —— **只给** `card_share_scope` / `qr_show_scope` 两列。
 *
 * 动作方是**本群成员**（谁能把群拿出去），所以 `all_members` 在这里的字面意思成立：
 * 「本群全体成员」。真值源：`backend-docs/groups/群聊管理.md` `GroupInfo` 字段表与
 * `PUT /join-policy` 请求体。
 *
 * 🔴 **`search_scope` 不用这个类型**，见 [`SearchScope`] —— 那一列的最松档叫 `everyone`。
 */
export type GroupScope = 'all_members' | 'admins' | 'owner_only';

/**
 * `search_scope`（谁**搜得到**本群）专用的三档 —— 与 [`GroupScope`] **刻意不共用**。
 *
 * 动作方是**群外的人**，方向与上面两列相反：`owner_only` 在前两列是「只有群主能分享 / 出码」，
 * 在这里是「只有群主搜得到本群 = **别人都搜不到**」。
 *
 * 🔴 **最松档叫 `everyone` 而不是 `all_members`，这是有意的**：那三列若共用 `all_members`
 * 就是**同名反义** —— 前两列读作「本群全体成员」，这一列的真义却是「**任何登录用户**」
 * （契约 `发现搜索.md`「群搜索可见性三档」原文：`all_members`（默认）= 任何登录用户）。
 * 读到 `search_scope === 'all_members'` 的人会把「谁都能搜到」理解成「只有成员能搜到」，
 * 语义正好反过来。`everyone` 沿用本仓 bots `message_policy`
 * （`everyone` / `whitelist` / `owner_only`，见 [`../api/bots`]）的既有约定，不是新造词。
 *
 * ⚠️ **契约文档尚未同步这条改名**（`群聊管理.md` / `发现搜索.md` 现仍写 `all_members`），
 * 后端整批也尚未上线 —— 两侧必须同批落地，否则 `PUT /join-policy` 会因取值不在白名单内返 400。
 */
export type SearchScope = 'everyone' | 'admins' | 'owner_only';

/**
 * 群聊信息（`GET /api/groups/{id}`、`GET /api/groups/{id}/public`、`GET /search`
 * 三处同构，见 `backend-docs/groups/群聊管理.md` 的 `GroupInfo` 字段表）。
 *
 * 入群策略那五个字段一律 `?:` —— 后端源码里已有 `PUT /join-policy`，但**是否已上线到当前
 * 生产环境未经验证**，读到 `undefined` 时由 [`JOIN_POLICY_DEFAULTS`] 提供显示回落。
 */
export interface GroupInfo {
  group_id: string;
  group_name: string;
  /** 群头像相对路径（需经 resolveServerAvatarUrl 收口；未设为 null） */
  group_avatar_url: string | null;
  group_description: string | null;
  creator_id: string;
  created_at: string;
  /** 是否需要入群审核（设置面板开关一）；`POST /{id}/apply` 的唯一判据 */
  join_approval_required?: boolean;
  /** 是否允许管理员参与审核（开关二）；`false` ⇒ 只有群主能列 / 批 / 拒入群申请 */
  admin_can_approve?: boolean;
  /** 谁能分享群名片（服务端强制，不满足发 `group_card` 消息时 403） */
  card_share_scope?: GroupScope;
  /** 谁能展示群二维码（服务端强制，不满足 `GET /{id}/qr` 时 403） */
  qr_show_scope?: GroupScope;
  /** 谁搜得到这个群（服务端在 `GET /api/discovery/search` 过滤；⚠️ 语义方向见 [`SearchScope`]） */
  search_scope?: SearchScope;
  status: string;
  member_count: number;
}

/**
 * 入群策略的完整五值 —— `PUT /api/groups/{id}/join-policy` 的**响应**形态。
 *
 * 契约承诺 `data` 是更新**之后**的完整五个值（`backend-docs/groups/群聊管理.md`
 * 「7.1 修改入群策略」响应字段说明），可直接整体回填设置面板，故此处五键**全必填**。
 */
export interface JoinPolicy {
  join_approval_required: boolean;
  admin_can_approve: boolean;
  card_share_scope: GroupScope;
  qr_show_scope: GroupScope;
  search_scope: SearchScope;
}

/**
 * 入群策略的**局部**更新 —— `PUT /join-policy` 的请求体形态，五键全可选。
 *
 * 契约：「只更新请求体里真正出现的那些，未出现的字段保持原值」⇒ 调用方只放要改的那几键，
 * 由 [`updateJoinPolicy`] 保证 `undefined` 的键**不进** body（塞进去后端会当"要更新"处理）。
 */
export interface JoinPolicyPatch {
  join_approval_required?: boolean;
  admin_can_approve?: boolean;
  card_share_scope?: GroupScope;
  qr_show_scope?: GroupScope;
  search_scope?: SearchScope;
}

/**
 * 入群策略五值的**显示回落**（全仓唯一一处放这些字面量的地方）
 *
 * 值来自 `backend-docs/groups/群聊管理.md` 的 `PUT /join-policy` 节及其上游字段表：
 * - `join_approval_required: true` —— 建群端点原文「可选，默认 true」
 * - `card_share_scope` / `qr_show_scope` 均 `'all_members'` —— 字段表与 §八三档表都标为（默认）
 * - `search_scope: 'everyone'` —— 契约把该列最松档的语义写作「**任何登录用户**」，
 *   本仓据此把它单独命名为 `everyone`（见 [`SearchScope`] 的同名反义说明），语义与契约默认档一致
 * - `admin_can_approve: true` —— 契约未写「默认」字样，取契约两处响应示例的值，
 *   且与该字段上线前的历史行为（管理员一直能审）等价
 *
 * 用途**只有一个**：后端尚未返回这些字段时（字段全是 `?:`，见 [`GroupInfo`]）拿它显示。
 *
 * 🔴 不许在组件里散写 `?? 'all_members'` / `?? 'everyone'` 这类裸回落 —— 回落值只许有这一个
 * 落点，否则默认值会在各处各写一份、契约一改就漏改。
 */
export const JOIN_POLICY_DEFAULTS: JoinPolicy = {
  join_approval_required: true,
  admin_can_approve: true,
  card_share_scope: 'all_members',
  qr_show_scope: 'all_members',
  search_scope: 'everyone',
};

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
 * 获取群聊详情（**本群活跃成员**可查）。
 *
 * 与 [`getPublicGroupInfo`] 并存、**不是**它的替代：那条走 `/public`、无成员门控、
 * 是扫码 / 群名片落地页的数据源；这条走 `/api/groups/{id}` 本体，返回同一个 `GroupInfo`，
 * 但要求调用者是本群活跃成员 —— 群设置面板要读自己群的当前配置，用的是这条。
 *
 * 错误（契约「404 与 403 的分界」）：`403` 群存在但你不是本群活跃成员；`404` 群不存在。
 */
export function getGroupDetail(api: ApiClient, groupId: string): Promise<GroupInfo> {
  return api.get<GroupInfo>(`/api/groups/${encodeURIComponent(groupId)}`);
}

/**
 * 获取未加入群聊的公开信息（群详情弹窗数据源）。无成员门控，任意登录用户可查。
 * 群不存在 / 已解散（status != active）→ 404（同形）。
 */
export function getPublicGroupInfo(api: ApiClient, groupId: string): Promise<GroupInfo> {
  return api.get<GroupInfo>(`/api/groups/${encodeURIComponent(groupId)}/public`);
}

/**
 * 修改入群策略（**仅群主**，管理员也会被后端 403）
 *
 * 🔴 **逐键构造 body，只放 `patch` 里真正出现的键**：契约是「只更新请求体里真正出现的那些」，
 * 所以把一个 `undefined` 的键塞进 JSON 也算"出现"（会被后端当成要更新该字段）。
 * `JSON.stringify` 确实会丢掉值为 `undefined` 的键，但那是序列化层的巧合、不是本函数的契约 ——
 * 依赖它等于把「只发被改的键」这条约束交给一个随实现可变的行为去保证，故这里显式过滤。
 *
 * 错误（契约「错误响应」）：`400` 三档取值不在白名单内 · `403` 你不是群主 · `404` 群不存在。
 *
 * @returns 更新**之后**的完整五值，可直接整体回填面板
 */
export function updateJoinPolicy(
  api: ApiClient,
  groupId: string,
  patch: JoinPolicyPatch,
): Promise<JoinPolicy> {
  const body: Record<string, unknown> = {};
  if (patch.join_approval_required !== undefined) {
    body.join_approval_required = patch.join_approval_required;
  }
  if (patch.admin_can_approve !== undefined) {
    body.admin_can_approve = patch.admin_can_approve;
  }
  if (patch.card_share_scope !== undefined) {
    body.card_share_scope = patch.card_share_scope;
  }
  if (patch.qr_show_scope !== undefined) {
    body.qr_show_scope = patch.qr_show_scope;
  }
  if (patch.search_scope !== undefined) {
    body.search_scope = patch.search_scope;
  }
  return api.put<JoinPolicy>(
    `/api/groups/${encodeURIComponent(groupId)}/join-policy`,
    body,
  );
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
 * 对可发现的群发起加入/加群申请（搜索方式）。**只看审批开关一个判据，两态**：
 * 免审核 → 直接入群，`status: 'joined'`；需审核 → 创建待审核申请，`status: 'pending'`。
 * 已是成员 / 已有 pending 申请 → 400。
 *
 * 🔴 **判两态一律读 `status`，不要解析 `message` 文案**（契约
 * `backend-docs/groups/群聊管理.md`「申请入群（搜索方式）」响应字段说明原文）。
 * 该端点的 `data` 已从 `{success, message}` 换成 `{status, message}` —— `success` 已被移除。
 *
 * ⚠️ 后端整批尚未上线的窗口期里 `status` 实际会是 `undefined`（旧响应没有这个键），
 * 所以调用方必须写 `=== 'joined'` 而不是 `!== 'pending'`：前者把未知落到"待审批"一侧
 * （保守、可恢复），后者会把没入群的判成已入群。
 */
export function applyToJoinGroup(
  api: ApiClient,
  groupId: string,
  message?: string,
): Promise<{ status: 'joined' | 'pending'; message: string }> {
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
 * **开了入群审核**的群，用户申请后群主在 App 里**根本看不到**，
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
