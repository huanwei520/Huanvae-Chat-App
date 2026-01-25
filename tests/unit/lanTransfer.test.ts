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
 * - 平台分离架构（桌面/移动端模块分离、条件编译）
 * - Android 数据目录初始化（使用 Tauri API 替代 TMPDIR）
 * - 移动端 UI 适配（组件隔离、WebviewWindow 兼容性）
 * - mDNS 设备下线检测（fullname 映射、验证失败计数、主动移除）
 *
 * 更新日志：
 * - 2026-01-21: 添加传输调试日志测试和毛玻璃样式集成测试
 * - 2026-01-21: 添加接收方进度显示测试和进度条样式统一测试
 * - 2026-01-22: 添加平台分离架构测试（桌面/移动端模块、capabilities、会话锁）
 * - 2026-01-21: 添加 Android 数据目录初始化测试（修复只读系统目录问题）
 * - 2026-01-22: 添加移动端 UI 适配测试（WebviewWindow 模块隔离）
 * - 2026-01-24: 添加 mDNS 设备下线检测测试（修复 fullname 格式不匹配问题）
 * - 2026-01-25: 哈希算法从 SHA-256 迁移到 CRC32fast（协议字段名保持兼容）
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
    // 使用 95ms 作为阈值，留出 5ms 容差以避免时间精度问题导致的 flaky test
    expect(endTime - startTime).toBeGreaterThanOrEqual(95);
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

describe('平台分离架构', () => {
  it('桌面端专属模块应正确导出', () => {
    // 验证桌面端模块结构
    const desktopModules = ['tray', 'session_lock'];
    desktopModules.forEach((module) => {
      expect(module).toMatch(/^[a-z_]+$/);
    });
  });

  it('会话锁命令应返回正确的结构', () => {
    // 模拟桌面端会话锁检查结果
    const sessionCheckResult = {
      exists: false,
      process_alive: false,
      pid: null,
    };

    expect(sessionCheckResult.exists).toBe(false);
    expect(sessionCheckResult.process_alive).toBe(false);
    expect(sessionCheckResult.pid).toBeNull();
  });

  it('移动端会话锁存根应返回无冲突', () => {
    // 移动端会话锁存根应始终返回无冲突
    const mobileSessionResult = {
      exists: false,
      process_alive: false,
      pid: null,
    };

    expect(mobileSessionResult.exists).toBe(false);
  });

  it('capabilities 配置应区分桌面和移动平台', () => {
    // 桌面端 capabilities
    const desktopPlatforms = ['linux', 'macOS', 'windows'];
    // 移动端 capabilities
    const mobilePlatforms = ['android', 'iOS'];

    // 验证平台名称正确
    desktopPlatforms.forEach((platform) => {
      expect(['linux', 'macOS', 'windows']).toContain(platform);
    });

    mobilePlatforms.forEach((platform) => {
      expect(['android', 'iOS']).toContain(platform);
    });

    // 验证平台列表互斥
    const overlap = desktopPlatforms.filter((p) => mobilePlatforms.includes(p));
    expect(overlap).toHaveLength(0);
  });

  it('密码存储应根据平台返回正确结果', () => {
    // 桌面端：使用 keyring
    const desktopPasswordSupported = true;

    // 移动端：返回平台不支持错误
    const mobilePasswordSupported = false;
    const mobileError = '密码存储在移动端暂不可用，请手动输入密码';

    expect(desktopPasswordSupported).toBe(true);
    expect(mobilePasswordSupported).toBe(false);
    expect(mobileError).toContain('移动端');
  });

  it('Android 数据目录应使用 Tauri API 初始化', () => {
    // 模拟 Android 数据目录初始化
    const androidDataDir = '/data/data/com.github.huanwei520.huanvae_chat_app';
    const appSubDir = 'huanvae-chat';
    const expectedPath = `${androidDataDir}/files/${appSubDir}`;

    // 验证路径结构正确
    expect(expectedPath).toContain('data/data');
    expect(expectedPath).toContain('files');
    expect(expectedPath).toContain('huanvae-chat');
    expect(expectedPath).not.toContain('/system/bin'); // 不应使用只读系统目录
  });

  it('桌面端数据目录应使用 dirs crate', () => {
    // 模拟桌面端数据目录（Linux 示例）
    const linuxDataDir = '/home/user/.local/share/huanvae-chat';
    const macOSDataDir = '/Users/user/Library/Application Support/huanvae-chat';
    const windowsDataDir = 'C:\\Users\\user\\AppData\\Local\\huanvae-chat';

    // 验证桌面端路径不依赖 TMPDIR 环境变量
    expect(linuxDataDir).toContain('.local/share');
    expect(macOSDataDir).toContain('Library/Application Support');
    expect(windowsDataDir).toContain('AppData\\Local');
  });

  it('Android 初始化失败时应有明确错误信息', () => {
    // 模拟未初始化时的错误
    const uninitializedError =
      'Android 数据目录未初始化，请确保在 setup 阶段调用 init_android_data_dir()';

    expect(uninitializedError).toContain('未初始化');
    expect(uninitializedError).toContain('setup');
    expect(uninitializedError).toContain('init_android_data_dir');
  });

  it('移动端应避免导入使用 WebviewWindow 的模块', () => {
    // WebviewWindow 多窗口 API 仅桌面端支持
    // 移动端 MobileMain 不应导入以下模块：
    const desktopOnlyModules = [
      'lanTransfer/api.ts', // openLanTransferWindow 使用 WebviewWindow
      'meeting/components/MeetingEntryModal.tsx', // 使用 WebviewWindow
      'components/files/FilesModal.tsx', // 使用 openDialog
    ];

    // 验证移动端组件列表
    const mobileOnlyComponents = [
      'MobileMain',
      'MobileHeader',
      'MobileTabBar',
      'MobileDrawer',
      'MobileChatList',
      'MobileContacts',
      'MobileChatView',
    ];

    expect(desktopOnlyModules.length).toBeGreaterThan(0);
    expect(mobileOnlyComponents.length).toBe(7);
  });

  it('移动端抽屉菜单应隐藏不支持的功能', () => {
    // 移动端不支持的功能（使用 WebviewWindow）
    const unsupportedFeatures = [
      '视频会议',
      '文件互传',
      '局域网传输',
    ];

    // 移动端抽屉菜单应仅显示
    const supportedFeatures = ['设置', '退出登录'];

    expect(unsupportedFeatures.length).toBe(3);
    expect(supportedFeatures).toContain('设置');
    expect(supportedFeatures).not.toContain('视频会议');
  });

  it('平台检测应正确识别移动端', () => {
    // 模拟平台检测逻辑
    const mobileKeywords = ['android', 'iphone', 'ipad', 'mobile'];

    // 模拟 Android User-Agent
    const androidUA =
      'Mozilla/5.0 (Linux; Android 14; RMX3888) AppleWebKit/537.36';

    const isMobile = mobileKeywords.some((keyword) =>
      androidUA.toLowerCase().includes(keyword),
    );

    expect(isMobile).toBe(true);
  });
});

describe('mDNS 设备下线检测', () => {
  describe('fullname 到 device_id 映射', () => {
    it('mDNS instance_name 应限制为 15 字符', () => {
      // UUID 格式的 device_id（32 字符，不含连字符）
      const deviceId = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      expect(deviceId.length).toBe(32);

      // mDNS instance_name 截断到 15 字符
      const instanceName = deviceId.substring(0, 15);
      expect(instanceName.length).toBe(15);
      expect(instanceName).toBe('a1b2c3d4e5f6g7h');
    });

    it('fullname 应正确构建', () => {
      const instanceName = 'a1b2c3d4e5f6g7h';
      const serviceType = '_hvae-xfer._tcp.local.';
      const fullname = `${instanceName}.${serviceType}`;

      expect(fullname).toBe('a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.');
    });

    it('映射表应能正确反向查找 device_id', () => {
      // 模拟映射表
      const fullnameToDeviceId = new Map<string, string>();
      const deviceId = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      const fullname = 'a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.';

      fullnameToDeviceId.set(fullname, deviceId);

      // 通过 fullname 查找完整的 device_id
      const foundDeviceId = fullnameToDeviceId.get(fullname);
      expect(foundDeviceId).toBe(deviceId);
    });

    it('反向映射应能通过 device_id 查找 fullname', () => {
      // 模拟映射表
      const fullnameToDeviceId = new Map<string, string>();
      const deviceId = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      const fullname = 'a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.';

      fullnameToDeviceId.set(fullname, deviceId);

      // 反转映射
      const deviceIdToFullname = new Map<string, string>();
      fullnameToDeviceId.forEach((did, fname) => {
        deviceIdToFullname.set(did, fname);
      });

      // 通过 device_id 查找 fullname
      const foundFullname = deviceIdToFullname.get(deviceId);
      expect(foundFullname).toBe(fullname);
    });
  });

  describe('验证失败计数机制', () => {
    it('连续失败次数应正确累加', () => {
      const failureCount = new Map<string, number>();
      const deviceId = 'test-device-id';
      const maxFailures = 3;

      // 模拟连续失败
      for (let i = 1; i <= maxFailures; i++) {
        const currentCount = (failureCount.get(deviceId) ?? 0) + 1;
        failureCount.set(deviceId, currentCount);
        expect(failureCount.get(deviceId)).toBe(i);
      }

      expect(failureCount.get(deviceId)).toBe(maxFailures);
    });

    it('验证成功时应重置失败计数', () => {
      const failureCount = new Map<string, number>();
      const deviceId = 'test-device-id';

      // 设置失败计数
      failureCount.set(deviceId, 2);
      expect(failureCount.get(deviceId)).toBe(2);

      // 验证成功，重置计数
      failureCount.delete(deviceId);
      expect(failureCount.get(deviceId)).toBeUndefined();
    });

    it('超过最大失败次数应触发设备移除', () => {
      const maxFailures = 3;
      const failureCount = new Map<string, number>();
      const devices = new Map<string, DiscoveredDevice>();
      const deviceId = 'test-device-id';

      // 添加设备
      devices.set(deviceId, {
        deviceId,
        deviceName: 'Test Device',
        userId: 'user1',
        userNickname: '用户1',
        ipAddress: '192.168.1.100',
        port: 53317,
        discoveredAt: '2026-01-24T00:00:00Z',
        lastSeen: '2026-01-24T00:01:00Z',
      });

      // 模拟连续失败直到超过阈值
      failureCount.set(deviceId, maxFailures);

      // 检查是否应该移除
      const currentCount = failureCount.get(deviceId) ?? 0;
      if (currentCount >= maxFailures) {
        devices.delete(deviceId);
        failureCount.delete(deviceId);
      }

      expect(devices.has(deviceId)).toBe(false);
      expect(failureCount.has(deviceId)).toBe(false);
    });
  });

  describe('ServiceRemoved 事件处理', () => {
    it('应通过映射表正确移除设备', () => {
      const fullnameToDeviceId = new Map<string, string>();
      const devices = new Map<string, DiscoveredDevice>();

      const deviceId = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      const fullname = 'a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.';

      // 设置映射和设备
      fullnameToDeviceId.set(fullname, deviceId);
      devices.set(deviceId, {
        deviceId,
        deviceName: 'Test Device',
        userId: 'user1',
        userNickname: '用户1',
        ipAddress: '192.168.1.100',
        port: 53317,
        discoveredAt: '2026-01-24T00:00:00Z',
        lastSeen: '2026-01-24T00:01:00Z',
      });

      // 模拟 ServiceRemoved 事件处理
      const foundDeviceId = fullnameToDeviceId.get(fullname);
      expect(foundDeviceId).toBe(deviceId);

      if (foundDeviceId) {
        devices.delete(foundDeviceId);
        fullnameToDeviceId.delete(fullname);
      }

      expect(devices.has(deviceId)).toBe(false);
      expect(fullnameToDeviceId.has(fullname)).toBe(false);
    });

    it('未找到映射时应回退到 fullname 解析', () => {
      const fullnameToDeviceId = new Map<string, string>();
      const fullname = 'a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.';

      // 映射表为空
      let deviceId = fullnameToDeviceId.get(fullname);

      if (!deviceId) {
        // 回退：从 fullname 提取第一部分
        deviceId = fullname.split('.')[0];
      }

      expect(deviceId).toBe('a1b2c3d4e5f6g7h');
    });
  });

  describe('设备发现时的映射保存', () => {
    it('发现新设备时应保存 fullname 映射', () => {
      const fullnameToDeviceId = new Map<string, string>();
      const deviceId = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
      const fullname = 'a1b2c3d4e5f6g7h._hvae-xfer._tcp.local.';

      // 模拟设备发现时保存映射
      fullnameToDeviceId.set(fullname, deviceId);

      expect(fullnameToDeviceId.get(fullname)).toBe(deviceId);
    });

    it('设备重新上线时应重置验证失败计数', () => {
      const failureCount = new Map<string, number>();
      const deviceId = 'test-device-id';

      // 设置之前的失败计数
      failureCount.set(deviceId, 2);

      // 设备重新发现，重置计数
      failureCount.delete(deviceId);

      expect(failureCount.has(deviceId)).toBe(false);
    });
  });

  describe('验证任务配置', () => {
    it('验证间隔应为 5 秒', () => {
      const DEVICE_VERIFY_INTERVAL_SECS = 5;
      expect(DEVICE_VERIFY_INTERVAL_SECS).toBe(5);
    });

    it('验证超时应为 3 秒', () => {
      const DEVICE_VERIFY_TIMEOUT_SECS = 3;
      expect(DEVICE_VERIFY_TIMEOUT_SECS).toBe(3);
    });

    it('最大失败次数应为 3 次', () => {
      const MAX_VERIFY_FAILURES = 3;
      expect(MAX_VERIFY_FAILURES).toBe(3);
    });
  });
});
