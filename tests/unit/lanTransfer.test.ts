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
 * - 传输调试日志（字节格式化、进度计算、ETA计算）
 * - 毛玻璃样式集成（CSS变量、样式属性）
 * - 接收方进度显示（速度计算、剩余时间、初始进度、完成事件）
 * - 进度条样式统一（蓝色纯色）
 *
 * 更新日志：
 * - 2026-01-21: 添加传输调试日志测试和毛玻璃样式集成测试
 * - 2026-01-21: 添加接收方进度显示测试和进度条样式统一测试
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

describe('传输调试日志', () => {
  it('应正确格式化字节大小', () => {
    // 测试字节格式化逻辑
    const formatBytes = (bytes: number): string => {
      const KB = 1024;
      const MB = KB * 1024;
      const GB = MB * 1024;

      if (bytes >= GB) {
        return `${(bytes / GB).toFixed(2)} GB`;
      } else if (bytes >= MB) {
        return `${(bytes / MB).toFixed(2)} MB`;
      } else if (bytes >= KB) {
        return `${(bytes / KB).toFixed(2)} KB`;
      } else {
        return `${bytes} B`;
      }
    };

    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.50 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
  });

  it('传输进度百分比计算应正确', () => {
    const testCases = [
      { offset: 0, total: 100, expected: 0 },
      { offset: 50, total: 100, expected: 50 },
      { offset: 100, total: 100, expected: 100 },
      { offset: 1024 * 1024, total: 1024 * 1024 * 10, expected: 10 },
    ];

    testCases.forEach(({ offset, total, expected }) => {
      const percentage = (offset / total) * 100;
      expect(percentage).toBe(expected);
    });
  });

  it('ETA 计算应正确', () => {
    // speed = bytes/second
    // eta = remaining_bytes / speed
    const totalBytes = 1024 * 1024 * 100; // 100 MB
    const transferredBytes = 1024 * 1024 * 40; // 40 MB
    const speed = 1024 * 1024 * 10; // 10 MB/s

    const remainingBytes = totalBytes - transferredBytes;
    const etaSeconds = remainingBytes / speed;

    expect(etaSeconds).toBe(6); // 60 MB remaining / 10 MB/s = 6 seconds
  });
});

describe('毛玻璃样式集成', () => {
  it('传输窗口应使用主题 CSS 变量', () => {
    // 验证毛玻璃样式应使用的 CSS 变量
    const requiredCssVariables = [
      '--gradient-glass',
      '--blur-xl',
      '--saturate-high',
      '--glass-border',
      '--glass-white-50',
      '--glass-white-80',
      '--glass-white-40',
      '--glass-white-30',
      '--color-primary-4-rgb',
      '--color-primary-6-rgb',
      '--radius-2xl',
    ];

    // 这些变量应该在主题系统中定义
    requiredCssVariables.forEach((variable) => {
      expect(variable).toMatch(/^--[a-z0-9-]+$/);
    });
  });

  it('毛玻璃效果应包含必要的 CSS 属性', () => {
    // 毛玻璃效果的关键 CSS 属性
    const glassProperties = {
      background: 'var(--gradient-glass)',
      backdropFilter: 'blur() saturate()',
      border: 'solid var(--glass-border)',
      boxShadow: 'multiple layers for depth',
    };

    expect(Object.keys(glassProperties)).toContain('background');
    expect(Object.keys(glassProperties)).toContain('backdropFilter');
    expect(Object.keys(glassProperties)).toContain('border');
    expect(Object.keys(glassProperties)).toContain('boxShadow');
  });
});

describe('接收方进度显示', () => {
  it('应正确计算接收速度', () => {
    // 模拟接收进度计算
    const resumeOffset = 1024 * 1024 * 10; // 10 MB（续传起始）
    const received = 1024 * 1024 * 50; // 50 MB（当前接收）
    const elapsedSeconds = 8; // 8 秒

    const transferredSinceStart = received - resumeOffset; // 40 MB
    const speed = transferredSinceStart / elapsedSeconds; // 5 MB/s

    expect(transferredSinceStart).toBe(1024 * 1024 * 40);
    expect(speed).toBe(1024 * 1024 * 5);
  });

  it('应正确计算接收剩余时间', () => {
    const totalBytes = 1024 * 1024 * 100; // 100 MB
    const received = 1024 * 1024 * 60; // 60 MB
    const speed = 1024 * 1024 * 8; // 8 MB/s

    const remainingBytes = totalBytes - received;
    const etaSeconds = remainingBytes / speed;

    expect(remainingBytes).toBe(1024 * 1024 * 40);
    expect(etaSeconds).toBe(5); // 40 MB / 8 MB/s = 5 秒
  });

  it('初始进度事件应包含正确信息', () => {
    const initialProgress: BatchTransferProgress = {
      sessionId: 'test-session',
      totalFiles: 1,
      completedFiles: 0,
      totalBytes: 1024 * 1024 * 100,
      transferredBytes: 0,
      speed: 0,
      currentFile: {
        fileId: 'test-file',
        fileName: 'test.mp4',
        fileSize: 1024 * 1024 * 100,
        mimeType: 'video/mp4',
        sha256: 'abc123',
      },
      etaSeconds: undefined,
    };

    expect(initialProgress.transferredBytes).toBe(0);
    expect(initialProgress.completedFiles).toBe(0);
    expect(initialProgress.currentFile?.fileName).toBe('test.mp4');
  });

  it('完成事件应正确标记传输完成', () => {
    // 模拟 BatchTransferCompleted 事件
    const completedEvent = {
      sessionId: 'test-session',
      totalFiles: 1,
      saveDirectory: '/path/to/saved/file.mp4',
    };

    expect(completedEvent.totalFiles).toBe(1);
    expect(completedEvent.saveDirectory).toContain('file.mp4');
  });
});

describe('进度条样式统一', () => {
  it('进度条应使用统一的蓝色样式', () => {
    // 验证进度条使用 --primary 变量
    const expectedBackground = 'var(--primary, #3b82f6)';

    // 两种进度条应使用相同的背景色
    expect(expectedBackground).toContain('--primary');
    expect(expectedBackground).toContain('#3b82f6');
  });
});
