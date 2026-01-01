/**
 * 设置面板组件
 *
 * 内嵌式设置面板，替换会话列表区域显示
 * 使用白色毛玻璃效果 + 蓝白配色
 *
 * 包含以下功能模块：
 * - 提示音设置 (NotificationSoundCard)
 * - 数据管理 (DataManagementCard)
 * - 版本信息 (AppVersionInfo)
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getVersion } from '@tauri-apps/api/app';
import { NotificationSoundCard } from './NotificationSoundCard';
import { DataManagementCard } from './DataManagementCard';
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

// ============================================
// 版本信息组件
// ============================================

/**
 * 应用版本信息组件
 *
 * 显示当前应用版本号和版权信息
 * 版本号通过 Tauri API 动态获取
 */
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
      <div className="app-version-logo">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <div className="app-version-text">
        <span className="app-version-name">Huanvae Chat</span>
        <span className="app-version-number">v{version || '...'}</span>
      </div>
      <div className="app-version-copyright">
        © {currentYear} HuanWei
      </div>
    </div>
  );
};

// ============================================
// 组件实现
// ============================================

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
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

  return (
    <motion.div
      className="settings-panel"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 30,
      }}
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
        <NotificationSoundCard />
        <DataManagementCard />
      </div>

      {/* 版本信息固定在底部 */}
      <AppVersionInfo />
    </motion.div>
  );
};

export default SettingsPanel;
