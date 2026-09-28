/**
 * 会话过期自动重登（401→refresh→再401 自愈链的「自动重登腿」）
 *
 * 背景（块 1790430647659-tu14ytyn-1）：后端同设备重登会撤销旧 refresh token
 * （Huanvae-Chat-Rust src/auth/services/token_service.rs:69-79），而 refresh 成功
 * 不轮换（src/auth/handlers/refresh_token.rs:44-61 只回 access_token）。guard 守护进程
 * 若持已撤销令牌对，401→refresh→再 401 后只能等前端送新令牌（daemon 侧熔断等待，
 * 见 HuanvaeGuard@7dd8538/acfb104）。
 *
 * 本模块把「等用户手动重登」变成「用已保存账号自动重登」：
 *   refresh 再 401 → SessionContext.onSessionExpired → performAutoRelogin(用已存凭据)
 *   → setSession（pushGuardCredentials 随 setSession/updateTokens 把新令牌送达守护进程）
 *   → daemon 拉取链恢复，配置热更新横幅自清。
 * 重登失败才回退为登出（保持既有行为）。
 *
 * 纯函数 pickAccountForSession 独立导出以便单测；副作用函数只在 App 运行时被
 * SessionContext 动态 import（避免把 tauri http 插件图拖进单测模块图）。
 */

import { invoke } from '@tauri-apps/api/core';
import { login, getProfile } from '../api/auth';
import { getDeviceInfo } from './deviceInfo';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { isMobile } from '../utils/platform';
import {
  storePassword as mobileStorePassword,
  retrievePassword as mobileRetrievePassword,
} from './mobileKeystore';
import type { SavedAccount } from '../types/account';

/** 自动重登结果：与 SessionContext.setSession 所需字段对齐 */
export interface AutoReloginResult {
  serverUrl: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  nickname: string;
  avatarPath: string | null;
  /** 已解析头像完整 URL 前的原始 profile（Session.profile 形状） */
  profile: Record<string, unknown>;
}

/**
 * 从已保存账号中挑出自动重登目标（纯函数，可单测）。
 * 规则：
 *   1) server_url 与 user_id 都匹配 → 该账号；
 *   2) 仅 server_url 匹配且该服务器下只有一个账号 → 该账号（userId 变更场景兜底）；
 *   3) 其余（无匹配/多义）→ null（放弃自动重登，回退登出）。
 */
export function pickAccountForSession(
  accounts: SavedAccount[],
  serverUrl: string,
  userId: string,
): SavedAccount | null {
  const exact = accounts.find(a => a.server_url === serverUrl && a.user_id === userId);
  if (exact) { return exact; }
  const sameServer = accounts.filter(a => a.server_url === serverUrl);
  return sameServer.length === 1 ? sameServer[0] : null;
}

/** 取已保存密码：桌面走后端 AES 文件，移动端走本地安全存储（与 useAccounts.getPassword 同构） */
async function getSavedPassword(serverUrl: string, userId: string): Promise<string> {
  if (isMobile()) {
    const pw = await mobileRetrievePassword(serverUrl, userId);
    if (!pw) { throw new Error('未找到保存的密码，请手动输入'); }
    return pw;
  }
  const pw = await invoke<string>('get_account_password', { serverUrl, userId });
  if (!pw) { throw new Error('未找到保存的密码'); }
  return pw;
}

/**
 * 用已保存账号静默重登。
 * 失败抛错（由调用方回退 clearSession），成功返回可直接 setSession 的字段集。
 * 登录走与手动登录完全相同的 login()（含 deviceInfo/macAddress——macAddress 即
 * 后端「同设备重登撤销旧对」的语义入口，新对签发后旧对作废是预期行为）。
 */
export async function performAutoRelogin(
  serverUrl: string,
  userId: string,
): Promise<AutoReloginResult> {
  const accounts = await invoke<SavedAccount[]>('get_saved_accounts');
  const account = pickAccountForSession(accounts || [], serverUrl, userId);
  if (!account) {
    throw new Error('无匹配的已保存账号，无法自动重登');
  }

  const password = await getSavedPassword(account.server_url, account.user_id);
  const { deviceInfo, macAddress } = await getDeviceInfo();

  const loginResponse = await login(
    account.server_url,
    account.user_id,
    password,
    deviceInfo,
    macAddress,
  );

  const profileResponse = await getProfile(account.server_url, loginResponse.access_token);
  const profile = profileResponse.data as unknown as Record<string, unknown>;

  return {
    serverUrl: account.server_url,
    userId: account.user_id,
    accessToken: loginResponse.access_token,
    refreshToken: loginResponse.refresh_token,
    nickname: profile.user_nickname as string ?? account.nickname,
    avatarPath: account.avatar_path,
    profile,
  };
}

/** 密码回写仅在移动端需要（桌面端密码未变不重写钥匙串，对齐 App.tsx 注释） */
export async function ensurePasswordStored(
  serverUrl: string,
  userId: string,
  password: string,
): Promise<void> {
  if (!isMobile()) { return; }
  const existing = await mobileRetrievePassword(serverUrl, userId).catch(() => null);
  if (existing !== password) {
    await mobileStorePassword(serverUrl, userId, password);
  }
}

/** 头像相对路径解析（与 App.tsx createSessionAndLogin 同构） */
export function resolveAvatar(profile: Record<string, unknown>): unknown {
  return {
    ...profile,
    user_avatar_url: resolveServerAvatarUrl(profile.user_avatar_url as string | null | undefined),
  };
}
