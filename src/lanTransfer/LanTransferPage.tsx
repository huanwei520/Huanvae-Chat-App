/**
 * 局域网传输独立窗口页面
 *
 * 作为独立窗口运行，提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 显示发现的局域网设备列表
 * - 发送/接收传输请求（需确认）
 * - 多文件选择和传输（支持拖放）
 * - 显示传输进度（支持批量）
 * - 单文件取消支持
 * - 断点续传
 * - 设置面板（保存目录、信任设备）
 *
 * UI 架构：
 * - DeviceCard: 设备卡片，支持展开/收起
 * - InlineTransferPanel: 内联传输面板（展开后显示在设备卡片下方）
 *   - 拖放区域
 *   - 文件列表（显示每个文件的进度和状态）
 *   - 单文件取消按钮
 *   - 总体进度和取消全部按钮
 *
 * 更新日志：
 * - 2026-02-03: 重构为内联展开式 UI，移除弹窗覆盖层
 * - 2026-02-03: 添加文件列表和单文件取消支持
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
  BatchTransferProgress,
  HashingProgress,
  FileMetadata,
  FileProgressInfo,
  TransferStatus,
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
  onSendFilePaths?: (paths: string[]) => void;
  onDisconnect?: () => void;
  onCancelFile?: (fileId: string) => void;
  onCancelSession?: (sessionId: string) => void;
  isTrusted?: boolean;
  isConnected?: boolean;
  connection?: PeerConnection;
  batchProgress?: BatchTransferProgress | null;
  hashingProgress?: HashingProgress | null;
}

function DeviceCard({
  device,
  onRequestConnection,
  onSendFiles,
  onSendFilePaths,
  onDisconnect,
  onCancelFile,
  onCancelSession,
  isTrusted,
  isConnected,
  connection,
  batchProgress,
  hashingProgress,
}: DeviceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 连接后自动展开
  useEffect(() => {
    if (isConnected && connection) {
      setIsExpanded(true);
    }
  }, [isConnected, connection]);

  const handleToggleExpand = () => {
    if (isConnected) {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <motion.div
      className={`lan-device-card-wrapper ${isExpanded ? 'expanded' : ''}`}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div
        className={`lan-device-card ${isConnected ? 'connected' : ''} ${isExpanded ? 'expanded' : ''}`}
        onClick={handleToggleExpand}
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
              {/* 已连接：显示展开/收起和断开连接按钮 */}
              <button
                className="lan-device-expand-btn"
                onClick={(e) => { e.stopPropagation(); handleToggleExpand(); }}
                title={isExpanded ? '收起' : '展开'}
              >
                <ChevronIcon expanded={isExpanded} />
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
      </div>

      {/* 展开的传输面板 */}
      <AnimatePresence>
        {isExpanded && isConnected && connection && (
          <InlineTransferPanel
            connection={connection}
            batchProgress={batchProgress ?? null}
            hashingProgress={hashingProgress ?? null}
            onSendFiles={onSendFiles ?? (() => {})}
            onSendFilePaths={onSendFilePaths ?? (() => {})}
            onCancelFile={onCancelFile ?? (() => {})}
            onCancelSession={onCancelSession ?? (() => {})}
          />
        )}
      </AnimatePresence>
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

// ============================================================================
// 内联传输面板（展开后显示在设备卡片下方）
// ============================================================================

interface InlineTransferPanelProps {
  connection: PeerConnection;
  batchProgress: BatchTransferProgress | null;
  hashingProgress: HashingProgress | null;
  onSendFiles: () => void;
  onSendFilePaths: (paths: string[]) => void;
  onCancelFile: (fileId: string) => void;
  onCancelSession: (sessionId: string) => void;
}

/** 获取状态标签和样式类 */
function getStatusInfo(status: TransferStatus): { label: string; className: string } {
  switch (status) {
    case 'pending':
      return { label: '等待中', className: 'pending' };
    case 'transferring':
      return { label: '传输中', className: 'transferring' };
    case 'completed':
      return { label: '已完成', className: 'completed' };
    case 'failed':
      return { label: '失败', className: 'failed' };
    case 'cancelled':
      return { label: '已取消', className: 'cancelled' };
    case 'paused':
      return { label: '已暂停', className: 'paused' };
    default:
      return { label: '未知', className: '' };
  }
}

// 全局拖放事件管理器 - 避免多个组件同时注册监听器导致重复触发
const globalDragDropState = {
  currentHandler: null as ((paths: string[]) => void) | null,
  isListenerSetup: false,
};

function InlineTransferPanel({
  connection,
  batchProgress,
  hashingProgress,
  onSendFiles,
  onSendFilePaths,
  onCancelFile,
  onCancelSession,
}: InlineTransferPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // 处理拖放事件 - 使用全局状态避免重复注册
  useEffect(() => {
    // 注册当前面板为活跃的拖放处理器
    globalDragDropState.currentHandler = onSendFilePaths;

    // 只在第一次时设置全局监听器
    if (!globalDragDropState.isListenerSetup) {
      globalDragDropState.isListenerSetup = true;

      const setupDragListeners = async () => {
        const { listen } = await import('@tauri-apps/api/event');

        await listen(TauriEvent.DRAG_ENTER, () => {
          // 触发所有 InlineTransferPanel 的 dragging 状态通过 DOM 事件
          window.dispatchEvent(new CustomEvent('lan-drag-enter'));
        });

        await listen(TauriEvent.DRAG_LEAVE, () => {
          window.dispatchEvent(new CustomEvent('lan-drag-leave'));
        });

        await listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, (event) => {
          window.dispatchEvent(new CustomEvent('lan-drag-leave'));
          // 只调用当前活跃的处理器，避免重复触发
          if (event.payload.paths && event.payload.paths.length > 0 && globalDragDropState.currentHandler) {
            globalDragDropState.currentHandler(event.payload.paths);
          }
        });
      };

      setupDragListeners();
    }

    // 监听本地拖放事件
    const handleDragEnter = () => setIsDragging(true);
    const handleDragLeave = () => setIsDragging(false);

    window.addEventListener('lan-drag-enter', handleDragEnter);
    window.addEventListener('lan-drag-leave', handleDragLeave);

    return () => {
      // 清理本地事件监听
      window.removeEventListener('lan-drag-enter', handleDragEnter);
      window.removeEventListener('lan-drag-leave', handleDragLeave);
      // 如果当前面板是活跃处理器，清除它
      if (globalDragDropState.currentHandler === onSendFilePaths) {
        globalDragDropState.currentHandler = null;
      }
    };
  }, [onSendFilePaths]);

  const overallPercentage = batchProgress && batchProgress.totalBytes > 0
    ? (batchProgress.transferredBytes / batchProgress.totalBytes) * 100
    : 0;

  return (
    <motion.div
      className="lan-inline-transfer-panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* 拖放区域 */}
      <div
        ref={dropZoneRef}
        className={`lan-inline-dropzone${isDragging ? ' dragging' : ''}`}
        onClick={onSendFiles}
      >
        <UploadIcon />
        <span>拖拽文件到此处或点击选择</span>
      </div>

      {/* 哈希计算进度 */}
      {hashingProgress && (
        <div className="lan-inline-hashing">
          <div className="lan-inline-hashing-header">
            <span>正在计算校验值...</span>
            <span>{hashingProgress.currentFile}/{hashingProgress.totalFiles} 文件</span>
          </div>
          <div className="lan-inline-hashing-file">{hashingProgress.fileName}</div>
          <div className="lan-inline-progress-bar">
            <div
              className="lan-inline-progress-fill hashing"
              style={{
                width: `${hashingProgress.fileSize > 0 ? (hashingProgress.processedBytes / hashingProgress.fileSize) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 文件列表 */}
      {batchProgress && batchProgress.files && batchProgress.files.length > 0 && (
        <div className="lan-file-list">
          <div className="lan-file-list-header">
            <span>文件列表</span>
            <span>{batchProgress.completedFiles}/{batchProgress.totalFiles} 文件</span>
          </div>
          <div className="lan-file-list-items">
            {batchProgress.files.map((file) => {
              const filePercentage = file.fileSize > 0
                ? (file.transferredBytes / file.fileSize) * 100
                : 0;
              const statusInfo = getStatusInfo(file.status);
              const canCancel = file.status === 'pending' || file.status === 'transferring';

              return (
                <div key={file.fileId} className={`lan-file-item ${statusInfo.className}`}>
                  <div className="lan-file-item-icon">
                    <FileIcon />
                  </div>
                  <div className="lan-file-item-info">
                    <div className="lan-file-item-name" title={file.fileName}>
                      {file.fileName}
                    </div>
                    <div className="lan-file-item-progress-bar">
                      <div
                        className={`lan-file-item-progress-fill ${statusInfo.className}`}
                        style={{ width: `${filePercentage}%` }}
                      />
                    </div>
                    <div className="lan-file-item-stats">
                      <span>{formatSize(file.transferredBytes)} / {formatSize(file.fileSize)}</span>
                      <span className={`lan-file-item-status ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                  {canCancel && (
                    <button
                      className="lan-file-item-cancel"
                      onClick={() => onCancelFile(file.fileId)}
                      title="跳过此文件"
                    >
                      <XIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 总体进度 */}
      {batchProgress && batchProgress.totalBytes > 0 && (
        <div className="lan-inline-overall">
          <div className="lan-inline-progress-bar">
            <div
              className="lan-inline-progress-fill"
              style={{ width: `${overallPercentage}%` }}
            />
          </div>
          <div className="lan-inline-stats">
            <span>{formatSize(batchProgress.transferredBytes)} / {formatSize(batchProgress.totalBytes)}</span>
            <span>{formatSpeed(batchProgress.speed)}</span>
            {batchProgress.etaSeconds && <span>剩余 {formatEta(batchProgress.etaSeconds)}</span>}
            <button
              className="lan-inline-cancel-all"
              onClick={() => onCancelSession(batchProgress.sessionId)}
            >
              取消全部
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// PeerTransferWindow 和 TransferRequestCard 已移除
// 传输功能已整合到 InlineTransferPanel 中
// 只支持点对点连接模式，需先建立连接后才能传输文件

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
    activeTransfers,
    batchProgressMap,
    hashingProgress,
    saveDirectory,
    config,
    // 点对点连接
    activeConnections,
    pendingPeerConnectionRequests,
    requestPeerConnection,
    respondPeerConnection,
    disconnectPeer,
    sendFilesToPeer,
    // 服务管理
    startService,
    stopService,
    // 旧版兼容
    respondToRequest,
    cancelSession,
    cancelFileTransfer,
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

  // 检查设备是否已连接
  const isDeviceConnected = (deviceId: string) => {
    return activeConnections.some((c) => c.peerDevice.deviceId === deviceId);
  };

  // 获取设备的连接
  const getConnectionForDevice = (deviceId: string) => {
    return activeConnections.find((c) => c.peerDevice.deviceId === deviceId);
  };

  // 获取设备连接对应的批量传输进度
  // batchProgressMap 的 key 是 sessionId，需要遍历查找
  const getBatchProgressForDevice = (deviceId: string): BatchTransferProgress | null => {
    // 由于 batchProgressMap 的 key 是 sessionId 而非 connectionId，
    // 我们需要根据当前连接状态来判断哪个进度属于该设备
    // 暂时返回 Map 中的第一个匹配的进度（假设一个连接对应一个会话）
    const connection = getConnectionForDevice(deviceId);
    if (!connection) return null;
    
    // 遍历所有进度，查找可能属于该连接的进度
    for (const [_sessionId, progress] of batchProgressMap.entries()) {
      // 如果只有一个设备连接，直接返回
      if (activeConnections.length === 1) {
        return progress;
      }
    }
    return null;
  };

  // 从设备卡片发送文件路径（拖放）
  const handleSendFilePathsFromCard = async (device: DiscoveredDevice, paths: string[]) => {
    const connection = getConnectionForDevice(device.deviceId);
    if (!connection || !paths.length) return;

    try {
      addDebugLog(`发送 ${paths.length} 个文件到 ${device.deviceName}`);
      await sendFilesToPeer(connection.connectionId, paths);
    } catch (error) {
      console.error('[LanTransfer] 发送文件失败:', error);
      addDebugLog(`❌ 发送文件失败: ${error}`);
    }
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
                  onSendFilePaths={(paths) => handleSendFilePathsFromCard(device, paths)}
                  onDisconnect={() => handleDisconnectDevice(device)}
                  onCancelFile={cancelFileTransfer}
                  onCancelSession={cancelSession}
                  isTrusted={isDeviceTrusted(device.deviceId)}
                  isConnected={isDeviceConnected(device.deviceId)}
                  connection={getConnectionForDevice(device.deviceId)}
                  batchProgress={getBatchProgressForDevice(device.deviceId)}
                  hashingProgress={isDeviceConnected(device.deviceId) ? hashingProgress : null}
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

    </div>
  );
}
