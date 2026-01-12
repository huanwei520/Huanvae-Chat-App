/**
 * 局域网传输 Hook
 *
 * 提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 启动/停止局域网传输服务
 * - 获取发现的设备列表
 * - 发送连接请求
 * - 响应连接请求
 * - 发送文件
 * - 获取传输进度
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

/** 连接请求 */
export interface ConnectionRequest {
  requestId: string;
  fromDevice: DiscoveredDevice;
  requestedAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
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
  status: 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
  transferredBytes: number;
  speed: number;
  startedAt: string;
  etaSeconds?: number;
}

/** 局域网传输事件 */
export type LanTransferEvent =
  | { type: 'device_discovered'; device: DiscoveredDevice }
  | { type: 'device_left'; deviceId: string }
  | { type: 'connection_request'; request: ConnectionRequest }
  | { type: 'connection_response'; requestId: string; accepted: boolean }
  | { type: 'transfer_progress'; task: TransferTask }
  | { type: 'transfer_completed'; taskId: string; savedPath: string }
  | { type: 'transfer_failed'; taskId: string; error: string }
  | { type: 'service_state_changed'; isRunning: boolean };

/** Hook 返回值 */
export interface UseLanTransferReturn {
  /** 服务是否正在运行 */
  isRunning: boolean;
  /** 服务加载中 */
  loading: boolean;
  /** 发现的设备列表 */
  devices: DiscoveredDevice[];
  /** 待处理的连接请求 */
  pendingRequests: ConnectionRequest[];
  /** 活跃的传输任务 */
  activeTransfers: TransferTask[];
  /** 启动服务 */
  startService: (userId: string, userNickname: string) => Promise<void>;
  /** 停止服务 */
  stopService: () => Promise<void>;
  /** 刷新设备列表 */
  refreshDevices: () => Promise<void>;
  /** 发送连接请求 */
  sendConnectionRequest: (deviceId: string) => Promise<string>;
  /** 响应连接请求 */
  respondToRequest: (requestId: string, accept: boolean) => Promise<void>;
  /** 发送文件 */
  sendFile: (deviceId: string, filePath: string) => Promise<string>;
  /** 取消传输 */
  cancelTransfer: (transferId: string) => Promise<void>;
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

  // 启动服务
  const startService = useCallback(async (userId: string, userNickname: string) => {
    // 避免重复启动
    if (loading) {
      return;
    }

    setLoading(true);
    try {
      await invoke('start_lan_transfer_service', { userId, userNickname });
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

  // 发送连接请求
  const sendConnectionRequest = useCallback(async (deviceId: string) => {
    const requestId = await invoke<string>('send_connection_request', { deviceId });
    return requestId;
  }, []);

  // 响应连接请求
  const respondToRequest = useCallback(async (requestId: string, accept: boolean) => {
    await invoke('respond_to_connection_request', { requestId, accept });
    // 从待处理列表中移除
    setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  }, []);

  // 发送文件
  const sendFile = useCallback(async (deviceId: string, filePath: string) => {
    const taskId = await invoke<string>('send_file_to_device', { deviceId, filePath });
    return taskId;
  }, []);

  // 取消传输
  const cancelTransfer = useCallback(async (transferId: string) => {
    await invoke('cancel_transfer', { transferId });
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
            setDevices((prev) => prev.filter((d) => d.deviceId !== payload.deviceId));
            break;

          case 'connection_request':
            setPendingRequests((prev) => [...prev, payload.request]);
            break;

          case 'connection_response':
            // 可以在这里处理连接响应
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

          case 'transfer_completed':
          case 'transfer_failed':
            setActiveTransfers((prev) =>
              prev.filter((t) => t.taskId !== payload.taskId),
            );
            break;

          case 'service_state_changed':
            setIsRunning(payload.isRunning);
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
  // 使用 useRef 避免 refreshDevices 依赖导致的重复触发
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    // 首次启动时延迟一小段时间再刷新，避免与启动服务同时执行
    const initialTimeoutId = setTimeout(() => {
      refreshDevices();
    }, 500);

    // 定期刷新
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
        const result = await invoke<ConnectionRequest[]>('get_pending_connection_requests');
        setPendingRequests(result);
      } catch (error) {
        console.error('[LanTransfer] 获取连接请求失败:', error);
      }
    };

    fetchRequests();
  }, [isRunning]);

  // 获取活跃传输
  useEffect(() => {
    if (!isRunning) { return; }

    const fetchTransfers = async () => {
      try {
        const result = await invoke<TransferTask[]>('get_active_transfers');
        setActiveTransfers(result);
      } catch (error) {
        console.error('[LanTransfer] 获取传输任务失败:', error);
      }
    };

    fetchTransfers();
  }, [isRunning]);

  return {
    isRunning,
    loading,
    devices,
    pendingRequests,
    activeTransfers,
    startService,
    stopService,
    refreshDevices,
    sendConnectionRequest,
    respondToRequest,
    sendFile,
    cancelTransfer,
  };
}
