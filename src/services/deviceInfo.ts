/**
 * 设备信息服务
 *
 * 获取当前设备的标识信息，用于登录时上传到服务器
 * 使服务器能够识别同一设备的多次登录
 *
 * ## 平台差异
 *
 * - **桌面端**：使用计算机名 + MAC 地址
 * - **Android**：使用设备型号 + 持久化 UUID（替代 MAC，因 Android 10+ 限制）
 *
 * @module services/deviceInfo
 */

import { platform, arch, version, hostname } from '@tauri-apps/plugin-os';
import { invoke } from '@tauri-apps/api/core';
import { isMobile } from '../utils/platform';

/**
 * 设备信息
 */
export interface DeviceInfo {
  /** 设备描述信息（如 "DESKTOP-ABC - Windows 10.0.22621 (x86_64)"） */
  deviceInfo: string;
  /** MAC 地址或设备 UUID（如 "00:1A:2B:3C:4D:5E" 或 "uuid:xxx"） */
  macAddress: string | null;
}

/**
 * 获取本机 MAC 地址（桌面端）
 *
 * 调用 Rust 后端命令获取第一个可用网卡的 MAC 地址
 *
 * @returns MAC 地址字符串，格式 "XX:XX:XX:XX:XX:XX"，失败返回 null
 */
async function getMacAddress(): Promise<string | null> {
  try {
    return await invoke<string | null>('get_mac_address_cmd');
  } catch (error) {
    console.warn('[DeviceInfo] 获取 MAC 地址失败:', error);
    return null;
  }
}

/**
 * 获取或生成 Android 设备 UUID
 *
 * Android 10+ 限制了 MAC 地址访问，使用持久化 UUID 替代
 * UUID 存储在 Keystore 中，重装应用后会重新生成
 *
 * @returns 设备 UUID，格式 "uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 */
async function getAndroidDeviceId(): Promise<string> {
  try {
    // 尝试从 Keystore 读取已存储的 UUID
    const { retrieveDeviceUuid, storeDeviceUuid } = await import('./mobileKeystore');

    const stored = await retrieveDeviceUuid();
    if (stored) {
      console.warn('[DeviceInfo] 使用已存储的设备 UUID');
      return `uuid:${stored}`;
    }

    // 生成新的 UUID
    const newUuid = crypto.randomUUID();
    console.warn('[DeviceInfo] 生成新的设备 UUID:', newUuid);

    // 持久化存储
    await storeDeviceUuid(newUuid);
    console.warn('[DeviceInfo] 设备 UUID 已保存到 Keystore');

    return `uuid:${newUuid}`;
  } catch (error) {
    // Keystore 不可用时，生成临时 UUID
    console.warn('[DeviceInfo] Keystore 不可用，使用临时 UUID:', error);
    return `uuid:${crypto.randomUUID()}`;
  }
}

/**
 * 从 UserAgent 解析 Android 设备型号
 *
 * @returns 设备型号（如 "Pixel 7 Pro"）或 "Android Device"
 */
function parseAndroidModel(): string {
  const ua = navigator.userAgent;
  console.warn('[DeviceInfo] UserAgent:', ua);

  // 匹配 Android 设备型号
  // 格式: Android X.X; DEVICE_MODEL Build/
  // 或: Android X.X; MANUFACTURER DEVICE_MODEL Build/
  const match = ua.match(/Android\s[\d.]+;\s*([^)]+?)\s*(?:Build|;)/i);
  console.warn('[DeviceInfo] 型号匹配结果:', match);

  if (match?.[1]) {
    // 清理型号字符串
    let model = match[1].trim();
    // 移除 SDK 版本等后缀
    model = model.replace(/\s+SDK\s+\d+/i, '');
    // 移除语言后缀
    model = model.replace(/;\s*[a-z]{2}[-_][A-Z]{2}$/i, '');
    if (model && model.length > 0) {
      console.warn('[DeviceInfo] 解析到设备型号:', model);
      return model;
    }
  }

  return 'Android Device';
}

/**
 * 格式化平台名称
 *
 * @param os - 原始平台标识（如 "windows"）
 * @returns 格式化后的名称（如 "Windows"）
 */
function formatPlatform(os: string): string {
  const platformMap: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    ios: 'iOS',
    android: 'Android',
  };
  return platformMap[os] || os;
}

/**
 * 获取设备信息
 *
 * 组合获取设备名、操作系统、版本、架构和设备标识
 *
 * ## 平台差异
 *
 * - **桌面端**：返回 `{hostName} - {platform} {version} ({arch})` + MAC 地址
 * - **Android**：返回 `{deviceModel} - Android {version} ({arch})` + UUID
 *
 * @returns 设备信息对象
 *
 * @example
 * ```ts
 * // 桌面端
 * const { deviceInfo, macAddress } = await getDeviceInfo();
 * // deviceInfo: "DESKTOP-ABC123 - Windows 10.0.22621 (x86_64)"
 * // macAddress: "00:1A:2B:3C:4D:5E"
 *
 * // Android
 * // deviceInfo: "Pixel 7 Pro - Android 14 (aarch64)"
 * // macAddress: "uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 * ```
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  try {
    // Android 使用不同的获取方式
    if (isMobile()) {
      const [os, osArch, osVersion, deviceId] = await Promise.all([
        platform(),
        arch(),
        version(),
        getAndroidDeviceId(),
      ]);

      // 从 UserAgent 解析设备型号
      const deviceModel = parseAndroidModel();
      const platformName = formatPlatform(os);
      const deviceInfo = `${deviceModel} - ${platformName} ${osVersion} (${osArch})`;

      console.warn('[DeviceInfo] Android 获取成功:', { deviceInfo, deviceId });
      return { deviceInfo, macAddress: deviceId };
    }

    // 桌面端：使用原有逻辑
    const [os, osArch, osVersion, host, macAddress] = await Promise.all([
      platform(),
      arch(),
      version(),
      hostname(),
      getMacAddress(),
    ]);

    const platformName = formatPlatform(os);
    const hostName = host || 'Unknown';
    const deviceInfo = `${hostName} - ${platformName} ${osVersion} (${osArch})`;

    console.warn('[DeviceInfo] 桌面端获取成功:', { deviceInfo, macAddress });
    return { deviceInfo, macAddress };
  } catch (error) {
    console.warn('[DeviceInfo] 获取设备信息失败:', error);
    return {
      deviceInfo: isMobile() ? 'Huanvae Chat Android' : 'Huanvae Chat Desktop',
      macAddress: null,
    };
  }
}
