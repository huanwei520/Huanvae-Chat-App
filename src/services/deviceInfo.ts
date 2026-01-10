/**
 * 设备信息服务
 *
 * 获取当前设备的标识信息，用于登录时上传到服务器
 * 使服务器能够识别同一设备的多次登录
 *
 * @module services/deviceInfo
 */

import { platform, arch, version, hostname } from '@tauri-apps/plugin-os';
import { invoke } from '@tauri-apps/api/core';

/**
 * 设备信息
 */
export interface DeviceInfo {
  /** 设备描述信息（如 "DESKTOP-ABC - Windows 10.0.22621 (x86_64)"） */
  deviceInfo: string;
  /** MAC 地址（如 "00:1A:2B:3C:4D:5E"） */
  macAddress: string | null;
}

/**
 * 获取本机 MAC 地址
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
 * 组合获取计算机名、操作系统、版本、架构和 MAC 地址
 *
 * @returns 设备信息对象
 *
 * @example
 * ```ts
 * const { deviceInfo, macAddress } = await getDeviceInfo();
 * // deviceInfo: "DESKTOP-ABC123 - Windows 10.0.22621 (x86_64)"
 * // macAddress: "00:1A:2B:3C:4D:5E"
 * ```
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  try {
    const [os, osArch, osVersion, host, macAddress] = await Promise.all([
      platform(),
      arch(),
      version(),
      hostname(),
      getMacAddress(),
    ]);

    // 格式化平台名称
    const platformName = formatPlatform(os);

    // 生成设备描述
    const hostName = host || 'Unknown';
    const deviceInfo = `${hostName} - ${platformName} ${osVersion} (${osArch})`;

    // 调试日志
    console.warn('[DeviceInfo] 获取成功:', { deviceInfo, macAddress });
    return { deviceInfo, macAddress };
  } catch (error) {
    console.warn('[DeviceInfo] 获取设备信息失败:', error);
    return {
      deviceInfo: 'Huanvae Chat Desktop',
      macAddress: null,
    };
  }
}
