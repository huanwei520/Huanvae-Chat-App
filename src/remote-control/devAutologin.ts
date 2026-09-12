/**
 * dev 门控自动登录（测试面；双条件门控：VITE_DEV_CONTROL=1 **且**
 * VITE_DEV_AUTOLOGIN=<user_id> 构建期注入才激活）。
 *
 * 用途：UI 自动化环境（Xvfb/无 WM）里密钥链读回后的账号选择页点击链路
 * 受渲染/焦点环境干扰时，以应用自身的既有命令与 API 完成「已保存账号直登」：
 * get_saved_accounts → get_account_password（系统钥匙串读回，密码不落盘、
 * 不进日志）→ login API → getProfile → 复用 App 的 createSessionAndLogin
 * 收口（setCurrentUser/initDatabase/会话锁/setSession 全走既有路径）。
 *
 * 凭据边界（§5.5 同源）：密码只在进程内 keyring→API 传递，本模块不打印、
 * 不存储、不写入任何令牌/密码；生产构建两 env 均未定义 → 分支死代码摇树，
 * 与 devGate.ts 同一信任级别（测试专用，不入生产路径）。
 *
 * @module remote-control/devAutologin
 */

import { invoke } from '@tauri-apps/api/core';
import { getProfile, login } from '../api/auth';
import { getDeviceInfo } from '../services/deviceInfo';
import type { UserProfile } from '../types/session';

/** 与 src-tauri storage.rs SavedAccount 对齐（前端消费子集） */
interface DevSavedAccount {
  server_url: string;
  user_id: string;
  nickname: string;
  avatar_path: string | null;
}

/** App.tsx createSessionAndLogin 同签名（登录唯一公共收口点） */
export type DevLoginSuccessFn = (
  serverUrl: string,
  userId: string,
  accessToken: string,
  refreshToken: string,
  profile: UserProfile,
  avatarPath: string | null,
) => Promise<void>;

/** 双门控是否激活（构建期注入判定，运行期无副作用） */
export function isDevAutologin(): boolean {
  return (
    import.meta.env.VITE_DEV_CONTROL === '1' &&
    Boolean(import.meta.env.VITE_DEV_AUTOLOGIN)
  );
}

/** 每 JS 上下文只跑一次：effect 依赖抖动/StrictMode 双挂载不重复登录打转 */
let ran = false;

/**
 * 自动登录：已保存账号 → 钥匙串读回密码 → login API → profile → 登录收口。
 * 失败向上抛（调用方 console.warn 留痕，不阻塞页面——账号选择页仍可手点）。
 */
export async function devAutologin(onLoginSuccess: DevLoginSuccessFn): Promise<void> {
  if (ran) {
    return;
  }
  ran = true;
  const userId = import.meta.env.VITE_DEV_AUTOLOGIN as string;
  const accounts = await invoke<DevSavedAccount[]>('get_saved_accounts');
  const acc = accounts.find((a) => a.user_id === userId);
  if (!acc) {
    throw new Error(`dev autologin: saved account not found: ${userId}`);
  }
  const password = await invoke<string>('get_account_password', {
    serverUrl: acc.server_url,
    userId: acc.user_id,
  });
  const { deviceInfo, macAddress } = await getDeviceInfo();
  const loginResponse = await login(
    acc.server_url,
    acc.user_id,
    password,
    deviceInfo,
    macAddress,
  );
  const profileResponse = await getProfile(acc.server_url, loginResponse.access_token);
  await onLoginSuccess(
    acc.server_url,
    acc.user_id,
    loginResponse.access_token,
    loginResponse.refresh_token,
    profileResponse.data,
    acc.avatar_path,
  );
}
