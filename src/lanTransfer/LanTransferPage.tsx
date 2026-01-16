/**
 * 局域网传输独立窗口页面
 *
 * 作为独立窗口运行，提供局域网设备发现和文件传输功能
 * 通过 localStorage 获取用户数据
 *
 * 功能：
 * - 显示发现的局域网设备列表
 * - 发送/接收连接请求
 * - 选择文件进行传输
 * - 显示传输进度
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLanTransfer, DiscoveredDevice, ConnectionRequest, TransferTask } from '../hooks/useLanTransfer';
import { loadLanTransferData, clearLanTransferData } from './api';
import './styles.css';

// ============================================================================
// 调试信息类型
// ============================================================================

interface DebugInfo {
  localIp: string;
  allInterfaces: Array<{ name: string; ip: string }>;
  deviceId: string;
  hostname: string;
  os: string;
  servicePort: number;
  mdnsServiceType: string;
  startTime: string;
  eventCount: number;
  lastEvent: string;
}

// ============================================================================
// 图标组件
// ============================================================================

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 4v6h6M23 20v-6h-6" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
  </svg>
);

const ComputerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const XIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const DebugIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// ============================================================================
// 动画配置
// ============================================================================

const cardVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

// ============================================================================
// 子组件
// ============================================================================

interface DeviceCardProps {
  device: DiscoveredDevice;
  onSelect: () => void;
}

function DeviceCard({ device, onSelect }: DeviceCardProps) {
  return (
    <motion.div
      className="lan-device-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
    >
      <div className="lan-device-icon">
        <ComputerIcon />
      </div>
      <div className="lan-device-info">
        <div className="lan-device-name">{device.deviceName}</div>
        <div className="lan-device-user">
          {device.userNickname} (@{device.userId})
        </div>
        <div className="lan-device-ip">{device.ipAddress}</div>
      </div>
      <button className="lan-device-send-btn" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <SendIcon />
      </button>
    </motion.div>
  );
}

interface ConnectionRequestCardProps {
  request: ConnectionRequest;
  onAccept: () => void;
  onReject: () => void;
}

function ConnectionRequestCard({ request, onAccept, onReject }: ConnectionRequestCardProps) {
  return (
    <motion.div
      className="lan-request-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="lan-request-info">
        <div className="lan-request-title">连接请求</div>
        <div className="lan-request-from">
          来自: {request.fromDevice.deviceName}
        </div>
        <div className="lan-request-user">
          用户: {request.fromDevice.userNickname}
        </div>
      </div>
      <div className="lan-request-actions">
        <button className="lan-request-accept" onClick={onAccept}>
          <CheckIcon />
        </button>
        <button className="lan-request-reject" onClick={onReject}>
          <XIcon />
        </button>
      </div>
    </motion.div>
  );
}

interface TransferProgressCardProps {
  task: TransferTask;
  onCancel: () => void;
}

function TransferProgressCard({ task, onCancel }: TransferProgressCardProps) {
  const progress = task.file.fileSize > 0
    ? (task.transferredBytes / task.file.fileSize) * 100
    : 0;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    if (bytes < 1024 * 1024 * 1024) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    return `${formatSize(bytesPerSec)}/s`;
  };

  return (
    <motion.div
      className="lan-transfer-progress-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="lan-transfer-info">
        <div className="lan-transfer-filename">{task.file.fileName}</div>
        <div className="lan-transfer-meta">
          {task.direction === 'send' ? '发送到' : '接收自'}: {task.targetDevice.deviceName}
        </div>
        <div className="lan-transfer-progress-bar">
          <div
            className="lan-transfer-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="lan-transfer-stats">
          <span>{formatSize(task.transferredBytes)} / {formatSize(task.file.fileSize)}</span>
          <span>{formatSpeed(task.speed)}</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
      </div>
      {task.status === 'transferring' && (
        <button className="lan-transfer-cancel" onClick={onCancel}>
          <XIcon />
        </button>
      )}
    </motion.div>
  );
}

// ============================================================================
// 主页面组件
// ============================================================================

export default function LanTransferPage() {
  const [userData, setUserData] = useState<{ userId: string; userNickname: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const {
    isRunning,
    loading,
    devices,
    pendingRequests,
    activeTransfers,
    startService,
    stopService,
    refreshDevices,
    respondToRequest,
    sendFile,
    cancelTransfer,
  } = useLanTransfer();

  // 服务启动状态跟踪
  const serviceStartedRef = useRef(false);

  // 添加调试日志
  const addDebugLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 99)]);
  }, []);

  // 获取调试信息
  const fetchDebugInfo = useCallback(async () => {
    try {
      addDebugLog('正在获取调试信息...');

      // 获取本机网络信息
      const networkInfo = await invoke<{
        local_ip: string;
        interfaces: Array<[string, string]>;
        device_id: string;
        hostname: string;
        os: string;
      }>('get_lan_debug_info').catch(() => null);

      if (networkInfo) {
        setDebugInfo({
          localIp: networkInfo.local_ip,
          allInterfaces: networkInfo.interfaces.map(([name, ip]) => ({ name, ip })),
          deviceId: networkInfo.device_id,
          hostname: networkInfo.hostname,
          os: networkInfo.os,
          servicePort: 53317,
          mdnsServiceType: '_hvae-xfer._tcp.local.',
          startTime: new Date().toISOString(),
          eventCount: 0,
          lastEvent: '-',
        });
        addDebugLog(`✓ 本地 IP: ${networkInfo.local_ip}`);
        addDebugLog(`✓ 设备 ID: ${networkInfo.device_id}`);
        addDebugLog(`✓ 网络接口数: ${networkInfo.interfaces.length}`);
      } else {
        addDebugLog('⚠ 无法获取调试信息（命令不存在）');
      }
    } catch (error) {
      addDebugLog(`❌ 获取调试信息失败: ${error}`);
    }
  }, [addDebugLog]);

  // 初始化：读取用户数据并启动服务
  useEffect(() => {
    const data = loadLanTransferData();
    if (!data) {
      console.error('[LanTransfer] 无法加载用户数据');
      window.close();
      return;
    }
    setUserData(data);
  }, []);

  // 启动服务
  useEffect(() => {
    if (userData && !serviceStartedRef.current) {
      serviceStartedRef.current = true;
      addDebugLog(`启动服务: 用户=${userData.userNickname} (${userData.userId})`);
      startService(userData.userId, userData.userNickname);
      // 延迟获取调试信息
      setTimeout(() => {
        fetchDebugInfo();
      }, 1000);
    }
  }, [userData, startService, addDebugLog, fetchDebugInfo]);

  // 关闭窗口时停止服务
  useEffect(() => {
    return () => {
      if (isRunning) {
        stopService();
      }
    };
  }, [isRunning, stopService]);

  // 关闭窗口
  const handleClose = useCallback(() => {
    if (isRunning) {
      stopService();
    }
    clearLanTransferData();
    window.close();
  }, [isRunning, stopService]);

  // 处理刷新设备
  const handleRefresh = useCallback(async () => {
    if (!isRunning || isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      await refreshDevices();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRunning, isRefreshing, refreshDevices]);

  // 处理文件发送
  const handleSendFile = async (device: DiscoveredDevice) => {
    try {
      const result = await open({
        multiple: false,
        title: '选择要发送的文件',
      });

      if (result) {
        await sendFile(device.deviceId, result);
      }
    } catch (error) {
      console.error('[LanTransfer] 选择文件失败:', error);
    }
  };

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  if (!userData) {
    return (
      <div className="lan-page lan-loading">
        <div className="lan-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="lan-page">
      {/* 顶部工具栏 */}
      <header className="lan-header">
        <div className="lan-header-info">
          <h1 className="lan-title">🔄 局域网互传</h1>
          <span className="lan-device-count">
            {loading ? '扫描中...' : `${devices.length} 台设备`}
          </span>
        </div>
        <div className="lan-header-actions">
          <button
            className={`lan-action-btn debug ${showDebug ? 'active' : ''}`}
            onClick={() => setShowDebug(!showDebug)}
            title="调试信息"
          >
            <DebugIcon />
          </button>
          <button
            className="lan-action-btn refresh"
            onClick={handleRefresh}
            disabled={!isRunning || isRefreshing}
            title="刷新设备列表"
          >
            <motion.span
              animate={isRefreshing ? { rotate: 360 } : {}}
              transition={isRefreshing ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
            >
              <RefreshIcon />
            </motion.span>
          </button>
          <button className="lan-action-btn close" onClick={handleClose} title="关闭 (Esc)">
            <CloseIcon />
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="lan-main">
        {/* 连接请求 */}
        <AnimatePresence>
          {pendingRequests.length > 0 && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">待处理的连接请求</h2>
              <div className="lan-cards-list">
                {pendingRequests.map((request) => (
                  <ConnectionRequestCard
                    key={request.requestId}
                    request={request}
                    onAccept={() => respondToRequest(request.requestId, true)}
                    onReject={() => respondToRequest(request.requestId, false)}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 传输进度 */}
        <AnimatePresence>
          {activeTransfers.length > 0 && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">传输中</h2>
              <div className="lan-cards-list">
                {activeTransfers.map((task) => (
                  <TransferProgressCard
                    key={task.taskId}
                    task={task}
                    onCancel={() => cancelTransfer(task.taskId)}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 设备列表 */}
        <section className="lan-section lan-devices-section">
          <h2 className="lan-section-title">局域网设备</h2>

          {/* 状态指示 */}
          <div className="lan-status-bar">
            <div className={`lan-status-dot ${isRunning ? 'running' : ''}`} />
            <span className="lan-status-text">
              {loading && '正在扫描...'}
              {!loading && isRunning && '服务运行中'}
              {!loading && !isRunning && '服务未启动'}
            </span>
          </div>

          {/* 空状态 */}
          {devices.length === 0 && !loading && (
            <div className="lan-empty-state">
              <div className="lan-empty-icon">🔍</div>
              <div className="lan-empty-text">未发现局域网设备</div>
              <div className="lan-empty-hint">
                请确保其他设备已启动并运行此应用
              </div>
            </div>
          )}

          {/* 设备卡片列表 */}
          <div className="lan-cards-list">
            <AnimatePresence mode="popLayout">
              {devices.map((device) => (
                <DeviceCard
                  key={device.deviceId}
                  device={device}
                  onSelect={() => handleSendFile(device)}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* 调试面板 */}
        <AnimatePresence>
          {showDebug && (
            <motion.section
              className="lan-section lan-debug-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="lan-debug-header" onClick={() => setShowDebug(!showDebug)}>
                <h2 className="lan-section-title">🔧 调试信息</h2>
                <ChevronIcon expanded={showDebug} />
              </div>

              <div className="lan-debug-content">
                {/* 本机信息 */}
                <div className="lan-debug-block">
                  <h3>📱 本机信息</h3>
                  {debugInfo ? (
                    <div className="lan-debug-grid">
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">主机名:</span>
                        <span className="lan-debug-value">{debugInfo.hostname}</span>
                      </div>
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">本地 IP:</span>
                        <span className="lan-debug-value highlight">{debugInfo.localIp}</span>
                      </div>
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">设备 ID:</span>
                        <span className="lan-debug-value mono">{debugInfo.deviceId}</span>
                      </div>
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">操作系统:</span>
                        <span className="lan-debug-value">{debugInfo.os}</span>
                      </div>
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">服务端口:</span>
                        <span className="lan-debug-value">{debugInfo.servicePort}</span>
                      </div>
                      <div className="lan-debug-item">
                        <span className="lan-debug-label">mDNS 类型:</span>
                        <span className="lan-debug-value mono">{debugInfo.mdnsServiceType}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="lan-debug-loading">加载中...</div>
                  )}
                </div>

                {/* 网络接口 */}
                <div className="lan-debug-block">
                  <h3>🌐 网络接口</h3>
                  {debugInfo?.allInterfaces ? (
                    <div className="lan-debug-interfaces">
                      {debugInfo.allInterfaces.map((iface, idx) => (
                        <div
                          key={idx}
                          className={`lan-debug-interface ${iface.ip === debugInfo.localIp ? 'active' : ''}`}
                        >
                          <span className="lan-debug-iface-name">{iface.name}</span>
                          <span className="lan-debug-iface-ip">{iface.ip}</span>
                          {iface.ip === debugInfo.localIp && (
                            <span className="lan-debug-iface-badge">当前</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="lan-debug-loading">加载中...</div>
                  )}
                </div>

                {/* 服务状态 */}
                <div className="lan-debug-block">
                  <h3>📡 服务状态</h3>
                  <div className="lan-debug-grid">
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">mDNS 服务:</span>
                      <span className={`lan-debug-value ${isRunning ? 'success' : 'error'}`}>
                        {isRunning ? '✅ 运行中' : '❌ 未启动'}
                      </span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">发现设备数:</span>
                      <span className="lan-debug-value">{devices.length}</span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">待处理请求:</span>
                      <span className="lan-debug-value">{pendingRequests.length}</span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">活跃传输:</span>
                      <span className="lan-debug-value">{activeTransfers.length}</span>
                    </div>
                  </div>
                </div>

                {/* 调试日志 */}
                <div className="lan-debug-block">
                  <h3>📋 调试日志</h3>
                  <div className="lan-debug-logs">
                    {debugLogs.length > 0 ? (
                      debugLogs.map((log, idx) => (
                        <div key={idx} className="lan-debug-log-entry">
                          {log}
                        </div>
                      ))
                    ) : (
                      <div className="lan-debug-log-empty">暂无日志</div>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="lan-debug-actions">
                  <button className="lan-debug-btn" onClick={fetchDebugInfo}>
                    🔄 刷新信息
                  </button>
                  <button
                    className="lan-debug-btn"
                    onClick={() => {
                      addDebugLog('手动触发设备刷新');
                      refreshDevices();
                    }}
                  >
                    📡 刷新设备
                  </button>
                  <button
                    className="lan-debug-btn danger"
                    onClick={() => setDebugLogs([])}
                  >
                    🗑️ 清除日志
                  </button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
