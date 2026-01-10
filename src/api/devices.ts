/**
 * 设备管理 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 *
 * @module api/devices
 */

import type { ApiClient } from './client';
import type { Device, DevicesResponse } from '../types/device';

/**
 * 获取登录设备列表
 *
 * @param api - API 客户端实例
 * @returns 设备列表
 */
export function getDevices(api: ApiClient): Promise<Device[]> {
  return api.get<DevicesResponse>('/api/auth/devices').then((res) => res.devices);
}

/**
 * 删除指定设备
 *
 * 注意：删除当前设备会导致当前 Token 失效
 *
 * @param api - API 客户端实例
 * @param deviceId - 要删除的设备 ID
 */
export function deleteDevice(api: ApiClient, deviceId: string): Promise<void> {
  return api.delete(`/api/auth/devices/${deviceId}`);
}
