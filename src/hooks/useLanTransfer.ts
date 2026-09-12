/**
 * 局域网传输 Hook
 *
 * 提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 启动/停止局域网传输服务
 * - 获取发现的设备列表（自动更新设备信息，包括 IP 地址变化）
 * - 点对点连接管理（带去重检查，防止重复连接）
 * - 多文件并行批量传输（默认并行度 3）
 * - 单文件取消支持（cancelFileTransfer）
 * - 会话级批量取消支持（cancelSession）
 * - 断点续传支持
 * - 实时进度跟踪（单文件 + 批量进度）
 * - 配置管理
 *
 * 传输模式：
 * - 仅支持点对点连接模式：需先建立连接后才能传输文件
 * - 旧版传输请求模式已移除
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
 * - 2026-02: D-08 服务启停错误入 serviceError；D-15 失败原因入文件级状态、终态条目保留；
 *   D-16 仅发起方写 currentConnection；D-17 哈希进度按发起目标归属；D-18 删除死状态 paused；
 *   D-12 调试事件真实计数；批量 payload 增补 direction/peer（D-01/D-22 归属依据）
 * - 2026-02-04: 移除旧版传输请求模式 (sendTransferRequest/respondToTransferRequest)
 * - 2026-01-25: 修复设备 IP 不更新、批量进度不更新、取消按钮不工作问题
 * - 2026-01-25: 支持多个并行传输会话（batchProgressMap）
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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

/** 传输任务 */
export interface TransferTask {
  taskId: string;
  sessionId: string;
  file: FileMetadata;
  direction: 'send' | 'receive';
  targetDevice: DiscoveredDevice;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  transferredBytes: number;
  speed: number;
  startedAt: string;
  etaSeconds?: number;
}

/** 文件传输状态 */
export interface FileTransferState {
  file: FileMetadata;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
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
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  targetDevice: DiscoveredDevice;
  direction: 'send' | 'receive';
}

/** 传输状态（D-18：paused 是无人产出的死状态，已从状态机删除） */
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

/** 批量会话终态（Rust 增补字段，可能缺省） */
export type BatchOutcome = 'completed' | 'cancelled' | 'failed' | 'partial';

/** 单文件进度信息（用于前端显示文件列表） */
export interface FileProgressInfo {
  /** 文件 ID */
  fileId: string;
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 已传输字节数 */
  transferredBytes: number;
  /** 传输状态 */
  status: TransferStatus;
  /** 失败原因（transfer_failed / failed_files 下发，D-15：不再丢弃） */
  error?: string;
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
  /** 每个文件的进度信息 */
  files?: FileProgressInfo[];
  /** 传输方向（Rust 增补，可能缺省；归属/展示优先于会话表回退） */
  direction?: 'send' | 'receive';
  /** 对端设备 ID（Rust 增补，可能缺省） */
  peerDeviceId?: string;
  /** 对端设备名（Rust 增补，可能缺省） */
  peerDeviceName?: string;
  /** 会话终态（batch_transfer_completed 下发；completed 的条目被移除，其余保留展示失败原因） */
  outcome?: BatchOutcome;
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
  // 旧版连接事件（保留兼容性）
  | { type: 'connection_request'; request: ConnectionRequest }
  | { type: 'connection_response'; request_id: string; accepted: boolean }
  | { type: 'transfer_progress'; task: TransferTask }
  | { type: 'batch_progress'; progress: BatchTransferProgress }
  | { type: 'transfer_completed'; task_id: string; saved_path: string }
  | {
      type: 'batch_transfer_completed';
      session_id: string;
      total_files: number;
      save_directory: string;
      /** 会话终态（Rust 增补，可能缺省；缺省按 completed 处理） */
      outcome?: BatchOutcome;
      /** 失败文件清单（Rust 增补，可能缺省） */
      failed_files?: Array<{ file_id?: string; file_name?: string; error?: string }>;
    }
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
  /** 活跃的传输任务 */
  activeTransfers: TransferTask[];
  /** 批量传输进度（支持多个并行会话） */
  batchProgressMap: Map<string, BatchTransferProgress>;
  /** 哈希计算进度（大文件预处理时显示） */
  hashingProgress: HashingProgress | null;
  /** 哈希进度归属的设备 ID（D-17；null = 交给会话表回退判定，UI 不得全员广播） */
  hashingDeviceId: string | null;
  /** 活跃的传输会话 */
  activeSessions: TransferSession[];
  /** 保存目录 */
  saveDirectory: string;
  /** 配置 */
  config: LanTransferConfig | null;
  /** 服务启停错误信息（D-08：不再吞错，供 UI 服务状态区展示；null = 无错误） */
  serviceError: string | null;
  /** 已收到的局域网传输事件总数（D-12：调试面板真实计数） */
  eventCount: number;
  /** 最后一次收到的事件类型名 */
  lastEvent: string | null;

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
  /** 取消传输 */
  cancelTransfer: (transferId: string) => Promise<void>;
  /** 取消单个文件传输（并行传输中） */
  cancelFileTransfer: (fileId: string) => Promise<void>;
  /** 取消传输会话 */
  cancelSession: (sessionId: string) => Promise<void>;
  /** 关闭已终结的批量条目（失败/取消/部分完成后保留在进度表里的终态卡片） */
  dismissBatchSession: (sessionId: string) => void;

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
  const [activeTransfers, setActiveTransfers] = useState<TransferTask[]>([]);
  const [batchProgressMap, setBatchProgressMap] = useState<Map<string, BatchTransferProgress>>(new Map());
  const [hashingProgress, setHashingProgress] = useState<HashingProgress | null>(null);
  const [activeSessions, setActiveSessions] = useState<TransferSession[]>([]);
  // 已经为其补拉过会话表的 sessionId。会话表是「进度 → 设备」归属的唯一桥
  // （BatchTransferProgress 本身不带 connectionId/deviceId），而它原先只在服务启停
  // 和「整批传完」两个时刻拉取 —— 传输**进行中**新建的会话因此永远不在表里，
  // UI 拿不到归属就只能不显示进度。故首次见到某个 sessionId 的进度就补拉一次。
  const sessionsFetchedForRef = useRef<Set<string>>(new Set());
  const [saveDirectory, setSaveDirectoryState] = useState<string>('');
  const [config, setConfig] = useState<LanTransferConfig | null>(null);

  // 点对点连接状态
  const [activeConnections, setActiveConnections] = useState<PeerConnection[]>([]);
  const [pendingPeerConnectionRequests, setPendingPeerConnectionRequests] = useState<PeerConnectionRequest[]>([]);
  const [currentConnection, setCurrentConnection] = useState<PeerConnection | null>(null);

  // D-08：服务启停错误不再吞掉，供 UI 服务状态区展示
  const [serviceError, setServiceError] = useState<string | null>(null);
  // D-12：调试面板真实事件计数
  const [eventCount, setEventCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  // D-17：哈希进度归属（发起发送时锁定的目标设备；null = 交给会话表回退判定）
  const [hashingDeviceId, setHashingDeviceId] = useState<string | null>(null);

  // 事件回调里读取最新列表用的镜像（listener 只挂载一次，闭包里的 state 会过期）
  const activeTransfersRef = useRef<TransferTask[]>([]);
  const activeConnectionsRef = useRef<PeerConnection[]>([]);
  useEffect(() => { activeTransfersRef.current = activeTransfers; }, [activeTransfers]);
  useEffect(() => { activeConnectionsRef.current = activeConnections; }, [activeConnections]);
  // 发送发起时锁定的哈希归属目标（哈希阶段先于会话落表，会话表那时还查不到这次发送）
  const hashingTargetRef = useRef<string | null>(null);
  // StrictMode 双挂载/重复点击时的启动去重：并发调用共享同一次 invoke
  const startInProgressRef = useRef<Promise<void> | null>(null);

  // 启动服务
  const startService = useCallback(async (userId: string, userNickname: string, deviceName?: string) => {
    // D-19：并发调用（StrictMode 双挂载会连跑两遍 effect）共享同一次 invoke，
    // 避免「第二调用被 loading 挡板丢弃 → 服务永远没启动」。
    if (startInProgressRef.current) {
      return startInProgressRef.current;
    }
    const run = (async () => {
      setLoading(true);
      setServiceError(null);
      try {
        await invoke('start_lan_transfer_service', { userId, userNickname, deviceName: deviceName ?? null });
        setIsRunning(true);
      } catch (error) {
        // D-08/D-15：失败原因写入 serviceError 供 UI 展示，不再只进 console
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LanTransfer] 启动服务失败:', error);
        setIsRunning(false);
        setServiceError(`服务启动失败：${message}`);
      } finally {
        setLoading(false);
      }
    })();
    startInProgressRef.current = run;
    try {
      await run;
    } finally {
      startInProgressRef.current = null;
    }
  }, []);

  // 停止服务
  const stopService = useCallback(async () => {
    setLoading(true);
    try {
      await invoke('stop_lan_transfer_service');
    } catch (error) {
      // D-08：停止失败（如服务本就没在运行的关窗竞态）不能打断调用方的关窗/清理流程
      console.error('[LanTransfer] 停止服务失败:', error);
      setServiceError(`服务停止失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 无论 invoke 成败都把本地状态清干净，UI 才能可靠地关窗/复位
      setIsRunning(false);
      setDevices([]);
      setPendingRequests([]);
      setBatchProgressMap(new Map());
      setActiveConnections([]);
      setPendingPeerConnectionRequests([]);
      setCurrentConnection(null);
      setHashingProgress(null);
      setHashingDeviceId(null);
      hashingTargetRef.current = null;
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
    // D-17：哈希进度归属 —— 哈希阶段先于会话落表（会话表里还查不到这次发送），
    // 发起时按连接锁定目标设备，后续 hashing_progress 事件归属到它
    hashingTargetRef.current = activeConnectionsRef.current.find(
      (c) => c.connectionId === connectionId,
    )?.peerDevice?.deviceId ?? null;
    try {
      const sessionId = await invoke<string>('send_files_to_peer', { connectionId, filePaths });
      return sessionId;
    } catch (error) {
      hashingTargetRef.current = null;
      throw error;
    }
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

  // 关闭已终结的批量条目（失败/取消后保留在进度表里的终态卡片）
  const dismissBatchSession = useCallback((sessionId: string) => {
    setBatchProgressMap((prev) => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    sessionsFetchedForRef.current.delete(sessionId);
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
        if (!payload || typeof payload.type !== 'string') {
          return;
        }
        // D-12：调试面板真实事件计数
        setEventCount((c) => c + 1);
        setLastEvent(payload.type);

        switch (payload.type) {
          case 'device_discovered':
            if (!payload.device?.deviceId) {
              break;
            }
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
            if (!payload.request?.connectionId) {
              break;
            }
            setPendingPeerConnectionRequests((prev) => {
              const exists = prev.some((r) => r.connectionId === payload.request.connectionId);
              if (exists) {
                return prev;
              }
              return [...prev, payload.request];
            });
            break;

          case 'peer_connection_established': {
            const connection = payload.connection;
            if (!connection?.connectionId) {
              break;
            }
            setActiveConnections((prev) => {
              const exists = prev.some((c) => c.connectionId === connection.connectionId);
              if (exists) {
                return prev.map((c) =>
                  c.connectionId === connection.connectionId ? connection : c,
                );
              }
              return [...prev, connection];
            });
            // 连接建立后，清理来自该设备的待处理请求（解决互相请求时的重复显示问题）
            setPendingPeerConnectionRequests((prev) =>
              prev.filter((r) => r.fromDevice?.deviceId !== connection.peerDevice?.deviceId),
            );
            // D-16：仅发起方写入 currentConnection —— 被动接受对方发起的连接不该
            // 覆盖用户正在操作的连接（多连接时无条件抢占是埋雷）
            if (connection.isInitiator === true) {
              setCurrentConnection(connection);
            }
            break;
          }

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

          case 'batch_progress': {
            const progress = payload.progress;
            if (!progress?.sessionId) {
              break;
            }
            const { sessionId } = progress;
            setBatchProgressMap((prev) => {
              const newMap = new Map(prev);
              newMap.set(sessionId, progress);
              return newMap;
            });
            // 新会话首次上报进度 → 补拉会话表，让 UI 能把进度归属到具体设备
            if (!sessionsFetchedForRef.current.has(sessionId)) {
              sessionsFetchedForRef.current.add(sessionId);
              invoke<TransferSession[]>('get_all_transfer_sessions')
                .then(setActiveSessions)
                .catch((error) => {
                  // 拉不到就让下一条进度事件再试（这次的 sessionId 从已拉集合里退出来）
                  sessionsFetchedForRef.current.delete(sessionId);
                  console.error('[LanTransfer] 获取会话列表失败:', error);
                });
            }
            // 哈希阶段结束的判定：归属设备的首条 batch_progress 到达。
            // 只清「自己这一批」的哈希进度 —— 其它会话（如另一台设备的并行传输）的进度
            // 不能把正在进行的哈希进度吞掉（D-17）。对端字段缺省（旧后端）时退回无条件清理。
            const hashingTarget = hashingTargetRef.current;
            if (
              progress.peerDeviceId === undefined ||
              progress.peerDeviceId === null ||
              hashingTarget === null ||
              progress.peerDeviceId === hashingTarget
            ) {
              hashingTargetRef.current = null;
              setHashingProgress(null);
              setHashingDeviceId(null);
            }
            break;
          }

          case 'hashing_progress':
            // 大文件哈希计算进度（D-17：归属 = sendFilesToPeer 发起时锁定的目标设备）
            setHashingProgress({
              fileName: payload.file_name,
              fileSize: payload.file_size,
              processedBytes: payload.processed_bytes,
              currentFile: payload.current_file,
              totalFiles: payload.total_files,
            });
            setHashingDeviceId(hashingTargetRef.current);
            break;

          case 'transfer_completed':
            setActiveTransfers((prev) =>
              prev.filter((t) => t.taskId !== payload.task_id),
            );
            break;

          case 'batch_transfer_completed': {
            // D-15：终态不再无条件删条目 —— outcome!=='completed' 或带失败文件时保留
            // 终态卡片，把失败原因合并到对应文件上，用户才能看到“哪个文件为什么失败”。
            const outcome = payload.outcome ?? 'completed';
            const failedFiles = Array.isArray(payload.failed_files) ? payload.failed_files : [];
            const keepEntry = outcome !== 'completed' || failedFiles.length > 0;
            setBatchProgressMap((prev) => {
              const next = new Map(prev);
              const existing = next.get(payload.session_id);
              if (!keepEntry) {
                next.delete(payload.session_id);
                return next;
              }
              const failedById = new Map<string, { file_name?: string; error?: string }>();
              const failedByName = new Map<string, { file_name?: string; error?: string }>();
              for (const fail of failedFiles) {
                if (fail.file_id) { failedById.set(fail.file_id, fail); }
                if (fail.file_name) { failedByName.set(fail.file_name, fail); }
              }
              const markTerminal = (f: FileProgressInfo): FileProgressInfo => {
                const fail = failedById.get(f.fileId) ?? failedByName.get(f.fileName);
                if (fail) {
                  return { ...f, status: 'failed', error: fail.error ?? '传输失败' };
                }
                // 会话已终态：没有明确终态的残留文件不能永远挂在“传输中”
                if (f.status === 'pending' || f.status === 'transferring') {
                  return { ...f, status: outcome === 'cancelled' ? 'cancelled' : 'failed' };
                }
                return f;
              };
              if (existing) {
                next.set(payload.session_id, {
                  ...existing,
                  outcome,
                  files: (existing.files ?? []).map(markTerminal),
                });
              } else if (failedFiles.length > 0) {
                // 终态先于任何进度事件到达：构造最小终态条目，避免失败被无声吞掉
                next.set(payload.session_id, {
                  sessionId: payload.session_id,
                  totalFiles: payload.total_files ?? failedFiles.length,
                  completedFiles: 0,
                  totalBytes: 0,
                  transferredBytes: 0,
                  speed: 0,
                  outcome,
                  files: failedFiles.map((fail) => ({
                    fileId: fail.file_id ?? fail.file_name ?? '',
                    fileName: fail.file_name ?? fail.file_id ?? '未知文件',
                    fileSize: 0,
                    transferredBytes: 0,
                    status: 'failed' as TransferStatus,
                    error: fail.error ?? '传输失败',
                  })),
                });
              }
              return next;
            });
            sessionsFetchedForRef.current.delete(payload.session_id);
            // 刷新会话列表
            invoke<TransferSession[]>('get_all_transfer_sessions')
              .then(setActiveSessions)
              .catch((error) => console.error('[LanTransfer] 获取会话列表失败:', error));
            break;
          }

          case 'transfer_failed': {
            // D-15：失败原因不再丢弃 —— 写入批量条目的文件级状态，供文件行内展示。
            // task_id → sessionId/fileId 的映射借 activeTransfers 镜像完成。
            const message = typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : '传输失败';
            const task = activeTransfersRef.current.find((t) => t.taskId === payload.task_id);
            if (task?.sessionId && task.file?.fileId) {
              setBatchProgressMap((prev) => {
                const entry = prev.get(task.sessionId);
                if (!entry) {
                  return prev;
                }
                const files = (entry.files ?? []).map((f) =>
                  f.fileId === task.file.fileId
                    ? { ...f, status: 'failed' as TransferStatus, error: message }
                    : f,
                );
                const next = new Map(prev);
                next.set(task.sessionId, { ...entry, files });
                return next;
              });
            }
            setActiveTransfers((prev) =>
              prev.filter((t) => t.taskId !== payload.task_id),
            );
            break;
          }

          case 'service_state_changed':
            setIsRunning(payload.is_running === true);
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
        const [connectionRequests, peerConnectionRequests, peerConnections] = await Promise.all([
          invoke<ConnectionRequest[]>('get_pending_connection_requests'),
          invoke<PeerConnectionRequest[]>('get_pending_peer_connection_requests'),
          invoke<PeerConnection[]>('get_active_peer_connections'),
        ]);
        setPendingRequests(connectionRequests);
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
    activeTransfers,
    batchProgressMap,
    hashingProgress,
    hashingDeviceId,
    activeSessions,
    saveDirectory,
    config,
    serviceError,
    eventCount,
    lastEvent,

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
    cancelTransfer,
    cancelFileTransfer,
    cancelSession,
    dismissBatchSession,

    // 配置管理
    setSaveDirectory,
    openSaveDirectory,
    addTrustedDevice,
    removeTrustedDevice,
    setAutoAcceptTrusted,
    refreshConfig,
  };
}
