/**
 * Bot（机器人）API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 * createApiClient 已自动解包 ApiResponse.data，类型均为解包后的扁平结构
 *
 * 覆盖端点：
 * - 管理：创建 / 我的列表 / 详情 / 更新 / 删除
 * - 凭据：重置 token
 * - 好友：按 username 添加 bot 好友
 *
 * 关键语义：
 * - token 仅在创建 / 重置时明文返回一次（CreateBotResponse.token /
 *   ResetBotTokenResponse.token），后端只存哈希，之后无法再查看
 * - 创建限制：每 owner 最多 10 个 bot；20 次/小时；username 冲突返回 409
 * - 删除语义：bot 元数据删除 + 账号封禁，token 与加好友入口即刻失效
 */

import type { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** Bot 指令（供聊天输入 / 指令菜单展示） */
export interface BotCommand {
  command: string;
  description: string;
}

/** Bot 信息 */
export interface BotInfo {
  /** 形如 "bot_{uuid-simple}" */
  bot_user_id: string;
  /** 3-32 字符 [A-Za-z0-9_]，全局唯一 */
  username: string;
  nickname: string;
  description: string;
  /** JSON 数组，默认 [] */
  commands: BotCommand[];
  /** P0 阶段恒为 null（列已建，功能未实现） */
  webhook_url: string | null;
  /** 默认 false */
  can_join_groups: boolean;
  is_active: boolean;
  /** 谁可以给 bot 发消息：everyone / whitelist / owner_only */
  message_policy: string;
  /** policy=whitelist 时生效的用户白名单，≤200 条 */
  message_whitelist: string[];
  /** false 时非 owner 搜索/添加一律 404（不泄露存在性） */
  is_discoverable: boolean;
  /** ISO 8601 */
  created_at: string;
  updated_at: string;
}

/** 创建 bot 请求 */
export interface CreateBotRequest {
  username: string;
  nickname: string;
  description?: string;
}

/**
 * 创建 bot 响应。
 * token 仅在此响应中明文返回一次，之后无法再查看（只能重置）。
 */
export interface CreateBotResponse {
  bot_user_id: string;
  username: string;
  nickname: string;
  description: string;
  token: string;
  /** 回显服务端生效的消息策略值 */
  message_policy: string;
  /** 回显服务端生效的可发现性值 */
  is_discoverable: boolean;
}

/** 更新 bot 请求（字段全部可选，只更新传入项） */
export interface UpdateBotRequest {
  nickname?: string;
  description?: string;
  commands?: BotCommand[];
  /** 未提供不改 */
  message_policy?: 'everyone' | 'whitelist' | 'owner_only';
  /** 未提供不改；policy=whitelist 时生效，≤200 条 */
  message_whitelist?: string[];
  /** 未提供不改 */
  is_discoverable?: boolean;
}

/**
 * 重置 token 响应。
 * 新 token 仅在此响应中明文返回一次，旧 token 即刻失效。
 */
export interface ResetBotTokenResponse {
  token: string;
}

/** 按 username 添加 bot 好友的响应 */
export interface AddBotResponse {
  bot_user_id: string;
  username: string;
  nickname: string | null;
  request_id: string;
}

// ============================================
// Bot 管理
// ============================================

/**
 * 创建 bot。
 * 限制：每 owner 最多 10 个；20 次/小时；username 冲突返回 409。
 * 响应中的 token 仅此一次明文返回。
 */
export function createBot(
  api: ApiClient,
  data: CreateBotRequest,
): Promise<CreateBotResponse> {
  return api.post<CreateBotResponse>('/api/bots', data as unknown as Record<string, unknown>);
}

/** 列出自己的 bot */
export function listMyBots(api: ApiClient): Promise<BotInfo[]> {
  return api.get<BotInfo[]>('/api/bots');
}

/** 获取 bot 详情（仅 owner） */
export function getBot(api: ApiClient, botUserId: string): Promise<BotInfo> {
  return api.get<BotInfo>(`/api/bots/${botUserId}`);
}

/** 更新 bot 信息（仅 owner），返回更新后的完整 BotInfo */
export function updateBot(
  api: ApiClient,
  botUserId: string,
  data: UpdateBotRequest,
): Promise<BotInfo> {
  return api.put<BotInfo>(`/api/bots/${botUserId}`, data as unknown as Record<string, unknown>);
}

/**
 * 删除 bot（仅 owner）。
 * 语义：bot 元数据删除 + 账号封禁，token 与加好友入口即刻失效。
 * 后端不返回 data，仅 message "bot deleted"。
 */
export function deleteBot(api: ApiClient, botUserId: string): Promise<void> {
  return api.delete<void>(`/api/bots/${botUserId}`);
}

/**
 * 重置 bot token（仅 owner）。
 * 新 token 仅此一次明文返回，旧 token 即刻失效。
 * 注意：路由是连字符 reset-token（非下划线）。
 */
export function resetBotToken(
  api: ApiClient,
  botUserId: string,
): Promise<ResetBotTokenResponse> {
  return api.post<ResetBotTokenResponse>(`/api/bots/${botUserId}/reset-token`, {});
}

// ============================================
// Bot 好友
// ============================================

/**
 * 按 username 添加 bot 好友。
 * bot 好友策略恒 auto_accept，一次调用即成好友（无需对方确认）。
 * 无请求体（username 走 query）。
 * 错误：bot 不存在 / 停用 / 已删 → 404；已是好友 → 400。
 */
export function addBotByUsername(
  api: ApiClient,
  username: string,
): Promise<AddBotResponse> {
  return api.post<AddBotResponse>(
    `/api/friends/add-bot?username=${encodeURIComponent(username)}`,
    {},
  );
}

/** GET /api/bots/{bot_user_id}/commands 响应（用户 JWT，能聊天即可见，404 同形） */
export interface BotCommandsResponse {
  commands: BotCommand[];
}

/**
 * 查询某 bot 的指令列表（用户 JWT）。
 * 授权在后端：能与该 bot 聊天即可见；bot 不存在 / 无权限一律 404 同形（不泄露存在性）。
 * 前端只调用 + 渲染，不做任何过滤。
 */
export function getBotCommands(api: ApiClient, botUserId: string): Promise<BotCommandsResponse> {
  return api.get<BotCommandsResponse>(`/api/bots/${encodeURIComponent(botUserId)}/commands`);
}

// ============================================
// 工具函数
// ============================================

/** 判断用户 ID 是否为 bot 账号（bot_user_id 形如 `bot_{uuid}`，以 `bot_` 前缀区分） */
export function isBotUserId(userId: string): boolean {
  return userId.startsWith('bot_');
}
