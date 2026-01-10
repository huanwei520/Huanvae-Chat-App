/**
 * 设置面板组件
 *
 * iOS/macOS 风格的设置面板，按功能分组：
 * - 通知与提醒：消息提示音设置
 * - 存储与数据：缓存清理、数据重置
 * - 账户与安全：设备管理（查看和删除登录设备）
 * - 关于：版本信息、手动检查更新
 *
 * 更新检查功能：
 * - 点击检查按钮后，若已是最新版本，按钮变为"已是最新版本"
 * - 若有新版本，弹出灵动岛风格更新提示窗口
 *
 * @module components/settings/SettingsPanel
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  checkForUpdates,
  downloadAndInstall,
  restartApp,
  useUpdateToast,
  UpdateToast,
  type UpdateInfo,
} from '../../update';
import { SettingsSection } from './SettingsSection';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { SoundSelector } from './SoundSelector';
import { DeviceListPanel } from './DeviceListPanel';
import './styles.css';

// ============================================
// 类型定义
// ============================================

interface SettingsPanelProps {
  onClose: () => void;
}

// ============================================
// 图标组件
// ============================================

const BackIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const VolumeIcon: React.FC<{ muted?: boolean }> = ({ muted }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {!muted && (
      <>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </>
    )}
    {muted && (
      <>
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </>
    )}
  </svg>
);

const DatabaseIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const WarningIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// ============================================
// 辅助函数
// ============================================

/**
 * 获取更新按钮文本
 */
function getUpdateButtonText(checking: boolean, isLatest: boolean): string {
  if (checking) {
    return '检查中...';
  }
  if (isLatest) {
    return '已是最新版本';
  }
  return '检查';
}

// ============================================
// 版本信息组件
// ============================================

const AppVersionInfo: React.FC = () => {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('未知'));
  }, []);

  const currentYear = new Date().getFullYear();

  return (
    <div className="app-version-info">
      <div className="app-version-text">
        <span className="app-version-name">Huanvae Chat</span>
        <span className="app-version-number">v{version || '...'}</span>
      </div>
      <div className="app-version-copyright">© {currentYear} HuanWei</div>
    </div>
  );
};

// ============================================
// 重置确认组件
// ============================================

interface ResetConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

const ResetConfirm: React.FC<ResetConfirmProps> = ({ onConfirm, onCancel, loading }) => {
  const [confirmInput, setConfirmInput] = useState('');

  return (
    <motion.div
      className="reset-confirm-box"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <p className="reset-confirm-hint">请输入 &quot;确认清空&quot; 以继续：</p>
      <input
        type="text"
        className="reset-confirm-input"
        value={confirmInput}
        onChange={(e) => setConfirmInput(e.target.value)}
        placeholder="确认清空"
        disabled={loading}
        autoFocus
      />
      <div className="reset-confirm-actions">
        <button
          className="reset-confirm-btn reset-confirm-btn-danger"
          onClick={onConfirm}
          disabled={loading || confirmInput !== '确认清空'}
        >
          {loading ? '重置中...' : '确认重置'}
        </button>
        <button className="reset-confirm-btn reset-confirm-btn-cancel" onClick={onCancel} disabled={loading}>
          取消
        </button>
      </div>
    </motion.div>
  );
};

// ============================================
// 结果提示组件
// ============================================

interface ResultToastProps {
  type: 'success' | 'error';
  message: string;
}

const ResultToast: React.FC<ResultToastProps> = ({ type, message }) => (
  <motion.div
    className={`settings-result settings-result-${type}`}
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
  >
    {message}
  </motion.div>
);

// ============================================
// 主组件实现
// ============================================

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { notification, setNotificationEnabled } = useSettingsStore();

  // 数据管理状态
  const [clearingMessages, setClearingMessages] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 更新检查状态
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isLatestVersion, setIsLatestVersion] = useState(false);

  // 更新弹窗状态
  const toast = useUpdateToast();

  // 面板导航状态
  const [showDeviceList, setShowDeviceList] = useState(false);

  // 按 ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 清空消息缓存
  const handleClearMessages = async () => {
    setClearingMessages(true);
    setResult(null);

    try {
      await invoke('db_clear_messages');
      setResult({ type: 'success', message: '消息缓存已清空' });
      setTimeout(() => setResult(null), 3000);
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setClearingMessages(false);
    }
  };

  // 重置所有数据
  const handleResetAllData = async () => {
    setResetting(true);
    setResult(null);

    try {
      await invoke('db_clear_all_data');
      setShowResetConfirm(false);
      setResult({ type: 'success', message: '所有数据已重置' });
      setTimeout(() => setResult(null), 3000);
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setResetting(false);
    }
  };

  // 检查更新
  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) {
      return;
    }

    setCheckingUpdate(true);
    setResult(null);
    setUpdateInfo(null);
    setIsLatestVersion(false);

    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);

      if (info.available && info.version && info.update) {
        // 有新版本，弹出升级窗口
        toast.showAvailable(info.version, info.notes);
      } else {
        // 已是最新版本，更新按钮状态
        setIsLatestVersion(true);
      }
    } catch {
      setResult({ type: 'error', message: '检查更新失败，请稍后重试' });
      setTimeout(() => setResult(null), 3000);
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate, toast]);

  // 处理更新下载
  const handleUpdate = useCallback(async () => {
    if (!updateInfo?.update) {
      return;
    }

    toast.startDownload();

    try {
      await downloadAndInstall(updateInfo.update, (progress) => {
        toast.updateProgress(
          progress.percent || 0,
          progress.downloaded || 0,
          progress.contentLength || 0,
        );
      });

      toast.downloadComplete();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.showError(errorMsg);
    }
  }, [updateInfo, toast]);

  // 重启应用
  const handleRestart = useCallback(async () => {
    try {
      await restartApp();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.showError(`重启失败: ${errorMsg}`);
    }
  }, [toast]);

  return (
    <motion.div
      className="settings-panel"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* 面板头部 */}
      <div className="settings-panel-header">
        <button className="settings-back-btn" onClick={onClose}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="settings-panel-title">设置</h2>
      </div>

      {/* 面板内容 */}
      <div className="settings-panel-content">
        {/* 结果提示 */}
        <AnimatePresence>
          {result && <ResultToast type={result.type} message={result.message} />}
        </AnimatePresence>

        {/* 分组一：通知与提醒 */}
        <SettingsSection title="通知与提醒">
          <SettingsGroup>
            <SettingsRow
              icon={<VolumeIcon muted={!notification.enabled} />}
              title="消息提示音"
              subtitle="选择新消息到达时的提示音效"
              type="toggle"
              checked={notification.enabled}
              onToggle={setNotificationEnabled}
              expandable
              expanded={notification.enabled}
              expandContent={<SoundSelector />}
              showDivider={false}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* 分组二：存储与数据 */}
        <SettingsSection title="存储与数据">
          <SettingsGroup>
            <SettingsRow
              icon={<DatabaseIcon />}
              title="清空消息缓存"
              subtitle="删除本地聊天记录，不影响服务器数据"
              type="button"
              buttonText="清空"
              onButtonClick={handleClearMessages}
              buttonLoading={clearingMessages}
              buttonDisabled={clearingMessages}
              showDivider
            />
            <SettingsRow
              icon={<WarningIcon />}
              title="重置所有数据"
              subtitle="清空所有本地缓存，需重新同步"
              type="button"
              buttonText="重置"
              buttonVariant="danger"
              onButtonClick={() => setShowResetConfirm(true)}
              buttonDisabled={showResetConfirm}
              danger
              showDivider={false}
            />
          </SettingsGroup>

          {/* 重置确认框 */}
          <AnimatePresence>
            {showResetConfirm && (
              <ResetConfirm
                onConfirm={handleResetAllData}
                onCancel={() => setShowResetConfirm(false)}
                loading={resetting}
              />
            )}
          </AnimatePresence>
        </SettingsSection>

        {/* 分组三：账户与安全 */}
        <SettingsSection title="账户与安全">
          <SettingsGroup>
            <SettingsRow
              title="设备管理"
              subtitle="查看和管理登录设备"
              type="arrow"
              onClick={() => setShowDeviceList(true)}
              showDivider={false}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* 分组四：关于 */}
        <SettingsSection title="关于">
          <SettingsGroup>
            <SettingsRow
              title="检查更新"
              type="button"
              buttonText={getUpdateButtonText(checkingUpdate, isLatestVersion)}
              onButtonClick={handleCheckUpdate}
              buttonDisabled={checkingUpdate || isLatestVersion}
              showDivider={false}
            />
          </SettingsGroup>
        </SettingsSection>
      </div>

      {/* 版本信息固定在底部 */}
      <AppVersionInfo />

      {/* 设备管理面板 */}
      <AnimatePresence>
        {showDeviceList && (
          <DeviceListPanel onBack={() => setShowDeviceList(false)} />
        )}
      </AnimatePresence>

      {/* 更新弹窗 */}
      <UpdateToast
        status={toast.status}
        version={toast.version}
        notes={toast.notes}
        progress={toast.progress}
        downloaded={toast.downloaded}
        total={toast.total}
        proxyUrl={toast.proxyUrl}
        errorMessage={toast.errorMessage}
        onUpdate={handleUpdate}
        onDismiss={toast.dismiss}
        onRestart={handleRestart}
        onRetry={handleUpdate}
      />
    </motion.div>
  );
};

export default SettingsPanel;
