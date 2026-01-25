/**
 * 局域网传输 Hook
 *
 * 提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 启动/停止局域网传输服务
 * - 获取发现的设备列表（自动更新设备信息，包括 IP 地址变化）
 * - 点对点连接管理（带去重检查，防止重复连接）
 * - 发送传输请求（需确认）
 * - 多文件并行批量传输（默认并行度 3）
 * - 单文件取消支持（cancelFileTransfer）
 * - 会话级批量取消支持（cancelSession）
 * - 断点续传支持
 * - 实时进度跟踪（单文件 + 批量进度）
 * - 配置管理
 *
 * 并行传输：
 * - 后端使用 Semaphore 限制并发数
 * - 每个文件有独立的 CancellationToken
 * - 会话取消时批量取消所有正在传输的文件
 * - 一个文件失败不影响其他文件继续传输
 *
 * 进度更新：
 * - activeTransfers: 单文件传输进度（TransferProgress 事件）
 * - batchProgressMap: 支持多个并行会话的批量传输进度
 * - 两者同步更新，确保 UI 显示正确
 *
 * 设备发现：
 * - DeviceDiscovered 事件：新设备发现或已有设备信息更新
 * - 前端自动合并更新设备列表，保持最新状态
 *
 * 连接去重机制：
 * - 前端：requestPeerConnection 调用前检查 activeConnections
 * - 后端：request_peer_connection 和 server 端都有去重检查
 * - 如果已存在连接，返回现有 connectionId 而不是创建新连接
 *
 * 更新日志：
 * - 2026-01-25: 修复设备 IP 不更新、批量进度不更新、取消按钮不工作问题
 * - 2026-01-25: 支持多个并行传输会话（batchProgressMap）
 */

import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// ============================================================================
// 类型定义
// ============================================================================

/** 发现的设备信息 */
export interface DiscoveredDevice {
  deviceId: string;
  deviceName: string;
  userId: string;
  userNickname: string;
  ipAddress: string;
  port: number;
  discoveredAt: string;
  lastSeen: string;
}

/** 连接请求（旧版兼容） */
export interface ConnectionRequest {
  requestId: string;
  fromDevice: DiscoveredDevice;
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

/** 点对点连接状态 */
export type PeerConnectionStatus = 'connected' | 'disconnected';

/** 点对点连接 */
export interface PeerConnection {
  connectionId: string;
  peerDevice: DiscoveredDevice;
  establishedAt: string;
  status: PeerConnectionStatus;
  isInitiator: boolean;
}

/** 点对点连接请求 */
export interface PeerConnectionRequest {
  connectionId: string;
  fromDevice: DiscoveredDevice;
  requestedAt: string;
}

/** 文件元信息 */
export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
}

/** 传输请求（新版，需确认） */
export interface TransferRequest {
  requestId: string;
  fromDevice: DiscoveredDevice;
  files: FileMetadata[];
  totalSize: number;
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

/** 传输任务 */
export interface TransferTask {
  taskId: string;
  sessionId: string;
  file: FileMetadata;
  direction: 'send' | 'receive';
  targetDevice: DiscoveredDevice;
  status: 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
  transferredBytes: number;
  speed: number;
  startedAt: string;
  etaSeconds?: number;
}

/** 文件传输状态 */
export interface FileTransferState {
  file: FileMetadata;
  status: 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
  transferredBytes: number;
  resumeInfo?: ResumeInfo;
}

/** 断点续传信息 */
export interface ResumeInfo {
  fileId: string;
  fileSha256: string;
  tempFilePath: string;
  transferredBytes: number;
  chunkHashes: string[];
  lastUpdated: string;
}

/** 传输会话（多文件） */
export interface TransferSession {
  sessionId: string;
  requestId: string;
  files: FileTransferState[];
  filePaths: string[];
  status: 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  targetDevice: DiscoveredDevice;
  direction: 'send' | 'receive';
}

/** 批量传输进度 */
export interface BatchTransferProgress {
  sessionId: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  transferredBytes: number;
  speed: number;
  currentFile?: FileMetadata;
  etaSeconds?: number;
}

/** 信任设备 */
export interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  addedAt: string;
}

/** 局域网传输配置 */
export interface LanTransferConfig {
  saveDirectory: string;
  tempDirectory: string;
  groupByDate: boolean;
  autoAcceptTrusted: boolean;
  trustedDevices: TrustedDevice[];
  maxConcurrentTransfers: number;
  version: string;
}

/** 哈希计算进度 */
export interface HashingProgress {
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 已处理字节数 */
  processedBytes: number;
  /** 当前文件索引（从 1 开始） */
  currentFile: number;
  /** 总文件数 */
  totalFiles: number;
}

/** 局域网传输事件 */
export type LanTransferEvent =
  | { type: 'device_discovered'; device: DiscoveredDevice }
  | { type: 'device_left'; device_id: string }
  // 点对点连接事件
  | { type: 'peer_connection_request'; request: PeerConnectionRequest }
  | { type: 'peer_connection_established'; connection: PeerConnection }
  | { type: 'peer_connection_closed'; connection_id: string }
  // 旧版连接事件
  | { type: 'connection_request'; request: ConnectionRequest }
  | { type: 'connection_response'; request_id: string; accepted: boolean }
  // 传输事件
  | { type: 'transfer_request_received'; request: TransferRequest }
  | { type: 'transfer_request_response'; request_id: string; accepted: boolean; reject_reason?: string }
  | { type: 'transfer_progress'; task: TransferTask }
  | { type: 'batch_progress'; progress: BatchTransferProgress }
  | { type: 'transfer_completed'; task_id: string; saved_path: string }
  | { type: 'batch_transfer_completed'; session_id: string; total_files: number; save_directory: string }
  | { type: 'transfer_failed'; task_id: string; error: string }
  | { type: 'service_state_changed'; is_running: boolean }
  // 哈希计算进度（大文件预处理时显示）
  | { type: 'hashing_progress'; file_name: string; file_size: number; processed_bytes: number; current_file: number; total_files: number };

/** Hook 返回值 */
export interface UseLanTransferReturn {
  /** 服务是否正在运行 */
  isRunning: boolean;
  /** 服务加载中 */
  loading: boolean;
  /** 发现的设备列表 */
  devices: DiscoveredDevice[];
  /** 待处理的连接请求（旧版） */
  pendingRequests: ConnectionRequest[];
  /** 待处理的传输请求（新版） */
  pendingTransferRequests: TransferRequest[];
  /** 活跃的传输任务 */
  activeTransfers: TransferTask[];
  /** 批量传输进度（支持多个并行会话） */
  batchProgressMap: Map<string, BatchTransferProgress>;
  /** 哈希计算进度（大文件预处理时显示） */
  hashingProgress: HashingProgress | null;
  /** 活跃的传输会话 */
  activeSessions: TransferSession[];
  /** 保存目录 */
  saveDirectory: string;
  /** 配置 */
  config: LanTransferConfig | null;

  // ========== 点对点连接（新版） ==========
  /** 活跃的点对点连接 */
  activeConnections: PeerConnection[];
  /** 待处理的点对点连接请求 */
  pendingPeerConnectionRequests: PeerConnectionRequest[];
  /** 当前打开的连接（用于传输窗口） */
  currentConnection: PeerConnection | null;
  /** 设置当前连接 */
  setCurrentConnection: (connection: PeerConnection | null) => void;
  /** 请求建立点对点连接 */
  requestPeerConnection: (deviceId: string) => Promise<string>;
  /** 响应点对点连接请求 */
  respondPeerConnection: (connectionId: string, accept: boolean) => Promise<void>;
  /** 断开点对点连接 */
  disconnectPeer: (connectionId: string) => Promise<void>;
  /** 向已连接的设备发送文件 */
  sendFilesToPeer: (connectionId: string, filePaths: string[]) => Promise<string>;

  // ========== 服务管理 ==========
  /** 启动服务 */
  startService: (userId: string, userNickname: string, deviceName?: string) => Promise<void>;
  /** 停止服务 */
  stopService: () => Promise<void>;
  /** 刷新设备列表 */
  refreshDevices: () => Promise<void>;

  // ========== 旧版兼容 ==========
  /** 发送连接请求（旧版） */
  sendConnectionRequest: (deviceId: string) => Promise<string>;
  /** 响应连接请求（旧版） */
  respondToRequest: (requestId: string, accept: boolean) => Promise<void>;
  /** 发送文件（旧版单文件） */
  sendFile: (deviceId: string, filePath: string) => Promise<string>;
  /** 发送传输请求（旧版多文件，需确认） */
  sendTransferRequest: (deviceId: string, filePaths: string[]) => Promise<string>;
  /** 响应传输请求 */
  respondToTransferRequest: (requestId: string, accept: boolean) => Promise<void>;
  /** 取消传输 */
  cancelTransfer: (transferId: string) => Promise<void>;
  /** 取消单个文件传输（并行传输中） */
  cancelFileTransfer: (fileId: string) => Promise<void>;
  /** 取消传输会话 */
  cancelSession: (requestId: string) => Promise<void>;

  // ========== 配置管理 ==========
  /** 设置保存目录 */
  setSaveDirectory: (path: string) => Promise<void>;
  /** 打开保存目录 */
  openSaveDirectory: () => Promise<void>;
  /** 添加信任设备 */
  addTrustedDevice: (deviceId: string, deviceName: string) => Promise<void>;
  /** 移除信任设备 */
  removeTrustedDevice: (deviceId: string) => Promise<void>;
  /** 设置自动接受信任设备 */
  setAutoAcceptTrusted: (enabled: boolean) => Promise<void>;
  /** 刷新配置 */
  refreshConfig: () => Promise<void>;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useLanTransfer(): UseLanTransferReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ConnectionRequest[]>([]);
  const [pendingTransferRequests, setPendingTransferRequests] = useState<TransferRequest[]>([]);
  const [activeTransfers, setActiveTransfers] = useState<TransferTask[]>([]);
  const [batchProgressMap, setBatchProgressMap] = useState<Map<string, BatchTransferProgress>>(new Map());
  const [hashingProgress, setHashingProgress] = useState<HashingProgress | null>(null);
  const [activeSessions, setActiveSessions] = useState<TransferSession[]>([]);
  const [saveDirectory, setSaveDirectoryState] = useState<string>('');
  const [config, setConfig] = useState<LanTransferConfig | null>(null);

  // 点对点连接状态
  const [activeConnections, setActiveConnections] = useState<PeerConnection[]>([]);
  const [pendingPeerConnectionRequests, setPendingPeerConnectionRequests] = useState<PeerConnectionRequest[]>([]);
  const [currentConnection, setCurrentConnection] = useState<PeerConnection | null>(null);

  // 启动服务
  const startService = useCallback(async (userId: string, userNickname: string, deviceName?: string) => {
    if (loading) {
      return;
    }

    setLoading(true);
    try {
      await invoke('start_lan_transfer_service', { userId, userNickname, deviceName: deviceName ?? null });
      setIsRunning(true);
    } catch (error) {
      console.error('[LanTransfer] 启动服务失败:', error);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // 停止服务
  const stopService = useCallback(async () => {
    setLoading(true);
    try {
      await invoke('stop_lan_transfer_service');
      setIsRunning(false);
      setDevices([]);
      setPendingRequests([]);
      setPendingTransferRequests([]);
      setBatchProgressMap(new Map());
      setActiveConnections([]);
      setPendingPeerConnectionRequests([]);
      setCurrentConnection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 刷新设备列表
  const refreshDevices = useCallback(async () => {
    try {
      const result = await invoke<DiscoveredDevice[]>('get_discovered_devices');
      setDevices(result);
    } catch (error) {
      console.error('[LanTransfer] 获取设备列表失败:', error);
    }
  }, []);

  // ========== 点对点连接函数 ==========

  // 请求建立点对点连接（带去重检查）
  const requestPeerConnection = useCallback(async (deviceId: string) => {
    // 前端去重：检查是否已与该设备建立连接
    const existingConnection = activeConnections.find(
      (c) => c.peerDevice.deviceId === deviceId && c.status === 'connected',
    );
    if (existingConnection) {
      console.warn(`[LanTransfer] 已存在与 ${deviceId} 的连接: ${existingConnection.connectionId}`);
      return existingConnection.connectionId;
    }

    const connectionId = await invoke<string>('request_peer_connection', { deviceId });
    return connectionId;
  }, [activeConnections]);

  // 响应点对点连接请求
  const respondPeerConnection = useCallback(async (connectionId: string, accept: boolean) => {
    await invoke('respond_peer_connection', { connectionId, accept });
    setPendingPeerConnectionRequests((prev) =>
      prev.filter((r) => r.connectionId !== connectionId),
    );
  }, []);

  // 断开点对点连接
  const disconnectPeer = useCallback(async (connectionId: string) => {
    await invoke('disconnect_peer', { connectionId });
    setActiveConnections((prev) =>
      prev.filter((c) => c.connectionId !== connectionId),
    );
    // 如果断开的是当前连接，清空
    setCurrentConnection((prev) =>
      prev?.connectionId === connectionId ? null : prev,
    );
  }, []);

  // 向已连接的设备发送文件
  const sendFilesToPeer = useCallback(async (connectionId: string, filePaths: string[]) => {
    const sessionId = await invoke<string>('send_files_to_peer', { connectionId, filePaths });
    return sessionId;
  }, []);

  // ========== 旧版兼容函数 ==========

  // 发送连接请求（旧版）
  const sendConnectionRequest = useCallback(async (deviceId: string) => {
    const requestId = await invoke<string>('send_connection_request', { deviceId });
    return requestId;
  }, []);

  // 响应连接请求（旧版）
  const respondToRequest = useCallback(async (requestId: string, accept: boolean) => {
    await invoke('respond_to_connection_request', { requestId, accept });
    setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  }, []);

  // 发送文件（旧版单文件）
  const sendFile = useCallback(async (deviceId: string, filePath: string) => {
    const taskId = await invoke<string>('send_file_to_device', { deviceId, filePath });
    return taskId;
  }, []);

  // 发送传输请求（新版多文件）
  const sendTransferRequest = useCallback(async (deviceId: string, filePaths: string[]) => {
    const requestId = await invoke<string>('send_transfer_request', { deviceId, filePaths });
    return requestId;
  }, []);

  // 响应传输请求
  const respondToTransferRequest = useCallback(async (requestId: string, accept: boolean) => {
    await invoke('respond_to_transfer_request', { requestId, accept });
    setPendingTransferRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  }, []);

  // 取消传输
  const cancelTransfer = useCallback(async (transferId: string) => {
    await invoke('cancel_transfer', { transferId });
  }, []);

  // 取消单个文件传输（并行传输中的单文件取消）
  const cancelFileTransfer = useCallback(async (fileId: string) => {
    await invoke('cancel_file_transfer', { fileId });
  }, []);

  // 取消传输会话
  const cancelSession = useCallback(async (requestId: string) => {
    await invoke('cancel_transfer_session', { requestId });
  }, []);

  // 设置保存目录
  const setSaveDirectory = useCallback(async (path: string) => {
    await invoke('set_lan_transfer_save_directory', { path });
    setSaveDirectoryState(path);
  }, []);

  // 打开保存目录
  const openSaveDirectory = useCallback(async () => {
    await invoke('open_lan_transfer_directory');
  }, []);

  // 添加信任设备
  const addTrustedDevice = useCallback(async (deviceId: string, deviceName: string) => {
    await invoke('add_trusted_device', { deviceId, deviceName });
    // 刷新配置
    const newConfig = await invoke<LanTransferConfig>('get_lan_transfer_config');
    setConfig(newConfig);
  }, []);

  // 移除信任设备
  const removeTrustedDevice = useCallback(async (deviceId: string) => {
    await invoke('remove_trusted_device', { deviceId });
    // 刷新配置
    const newConfig = await invoke<LanTransferConfig>('get_lan_transfer_config');
    setConfig(newConfig);
  }, []);

  // 设置自动接受信任设备
  const setAutoAcceptTrusted = useCallback(async (enabled: boolean) => {
    await invoke('set_auto_accept_trusted', { enabled });
    // 刷新配置
    const newConfig = await invoke<LanTransferConfig>('get_lan_transfer_config');
    setConfig(newConfig);
  }, []);

  // 刷新配置
  const refreshConfig = useCallback(async () => {
    try {
      const newConfig = await invoke<LanTransferConfig>('get_lan_transfer_config');
      setConfig(newConfig);
      setSaveDirectoryState(newConfig.saveDirectory);
    } catch (error) {
      console.error('[LanTransfer] 获取配置失败:', error);
    }
  }, []);

  // 监听事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<LanTransferEvent>('lan-transfer-event', (event) => {
        const payload = event.payload;

        switch (payload.type) {
          case 'device_discovered':
            setDevices((prev) => {
              const exists = prev.some((d) => d.deviceId === payload.device.deviceId);
              if (exists) {
                return prev.map((d) =>
                  d.deviceId === payload.device.deviceId ? payload.device : d,
                );
              }
              return [...prev, payload.device];
            });
            break;

          case 'device_left':
            setDevices((prev) => prev.filter((d) => d.deviceId !== payload.device_id));
            break;

          // 点对点连接事件
          case 'peer_connection_request':
            setPendingPeerConnectionRequests((prev) => {
              const exists = prev.some((r) => r.connectionId === payload.request.connectionId);
              if (exists) {
                return prev;
              }
              return [...prev, payload.request];
            });
            break;

          case 'peer_connection_established':
            setActiveConnections((prev) => {
              const exists = prev.some((c) => c.connectionId === payload.connection.connectionId);
              if (exists) {
                return prev.map((c) =>
                  c.connectionId === payload.connection.connectionId ? payload.connection : c,
                );
              }
              return [...prev, payload.connection];
            });
            // 连接建立后，清理来自该设备的待处理请求（解决互相请求时的重复显示问题）
            setPendingPeerConnectionRequests((prev) =>
              prev.filter((r) => r.fromDevice.deviceId !== payload.connection.peerDevice.deviceId),
            );
            // 自动设置为当前连接（可以用于打开传输窗口）
            setCurrentConnection(payload.connection);
            break;

          case 'peer_connection_closed':
            setActiveConnections((prev) =>
              prev.filter((c) => c.connectionId !== payload.connection_id),
            );
            // 如果关闭的是当前连接，清空
            setCurrentConnection((prev) =>
              prev?.connectionId === payload.connection_id ? null : prev,
            );
            break;

          // 旧版连接事件
          case 'connection_request':
            setPendingRequests((prev) => [...prev, payload.request]);
            break;

          case 'connection_response':
            // 处理连接响应
            break;

          case 'transfer_request_received':
            setPendingTransferRequests((prev) => {
              const exists = prev.some((r) => r.requestId === payload.request.requestId);
              if (exists) {
                return prev;
              }
              return [...prev, payload.request];
            });
            break;

          case 'transfer_request_response':
            // 处理传输请求响应
            if (!payload.accepted) {
              // 如果被拒绝，可以显示通知
              console.warn('[LanTransfer] 传输请求被拒绝:', payload.reject_reason);
            }
            break;

          case 'transfer_progress':
            setActiveTransfers((prev) => {
              const exists = prev.some((t) => t.taskId === payload.task.taskId);
              if (exists) {
                return prev.map((t) =>
                  t.taskId === payload.task.taskId ? payload.task : t,
                );
              }
              return [...prev, payload.task];
            });
            break;

          case 'batch_progress':
            setBatchProgressMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(payload.progress.sessionId, payload.progress);
              return newMap;
            });
            // 传输开始后清除哈希进度
            setHashingProgress(null);
            break;

          case 'hashing_progress':
            // 大文件哈希计算进度
            setHashingProgress({
              fileName: payload.file_name,
              fileSize: payload.file_size,
              processedBytes: payload.processed_bytes,
              currentFile: payload.current_file,
              totalFiles: payload.total_files,
            });
            break;

          case 'transfer_completed':
            setActiveTransfers((prev) =>
              prev.filter((t) => t.taskId !== payload.task_id),
            );
            break;

          case 'batch_transfer_completed':
            setBatchProgressMap((prev) => {
              const newMap = new Map(prev);
              newMap.delete(payload.session_id);
              return newMap;
            });
            // 刷新会话列表
            invoke<TransferSession[]>('get_all_transfer_sessions').then(setActiveSessions);
            break;

          case 'transfer_failed':
            setActiveTransfers((prev) =>
              prev.filter((t) => t.taskId !== payload.task_id),
            );
            break;

          case 'service_state_changed':
            setIsRunning(payload.is_running);
            break;
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 定期刷新设备列表
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const initialTimeoutId = setTimeout(() => {
      refreshDevices();
    }, 500);

    const intervalId = setInterval(() => {
      refreshDevices();
    }, 5000);

    return () => {
      clearTimeout(initialTimeoutId);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // 获取待处理请求
  useEffect(() => {
    if (!isRunning) { return; }

    const fetchRequests = async () => {
      try {
        const [connectionRequests, transferRequests, peerConnectionRequests, peerConnections] = await Promise.all([
          invoke<ConnectionRequest[]>('get_pending_connection_requests'),
          invoke<TransferRequest[]>('get_pending_transfer_requests'),
          invoke<PeerConnectionRequest[]>('get_pending_peer_connection_requests'),
          invoke<PeerConnection[]>('get_active_peer_connections'),
        ]);
        setPendingRequests(connectionRequests);
        setPendingTransferRequests(transferRequests);
        setPendingPeerConnectionRequests(peerConnectionRequests);
        setActiveConnections(peerConnections);
      } catch (error) {
        console.error('[LanTransfer] 获取请求失败:', error);
      }
    };

    fetchRequests();
  }, [isRunning]);

  // 获取活跃传输和会话
  useEffect(() => {
    if (!isRunning) { return; }

    const fetchTransfers = async () => {
      try {
        const [transfers, sessions] = await Promise.all([
          invoke<TransferTask[]>('get_active_transfers'),
          invoke<TransferSession[]>('get_all_transfer_sessions'),
        ]);
        setActiveTransfers(transfers);
        setActiveSessions(sessions);
      } catch (error) {
        console.error('[LanTransfer] 获取传输任务失败:', error);
      }
    };

    fetchTransfers();
  }, [isRunning]);

  // 获取配置
  useEffect(() => {
    if (!isRunning) { return; }
    refreshConfig();
  }, [isRunning, refreshConfig]);

  return {
    // 基础状态
    isRunning,
    loading,
    devices,
    pendingRequests,
    pendingTransferRequests,
    activeTransfers,
    batchProgressMap,
    hashingProgress,
    activeSessions,
    saveDirectory,
    config,

    // 点对点连接
    activeConnections,
    pendingPeerConnectionRequests,
    currentConnection,
    setCurrentConnection,
    requestPeerConnection,
    respondPeerConnection,
    disconnectPeer,
    sendFilesToPeer,

    // 服务管理
    startService,
    stopService,
    refreshDevices,

    // 旧版兼容
    sendConnectionRequest,
    respondToRequest,
    sendFile,
    sendTransferRequest,
    respondToTransferRequest,
    cancelTransfer,
    cancelFileTransfer,
    cancelSession,

    // 配置管理
    setSaveDirectory,
    openSaveDirectory,
    addTrustedDevice,
    removeTrustedDevice,
    setAutoAcceptTrusted,
    refreshConfig,
  };
}
