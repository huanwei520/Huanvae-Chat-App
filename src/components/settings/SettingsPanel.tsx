/**
 * 设置面板组件
 *
 * iOS/macOS 风格的设置面板，按功能分组：
 * - 通知与提醒：消息提示音设置
 * - 存储与数据：大文件直连阈值、缓存清理、数据重置
 * - 账户与安全：设备管理（查看和删除登录设备）
 * - 关于：版本信息、手动检查更新
 *
 * 大文件直连阈值：
 * - 用户可配置阈值（10-1000MB，默认100MB）
 * - ≥阈值的文件上传时不复制到缓存目录，直接使用原始路径
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
import { useUpdateStore, useIsChecking } from '../../update/store';
import { openThemeEditorWindow, useThemeStore, getPresetConfig } from '../../theme';
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
  /** 关闭面板回调 */
  onClose: () => void;
  /** 打开主题设置页面回调（移动端使用页面导航，桌面端使用独立窗口） */
  onThemeClick?: () => void;
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

const FileIcon: React.FC = () => (
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
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const PaletteIcon: React.FC = () => (
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
    <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, onThemeClick }) => {
  const { notification, setNotificationEnabled, fileCache, setLargeFileThreshold } = useSettingsStore();

  // 数据管理状态
  const [clearingMessages, setClearingMessages] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 更新检查状态（使用全局 store）
  const checkingUpdate = useIsChecking();
  const checkUpdate = useUpdateStore((s) => s.checkUpdate);
  const [isLatestVersion, setIsLatestVersion] = useState(false);

  // 面板导航状态
  const [showDeviceList, setShowDeviceList] = useState(false);

  // 主题状态
  const themePreset = useThemeStore((s) => s.config.preset);

  // 阈值编辑状态
  const [isEditingThreshold, setIsEditingThreshold] = useState(false);
  const [thresholdValue, setThresholdValue] = useState(fileCache.largeFileThresholdMB);
  const thresholdInputRef = React.useRef<HTMLInputElement>(null);

  // 保存阈值并退出编辑
  const saveThreshold = useCallback(() => {
    const value = Math.max(10, Math.min(1000, thresholdValue));
    setLargeFileThreshold(value);
    setThresholdValue(value);
    setIsEditingThreshold(false);
  }, [thresholdValue, setLargeFileThreshold]);

  // 进入编辑模式时聚焦输入框
  useEffect(() => {
    if (isEditingThreshold && thresholdInputRef.current) {
      thresholdInputRef.current.focus();
      thresholdInputRef.current.select();
    }
  }, [isEditingThreshold]);

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

  // 检查更新（使用全局 store，自动处理平台差异和防抖）
  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) {
      return;
    }

    setResult(null);
    setIsLatestVersion(false);

    try {
      await checkUpdate();

      // 检查完成后，如果弹窗没有显示（即没有新版本），则设置为最新版本
      // 这里通过延迟检查状态来判断
      setTimeout(() => {
        const currentStatus = useUpdateStore.getState().status;
        if (currentStatus === 'idle') {
          setIsLatestVersion(true);
        }
      }, 100);
    } catch (err) {
      console.error('[Settings] 检查更新失败:', err);
      setResult({ type: 'error', message: '检查更新失败，请稍后重试' });
      setTimeout(() => setResult(null), 3000);
    }
  }, [checkingUpdate, checkUpdate]);

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

        {/* 分组一：外观 */}
        <SettingsSection title="外观">
          <SettingsGroup>
            <SettingsRow
              icon={<PaletteIcon />}
              title="主题设置"
              subtitle={`当前: ${getPresetConfig(themePreset).name}`}
              type="arrow"
              onClick={() => {
                // 移动端使用页面导航，桌面端使用独立窗口
                if (onThemeClick) {
                  onThemeClick();
                } else {
                  openThemeEditorWindow();
                }
              }}
              showDivider={false}
            />
          </SettingsGroup>
        </SettingsSection>

        {/* 分组二：通知与提醒 */}
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

        {/* 分组三：存储与数据 */}
        <SettingsSection title="存储与数据">
          <SettingsGroup>
            <SettingsRow
              icon={<FileIcon />}
              title="大文件直连阈值"
              subtitle={`≥${fileCache.largeFileThresholdMB}MB 的文件不复制到缓存`}
              type="custom"
              showDivider
              rightContent={
                <div className="threshold-wrapper">
                  {isEditingThreshold ? (
                    <input
                      ref={thresholdInputRef}
                      type="number"
                      className="threshold-input"
                      value={thresholdValue}
                      onChange={(e) => setThresholdValue(Number(e.target.value))}
                      onBlur={saveThreshold}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          saveThreshold();
                        } else if (e.key === 'Escape') {
                          setThresholdValue(fileCache.largeFileThresholdMB);
                          setIsEditingThreshold(false);
                        }
                      }}
                      min={10}
                      max={1000}
                      step={10}
                    />
                  ) : (
                    <div
                      className="threshold-display"
                      onClick={() => {
                        setThresholdValue(fileCache.largeFileThresholdMB);
                        setIsEditingThreshold(true);
                      }}
                    >
                      <span className="threshold-value">{fileCache.largeFileThresholdMB}</span>
                    </div>
                  )}
                  <span className="threshold-unit">MB</span>
                </div>
              }
            />
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

        {/* 分组四：账户与安全 */}
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

        {/* 分组五：关于 */}
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

      {/* 更新弹窗已移至 App.tsx 统一渲染 */}
    </motion.div>
  );
};

export default SettingsPanel;
