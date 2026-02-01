/**
 * 版本历史面板
 *
 * 显示流程的版本历史记录，支持查看和回滚到历史版本
 *
 * @module lowcode/components/VersionHistoryPanel
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WorkflowVersion } from '../types/lowcode';
import type { VersionService } from '../services/versionService';

// ============================================================================
// 图标组件
// ============================================================================

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function RollbackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51,9a9,9,0,0,1,14.85-3.36L23,10M1,14l4.64,4.36A9,9,0,0,0,20.49,15" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface VersionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string | null;
  workflowName: string;
  versionService: VersionService | null;
  onRollback: (version: number) => Promise<void>;
}

// ============================================================================
// 版本项组件
// ============================================================================

interface VersionItemProps {
  version: WorkflowVersion;
  isCurrent: boolean;
  onRollback: () => void;
  isRollingBack: boolean;
}

function VersionItem({ version, isCurrent, onRollback, isRollingBack }: VersionItemProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRollbackClick = useCallback(() => {
    setShowConfirm(true);
  }, []);

  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    onRollback();
  }, [onRollback]);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
  }, []);

  return (
    <div className={`version-item ${isCurrent ? 'current' : ''}`}>
      <div className="version-timeline">
        <div className="version-dot" />
        <div className="version-line" />
      </div>

      <div className="version-content">
        <div className="version-header">
          <span className="version-number">v{version.version}</span>
          {isCurrent && <span className="version-current-badge">当前版本</span>}
          <span className="version-date">
            {new Date(version.created_at).toLocaleString()}
          </span>
        </div>

        <div className="version-name">{version.name}</div>

        {version.description && (
          <div className="version-desc">{version.description}</div>
        )}

        <div className="version-meta">
          <span>创建者: {version.created_by}</span>
        </div>

        {!isCurrent && (
          <div className="version-actions">
            {showConfirm ? (
              <div className="version-confirm">
                <span>确定回滚到此版本？</span>
                <button
                  className="version-confirm-btn yes"
                  onClick={handleConfirm}
                  disabled={isRollingBack}
                >
                  {isRollingBack ? '回滚中...' : '确定'}
                </button>
                <button
                  className="version-confirm-btn no"
                  onClick={handleCancel}
                  disabled={isRollingBack}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                className="version-rollback-btn"
                onClick={handleRollbackClick}
              >
                <RollbackIcon />
                <span>回滚到此版本</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function VersionHistoryPanelComponent({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  versionService,
  onRollback,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  // 加载版本列表
  const loadVersions = useCallback(async () => {
    if (!versionService || !workflowId) { return; }

    setLoading(true);
    setError(null);

    try {
      const response = await versionService.getVersions(workflowId);
      // 按版本号降序排列
      setVersions(response.versions.sort((a, b) => b.version - a.version));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [versionService, workflowId]);

  // 打开时加载
  useEffect(() => {
    if (isOpen && versionService && workflowId) {
      loadVersions();
    }
  }, [isOpen, versionService, workflowId, loadVersions]);

  // 执行回滚
  const handleRollback = useCallback(async (version: number) => {
    setRollingBack(true);
    setError(null);

    try {
      await onRollback(version);
      // 重新加载版本列表
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setRollingBack(false);
    }
  }, [onRollback, loadVersions]);

  if (!isOpen) { return null; }

  const currentVersion = versions.length > 0 ? versions[0].version : 0;

  return (
    <AnimatePresence>
      <motion.div
        className="dialog-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="dialog-content version-history-dialog"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="dialog-header">
            <div className="dialog-title-group">
              <HistoryIcon />
              <h2 className="dialog-title">版本历史</h2>
            </div>
            <div className="dialog-subtitle">{workflowName}</div>
            <div className="dialog-header-actions">
              <button
                className="dialog-refresh-btn"
                onClick={loadVersions}
                disabled={loading}
                title="刷新"
              >
                <RefreshIcon />
              </button>
              <button className="dialog-close-btn" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* 内容区 */}
          <div className="dialog-body">
            {loading && (
              <div className="version-loading">加载中...</div>
            )}

            {error && (
              <div className="version-error">{error}</div>
            )}

            {!loading && !error && !workflowId && (
              <div className="version-empty">
                请先保存流程后再查看版本历史
              </div>
            )}

            {!loading && !error && workflowId && versions.length === 0 && (
              <div className="version-empty">
                暂无版本记录
              </div>
            )}

            {!loading && versions.length > 0 && (
              <div className="version-timeline-list">
                {versions.map((version) => (
                  <VersionItem
                    key={version.id}
                    version={version}
                    isCurrent={version.version === currentVersion}
                    onRollback={() => handleRollback(version.version)}
                    isRollingBack={rollingBack}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 底部 */}
          <div className="dialog-footer">
            <button className="dialog-btn secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const VersionHistoryPanel = memo(VersionHistoryPanelComponent);
