/**
 * 局域网传输独立窗口页面
 *
 * 作为独立窗口运行，提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 显示发现的局域网设备列表
 * - 发送/接收传输请求（需确认）
 * - 多文件选择和传输
 * - 显示传输进度（支持批量）
 * - 断点续传
 * - 设置面板（保存目录、信任设备）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TauriEvent } from '@tauri-apps/api/event';
import {
  useLanTransfer,
  DiscoveredDevice,
  ConnectionRequest,
  TransferTask,
  TransferRequest,
  BatchTransferProgress,
  HashingProgress,
  FileMetadata,
  PeerConnection,
  PeerConnectionRequest,
} from '../hooks/useLanTransfer';
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
// 工具函数（使用统一的 format.ts）
// ============================================================================

import { formatSize, formatSpeed, formatEta } from '../utils/format';

// ============================================================================
// 图标组件
// ============================================================================

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ComputerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
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

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const FolderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14,2 14,8 20,8" />
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

const LinkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const DisconnectIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const UploadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
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
  onRequestConnection: () => void;
  onSendFiles?: () => void;
  onDisconnect?: () => void;
  isTrusted?: boolean;
  isConnected?: boolean;
}

function DeviceCard({ device, onRequestConnection, onSendFiles, onDisconnect, isTrusted, isConnected }: DeviceCardProps) {
  return (
    <motion.div
      className={`lan-device-card ${isConnected ? 'connected' : ''}`}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="lan-device-icon">
        <ComputerIcon />
      </div>
      <div className="lan-device-info">
        <div className="lan-device-name">
          {device.deviceName}
          {isTrusted && <span className="lan-trusted-badge">已信任</span>}
          {isConnected && <span className="lan-connected-badge">已连接</span>}
        </div>
        <div className="lan-device-user">
          {device.userNickname} (@{device.userId})
        </div>
        <div className="lan-device-ip">{device.ipAddress}</div>
      </div>
      <div className="lan-device-actions">
        {isConnected ? (
          <>
            {/* 已连接：显示发送文件和断开连接按钮 */}
            <button
              className="lan-device-connect-btn connected"
              onClick={(e) => { e.stopPropagation(); onSendFiles?.(); }}
              title="发送文件"
            >
              <FolderIcon />
            </button>
            <button
              className="lan-device-disconnect-btn"
              onClick={(e) => { e.stopPropagation(); onDisconnect?.(); }}
              title="断开连接"
            >
              <DisconnectIcon />
            </button>
          </>
        ) : (
          <button
            className="lan-device-connect-btn"
            onClick={(e) => { e.stopPropagation(); onRequestConnection(); }}
            title="请求连接"
          >
            <LinkIcon />
          </button>
        )}
      </div>
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

interface PeerConnectionRequestCardProps {
  request: PeerConnectionRequest;
  onAccept: () => void;
  onReject: () => void;
}

function PeerConnectionRequestCard({ request, onAccept, onReject }: PeerConnectionRequestCardProps) {
  return (
    <motion.div
      className="lan-request-card lan-peer-connection-request"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="lan-request-info">
        <div className="lan-request-title">
          <LinkIcon />
          <span>连接请求</span>
        </div>
        <div className="lan-request-from">
          来自: {request.fromDevice.deviceName}
        </div>
        <div className="lan-request-user">
          用户: {request.fromDevice.userNickname}
        </div>
        <div className="lan-request-desc">
          对方请求建立文件传输连接
        </div>
      </div>
      <div className="lan-request-actions">
        <button className="lan-request-accept" onClick={onAccept} title="接受连接">
          <CheckIcon />
        </button>
        <button className="lan-request-reject" onClick={onReject} title="拒绝连接">
          <XIcon />
        </button>
      </div>
    </motion.div>
  );
}

interface PeerTransferWindowProps {
  connection: PeerConnection;
  batchProgressMap: Map<string, BatchTransferProgress>;
  hashingProgress: HashingProgress | null;
  onSendFiles: () => void;
  onSendFilePaths: (paths: string[]) => void;
  onDisconnect: () => void;
  onClose: () => void;
  onCancelSession: (sessionId: string) => void;
}

function PeerTransferWindow({
  connection,
  batchProgressMap,
  hashingProgress,
  onSendFiles,
  onSendFilePaths,
  onDisconnect,
  onClose,
  onCancelSession,
}: PeerTransferWindowProps) {
  const [isDragging, setIsDragging] = useState(false);

  // 监听 Tauri 文件拖放事件
  useEffect(() => {
    const window = getCurrentWindow();
    const unlisteners: Array<() => void> = [];

    // 拖拽进入
    window.listen<{ paths: string[] }>(TauriEvent.DRAG_ENTER, (event) => {
      if (event.payload.paths && event.payload.paths.length > 0) {
        setIsDragging(true);
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    // 拖拽离开
    window.listen(TauriEvent.DRAG_LEAVE, () => {
      setIsDragging(false);
    }).then((unlisten) => unlisteners.push(unlisten));

    // 文件放下
    window.listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, (event) => {
      setIsDragging(false);
      if (event.payload.paths && event.payload.paths.length > 0) {
        onSendFilePaths(event.payload.paths);
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [onSendFilePaths]);

  return (
    <motion.div
      className="lan-peer-transfer-window"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <div className="lan-peer-transfer-header">
        <div className="lan-peer-transfer-title">
          <LinkIcon />
          <span>与 {connection.peerDevice.deviceName} 的文件传输</span>
        </div>
        <button className="lan-peer-transfer-close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="lan-peer-transfer-content">
        {/* 发送文件区域 */}
        <div className="lan-peer-transfer-send">
          <div
            className={`lan-peer-transfer-dropzone${isDragging ? ' dragging' : ''}`}
            onClick={onSendFiles}
          >
            <UploadIcon />
            <span>{isDragging ? '松开鼠标发送文件' : '点击选择文件或拖拽文件到此处'}</span>
            <span className="lan-peer-transfer-hint">支持多文件选择</span>
          </div>
        </div>

        {/* 哈希计算进度（大文件预处理） */}
        {hashingProgress && batchProgressMap.size === 0 && (
          <div className="lan-peer-transfer-progress">
            <div className="lan-peer-transfer-progress-header">
              <span>正在计算文件校验值...</span>
              <span>{hashingProgress.currentFile}/{hashingProgress.totalFiles} 个文件</span>
            </div>
            <div className="lan-peer-transfer-progress-bar">
              <div
                className="lan-peer-transfer-progress-fill hashing"
                style={{
                  width: `${(hashingProgress.processedBytes / hashingProgress.fileSize) * 100}%`,
                }}
              />
            </div>
            <div className="lan-peer-transfer-progress-info">
              <span>
                {formatSize(hashingProgress.processedBytes)} / {formatSize(hashingProgress.fileSize)}
              </span>
              <span>{hashingProgress.fileName}</span>
            </div>
          </div>
        )}

        {/* 传输进度（支持多个并行会话） */}
        {Array.from(batchProgressMap.entries()).map(([sessionId, bp]) => (
          <div key={sessionId} className="lan-peer-transfer-progress">
            <div className="lan-peer-transfer-progress-header">
              <span>传输进度 {batchProgressMap.size > 1 ? `#${Array.from(batchProgressMap.keys()).indexOf(sessionId) + 1}` : ''}</span>
              <span>{bp.completedFiles}/{bp.totalFiles} 个文件</span>
              <button
                className="lan-peer-transfer-cancel"
                onClick={() => onCancelSession(sessionId)}
                title="取消传输"
              >
                ✕
              </button>
            </div>
            <div className="lan-peer-transfer-progress-bar">
              <div
                className="lan-peer-transfer-progress-fill"
                style={{
                  width: `${bp.totalBytes > 0 ? (bp.transferredBytes / bp.totalBytes) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="lan-peer-transfer-progress-info">
              <span>
                {formatSize(bp.transferredBytes)} / {formatSize(bp.totalBytes)}
              </span>
              <span>{formatSpeed(bp.speed)}</span>
              {bp.etaSeconds && (
                <span>剩余 {formatEta(bp.etaSeconds)}</span>
              )}
            </div>
            {bp.currentFile && (
              <div className="lan-peer-transfer-current-file">
                <FileIcon />
                <span>{bp.currentFile.fileName}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="lan-peer-transfer-footer">
        <button className="lan-btn lan-btn-danger" onClick={() => { onDisconnect(); onClose(); }}>
          <DisconnectIcon />
          <span>断开连接</span>
        </button>
      </div>
    </motion.div>
  );
}

interface TransferRequestCardProps {
  request: TransferRequest;
  onAccept: () => void;
  onReject: () => void;
}

function TransferRequestCard({ request, onAccept, onReject }: TransferRequestCardProps) {
  return (
    <motion.div
      className="lan-transfer-request-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="lan-transfer-request-header">
        <div className="lan-transfer-request-title">文件传输请求</div>
        <div className="lan-transfer-request-from">
          来自: {request.fromDevice.deviceName} ({request.fromDevice.userNickname})
        </div>
      </div>
      <div className="lan-transfer-request-files">
        <div className="lan-transfer-request-files-header">
          <span>{request.files.length} 个文件</span>
          <span>总计 {formatSize(request.totalSize)}</span>
        </div>
        <div className="lan-transfer-request-files-list">
          {request.files.slice(0, 5).map((file: FileMetadata) => (
            <div key={file.fileId} className="lan-transfer-request-file">
              <FileIcon />
              <span className="lan-file-name">{file.fileName}</span>
              <span className="lan-file-size">{formatSize(file.fileSize)}</span>
            </div>
          ))}
          {request.files.length > 5 && (
            <div className="lan-transfer-request-more">
              +{request.files.length - 5} 更多文件...
            </div>
          )}
        </div>
      </div>
      <div className="lan-transfer-request-actions">
        <button className="lan-btn lan-btn-reject" onClick={onReject}>
          拒绝
        </button>
        <button className="lan-btn lan-btn-accept" onClick={onAccept}>
          接受
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
          {task.etaSeconds && <span>剩余 {formatEta(task.etaSeconds)}</span>}
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

interface BatchProgressCardProps {
  progress: BatchTransferProgress;
  onCancel: () => void;
}

function BatchProgressCard({ progress, onCancel }: BatchProgressCardProps) {
  const percentage = progress.totalBytes > 0
    ? (progress.transferredBytes / progress.totalBytes) * 100
    : 0;

  return (
    <motion.div
      className="lan-batch-progress-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="lan-batch-progress-header">
        <div className="lan-batch-progress-title">批量传输</div>
        <div className="lan-batch-progress-count">
          {progress.completedFiles} / {progress.totalFiles} 文件
        </div>
      </div>
      {progress.currentFile && (
        <div className="lan-batch-current-file">
          当前: {progress.currentFile.fileName}
        </div>
      )}
      <div className="lan-transfer-progress-bar">
        <div
          className="lan-transfer-progress-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="lan-transfer-stats">
        <span>{formatSize(progress.transferredBytes)} / {formatSize(progress.totalBytes)}</span>
        <span>{formatSpeed(progress.speed)}</span>
        <span>{percentage.toFixed(1)}%</span>
        {progress.etaSeconds && <span>剩余 {formatEta(progress.etaSeconds)}</span>}
      </div>
      <button className="lan-batch-cancel" onClick={onCancel}>
        取消全部
      </button>
    </motion.div>
  );
}

interface SettingsPanelProps {
  saveDirectory: string;
  onSetSaveDirectory: (path: string) => Promise<void>;
  onOpenSaveDirectory: () => Promise<void>;
  config: { autoAcceptTrusted: boolean; groupByDate: boolean } | null;
  onSetAutoAccept: (enabled: boolean) => Promise<void>;
  trustedDevices: Array<{ deviceId: string; deviceName: string }>;
  onRemoveTrusted: (deviceId: string) => Promise<void>;
}

function SettingsPanel({
  saveDirectory,
  onSetSaveDirectory,
  onOpenSaveDirectory,
  config,
  onSetAutoAccept,
  trustedDevices,
  onRemoveTrusted,
}: SettingsPanelProps) {
  const handleSelectDirectory = async () => {
    const result = await open({
      directory: true,
      title: '选择保存目录',
    });
    if (result) {
      await onSetSaveDirectory(result);
    }
  };

  return (
    <div className="lan-settings-panel">
      <div className="lan-settings-group">
        <h3>保存目录</h3>
        <div className="lan-settings-directory">
          <span className="lan-settings-path" title={saveDirectory}>
            {saveDirectory || '未设置'}
          </span>
          <button className="lan-btn lan-btn-small" onClick={handleSelectDirectory}>
            选择
          </button>
          <button className="lan-btn lan-btn-small" onClick={onOpenSaveDirectory}>
            <FolderIcon />
          </button>
        </div>
      </div>

      <div className="lan-settings-group">
        <h3>传输设置</h3>
        <label className="lan-settings-checkbox">
          <input
            type="checkbox"
            checked={config?.autoAcceptTrusted ?? false}
            onChange={(e) => onSetAutoAccept(e.target.checked)}
          />
          <span>自动接受来自信任设备的传输</span>
        </label>
      </div>

      <div className="lan-settings-group">
        <h3>信任设备 ({trustedDevices.length})</h3>
        {trustedDevices.length === 0 ? (
          <div className="lan-settings-empty">暂无信任设备</div>
        ) : (
          <div className="lan-trusted-devices-list">
            {trustedDevices.map((device) => (
              <div key={device.deviceId} className="lan-trusted-device-item">
                <span>{device.deviceName}</span>
                <button
                  className="lan-btn lan-btn-small lan-btn-danger"
                  onClick={() => onRemoveTrusted(device.deviceId)}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主页面组件
// ============================================================================

export default function LanTransferPage() {
  const [userData, setUserData] = useState<{ userId: string; userNickname: string } | null>(null);
  const [isScanning, setIsScanning] = useState(true); // 初始扫描状态
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const {
    isRunning,
    loading,
    devices,
    pendingRequests,
    pendingTransferRequests,
    activeTransfers,
    batchProgressMap,
    hashingProgress,
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
    // 旧版兼容
    respondToRequest,
    respondToTransferRequest,
    cancelTransfer,
    cancelFileTransfer,
    cancelSession,
    // 配置
    setSaveDirectory,
    openSaveDirectory,
    removeTrustedDevice,
    setAutoAcceptTrusted,
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
        addDebugLog('⚠ 无法获取调试信息');
      }
    } catch (error) {
      addDebugLog(`❌ 获取调试信息失败: ${error}`);
    }
  }, [addDebugLog]);

  // 初始化
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
      setIsScanning(true);
      startService(userData.userId, userData.userNickname);
      setTimeout(() => {
        fetchDebugInfo();
      }, 1000);
    }
  }, [userData, startService, addDebugLog, fetchDebugInfo]);

  // 扫描状态管理：发现设备后结束扫描状态，或超时后结束
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    // 发现设备后立即结束扫描状态
    if (devices.length > 0 && isScanning) {
      setIsScanning(false);
      return;
    }

    // 超时后结束扫描状态（5秒后）
    const timeoutId = setTimeout(() => {
      if (isScanning) {
        setIsScanning(false);
      }
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [isRunning, devices.length, isScanning]);

  // 关闭窗口时停止服务
  useEffect(() => {
    return () => {
      if (isRunning) {
        stopService();
      }
    };
  }, [isRunning, stopService]);

  // 关闭窗口
  const handleClose = useCallback(async () => {
    if (isRunning) {
      await stopService();
    }
    clearLanTransferData();
    window.close();
  }, [isRunning, stopService]);

  // 请求建立点对点连接
  const handleRequestConnection = async (device: DiscoveredDevice) => {
    try {
      addDebugLog(`请求连接到 ${device.deviceName}`);
      await requestPeerConnection(device.deviceId);
    } catch (error) {
      console.error('[LanTransfer] 请求连接失败:', error);
      addDebugLog(`❌ 请求连接失败: ${error}`);
    }
  };

  // 处理文件发送（在已建立的连接中）- 通过对话框选择
  const handleSendFilesToPeer = async () => {
    if (!currentConnection) { return; }

    try {
      const result = await open({
        multiple: true,
        title: '选择要发送的文件',
      });

      if (result && result.length > 0) {
        addDebugLog(`发送 ${result.length} 个文件到 ${currentConnection.peerDevice.deviceName}`);
        await sendFilesToPeer(currentConnection.connectionId, result);
      }
    } catch (error) {
      console.error('[LanTransfer] 选择文件失败:', error);
      addDebugLog(`❌ 选择文件失败: ${error}`);
    }
  };

  // 处理文件发送（在已建立的连接中）- 通过拖放
  const handleSendFilePathsToPeer = useCallback(async (paths: string[]) => {
    if (!currentConnection) { return; }

    try {
      addDebugLog(`拖放发送 ${paths.length} 个文件到 ${currentConnection.peerDevice.deviceName}`);
      await sendFilesToPeer(currentConnection.connectionId, paths);
    } catch (error) {
      console.error('[LanTransfer] 拖放发送文件失败:', error);
      addDebugLog(`❌ 拖放发送文件失败: ${error}`);
    }
  }, [currentConnection, sendFilesToPeer, addDebugLog]);

  // 检查设备是否已连接
  const isDeviceConnected = (deviceId: string) => {
    return activeConnections.some((c) => c.peerDevice.deviceId === deviceId);
  };

  // 获取设备的连接
  const getConnectionForDevice = (deviceId: string) => {
    return activeConnections.find((c) => c.peerDevice.deviceId === deviceId);
  };

  // 从设备卡片发送文件（在已建立的连接中）
  const handleSendFilesFromCard = async (device: DiscoveredDevice) => {
    const connection = getConnectionForDevice(device.deviceId);
    if (!connection) { return; }

    try {
      const result = await open({
        multiple: true,
        title: '选择要发送的文件',
      });

      if (result && result.length > 0) {
        addDebugLog(`发送 ${result.length} 个文件到 ${device.deviceName}`);
        await sendFilesToPeer(connection.connectionId, result);
      }
    } catch (error) {
      console.error('[LanTransfer] 选择文件失败:', error);
      addDebugLog(`❌ 选择文件失败: ${error}`);
    }
  };

  // 断开与设备的连接
  const handleDisconnectDevice = async (device: DiscoveredDevice) => {
    const connection = getConnectionForDevice(device.deviceId);
    if (!connection) { return; }

    try {
      addDebugLog(`断开与 ${device.deviceName} 的连接`);
      await disconnectPeer(connection.connectionId);
      addDebugLog('✓ 已断开连接');
    } catch (error) {
      console.error('[LanTransfer] 断开连接失败:', error);
      addDebugLog(`❌ 断开连接失败: ${error}`);
    }
  };

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false);
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, showSettings]);

  // 检查设备是否受信任
  const isDeviceTrusted = (deviceId: string) => {
    return config?.trustedDevices?.some((d) => d.deviceId === deviceId) ?? false;
  };

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
          <h1 className="lan-title">局域网互传</h1>
          <span className={`lan-device-count ${isScanning ? 'scanning' : ''}`}>
            {(() => {
              if (loading) { return '启动中...'; }
              if (isScanning) { return '搜索设备中...'; }
              return `${devices.length} 台设备`;
            })()}
          </span>
        </div>
        <div className="lan-header-actions">
          <button
            className={`lan-action-btn settings ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="设置"
          >
            <SettingsIcon />
          </button>
          <button
            className={`lan-action-btn debug ${showDebug ? 'active' : ''}`}
            onClick={() => setShowDebug(!showDebug)}
            title="调试信息"
          >
            <DebugIcon />
          </button>
          <button className="lan-action-btn close" onClick={handleClose} title="关闭 (Esc)">
            <CloseIcon />
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="lan-main">
        {/* 设置面板 */}
        <AnimatePresence>
          {showSettings && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">设置</h2>
              <SettingsPanel
                saveDirectory={saveDirectory}
                onSetSaveDirectory={setSaveDirectory}
                onOpenSaveDirectory={openSaveDirectory}
                config={config}
                onSetAutoAccept={setAutoAcceptTrusted}
                trustedDevices={config?.trustedDevices ?? []}
                onRemoveTrusted={removeTrustedDevice}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* 点对点连接请求 */}
        <AnimatePresence>
          {pendingPeerConnectionRequests.length > 0 && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">待处理的连接请求</h2>
              <div className="lan-cards-list">
                {pendingPeerConnectionRequests.map((request) => (
                  <PeerConnectionRequestCard
                    key={request.connectionId}
                    request={request}
                    onAccept={() => respondPeerConnection(request.connectionId, true)}
                    onReject={() => respondPeerConnection(request.connectionId, false)}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 传输请求（旧版兼容） */}
        <AnimatePresence>
          {pendingTransferRequests.length > 0 && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">待处理的传输请求</h2>
              <div className="lan-cards-list">
                {pendingTransferRequests.map((request) => (
                  <TransferRequestCard
                    key={request.requestId}
                    request={request}
                    onAccept={() => respondToTransferRequest(request.requestId, true)}
                    onReject={() => respondToTransferRequest(request.requestId, false)}
                  />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 连接请求（旧版兼容） */}
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

        {/* 批量传输进度（支持多个并行会话） */}
        <AnimatePresence>
          {batchProgressMap.size > 0 && (
            <motion.section
              className="lan-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h2 className="lan-section-title">
                批量传输 {batchProgressMap.size > 1 ? `(${batchProgressMap.size} 个会话)` : ''}
              </h2>
              {Array.from(batchProgressMap.entries()).map(([sessionId, bp]) => (
                <BatchProgressCard
                  key={sessionId}
                  progress={bp}
                  onCancel={() => cancelSession(sessionId)}
                />
              ))}
            </motion.section>
          )}
        </AnimatePresence>

        {/* 单文件传输进度 */}
        <AnimatePresence>
          {activeTransfers.length > 0 && batchProgressMap.size === 0 && (
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
                    onCancel={() => cancelFileTransfer(task.file.fileId)}
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
              <div className="lan-empty-icon">&#128269;</div>
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
                  onRequestConnection={() => handleRequestConnection(device)}
                  onSendFiles={() => handleSendFilesFromCard(device)}
                  onDisconnect={() => handleDisconnectDevice(device)}
                  isTrusted={isDeviceTrusted(device.deviceId)}
                  isConnected={isDeviceConnected(device.deviceId)}
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
                <h2 className="lan-section-title">调试信息</h2>
                <ChevronIcon expanded={showDebug} />
              </div>

              <div className="lan-debug-content">
                {/* 本机信息 */}
                <div className="lan-debug-block">
                  <h3>本机信息</h3>
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
                  <h3>网络接口</h3>
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
                  <h3>服务状态</h3>
                  <div className="lan-debug-grid">
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">mDNS 服务:</span>
                      <span className={`lan-debug-value ${isRunning ? 'success' : 'error'}`}>
                        {isRunning ? '运行中' : '未启动'}
                      </span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">发现设备数:</span>
                      <span className="lan-debug-value">{devices.length}</span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">待处理传输请求:</span>
                      <span className="lan-debug-value">{pendingTransferRequests.length}</span>
                    </div>
                    <div className="lan-debug-item">
                      <span className="lan-debug-label">活跃传输:</span>
                      <span className="lan-debug-value">{activeTransfers.length}</span>
                    </div>
                  </div>
                </div>

                {/* 调试日志 */}
                <div className="lan-debug-block">
                  <h3>调试日志</h3>
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
                    刷新信息
                  </button>
                  <button
                    className="lan-debug-btn danger"
                    onClick={() => setDebugLogs([])}
                  >
                    清除日志
                  </button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* 点对点传输窗口 */}
      <AnimatePresence>
        {currentConnection && (
          <div className="lan-peer-transfer-overlay">
            <PeerTransferWindow
              connection={currentConnection}
              batchProgressMap={batchProgressMap}
              hashingProgress={hashingProgress}
              onSendFiles={handleSendFilesToPeer}
              onSendFilePaths={handleSendFilePathsToPeer}
              onDisconnect={() => disconnectPeer(currentConnection.connectionId)}
              onClose={() => setCurrentConnection(null)}
              onCancelSession={cancelSession}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
