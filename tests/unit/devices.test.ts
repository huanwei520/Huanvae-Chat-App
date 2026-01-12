/**
 * 设备管理模块测试
 *
 * 测试设备类型和 API 服务
 *
 * 乐观更新说明：
 * - useDevices hook 实现了乐观更新模式
 * - 删除设备时立即从本地状态移除，触发退出动画
 * - API 请求失败时回滚到之前的状态
 * - 与好友/群聊卡片一致的增量更新体验
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Device } from '../../src/types/device';

// Mock ApiClient - 包含所有需要的方法
const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  getBaseUrl: vi.fn(() => 'http://localhost'),
  getAccessToken: vi.fn(() => 'mock-token'),
};

// 需要在 import 之前设置 mock
vi.mock('../../src/api/client', () => ({
  createApiClient: () => mockApiClient,
}));

import { getDevices, deleteDevice } from '../../src/api/devices';

describe('设备管理 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDevices', () => {
    it('应正确获取设备列表', async () => {
      const mockDevices: Device[] = [
        {
          device_id: '1',
          device_info: 'Chrome on Windows',
          is_current: true,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          device_id: '2',
          device_info: 'Safari on macOS',
          is_current: false,
          created_at: '2026-01-02T00:00:00Z',
        },
      ];

      mockApiClient.get.mockResolvedValue({ devices: mockDevices });

      const result = await getDevices(mockApiClient);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/auth/devices');
      expect(result).toEqual(mockDevices);
      expect(result.length).toBe(2);
      expect(result[0].is_current).toBe(true);
    });

    it('应在请求失败时抛出错误', async () => {
      mockApiClient.get.mockRejectedValue(new Error('401 Unauthorized'));

      await expect(getDevices(mockApiClient)).rejects.toThrow('401 Unauthorized');
    });
  });

  describe('deleteDevice', () => {
    it('应正确删除设备', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await deleteDevice(mockApiClient, 'device-123');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/auth/devices/device-123');
    });

    it('应在删除失败时抛出错误', async () => {
      mockApiClient.delete.mockRejectedValue(new Error('404 Not found'));

      await expect(deleteDevice(mockApiClient, 'invalid-id')).rejects.toThrow('404 Not found');
    });
  });
});

describe('Device 类型', () => {
  it('应正确定义设备类型', () => {
    const device: Device = {
      device_id: 'test-device',
      device_info: 'Test Browser',
      is_current: true,
      created_at: '2026-01-01T00:00:00Z',
      last_active_at: '2026-01-06T00:00:00Z',
      mac_address: '00:11:22:33:44:55',
    };

    expect(device.device_id).toBe('test-device');
    expect(device.device_info).toBe('Test Browser');
    expect(device.is_current).toBe(true);
    expect(device.mac_address).toBe('00:11:22:33:44:55');
  });

  it('可选字段可以不提供', () => {
    const device: Device = {
      device_id: 'test-device',
      device_info: 'Test Browser',
      is_current: false,
      created_at: '2026-01-01T00:00:00Z',
    };

    expect(device.last_active_at).toBeUndefined();
    expect(device.mac_address).toBeUndefined();
  });
});

describe('批量删除设备', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应能同时删除多个设备', async () => {
    mockApiClient.delete.mockResolvedValue(undefined);

    // 模拟批量删除
    const deviceIds = ['device-1', 'device-2', 'device-3'];
    await Promise.all(deviceIds.map((id) => deleteDevice(mockApiClient, id)));

    expect(mockApiClient.delete).toHaveBeenCalledTimes(3);
    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/auth/devices/device-1');
    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/auth/devices/device-2');
    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/auth/devices/device-3');
  });

  it('应正确统计成功和失败数量', async () => {
    // 模拟部分失败
    mockApiClient.delete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    const deviceIds = ['device-1', 'device-2', 'device-3'];
    const results = await Promise.allSettled(
      deviceIds.map((id) => deleteDevice(mockApiClient, id)),
    );

    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    expect(success).toBe(2);
    expect(failed).toBe(1);
  });
});
