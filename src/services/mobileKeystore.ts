/**
 * 移动端密码安全存储服务
 *
 * 使用 tauri-plugin-store 实现应用私有目录存储
 * 数据存储在应用沙箱内，其他应用无法访问
 *
 * ## 存储设计
 * - 密码以 JSON 键值对形式存储在 mobile-credentials.json
 * - key 格式: "serverHost#userId"
 * - 设备 UUID 存储在同一文件中
 *
 * ## 平台支持
 * - Android: 完全支持
 * - iOS: 完全支持
 * - 桌面端: 不支持（使用 keyring）
 */

import { isMobile } from '../utils/platform';
import { Store } from '@tauri-apps/plugin-store';

const STORE_FILE = 'mobile-credentials.json';
const PASSWORDS_KEY = 'passwords';
const DEVICE_UUID_KEY = 'deviceUuid';

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (storeInstance) {
    return storeInstance;
  }
  storeInstance = await Store.load(STORE_FILE);
  return storeInstance;
}

interface PasswordMap {
  [key: string]: string;
}

function makeKey(serverUrl: string, userId: string): string {
  const cleanUrl = serverUrl
    .replace(/^https?:\/\//, '')
    .replace(/[/:]/g, '_');
  return `${cleanUrl}#${userId}`;
}

/**
 * 保存账号密码到安全存储
 */
export async function storePassword(
  serverUrl: string,
  userId: string,
  password: string,
): Promise<void> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);
  const store = await getStore();
  const map = (await store.get<PasswordMap>(PASSWORDS_KEY)) || {};
  map[key] = password;
  await store.set(PASSWORDS_KEY, map);
  await store.save();
}

/**
 * 从安全存储获取密码
 */
export async function retrievePassword(
  serverUrl: string,
  userId: string,
): Promise<string | null> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);
  const store = await getStore();
  const map = (await store.get<PasswordMap>(PASSWORDS_KEY)) || {};
  return map[key] ?? null;
}

/**
 * 从安全存储删除密码
 */
export async function removePassword(
  serverUrl: string,
  userId: string,
): Promise<void> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);
  const store = await getStore();
  const map = (await store.get<PasswordMap>(PASSWORDS_KEY)) || {};

  if (key in map) {
    delete map[key];
    await store.set(PASSWORDS_KEY, map);
    await store.save();
  }
}

/**
 * 清除所有存储的密码
 */
export async function clearAllPasswords(): Promise<void> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const store = await getStore();
  await store.delete(PASSWORDS_KEY);
  await store.save();
}

/**
 * 检查存储是否可用
 */
export async function isStorageAvailable(): Promise<boolean> {
  if (!isMobile()) {
    return false;
  }

  try {
    await getStore();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取设备 UUID
 */
export async function retrieveDeviceUuid(): Promise<string | null> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const store = await getStore();
  return (await store.get<string>(DEVICE_UUID_KEY)) ?? null;
}

/**
 * 存储设备 UUID
 */
export async function storeDeviceUuid(uuid: string): Promise<void> {
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const store = await getStore();
  await store.set(DEVICE_UUID_KEY, uuid);
  await store.save();
}
