/**
 * 设备管理面板组件
 *
 * 显示当前账户的登录设备列表，支持删除其他设备
 *
 * 特性：
 * - 乐观更新：删除设备时立即从列表移除，无需等待服务器响应
 * - 失败回滚：API 请求失败时自动恢复被删除的设备
 * - 流畅动画：与好友/群聊卡片一致的进出场动画效果
 * - 当前设备标识：当前登录设备有特殊标识，删除需二次确认
 *
 * @module components/settings/DeviceListPanel
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDevices } from '../../hooks/useDevices';
import type { Device } from '../../types/device';
import './styles.css';

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

const DeviceIcon: React.FC<{ isCurrent?: boolean }> = ({ isCurrent }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke={isCurrent ? '#10b981' : 'currentColor'}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

// ============================================
// 辅助函数
// ============================================

/**
 * 格式化时间
 */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // 一小时内
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return minutes <= 0 ? '刚刚' : `${minutes}分钟前`;
    }

    // 今天
    if (date.toDateString() === now.toDateString()) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    // 其他
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}

// ============================================
// 设备项组件
// ============================================

interface DeviceItemProps {
  device: Device;
  onDelete: () => void;
  deleting: boolean;
}

const DeviceItem: React.FC<DeviceItemProps> = ({ device, onDelete, deleting }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDeleteClick = () => {
    if (device.is_current) {
      // 当前设备需要二次确认
      setShowConfirm(true);
    } else {
      onDelete();
    }
  };

  return (
    <motion.div
      className={`device-item ${device.is_current ? 'device-item-current' : ''}`}
      layout="position"
      layoutId={device.device_id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{
        layout: { type: 'spring', stiffness: 500, damping: 35 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
      }}
    >
      <div className="device-item-icon">
        <DeviceIcon isCurrent={device.is_current} />
      </div>

      <div className="device-item-info">
        <div className="device-item-name">
          {device.device_info || '未知设备'}
          {device.is_current && <span className="device-item-badge">当前设备</span>}
        </div>
        <div className="device-item-meta">
          {device.last_active_at && (
            <span>最后活跃: {formatTime(device.last_active_at)}</span>
          )}
          {!device.last_active_at && device.created_at && (
            <span>登录时间: {formatTime(device.created_at)}</span>
          )}
        </div>
      </div>

      <div className="device-item-actions">
        {!showConfirm ? (
          <button
            className="device-delete-btn"
            onClick={handleDeleteClick}
            disabled={deleting}
            title={device.is_current ? '退出当前设备' : '删除此设备'}
          >
            {deleting ? '...' : <TrashIcon />}
          </button>
        ) : (
          <div className="device-confirm-actions">
            <button
              className="device-confirm-btn device-confirm-yes"
              onClick={() => {
                setShowConfirm(false);
                onDelete();
              }}
              disabled={deleting}
            >
              确认退出
            </button>
            <button
              className="device-confirm-btn device-confirm-no"
              onClick={() => setShowConfirm(false)}
              disabled={deleting}
            >
              取消
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ============================================
// 主组件
// ============================================

interface DeviceListPanelProps {
  onBack: () => void;
}

export const DeviceListPanel: React.FC<DeviceListPanelProps> = ({ onBack }) => {
  const { devices, loading, error, deletingId, removingAll, refresh, remove, removeAllOthers } =
    useDevices();
  const [showRemoveAllConfirm, setShowRemoveAllConfirm] = useState(false);

  // 其他设备数量（用于显示确认信息）
  const otherDevicesCount = devices.filter((d) => !d.is_current).length;

  return (
    <motion.div
      className="device-list-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* 头部 */}
      <div className="device-list-header">
        <button className="settings-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="device-list-title">设备管理</h2>
        <button
          className="device-refresh-btn"
          onClick={refresh}
          disabled={loading}
          title="刷新"
        >
          <RefreshIcon />
        </button>
      </div>

      {/* 内容 */}
      <div className="device-list-content">
        {/* 加载中 */}
        {loading && (
          <div className="device-list-loading">
            <div className="device-loading-spinner" />
            <span>加载中...</span>
          </div>
        )}

        {/* 错误 */}
        {error && !loading && (
          <div className="device-list-error">
            <span>{error}</span>
            <button onClick={refresh}>重试</button>
          </div>
        )}

        {/* 设备列表 */}
        {!loading && !error && (
          <>
            <div className="device-list-hint">
              以下是当前账户的登录设备，您可以移除不再使用的设备。
            </div>

            {/* 一键删除其他设备 */}
            {otherDevicesCount > 0 && (
              <div className="device-remove-all-section">
                {!showRemoveAllConfirm ? (
                  <button
                    className="device-remove-all-btn"
                    onClick={() => setShowRemoveAllConfirm(true)}
                    disabled={removingAll}
                  >
                    {removingAll ? '删除中...' : `删除其他所有设备 (${otherDevicesCount})`}
                  </button>
                ) : (
                  <div className="device-remove-all-confirm">
                    <span className="device-remove-all-warning">
                      确定要删除其他 {otherDevicesCount} 个设备吗？
                    </span>
                    <div className="device-remove-all-actions">
                      <button
                        className="device-confirm-btn device-confirm-yes"
                        onClick={async () => {
                          setShowRemoveAllConfirm(false);
                          await removeAllOthers();
                        }}
                        disabled={removingAll}
                      >
                        确认删除
                      </button>
                      <button
                        className="device-confirm-btn device-confirm-no"
                        onClick={() => setShowRemoveAllConfirm(false)}
                        disabled={removingAll}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="device-list">
              <AnimatePresence initial={false}>
                {devices.map((device) => (
                  <DeviceItem
                    key={device.device_id}
                    device={device}
                    onDelete={() => remove(device.device_id)}
                    deleting={deletingId === device.device_id}
                  />
                ))}
              </AnimatePresence>
            </div>

            {devices.length === 0 && (
              <div className="device-list-empty">暂无设备信息</div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

export default DeviceListPanel;
