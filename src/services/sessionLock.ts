/**
 * 会话锁服务
 *
 * 实现同设备同账户单开：
 * - 同一账户在同一设备上只能运行一个实例
 * - 不同账户可以同时运行多个实例
 *
 * @module services/sessionLock
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * 会话检查结果
 */
export interface SessionCheckResult {
  /** 是否已有实例运行 */
  exists: boolean;
  /** 进程是否还在运行 */
  process_alive: boolean;
  /** 锁定的进程 ID */
  pid: number | null;
}

/**
 * 检查账户是否已有实例运行
 *
 * @param serverUrl - 服务器地址
 * @param userId - 用户 ID
 * @returns 检查结果
 *
 * @example
 * ```ts
 * const result = await checkSessionLock('https://example.com', 'user123');
 * if (result.exists && result.process_alive) {
 *   console.log('账户已在其他窗口登录');
 * }
 * ```
 */
export function checkSessionLock(
  serverUrl: string,
  userId: string,
): Promise<SessionCheckResult> {
  return invoke<SessionCheckResult>('check_session_lock', {
    serverUrl,
    userId,
  });
}

/**
 * 创建会话锁
 *
 * 登录成功后调用，防止同一账户重复登录
 *
 * @param serverUrl - 服务器地址
 * @param userId - 用户 ID
 */
export function createSessionLock(
  serverUrl: string,
  userId: string,
): Promise<void> {
  return invoke('create_session_lock', {
    serverUrl,
    userId,
  });
}

/**
 * 移除会话锁
 *
 * 登出或应用退出时调用
 *
 * @param serverUrl - 服务器地址
 * @param userId - 用户 ID
 */
export function removeSessionLock(
  serverUrl: string,
  userId: string,
): Promise<void> {
  return invoke('remove_session_lock', {
    serverUrl,
    userId,
  });
}

/**
 * 检查并处理会话冲突
 *
 * 登录前调用，检查是否有同账户实例在运行。
 * 如果有，返回不可继续并显示错误消息。
 *
 * @param serverUrl - 服务器地址
 * @param userId - 用户 ID
 * @returns 是否可以继续登录
 *
 * @example
 * ```ts
 * const { canProceed, message } = await checkAndHandleSessionConflict(serverUrl, userId);
 * if (!canProceed) {
 *   setError(message);
 *   return;
 * }
 * // 继续登录流程
 * ```
 */
export async function checkAndHandleSessionConflict(
  serverUrl: string,
  userId: string,
): Promise<{ canProceed: boolean; message?: string }> {
  try {
    const result = await checkSessionLock(serverUrl, userId);

    if (result.exists && result.process_alive) {
      // 已有实例运行，直接返回错误消息
      return {
        canProceed: false,
        message: '该账户已在其他窗口登录',
      };
    }

    return { canProceed: true };
  } catch (error) {
    // 检查失败，不阻止登录
    console.warn('[SessionLock] 检查会话锁失败:', error);
    return { canProceed: true };
  }
}
