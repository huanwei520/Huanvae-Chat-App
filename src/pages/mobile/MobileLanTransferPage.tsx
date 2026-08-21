/**
 * 移动端局域网互传页面
 *
 * 提供局域网设备发现和文件传输功能
 *
 * 功能：
 * - 显示发现的局域网设备列表
 * - 发送/接收传输请求
 * - 显示传输进度
 * - 调试面板（与桌面端一致）
 *
 * 样式：
 * - 使用与抽屉一致的白色毛玻璃效果
 * - 颜色通过 CSS 变量统一管理，支持主题切换
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useSession } from '../../contexts/SessionContext';
import { selectFilesForTransfer, cleanupTempFiles, type FilePreparationStatus } from '../../utils/androidFileHandler';
import { createTempCleanupTracker } from '../../lanTransfer/tempCleanupTracker';
import {
  useLanTransfer,
  type DiscoveredDevice,
  type PeerConnectionRequest,
} from '../../hooks/useLanTransfer';
import { platform } from '@tauri-apps/plugin-os';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

// 从 UserAgent 解析 Android 设备型号
function getDeviceModel(): string {
  const ua = navigator.userAgent;
  // 匹配 Android 设备型号: Android X.X; DEVICE_MODEL Build/
  const match = ua.match(/Android\s[\d.]+;\s*([^)]+?)\s*(?:Build|;)/i);
  if (match?.[1]) {
    let model = match[1].trim();
    model = model.replace(/\s+SDK\s+\d+/i, '');
    model = model.replace(/;\s*[a-z]{2}[-_][A-Z]{2}$/i, '');
    return model;
  }
  return 'Android Device';
}

// ============================================
// 调试信息类型
// ============================================

interface DebugInfo {
  localIp: string;
  allInterfaces: Array<{ name: string; ip: string }>;
  deviceId: string;
  hostname: string;
}

// ============================================
// 辅助函数（使用统一的 format.ts）
// ============================================

import { formatSize, formatSpeed, formatEta } from '../../utils/format';

// ============================================
// 图标组件
// ============================================

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// 刷新图标
const RefreshIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
);

// 调试图标
const DebugIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
    />
  </svg>
);

// 连接图标
const LinkIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
    />
  </svg>
);

// 文件夹图标（已连接时显示）
const FolderIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z"
    />
  </svg>
);

// 断开连接图标
const DisconnectIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

// 设备图标
const DeviceIcon = ({ deviceName }: { deviceName: string }) => {
  const isPhone = deviceName.toLowerCase().includes('phone') ||
    deviceName.toLowerCase().includes('android') ||
    deviceName.toLowerCase().includes('iphone');

  if (isPhone) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
};

// ============================================
// 类型定义
// ============================================

interface MobileLanTransferPageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

// ============================================
// 主组件
// ============================================

export function MobileLanTransferPage({ onClose }: MobileLanTransferPageProps) {
  const { session } = useSession();
  const transfer = useLanTransfer();

  // 选中的设备
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);

  // 调试状态
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const serviceStartedRef = useRef(false);
  // 待清理的 Android 临时文件（按 sessionId 登记，传完才删）
  const tempCleanupRef = useRef(createTempCleanupTracker());

  // 文件准备状态（Android 专用）
  const [filePreparation, setFilePreparation] = useState<FilePreparationStatus | null>(null);

  // 添加调试日志
  const addDebugLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.warn(`[LanTransfer] ${message}`);
    setDebugLogs((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 99)]);
  }, []);

  // 获取调试信息（兼容移动端和桌面端）
  const fetchDebugInfo = useCallback(async () => {
    try {
      addDebugLog('正在获取调试信息...');

      // 尝试获取网络信息
      const networkInfo = await invoke<{
        local_ip: string;
        interfaces: Array<[string, string]>;
        device_id: string;
      }>('get_lan_transfer_network_info').catch(() => null);

      if (networkInfo) {
        setDebugInfo({
          localIp: networkInfo.local_ip,
          allInterfaces: networkInfo.interfaces.map(([name, ip]) => ({ name, ip })),
          deviceId: networkInfo.device_id,
          hostname: '-',
        });
        addDebugLog(`✓ 本地 IP: ${networkInfo.local_ip}`);
        addDebugLog(`✓ 设备 ID: ${networkInfo.device_id}`);
        addDebugLog(`✓ 网络接口数: ${networkInfo.interfaces.length}`);
      } else {
        addDebugLog('⚠ 命令不可用，使用备用方式');
        // 备用：从 transfer 状态获取
        setDebugInfo({
          localIp: '检测中...',
          allInterfaces: [],
          deviceId: session?.userId || '-',
          hostname: '-',
        });
      }
    } catch (error) {
      addDebugLog(`❌ 获取调试信息失败: ${error}`);
    }
  }, [addDebugLog, session?.userId]);

  // 启动服务（仅在组件挂载时执行一次）
  useEffect(() => {
    // 防止重复启动
    if (serviceStartedRef.current) {
      return;
    }

    if (!session) {
      return;
    }

    serviceStartedRef.current = true;
    const userId = session.userId;
    const nickname = session.profile?.user_nickname || userId;
    const deviceModel = getDeviceModel();
    addDebugLog(`启动服务: 用户=${nickname} (${userId}), 设备=${deviceModel}`);

    transfer.startService(userId, nickname, deviceModel)
      .then(() => {
        addDebugLog('✓ 服务启动成功');
        fetchDebugInfo();
      })
      .catch((err) => {
        addDebugLog(`❌ 服务启动失败: ${err}`);
      });

    // 组件卸载时停止服务
    return () => {
      transfer.stopService();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听服务状态变化
  useEffect(() => {
    if (transfer.isRunning) {
      addDebugLog('✓ 服务状态: 运行中');
    } else if (serviceStartedRef.current) {
      addDebugLog('⚠ 服务状态: 未运行');
    }
  }, [transfer.isRunning, addDebugLog]);

  // 监听设备发现
  useEffect(() => {
    if (transfer.devices.length > 0) {
      addDebugLog(`发现 ${transfer.devices.length} 个设备`);
    }
  }, [transfer.devices.length, addDebugLog]);

  // 监听传输进度（接收调试信息）
  useEffect(() => {
    if (transfer.activeTransfers.length > 0) {
      const task = transfer.activeTransfers[0];
      const progress = task.file.fileSize > 0
        ? Math.round((task.transferredBytes / task.file.fileSize) * 100)
        : 0;
      const direction = task.direction === 'send' ? '📤 发送' : '📥 接收';
      addDebugLog(`${direction}: ${task.file.fileName} (${progress}%, ${formatSpeed(task.speed)})`);
    }
  }, [transfer.activeTransfers, addDebugLog]);

  // 监听批量进度
  useEffect(() => {
    if (transfer.batchProgressMap.size > 0) {
      transfer.batchProgressMap.forEach((bp, sessionId) => {
        const progress = bp.totalBytes > 0
          ? Math.round((bp.transferredBytes / bp.totalBytes) * 100)
          : 0;
        addDebugLog(`📊 批量传输 [${sessionId.slice(0, 8)}]: ${bp.completedFiles}/${bp.totalFiles} 文件, ${progress}%`);
      });
    }
  }, [transfer.batchProgressMap, addDebugLog]);

  // 传完即删：会话在进度表里出现过又消失 = 这一批落幕
  useEffect(() => {
    const activeIds = new Set(transfer.batchProgressMap.keys());
    for (const paths of tempCleanupRef.current.settle(activeIds)) {
      cleanupTempFiles(paths).catch((e) => {
        console.warn('[LanTransfer] 清理临时文件失败:', e);
      });
    }
  }, [transfer.batchProgressMap]);

  // 页面卸载：放弃待清理项而不是清理它们 —— 传输由 Rust 侧承载，页面关了还在跑，
  // 这时删源文件会把它砍断。宁可漏删一次临时文件，也不能中断用户的传输。
  useEffect(() => {
    const tracker = tempCleanupRef.current;
    return () => tracker.abandon();
  }, []);

  // 刷新设备列表
  const handleRefresh = useCallback(() => {
    addDebugLog('手动刷新设备列表...');
    transfer.refreshDevices();
  }, [transfer, addDebugLog]);

  // 打开存储目录
  // Android: 使用 SAF (Storage Access Framework) 权限机制
  // 第一次需要用户选择目录授权，后续直接打开
  const handleOpenSaveDirectory = useCallback(async () => {
    addDebugLog('📂 尝试打开存储目录...');
    try {
      const os = await platform();
      addDebugLog(`平台: ${os}`);

      if (os === 'android') {
        addDebugLog('正在加载 AndroidFs 插件...');
        try {
          const androidFs = await import('tauri-plugin-android-fs-api');
          addDebugLog('✓ AndroidFs 插件已加载');

          // 检查是否有保存的目录权限
          const savedUriStr = localStorage.getItem('lanTransferDirUri');
          addDebugLog(`已保存的 URI: ${savedUriStr ? '有' : '无'}`);

          if (savedUriStr) {
            try {
              const savedUri = JSON.parse(savedUriStr);
              // 检查权限是否仍有效
              addDebugLog('检查已保存的目录权限...');
              const hasPermission = await androidFs.AndroidFs.checkPersistedUriPermission(savedUri, 'Read');
              addDebugLog(`权限状态: ${hasPermission}`);

              if (hasPermission) {
                // 直接打开目录
                addDebugLog('打开已授权的目录...');
                await androidFs.AndroidFs.showViewDirDialog(savedUri);
                addDebugLog('✓ 已打开存储目录');
                return;
              } else {
                addDebugLog('⚠ 权限已失效，需要重新授权');
                localStorage.removeItem('lanTransferDirUri');
              }
            } catch (parseErr) {
              addDebugLog(`⚠ 解析保存的 URI 失败: ${parseErr}`);
              localStorage.removeItem('lanTransferDirUri');
            }
          }

          // 请求用户选择目录（权限申请）
          addDebugLog('请求用户选择接收目录...');
          addDebugLog('提示: 请导航到 Download/HuanvaeChat 并选择');
          const uri = await androidFs.AndroidFs.showOpenDirPicker();

          if (uri) {
            addDebugLog(`用户选择了目录: ${JSON.stringify(uri)}`);

            // 持久化权限
            addDebugLog('持久化目录权限...');
            await androidFs.AndroidFs.persistPickerUriPermission(uri);
            addDebugLog('✓ 权限已持久化');

            // 保存 URI 到本地存储
            localStorage.setItem('lanTransferDirUri', JSON.stringify(uri));
            addDebugLog('✓ URI 已保存');

            // 打开目录
            addDebugLog('打开目录...');
            await androidFs.AndroidFs.showViewDirDialog(uri);
            addDebugLog('✓ 已打开存储目录');
          } else {
            addDebugLog('⚠ 用户取消了目录选择');
          }
        } catch (e) {
          addDebugLog(`❌ AndroidFs 操作失败: ${e}`);
        }
      } else {
        // 其他平台使用标准方式
        await transfer.openSaveDirectory();
        addDebugLog('✓ 已打开存储目录');
      }
    } catch (err) {
      addDebugLog(`❌ 打开目录失败: ${err}`);
    }
  }, [transfer, addDebugLog]);

  // 请求建立点对点连接
  const handleRequestConnection = useCallback(async (device: DiscoveredDevice) => {
    try {
      addDebugLog(`请求连接到 ${device.deviceName}`);
      await transfer.requestPeerConnection(device.deviceId);
      addDebugLog('✓ 连接请求已发送');
    } catch (err) {
      addDebugLog(`❌ 连接请求失败: ${err}`);
    }
  }, [transfer, addDebugLog]);

  // 响应点对点连接请求
  const handleRespondConnection = useCallback(async (request: PeerConnectionRequest, accept: boolean) => {
    try {
      addDebugLog(`${accept ? '接受' : '拒绝'}连接请求: ${request.fromDevice.deviceName}`);
      await transfer.respondPeerConnection(request.connectionId, accept);
      addDebugLog(`✓ 已${accept ? '接受' : '拒绝'}连接请求`);
    } catch (err) {
      addDebugLog(`❌ 响应连接请求失败: ${err}`);
      console.error('[LanTransfer] 响应连接请求失败:', err);
    }
  }, [transfer, addDebugLog]);

  // 检查设备是否已连接
  const isDeviceConnected = useCallback((deviceId: string) => {
    return transfer.activeConnections.some((c) => c.peerDevice.deviceId === deviceId);
  }, [transfer.activeConnections]);

  // 断开与设备的连接
  const handleDisconnectDevice = useCallback(async (device: DiscoveredDevice) => {
    const connection = transfer.activeConnections.find(
      (c) => c.peerDevice.deviceId === device.deviceId,
    );
    if (!connection) { return; }

    try {
      addDebugLog(`断开与 ${device.deviceName} 的连接`);
      await transfer.disconnectPeer(connection.connectionId);
      addDebugLog('✓ 已断开连接');
    } catch (err) {
      addDebugLog(`❌ 断开连接失败: ${err}`);
    }
  }, [transfer, addDebugLog]);

  // 选择文件并发送（在已建立的连接中）
  // 使用 selectFilesForTransfer 处理 Android content:// URI 问题
  const handleSendFiles = useCallback(async (device: DiscoveredDevice) => {
    try {
      // 检查是否已连接
      const connection = transfer.activeConnections.find(
        (c) => c.peerDevice.deviceId === device.deviceId,
      );

      // 文件准备状态回调（Android 专用，用于显示准备动画）
      const handleStatusChange = (status: FilePreparationStatus) => {
        setFilePreparation(status);
        if (status.phase === 'preparing' && status.currentFileName) {
          addDebugLog(`正在准备: ${status.currentFileName} (${status.processedFiles + 1}/${status.totalFiles})`);
        } else if (status.phase === 'done') {
          // 准备完成后清除状态
          setTimeout(() => setFilePreparation(null), 300);
        }
      };

      if (!connection) {
        // 未连接，需要先建立连接
        addDebugLog(`⚠ 请先与 ${device.deviceName} 建立连接`);
        setFilePreparation(null);
        return;
      }

      // 已连接，直接发送文件
      addDebugLog(`选择文件发送到 ${device.deviceName}`);

      // 使用 Android 文件处理函数（自动处理 content:// URI）
      addDebugLog('正在打开文件选择器...');
      const filePaths = await selectFilesForTransfer({
        multiple: true,
        title: '选择要发送的文件',
        onStatusChange: handleStatusChange,
      });

      addDebugLog(`文件选择结果: ${filePaths.length} 个文件`);

      if (filePaths.length > 0) {
        addDebugLog(`发送 ${filePaths.length} 个文件: ${filePaths.map((p) => p.split('/').pop()).join(', ')}`);
        const sessionId = await transfer.sendFilesToPeer(connection.connectionId, filePaths);
        addDebugLog('✓ 文件发送已开始');

        // 临时文件（Android 把 content:// 复制出来的那份）等**这一批真的传完**再删。
        // 判定与结算见 lanTransfer/tempCleanupTracker —— 不能按固定时长猜，
        // 传一个大文件远不止那点时间，到点删掉的正是传输正在读的源文件。
        tempCleanupRef.current.register(sessionId, filePaths);
      } else {
        addDebugLog('⚠ 未选择任何文件');
        setFilePreparation(null); // 清除状态
      }
    } catch (err) {
      addDebugLog(`❌ 发送失败: ${err}`);
      console.error('[LanTransfer] 选择文件失败:', err);
    }
  }, [transfer, addDebugLog]);

  // 页面动画
  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="mobile-lan-transfer-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-lan-transfer-header">
        <button className="mobile-lan-transfer-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-lan-transfer-title">局域网互传</h1>
        <div className="mobile-lan-transfer-actions">
          <button className="mobile-lan-transfer-action" onClick={handleRefresh}>
            <RefreshIcon />
          </button>
          <button
            className={`mobile-lan-transfer-action ${showDebug ? 'active' : ''}`}
            onClick={() => setShowDebug(!showDebug)}
          >
            <DebugIcon />
          </button>
        </div>
      </header>

      {/* 状态栏 */}
      <div className="mobile-lan-transfer-status">
        <div className={`status-dot ${transfer.isRunning ? 'running' : 'stopped'}`} />
        <span>{transfer.isRunning ? '服务运行中' : '服务未启动'}</span>
        {transfer.loading && <LoadingSpinner />}
      </div>

      {/* 存储目录 */}
      <div className="mobile-lan-save-directory">
        <span className="save-directory-label">接收目录:</span>
        <span className="save-directory-path">
          {transfer.saveDirectory || '/Download/HuanvaeChat'}
        </span>
        <button className="save-directory-btn" onClick={handleOpenSaveDirectory}>
          打开
        </button>
      </div>

      {/* 调试面板 */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            className="mobile-lan-debug-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            {/* 本机信息 */}
            <div className="mobile-lan-debug-block">
              <h3>本机信息</h3>
              {debugInfo ? (
                <div className="mobile-lan-debug-grid">
                  <div className="mobile-lan-debug-item">
                    <span className="label">本地 IP:</span>
                    <span className="value">{debugInfo.localIp}</span>
                  </div>
                  <div className="mobile-lan-debug-item">
                    <span className="label">设备 ID:</span>
                    <span className="value mono">{debugInfo.deviceId.substring(0, 16)}...</span>
                  </div>
                  {debugInfo.allInterfaces.length > 0 && (
                    <div className="mobile-lan-debug-interfaces">
                      <span className="label">网络接口:</span>
                      {debugInfo.allInterfaces.slice(0, 5).map((iface, idx) => (
                        <div key={idx} className="iface-item">
                          <span className="iface-name">{iface.name}</span>
                          <span className="iface-ip">{iface.ip}</span>
                        </div>
                      ))}
                      {debugInfo.allInterfaces.length > 5 && (
                        <div className="iface-more">+{debugInfo.allInterfaces.length - 5} 更多</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mobile-lan-debug-loading">
                  <LoadingSpinner />
                  <span>加载中...</span>
                </div>
              )}
            </div>

            {/* 服务状态 */}
            <div className="mobile-lan-debug-block">
              <h3>服务状态</h3>
              <div className="mobile-lan-debug-grid">
                <div className="mobile-lan-debug-item">
                  <span className="label">mDNS 服务:</span>
                  <span className={`value ${transfer.isRunning ? 'success' : 'error'}`}>
                    {transfer.isRunning ? '运行中' : '未启动'}
                  </span>
                </div>
                <div className="mobile-lan-debug-item">
                  <span className="label">发现设备数:</span>
                  <span className="value">{transfer.devices.length}</span>
                </div>
                <div className="mobile-lan-debug-item">
                  <span className="label">活跃传输:</span>
                  <span className="value">{transfer.activeTransfers.length}</span>
                </div>
              </div>
            </div>

            {/* 调试日志 */}
            <div className="mobile-lan-debug-block">
              <div className="mobile-lan-debug-log-header">
                <h3>调试日志</h3>
                <div className="mobile-lan-debug-log-actions">
                  <button onClick={fetchDebugInfo}>刷新</button>
                  <button onClick={() => setDebugLogs([])}>清空</button>
                </div>
              </div>
              <div className="mobile-lan-debug-logs">
                {debugLogs.length === 0 ? (
                  <div className="mobile-lan-debug-log-empty">暂无日志</div>
                ) : (
                  debugLogs.map((log, idx) => (
                    <div key={idx} className="mobile-lan-debug-log-entry">{log}</div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 点对点连接请求 */}
      <AnimatePresence>
        {transfer.pendingPeerConnectionRequests.length > 0 && (
          <motion.div
            className="mobile-lan-transfer-requests connection-requests"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <h3>连接请求</h3>
            {transfer.pendingPeerConnectionRequests.map((request) => (
              <div key={request.connectionId} className="transfer-request-card">
                <div className="request-info">
                  <span className="request-from">{request.fromDevice.deviceName}</span>
                  <span className="request-files">
                    {request.fromDevice.userNickname} 请求与你建立连接
                  </span>
                </div>
                <div className="request-actions">
                  <button
                    className="accept-btn"
                    onClick={() => handleRespondConnection(request, true)}
                  >
                    接受
                  </button>
                  <button
                    className="reject-btn"
                    onClick={() => handleRespondConnection(request, false)}
                  >
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 哈希计算进度（大文件预处理） */}
      {transfer.hashingProgress && transfer.batchProgressMap.size === 0 && (
        <div className="mobile-lan-batch-progress hashing">
          <div className="batch-progress-header">
            <span className="batch-progress-title">正在计算校验值...</span>
            <span className="batch-progress-count">
              {transfer.hashingProgress.currentFile}/{transfer.hashingProgress.totalFiles} 文件
            </span>
          </div>
          <div className="batch-current-file">
            {transfer.hashingProgress.fileName}
          </div>
          <div className="batch-progress-bar">
            <div
              className="batch-progress-fill hashing"
              style={{
                width: `${transfer.hashingProgress.fileSize > 0
                  ? (transfer.hashingProgress.processedBytes / transfer.hashingProgress.fileSize) * 100
                  : 0}%`,
              }}
            />
          </div>
          <div className="batch-progress-stats">
            <span>{formatSize(transfer.hashingProgress.processedBytes)} / {formatSize(transfer.hashingProgress.fileSize)}</span>
          </div>
        </div>
      )}

      {/* 批量传输进度（支持多个并行会话） */}
      {Array.from(transfer.batchProgressMap.entries()).map(([sessionId, bp]) => (
        <div key={sessionId} className="mobile-lan-batch-progress">
          <div className="batch-progress-header">
            <span className="batch-progress-title">
              批量传输 {transfer.batchProgressMap.size > 1 ? `#${Array.from(transfer.batchProgressMap.keys()).indexOf(sessionId) + 1}` : ''}
            </span>
            <span className="batch-progress-count">
              {bp.completedFiles}/{bp.totalFiles} 文件
            </span>
            <button
              className="batch-cancel-btn"
              onClick={() => transfer.cancelSession(sessionId)}
            >
              全部取消
            </button>
          </div>

          {/* 文件列表 */}
          {bp.files && bp.files.length > 0 && (
            <div className="mobile-lan-file-list">
              {bp.files.map((file) => {
                const filePercentage = file.fileSize > 0
                  ? (file.transferredBytes / file.fileSize) * 100
                  : 0;
                const canCancel = file.status === 'pending' || file.status === 'transferring';
                // 根据状态获取标签
                const getStatusLabel = (): string => {
                  switch (file.status) {
                    case 'completed': return '✓';
                    case 'failed': return '✗';
                    case 'cancelled': return '已跳过';
                    default: return '';
                  }
                };
                const statusLabel = getStatusLabel();

                return (
                  <div key={file.fileId} className={`mobile-lan-file-item ${file.status}`}>
                    <div className="mobile-lan-file-info">
                      <div className="mobile-lan-file-name" title={file.fileName}>
                        {file.fileName}
                      </div>
                      <div className="mobile-lan-file-progress-bar">
                        <div
                          className={`mobile-lan-file-progress-fill ${file.status}`}
                          style={{ width: `${filePercentage}%` }}
                        />
                      </div>
                      <div className="mobile-lan-file-stats">
                        <span>{formatSize(file.transferredBytes)} / {formatSize(file.fileSize)}</span>
                        {statusLabel && <span className={`mobile-lan-file-status ${file.status}`}>{statusLabel}</span>}
                      </div>
                    </div>
                    {canCancel && (
                      <button
                        className="mobile-lan-file-cancel-btn"
                        onClick={() => transfer.cancelFileTransfer(file.fileId)}
                        title="跳过此文件"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 总进度条 */}
          <div className="batch-progress-bar">
            <div
              className="batch-progress-fill"
              style={{
                width: `${bp.totalBytes > 0
                  ? (bp.transferredBytes / bp.totalBytes) * 100
                  : 0}%`,
              }}
            />
          </div>
          <div className="batch-progress-stats">
            <span>{formatSize(bp.transferredBytes)} / {formatSize(bp.totalBytes)}</span>
            <span>{formatSpeed(bp.speed)}</span>
            {bp.etaSeconds && (
              <span>剩余 {formatEta(bp.etaSeconds)}</span>
            )}
          </div>
        </div>
      ))}

      {/* 设备列表 */}
      <div className="mobile-lan-transfer-content">
        <h3>发现的设备</h3>
        {transfer.devices.length === 0 ? (
          <div className="no-devices">
            {transfer.isRunning ? (
              <>
                <LoadingSpinner />
                <span>正在搜索设备...</span>
              </>
            ) : (
              <span>服务未启动，无法发现设备</span>
            )}
          </div>
        ) : (
          <div className="device-list">
            {transfer.devices.map((device) => {
              const connected = isDeviceConnected(device.deviceId);
              return (
                <motion.div
                  key={device.deviceId}
                  className={`device-card ${connected ? 'connected' : ''} ${selectedDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                  onClick={() => setSelectedDevice(device)}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="device-icon">
                    <DeviceIcon deviceName={device.deviceName} />
                  </div>
                  <div className="device-info">
                    <div className="device-name-row">
                      <span className="device-name">{device.deviceName || device.userNickname}</span>
                      {connected && <span className="connected-badge">已连接</span>}
                    </div>
                    <span className="device-user">{device.userNickname}</span>
                    <span className="device-ip">{device.ipAddress}</span>
                  </div>
                  <div className="device-actions">
                    {connected ? (
                      <>
                        {/* 已连接：显示发送文件和断开连接按钮 */}
                        <button
                          className="connect-btn connected"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendFiles(device);
                          }}
                          title="发送文件"
                        >
                          <FolderIcon />
                        </button>
                        <button
                          className="disconnect-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDisconnectDevice(device);
                          }}
                          title="断开连接"
                        >
                          <DisconnectIcon />
                        </button>
                      </>
                    ) : (
                      /* 未连接：显示连接图标 */
                      <button
                        className="connect-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRequestConnection(device);
                        }}
                        title="请求连接"
                      >
                        <LinkIcon />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* 文件准备遮罩层（Android 专用） */}
      <AnimatePresence>
        {filePreparation && filePreparation.phase === 'preparing' && (
          <motion.div
            className="file-preparation-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="file-preparation-content">
              <div className="file-preparation-spinner">
                <LoadingSpinner />
              </div>
              <div className="file-preparation-title">正在准备文件...</div>
              <div className="file-preparation-info">
                {filePreparation.currentFileName ? (
                  <span className="file-name">{filePreparation.currentFileName}</span>
                ) : (
                  <span>读取文件信息中</span>
                )}
              </div>
              <div className="file-preparation-progress">
                {filePreparation.processedFiles} / {filePreparation.totalFiles} 个文件
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
