/**
 * 移动端会话持久化服务
 *
 * 使用 tauri-plugin-store 实现会话自动恢复
 * 后台进程被杀后，重新打开应用时自动恢复会话，无需重新登录或生物验证
 *
 * ## 工作原理
 * 1. 登录成功后，将 Session 保存到本地文件（session.json）
 * 2. 应用重新打开时，自动读取并恢复 Session（无需验证）
 * 3. 验证 Token 有效性，如过期则尝试刷新或跳转登录页
 *
 * ## 与 QQ/微信 体验一致
 * - 登录后直接保存，无需额外操作
 * - 打开应用自动恢复，无需指纹/面容验证
 * - 只有主动登出才需要重新登录
 *
 * ## 安全性说明
 * - 数据存储在应用私有目录，其他应用无法访问
 * - Access Token 有过期时间，即使泄露影响有限
 * - 用户可通过"设备管理"在其他设备登出本设备
 *
 * ## 平台支持
 * - Android: 完全支持
 * - iOS: 完全支持
 * - 桌面端: 不需要（进程不会被意外杀死）
 *
 * @module services/sessionPersist
 */

import { isMobile } from '../utils/platform';
import { Store } from '@tauri-apps/plugin-store';
import type { Session } from '../types/session';

// Store 实例（延迟初始化，但模块已静态导入）
let storeInstance: Store | null = null;
const STORE_FILE = 'mobile-session.json';
const SESSION_KEY = 'session';

/**
 * 获取或创建 Store 实例
 *
 * 使用静态导入 + 延迟初始化，比动态 import() 更快
 */
async function getStore(): Promise<Store> {
  if (storeInstance) {
    return storeInstance;
  }

  storeInstance = await Store.load(STORE_FILE);
  return storeInstance;
}

/**
 * 保存会话到本地存储
 *
 * 登录成功后调用，将 Session 保存到文件
 * 无需生物识别验证
 *
 * @param session 会话信息
 */
export async function persistSession(session: Session): Promise<void> {
  if (!isMobile()) {
    return; // 桌面端不需要持久化
  }

  try {
    console.warn('[SessionPersist] 正在保存会话...');
    const store = await getStore();
    await store.set(SESSION_KEY, session);
    await store.save();
    console.warn('[SessionPersist] 会话已保存');
  } catch (error) {
    console.error('[SessionPersist] 保存会话失败:', error);
    // 不抛出错误，保存失败不影响当前使用
  }
}

/**
 * 恢复会话
 *
 * 应用启动时调用，尝试从本地存储恢复 Session
 * 无需生物识别验证，自动完成
 *
 * @returns 恢复的会话，如果不存在返回 null
 */
export async function restoreSession(): Promise<Session | null> {
  if (!isMobile()) {
    return null;
  }

  try {
    console.warn('[SessionPersist] 正在恢复会话...');
    const store = await getStore();
    const session = await store.get<Session>(SESSION_KEY);

    if (!session) {
      console.warn('[SessionPersist] 无保存的会话');
      return null;
    }

    console.warn('[SessionPersist] 会话已恢复, userId:', session.userId);
    return session;
  } catch (error) {
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
    const store = await getStore();
    await store.delete(SESSION_KEY);
    await store.save();
    console.warn('[SessionPersist] 持久化会话已清除');
  } catch (error) {
    console.error('[SessionPersist] 清除会话失败:', error);
  }
}

/**
 * 检查是否有保存的会话
 *
 * 用于快速判断，不加载完整会话数据
 */
export async function hasPersistedSession(): Promise<boolean> {
  if (!isMobile()) {
    return false;
  }

  try {
    const store = await getStore();
    return await store.has(SESSION_KEY);
  } catch {
    return false;
  }
}
