/**
 * 设置面板组件
 *
 * 内嵌式设置面板，替换会话列表区域显示
 * 使用白色毛玻璃效果 + 蓝白配色
 */

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { NotificationSoundCard } from './NotificationSoundCard';
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

        {/* 可在此添加更多设置卡片 */}
      </div>
    </motion.div>
  );
};

export default SettingsPanel;
