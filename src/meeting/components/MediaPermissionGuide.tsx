/**
 * 媒体权限修复引导组件
 *
 * 当用户拒绝麦克风/摄像头/屏幕共享权限后，显示跨平台的修复指南。
 * 提供：
 * - 系统设置路径说明
 * - 可复制的修复命令
 * - 一键打开系统设置按钮
 *
 * 支持平台：
 * - Windows: ms-settings: URI
 * - macOS: tccutil 命令 + 系统设置
 * - Linux (Ubuntu): usermod, PipeWire 等命令
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import type { MediaErrorType, MediaErrorReason } from '../useWebRTC';

/** 修复命令 */
interface PermissionFixCommand {
  description: string;
  command: string;
  requiresAdmin: boolean;
  requiresRestart: boolean;
}

/** 权限修复指南 */
interface PermissionGuide {
  os: string;
  permissionName: string;
  steps: string[];
  fixCommands: PermissionFixCommand[];
  canOpenSettings: boolean;
  settingsPath: string;
  settingsUri: string | null;
}

interface Props {
  errorType: MediaErrorType;
  errorReason: MediaErrorReason;
  onClose: () => void;
  onRetry: () => void;
}

/** 媒体权限修复引导弹窗 */
export function MediaPermissionGuide({ errorType, errorReason, onClose, onRetry }: Props) {
  const [guide, setGuide] = useState<PermissionGuide | null>(null);
  const [opening, setOpening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // 获取权限修复指南
  useEffect(() => {
    const permissionTypeMap: Record<MediaErrorType, string> = {
      mic: 'microphone',
      camera: 'camera',
      screen: 'screen_capture',
    };
    const permissionType = permissionTypeMap[errorType];

    invoke<PermissionGuide>('get_media_permission_guide', { permissionType })
      .then(setGuide)
      .catch(console.error);
  }, [errorType]);

  // 打开系统设置
  const handleOpenSettings = useCallback(async () => {
    setOpening(true);
    try {
      const permissionTypeMap: Record<MediaErrorType, string> = {
        mic: 'microphone',
        camera: 'camera',
        screen: 'screen_capture',
      };
      const permissionType = permissionTypeMap[errorType];

      await invoke('open_media_permission_settings', { permissionType });
    } catch (err) {
      console.error('打开设置失败:', err);
    } finally {
      setOpening(false);
    }
  }, [errorType]);

  // 复制命令
  const handleCopyCommand = useCallback((command: string, index: number) => {
    navigator.clipboard.writeText(command).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }, []);

  // 获取错误标题
  const getErrorTitle = () => {
    const names = { mic: '麦克风', camera: '摄像头', screen: '屏幕共享' };
    const name = names[errorType] || '设备';

    if (errorReason === 'denied') {
      return `${name}权限被拒绝`;
    } else if (errorReason === 'not_found') {
      return `未检测到${name}`;
    }
    return `${name}访问失败`;
  };

  if (!guide) {
    return null;
  }

  return (
    <motion.div
      className="permission-guide-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="permission-guide-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="permission-guide-header">
          <span className="permission-guide-icon">🔒</span>
          <h3>{getErrorTitle()}</h3>
          <button className="permission-guide-close" onClick={onClose}>×</button>
        </div>

        {/* 系统信息 */}
        <div className="permission-guide-os">
          <span className="permission-guide-os-label">当前系统:</span>
          <span className="permission-guide-os-value">{guide.os}</span>
        </div>

        {/* 设置路径 */}
        <div className="permission-guide-path">
          <span className="permission-guide-path-icon">📍</span>
          <span>{guide.settingsPath}</span>
        </div>

        {/* 修复步骤 */}
        <div className="permission-guide-steps">
          {guide.steps.map((step, index) => (
            <div key={index} className="permission-guide-step">
              <span className="step-number">{index + 1}</span>
              <span className="step-text">{step}</span>
            </div>
          ))}
        </div>

        {/* 修复命令列表 */}
        {guide.fixCommands.length > 0 && (
          <div className="permission-guide-commands">
            <div className="commands-header">
              <span className="commands-icon">🔧</span>
              <span>修复命令（点击复制）</span>
            </div>
            <div className="commands-list">
              {guide.fixCommands.map((cmd, index) => (
                <div key={index} className="command-item">
                  <div className="command-description">
                    {cmd.description}
                    {cmd.requiresAdmin && <span className="command-badge admin">需要管理员</span>}
                    {cmd.requiresRestart && <span className="command-badge restart">需重启应用</span>}
                  </div>
                  <div
                    className="command-code"
                    onClick={() => handleCopyCommand(cmd.command, index)}
                    title="点击复制"
                  >
                    <code>{cmd.command}</code>
                    <span className="command-copy">
                      {copiedIndex === index ? '✓ 已复制' : '复制'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="permission-guide-actions">
          {guide.canOpenSettings && (
            <button
              className="permission-guide-btn primary"
              onClick={handleOpenSettings}
              disabled={opening}
            >
              {opening ? '正在打开...' : '🔧 打开系统设置'}
            </button>
          )}
          <button
            className="permission-guide-btn secondary"
            onClick={onRetry}
          >
            🔄 重试
          </button>
        </div>

        {/* 提示 */}
        <p className="permission-guide-tip">
          💡 修改权限后可能需要重启应用才能生效
        </p>
      </motion.div>
    </motion.div>
  );
}
