/**
 * 移动端密码安全存储服务
 *
 * 使用 tauri-plugin-keystore 实现 Android Keystore / iOS Keychain 安全存储
 *
 * ## API 说明 (v2.1.0-alpha.1)
 * - store(value): 存储一个值（需要生物识别验证）
 * - retrieve(service, user): 获取密码（需要生物识别验证）
 * - remove(service, user): 删除密码
 *
 * ## 存储设计
 * - 由于 store() 只接受单个值，我们将所有密码存储为 JSON 对象
 * - 使用固定的 service/user 来存储/获取这个 JSON
 *
 * ## 平台支持
 * - Android: API 28+ (Android 9.0+)
 * - iOS: 支持
 * - 桌面端: 不支持（使用 keyring）
 */

import { isMobile } from '../utils/platform';

// 固定的 service 和 user 名称
const SERVICE_NAME = 'HuanvaeChat';
const USER_NAME = 'passwords';

// 密码映射类型
interface PasswordMap {
  [key: string]: string; // key 格式: "serverUrl#userId"
}

// 内存缓存，避免多次生物识别验证
let cachedPasswordMap: PasswordMap | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30000; // 缓存有效期 30 秒

// 生成存储 key
function makeKey(serverUrl: string, userId: string): string {
  // 清理 URL，移除协议和特殊字符
  const cleanUrl = serverUrl
    .replace(/^https?:\/\//, '')
    .replace(/[/:]/g, '_');
  return `${cleanUrl}#${userId}`;
}

// 动态导入 keystore 模块（避免在桌面端导入失败）
async function getKeystoreModule() {
  console.warn('[Keystore] 检查平台, isMobile:', isMobile());
  if (!isMobile()) {
    throw new Error('Keystore 仅在移动端可用');
  }

  try {
    console.warn('[Keystore] 正在导入模块...');
    const module = await import('@impierce/tauri-plugin-keystore');
    console.warn('[Keystore] 模块导入成功');
    return module;
  } catch (error) {
    console.error('[Keystore] 导入失败:', error);
    throw new Error('无法加载 keystore 模块');
  }
}

/**
 * 获取所有存储的密码映射
 * 注意：此操作需要生物识别认证，可能会弹出指纹/面容验证
 * 使用内存缓存减少生物验证次数
 */
async function getPasswordMap(forceRefresh = false): Promise<PasswordMap> {
  const now = Date.now();

  // 检查缓存是否有效
  if (!forceRefresh && cachedPasswordMap !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.warn('[Keystore] 使用缓存的密码映射');
    return cachedPasswordMap;
  }

  console.warn('[Keystore] 获取密码映射...');
  const keystore = await getKeystoreModule();

  console.warn('[Keystore] 调用 retrieve(service, user)...');
  const stored = await keystore.retrieve(SERVICE_NAME, USER_NAME);
  console.warn('[Keystore] retrieve() 返回:', stored ? '有数据' : '无数据');

  if (!stored) {
    cachedPasswordMap = {};
    cacheTimestamp = now;
    return {};
  }

  try {
    const parsed = JSON.parse(stored);
    const keys = Object.keys(parsed);
    console.warn('[Keystore] 解析成功, 已存储账号数:', keys.length);
    cachedPasswordMap = typeof parsed === 'object' && parsed !== null ? parsed : {};
    cacheTimestamp = now;
    return cachedPasswordMap;
  } catch {
    console.error('[Keystore] JSON 解析失败');
    cachedPasswordMap = {};
    cacheTimestamp = now;
    return {};
  }
}

/**
 * 保存密码映射到 keystore
 * 注意：此操作需要生物识别认证
 */
async function savePasswordMap(map: PasswordMap): Promise<void> {
  console.warn('[Keystore] 保存密码映射, 账号数:', Object.keys(map).length);
  const keystore = await getKeystoreModule();
  const json = JSON.stringify(map);
  console.warn('[Keystore] 调用 store()...');
  await keystore.store(json);
  console.warn('[Keystore] store() 完成');

  // 更新缓存
  cachedPasswordMap = { ...map };
  cacheTimestamp = Date.now();
}

/**
 * 保存账号密码到安全存储
 * 注意：此操作需要生物识别认证（指纹/面容）
 *
 * @param serverUrl 服务器地址
 * @param userId 用户 ID
 * @param password 密码
 */
export async function storePassword(
  serverUrl: string,
  userId: string,
  password: string,
): Promise<void> {
  console.warn('[Keystore] storePassword 被调用, serverUrl:', serverUrl, 'userId:', userId);
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);

  // 优先使用缓存，避免额外的生物识别验证
  let map: PasswordMap = {};
  if (cachedPasswordMap !== null && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    console.warn('[Keystore] 使用缓存更新密码');
    map = { ...cachedPasswordMap };
  } else {
    try {
      map = await getPasswordMap();
    } catch {
      console.warn('[Keystore] 获取现有密码失败，创建新映射');
      map = {};
    }
  }

  map[key] = password;
  await savePasswordMap(map);

  console.warn('[Keystore] 密码已保存:', key);
}

/**
 * 从安全存储获取密码
 * 注意：此操作需要生物识别认证（指纹/面容）
 *
 * @param serverUrl 服务器地址
 * @param userId 用户 ID
 * @returns 密码，如果不存在返回 null
 * @throws 如果生物识别验证失败或用户取消
 */
export async function retrievePassword(
  serverUrl: string,
  userId: string,
): Promise<string | null> {
  console.warn('[Keystore] retrievePassword 被调用, serverUrl:', serverUrl, 'userId:', userId);
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);
  console.warn('[Keystore] 查找密码, key:', key);

  const map = await getPasswordMap();
  const found = map[key] ?? null;
  console.warn('[Keystore] 密码查找结果:', found ? '找到' : '未找到');
  return found;
}

/**
 * 从安全存储删除密码
 *
 * @param serverUrl 服务器地址
 * @param userId 用户 ID
 */
export async function removePassword(
  serverUrl: string,
  userId: string,
): Promise<void> {
  console.warn('[Keystore] removePassword 被调用, serverUrl:', serverUrl, 'userId:', userId);
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const key = makeKey(serverUrl, userId);

  let map: PasswordMap = {};
  try {
    map = await getPasswordMap();
  } catch {
    // 没有密码，无需删除
    return;
  }

  if (key in map) {
    delete map[key];
    await savePasswordMap(map);
    console.warn('[Keystore] 密码已删除:', key);
  }
}

/**
 * 清除所有存储的密码
 */
export async function clearAllPasswords(): Promise<void> {
  console.warn('[Keystore] clearAllPasswords 被调用');
  if (!isMobile()) {
    throw new Error('此功能仅在移动端可用');
  }

  const keystore = await getKeystoreModule();
  await keystore.remove(SERVICE_NAME, USER_NAME);
  console.warn('[Keystore] 所有密码已清除');
}

/**
 * 检查 keystore 是否可用
 */
export async function isKeystoreAvailable(): Promise<boolean> {
  if (!isMobile()) {
    return false;
  }

  try {
    await getKeystoreModule();
    return true;
  } catch {
    return false;
  }
}
