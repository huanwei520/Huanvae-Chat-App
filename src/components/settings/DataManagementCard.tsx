/**
 * 数据管理设置卡片
 *
 * 提供清空本地缓存数据的功能
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

// ============================================
// 图标组件
// ============================================

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

const CheckCircleIcon: React.FC = () => (
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
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

type ConfirmState = 'none' | 'messages' | 'all';
type ResultState = 'none' | 'success' | 'error';

// ============================================
// 组件实现
// ============================================

export const DataManagementCard: React.FC = () => {
  const [confirmState, setConfirmState] = useState<ConfirmState>('none');
  const [confirmInput, setConfirmInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultState>('none');
  const [errorMessage, setErrorMessage] = useState('');

  // 清空消息缓存
  const handleClearMessages = async () => {
    setLoading(true);
    setResult('none');
    setErrorMessage('');

    try {
      await invoke('db_clear_messages');
      setResult('success');
      setConfirmState('none');
      setConfirmInput('');

      // 3秒后隐藏成功提示
      setTimeout(() => setResult('none'), 3000);
    } catch (err) {
      setResult('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 清空所有数据
  const handleClearAllData = async () => {
    if (confirmInput !== '确认清空') {
      return;
    }

    setLoading(true);
    setResult('none');
    setErrorMessage('');

    try {
      await invoke('db_clear_all_data');
      setResult('success');
      setConfirmState('none');
      setConfirmInput('');

      // 3秒后隐藏成功提示
      setTimeout(() => setResult('none'), 3000);
    } catch (err) {
      setResult('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 取消操作
  const handleCancel = () => {
    setConfirmState('none');
    setConfirmInput('');
  };

  return (
    <div className="settings-card data-management-card">
      <div className="settings-card-header">
        <div className="settings-card-icon">
          <DatabaseIcon />
        </div>
        <div className="settings-card-title">
          <h3>数据管理</h3>
          <p>管理本地缓存数据</p>
        </div>
      </div>

      <div className="settings-card-content" style={{ paddingTop: 0 }}>
        {/* 成功提示 */}
        <AnimatePresence>
          {result === 'success' && (
            <motion.div
              className="data-result data-result-success"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <CheckCircleIcon />
              <span>数据已清空</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 错误提示 */}
        <AnimatePresence>
          {result === 'error' && (
            <motion.div
              className="data-result data-result-error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <WarningIcon />
              <span>{errorMessage || '操作失败'}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 清空消息缓存 */}
        <div className="data-action-item">
          <div className="data-action-info">
            <span className="data-action-title">清空消息缓存</span>
            <span className="data-action-desc">删除本地保存的聊天记录，不影响服务器数据</span>
          </div>

          <AnimatePresence mode="wait">
            {confirmState === 'messages' ? (
              <motion.div
                className="data-confirm-inline"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <button
                  className="data-confirm-btn confirm-yes"
                  onClick={handleClearMessages}
                  disabled={loading}
                >
                  {loading ? '清空中...' : '确定'}
                </button>
                <button
                  className="data-confirm-btn confirm-no"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  取消
                </button>
              </motion.div>
            ) : (
              <motion.button
                className="data-action-btn"
                onClick={() => setConfirmState('messages')}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <TrashIcon />
                <span>清空消息</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* 分隔线 */}
        <div className="data-divider" />

        {/* 重置所有数据 */}
        <div className="data-action-item data-action-danger">
          <div className="data-action-info">
            <div className="data-action-title-row">
              <WarningIcon />
              <span className="data-action-title">重置所有数据</span>
            </div>
            <span className="data-action-desc">
              清空所有本地缓存，包括消息、好友列表、群组信息等，需重新同步
            </span>
          </div>

          {confirmState !== 'all' && (
            <button
              className="data-action-btn data-action-btn-danger"
              onClick={() => setConfirmState('all')}
            >
              <TrashIcon />
              <span>重置数据</span>
            </button>
          )}
        </div>

        {/* 重置确认框 - 独立显示在下方 */}
        <AnimatePresence>
          {confirmState === 'all' && (
            <motion.div
              className="data-confirm-box"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <p className="data-confirm-hint">请输入 &quot;确认清空&quot; 以继续：</p>
              <input
                type="text"
                className="data-confirm-input"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="确认清空"
                disabled={loading}
                autoFocus
              />
              <div className="data-confirm-actions">
                <button
                  className="data-confirm-btn confirm-danger"
                  onClick={handleClearAllData}
                  disabled={loading || confirmInput !== '确认清空'}
                >
                  {loading ? '重置中...' : '确认重置'}
                </button>
                <button
                  className="data-confirm-btn confirm-no"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  取消
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default DataManagementCard;
