/**
 * 设备管理 Hook
 *
 * 提供获取设备列表、删除设备等功能
 * 使用 SessionContext 提供的 API 客户端
 *
 * 特性：
 * - 乐观更新：删除时立即从本地移除，无需重新加载列表
 * - 失败回滚：API 请求失败时自动恢复被删除的项
 * - 与好友/群聊卡片一致的动画效果
 * - 批量删除：一键删除所有其他设备（并行请求）
 *
 * @module hooks/useDevices
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import type { Device } from '../types/device';
import { getDevices, deleteDevice } from '../api/devices';

export interface UseDevicesReturn {
  /** 设备列表 */
  devices: Device[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 正在删除的设备 ID */
  deletingId: string | null;
  /** 是否正在批量删除 */
  removingAll: boolean;
  /** 刷新设备列表 */
  refresh: () => Promise<void>;
  /** 删除设备（乐观更新） */
  remove: (deviceId: string) => Promise<boolean>;
  /** 删除所有其他设备 */
  removeAllOthers: () => Promise<{ success: number; failed: number }>;
}

/**
 * 设备管理 Hook
 *
 * 使用乐观更新模式：
 * 1. 删除时立即从本地状态移除（触发退出动画）
 * 2. 后台发送删除请求
 * 3. 失败时回滚到之前的状态
 */
export function useDevices(): UseDevicesReturn {
  const { api } = useSession();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingAll, setRemovingAll] = useState(false);

  // 使用 ref 保存设备列表，用于乐观更新的回滚
  const devicesRef = useRef<Device[]>([]);

  // 同步 ref
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // 获取设备列表
  const refresh = useCallback(async () => {
    if (!api) {
      setError('未登录');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await getDevices(api);
      setDevices(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [api]);

  // 删除设备（乐观更新）
  const remove = useCallback(async (deviceId: string): Promise<boolean> => {
    if (!api) {
      setError('未登录');
      return false;
    }

    // 1. 保存当前状态用于回滚
    const previousDevices = devicesRef.current;

    // 2. 乐观更新：立即从本地移除（触发 AnimatePresence 的 exit 动画）
    setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));
    setDeletingId(deviceId);
    setError(null);

    try {
      // 3. 发送删除请求
      await deleteDevice(api, deviceId);
      return true;
    } catch (err) {
      // 4. 失败时回滚
      setDevices(previousDevices);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return false;
    } finally {
      setDeletingId(null);
    }
  }, [api]);

  // 删除所有其他设备
  const removeAllOthers = useCallback(async (): Promise<{ success: number; failed: number }> => {
    if (!api) {
      setError('未登录');
      return { success: 0, failed: 0 };
    }

    // 获取所有非当前设备
    const othersToRemove = devicesRef.current.filter((d) => !d.is_current);

    if (othersToRemove.length === 0) {
      return { success: 0, failed: 0 };
    }

    setRemovingAll(true);
    setError(null);

    // 保存当前状态用于回滚
    const previousDevices = devicesRef.current;

    // 乐观更新：立即移除所有其他设备
    setDevices((prev) => prev.filter((d) => d.is_current));

    // 并行删除所有设备
    const results = await Promise.allSettled(
      othersToRemove.map((device) => deleteDevice(api, device.device_id)),
    );

    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // 如果有失败的，重新获取列表
    if (failed > 0) {
      try {
        const list = await getDevices(api);
        setDevices(list);
      } catch {
        // 获取失败，回滚到之前的状态
        setDevices(previousDevices);
      }
      setError(`删除完成：成功 ${success} 个，失败 ${failed} 个`);
    }

    setRemovingAll(false);
    return { success, failed };
  }, [api]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    devices,
    loading,
    error,
    deletingId,
    removingAll,
    refresh,
    remove,
    removeAllOthers,
  };
}
