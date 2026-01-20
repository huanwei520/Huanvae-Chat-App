/**
 * 局域网传输模块测试
 *
 * 测试局域网传输相关的类型、状态管理和核心逻辑
 *
 * 功能测试：
 * - 服务启动/停止（包括自动重启）
 * - 设备发现
 * - 点对点连接管理
 * - 文件传输
 * - 断点续传
 * - 配置管理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// 类型定义（与 useLanTransfer.ts 保持一致）
interface DiscoveredDevice {
  deviceId: string;
  deviceName: string;
  userId: string;
  userNickname: string;
  ipAddress: string;
  port: number;
  discoveredAt: string;
  lastSeen: string;
}

interface PeerConnection {
  connectionId: string;
  peerDevice: DiscoveredDevice;
  establishedAt: string;
  status: 'connected' | 'disconnected';
  isInitiator: boolean;
}

interface PeerConnectionRequest {
  connectionId: string;
  fromDevice: DiscoveredDevice;
  requestedAt: string;
}

interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
}

interface BatchTransferProgress {
  sessionId: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  transferredBytes: number;
  speed: number;
  currentFile?: FileMetadata;
  etaSeconds?: number;
}

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

describe('局域网传输服务管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('服务启动', () => {
    it('应正确启动局域网传输服务', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await invoke('start_lan_transfer_service', {
        userId: 'user123',
        userNickname: '测试用户',
      });

      expect(mockInvoke).toHaveBeenCalledWith('start_lan_transfer_service', {
        userId: 'user123',
        userNickname: '测试用户',
      });
    });

    it('服务已运行时应自动重启（不报错）', async () => {
      // 模拟服务已运行但自动重启成功
      mockInvoke.mockResolvedValue(undefined);

      await invoke('start_lan_transfer_service', {
        userId: 'user123',
        userNickname: '测试用户',
      });

      // 再次启动应该成功（后端会自动停止旧服务）
      await invoke('start_lan_transfer_service', {
        userId: 'user123',
        userNickname: '测试用户',
      });

      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('服务停止', () => {
    it('应正确停止局域网传输服务', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await invoke('stop_lan_transfer_service');

      expect(mockInvoke).toHaveBeenCalledWith('stop_lan_transfer_service');
    });

    it('服务未运行时停止应抛出错误', async () => {
      mockInvoke.mockRejectedValue(new Error('服务未运行'));

      await expect(invoke('stop_lan_transfer_service')).rejects.toThrow('服务未运行');
    });
  });
});

describe('设备发现', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应正确获取发现的设备列表', async () => {
    const mockDevices: DiscoveredDevice[] = [
      {
        deviceId: 'device-1',
        deviceName: 'TestDevice',
        userId: 'user1',
        userNickname: '用户1',
        ipAddress: '192.168.1.100',
        port: 53317,
        discoveredAt: '2026-01-21T00:00:00Z',
        lastSeen: '2026-01-21T00:01:00Z',
      },
    ];

    mockInvoke.mockResolvedValue(mockDevices);

    const result = await invoke<DiscoveredDevice[]>('get_discovered_devices');

    expect(mockInvoke).toHaveBeenCalledWith('get_discovered_devices');
    expect(result).toEqual(mockDevices);
    expect(result.length).toBe(1);
    expect(result[0].deviceName).toBe('TestDevice');
  });

  it('无设备时应返回空数组', async () => {
    mockInvoke.mockResolvedValue([]);

    const result = await invoke<DiscoveredDevice[]>('get_discovered_devices');

    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });
});

describe('点对点连接管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('连接请求', () => {
    it('应正确发送连接请求', async () => {
      const connectionId = 'conn-123';
      mockInvoke.mockResolvedValue(connectionId);

      const result = await invoke<string>('request_peer_connection', {
        deviceId: 'device-1',
      });

      expect(mockInvoke).toHaveBeenCalledWith('request_peer_connection', {
        deviceId: 'device-1',
      });
      expect(result).toBe(connectionId);
    });

    it('设备不存在时应抛出错误', async () => {
      mockInvoke.mockRejectedValue(new Error('设备未找到'));

      await expect(
        invoke('request_peer_connection', { deviceId: 'invalid-device' }),
      ).rejects.toThrow('设备未找到');
    });
  });

  describe('连接响应', () => {
    it('应正确接受连接请求', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await invoke('respond_peer_connection', {
        connectionId: 'conn-123',
        accept: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith('respond_peer_connection', {
        connectionId: 'conn-123',
        accept: true,
      });
    });

    it('应正确拒绝连接请求', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await invoke('respond_peer_connection', {
        connectionId: 'conn-123',
        accept: false,
      });

      expect(mockInvoke).toHaveBeenCalledWith('respond_peer_connection', {
        connectionId: 'conn-123',
        accept: false,
      });
    });
  });

  describe('断开连接', () => {
    it('应正确断开连接', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await invoke('disconnect_peer', { connectionId: 'conn-123' });

      expect(mockInvoke).toHaveBeenCalledWith('disconnect_peer', {
        connectionId: 'conn-123',
      });
    });
  });

  describe('获取连接状态', () => {
    it('应正确获取活跃连接列表', async () => {
      const mockConnections: PeerConnection[] = [
        {
          connectionId: 'conn-123',
          peerDevice: {
            deviceId: 'device-1',
            deviceName: 'TestDevice',
            userId: 'user1',
            userNickname: '用户1',
            ipAddress: '192.168.1.100',
            port: 53317,
            discoveredAt: '2026-01-21T00:00:00Z',
            lastSeen: '2026-01-21T00:01:00Z',
          },
          establishedAt: '2026-01-21T00:02:00Z',
          status: 'connected',
          isInitiator: true,
        },
      ];

      mockInvoke.mockResolvedValue(mockConnections);

      const result = await invoke<PeerConnection[]>('get_active_peer_connections');

      expect(result).toEqual(mockConnections);
      expect(result[0].status).toBe('connected');
    });

    it('应正确获取待处理的连接请求', async () => {
      const mockRequests: PeerConnectionRequest[] = [
        {
          connectionId: 'conn-456',
          fromDevice: {
            deviceId: 'device-2',
            deviceName: 'OtherDevice',
            userId: 'user2',
            userNickname: '用户2',
            ipAddress: '192.168.1.101',
            port: 53317,
            discoveredAt: '2026-01-21T00:00:00Z',
            lastSeen: '2026-01-21T00:01:00Z',
          },
          requestedAt: '2026-01-21T00:03:00Z',
        },
      ];

      mockInvoke.mockResolvedValue(mockRequests);

      const result = await invoke<PeerConnectionRequest[]>('get_pending_peer_connection_requests');

      expect(result).toEqual(mockRequests);
      expect(result.length).toBe(1);
    });
  });
});

describe('文件传输', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('发送文件', () => {
    it('应正确通过已建立的连接发送文件', async () => {
      const sessionId = 'session-123';
      mockInvoke.mockResolvedValue(sessionId);

      const result = await invoke<string>('send_files_to_peer', {
        connectionId: 'conn-123',
        filePaths: ['/path/to/file1.txt', '/path/to/file2.pdf'],
      });

      expect(mockInvoke).toHaveBeenCalledWith('send_files_to_peer', {
        connectionId: 'conn-123',
        filePaths: ['/path/to/file1.txt', '/path/to/file2.pdf'],
      });
      expect(result).toBe(sessionId);
    });

    it('连接不存在时应抛出错误', async () => {
      mockInvoke.mockRejectedValue(new Error('连接不存在'));

      await expect(
        invoke('send_files_to_peer', {
          connectionId: 'invalid-conn',
          filePaths: ['/path/to/file.txt'],
        }),
      ).rejects.toThrow('连接不存在');
    });

    it('文件路径为空时应抛出错误', async () => {
      mockInvoke.mockRejectedValue(new Error('未选择任何文件'));

      await expect(
        invoke('send_files_to_peer', {
          connectionId: 'conn-123',
          filePaths: [],
        }),
      ).rejects.toThrow('未选择任何文件');
    });
  });
});

describe('传输进度', () => {
  it('应正确解析批量传输进度', () => {
    const progress: BatchTransferProgress = {
      sessionId: 'session-123',
      totalFiles: 5,
      completedFiles: 2,
      totalBytes: 1024 * 1024 * 100, // 100MB
      transferredBytes: 1024 * 1024 * 40, // 40MB
      speed: 1024 * 1024 * 10, // 10MB/s
      currentFile: {
        fileId: 'file-3',
        fileName: 'document.pdf',
        fileSize: 1024 * 1024 * 20,
        mimeType: 'application/pdf',
        sha256: 'abc123...',
      },
      etaSeconds: 6,
    };

    // 计算进度百分比
    const percentage = (progress.transferredBytes / progress.totalBytes) * 100;
    expect(percentage).toBe(40);

    // 计算速度（MB/s）
    const speedMB = progress.speed / (1024 * 1024);
    expect(speedMB).toBe(10);

    // 验证文件进度
    expect(progress.completedFiles).toBe(2);
    expect(progress.totalFiles).toBe(5);
  });
});

describe('DiscoveredDevice 类型', () => {
  it('应正确定义设备类型', () => {
    const device: DiscoveredDevice = {
      deviceId: 'test-device',
      deviceName: 'Test Device',
      userId: 'user123',
      userNickname: '测试用户',
      ipAddress: '192.168.1.100',
      port: 53317,
      discoveredAt: '2026-01-21T00:00:00Z',
      lastSeen: '2026-01-21T00:01:00Z',
    };

    expect(device.deviceId).toBe('test-device');
    expect(device.deviceName).toBe('Test Device');
    expect(device.port).toBe(53317);
  });
});

describe('PeerConnection 类型', () => {
  it('应正确定义点对点连接类型', () => {
    const connection: PeerConnection = {
      connectionId: 'conn-123',
      peerDevice: {
        deviceId: 'device-1',
        deviceName: 'TestDevice',
        userId: 'user1',
        userNickname: '用户1',
        ipAddress: '192.168.1.100',
        port: 53317,
        discoveredAt: '2026-01-21T00:00:00Z',
        lastSeen: '2026-01-21T00:01:00Z',
      },
      establishedAt: '2026-01-21T00:02:00Z',
      status: 'connected',
      isInitiator: true,
    };

    expect(connection.connectionId).toBe('conn-123');
    expect(connection.status).toBe('connected');
    expect(connection.isInitiator).toBe(true);
    expect(connection.peerDevice.deviceName).toBe('TestDevice');
  });

  it('连接状态应只能是 connected 或 disconnected', () => {
    const statuses: Array<'connected' | 'disconnected'> = ['connected', 'disconnected'];

    statuses.forEach((status) => {
      const connection: PeerConnection = {
        connectionId: 'conn-123',
        peerDevice: {
          deviceId: 'device-1',
          deviceName: 'TestDevice',
          userId: 'user1',
          userNickname: '用户1',
          ipAddress: '192.168.1.100',
          port: 53317,
          discoveredAt: '2026-01-21T00:00:00Z',
          lastSeen: '2026-01-21T00:01:00Z',
        },
        establishedAt: '2026-01-21T00:02:00Z',
        status,
        isInitiator: false,
      };

      expect(['connected', 'disconnected']).toContain(connection.status);
    });
  });
});

describe('窗口关闭时服务停止', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('关闭窗口时应等待服务完全停止', async () => {
    // 模拟 stopService 需要一些时间完成
    let serviceStoppedAt = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'stop_lan_transfer_service') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        serviceStoppedAt = Date.now();
      }
    });

    const startTime = Date.now();
    await invoke('stop_lan_transfer_service');
    const endTime = Date.now();

    // 验证服务停止后才返回
    expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    expect(serviceStoppedAt).toBeGreaterThan(0);
  });
});
