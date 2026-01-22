/**
 * 移动端会话持久化服务
 *
 * 使用 tauri-plugin-biometric 实现安全的会话存储和恢复
 * 后台进程被杀后，重新打开应用时可通过生物识别恢复会话，无需重新登录
 *
 * ## 工作原理
 * 1. 登录成功后，将 Session 加密存储到 Android Keystore
 * 2. 应用重新打开时，通过生物识别验证后恢复 Session
 * 3. 验证 Token 有效性，如过期则尝试刷新
 *
 * ## 安全性
 * - 数据存储在 Android Keystore（硬件级加密）
 * - 每次恢复都需要生物识别验证（指纹/面容）
 * - 不支持的设备无法使用此功能
 *
 * ## 平台支持
 * - Android: 完全支持（需设备有生物识别硬件）
 * - iOS: 完全支持（Touch ID / Face ID）
 * - 桌面端: 不需要（进程不会被意外杀死）
 *
 * @module services/sessionPersist
 */

import { isMobile } from '../utils/platform';
import type { Session } from '../types/session';

// 存储域名和键名
const DOMAIN = 'huanvae_chat';
const SESSION_KEY = 'session';

/**
 * 检查生物识别是否可用
 *
 * @returns 是否可用
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!isMobile()) {
    return false;
  }

  try {
    const { checkStatus } = await import('@tauri-apps/plugin-biometric');
    const status = await checkStatus();
    console.warn('[SessionPersist] 生物识别状态:', status);
    return status.isAvailable;
  } catch (error) {
    console.error('[SessionPersist] 检查生物识别失败:', error);
    return false;
  }
}

/**
 * 保存会话到安全存储
 *
 * 登录成功后调用，将 Session 加密存储
 * 需要生物识别验证
 *
 * @param session 会话信息
 */
export async function persistSession(session: Session): Promise<void> {
  if (!isMobile()) {
    return; // 桌面端不需要持久化
  }

  try {
    const { setData } = await import('@tauri-apps/plugin-biometric');
    const sessionJson = JSON.stringify(session);

    console.warn('[SessionPersist] 正在保存会话...');
    await setData({
      domain: DOMAIN,
      name: SESSION_KEY,
      data: sessionJson,
    });
    console.warn('[SessionPersist] 会话已安全存储');
  } catch (error) {
    console.error('[SessionPersist] 保存会话失败:', error);
    // 不抛出错误，保存失败不影响当前使用
  }
}

/**
 * 恢复会话
 *
 * 应用启动时调用，尝试从安全存储恢复 Session
 * 需要生物识别验证
 *
 * @returns 恢复的会话，如果不存在或验证失败返回 null
 */
export async function restoreSession(): Promise<Session | null> {
  if (!isMobile()) {
    return null;
  }

  try {
    // 1. 检查是否有保存的会话
    const { hasData, getData } = await import('@tauri-apps/plugin-biometric');

    const exists = await hasData({
      domain: DOMAIN,
      name: SESSION_KEY,
    });

    if (!exists) {
      console.warn('[SessionPersist] 无保存的会话');
      return null;
    }

    // 2. 获取会话数据（会弹出生物识别验证）
    console.warn('[SessionPersist] 正在恢复会话（需要生物验证）...');
    const result = await getData({
      domain: DOMAIN,
      name: SESSION_KEY,
      reason: '恢复登录会话',
    });

    if (!result.data) {
      console.warn('[SessionPersist] 会话数据为空');
      return null;
    }

    // 3. 解析会话
    const session: Session = JSON.parse(result.data);
    console.warn('[SessionPersist] 会话已恢复, userId:', session.userId);
    return session;
  } catch (error) {
    // 用户取消验证或其他错误
    console.warn('[SessionPersist] 恢复会话失败:', error);
    return null;
  }
}

/**
 * 清除持久化的会话
 *
 * 用户登出时调用
 */
export async function clearPersistedSession(): Promise<void> {
  if (!isMobile()) {
    return;
  }

  try {
    const { removeData, hasData } = await import('@tauri-apps/plugin-biometric');

    const exists = await hasData({
      domain: DOMAIN,
      name: SESSION_KEY,
    });

    if (exists) {
      await removeData({
        domain: DOMAIN,
        name: SESSION_KEY,
      });
      console.warn('[SessionPersist] 持久化会话已清除');
    }
  } catch (error) {
    console.error('[SessionPersist] 清除会话失败:', error);
  }
}

/**
 * 检查是否有持久化的会话（不需要验证）
 *
 * @returns 是否存在持久化会话
 */
export async function hasPersistedSession(): Promise<boolean> {
  if (!isMobile()) {
    return false;
  }

  try {
    const { hasData } = await import('@tauri-apps/plugin-biometric');

    return await hasData({
      domain: DOMAIN,
      name: SESSION_KEY,
    });
  } catch (error) {
    console.error('[SessionPersist] 检查会话失败:', error);
    return false;
  }
}
