/**
 * 流程列表对话框组件
 *
 * 显示用户保存的流程列表，支持加载和删除
 *
 * @module lowcode/components/WorkflowListDialog
 */

import { memo, useState, useCallback, useEffect } from 'react';
import type { Workflow } from '../types/lowcode';

// ============================================================================
// 图标组件
// ============================================================================

/** 关闭图标 */
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** 打开图标 */
function OpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 删除图标 */
function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
    </svg>
  );
}

/** 刷新图标 */
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

/** 对话框 Props */
interface WorkflowListDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 加载流程列表 */
  onLoadList: () => Promise<Workflow[]>;
  /** 加载流程（传递 ID，由调用方获取完整数据） */
  onLoad: (workflowId: string) => Promise<void>;
  /** 删除流程 */
  onDelete: (workflowId: string) => Promise<void>;
}

/** 待确认删除的项目 */
interface PendingDelete {
  id: string;
  name: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化日期
 */
function formatDate(dateString?: string): string {
  if (!dateString) {
    return '-';
  }

  try {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

// ============================================================================
// 流程项组件
// ============================================================================

interface WorkflowItemProps {
  workflow: Workflow;
  onLoad: () => void;
  onRequestDelete: () => void;
  isDeleting: boolean;
  isLoading: boolean;
}

function WorkflowItem({
  workflow,
  onLoad,
  onRequestDelete,
  isDeleting,
  isLoading,
}: WorkflowItemProps) {
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRequestDelete();
    },
    [onRequestDelete],
  );

  const handleLoad = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isLoading && !isDeleting) {
        onLoad();
      }
    },
    [onLoad, isLoading, isDeleting],
  );

  // 安全获取节点数量
  const nodeCount = workflow.definition?.nodes?.length ?? 0;

  return (
    <div
      className={`workflow-item ${isLoading ? 'loading' : ''}`}
      onClick={handleLoad}
    >
      <div className="workflow-item-info">
        <div className="workflow-item-name">
          {isLoading && <span className="loading-spinner-tiny" />}
          {workflow.name}
        </div>
        <div className="workflow-item-meta">
          {workflow.description && <span>{workflow.description} · </span>}
          <span>更新于 {formatDate(workflow.updated_at)}</span>
          <span> · {nodeCount} 个节点</span>
        </div>
      </div>

      <div className="workflow-item-actions">
        <button
          className="workflow-item-btn"
          onClick={handleLoad}
          disabled={isLoading || isDeleting}
          title="打开"
        >
          <OpenIcon />
        </button>
        <button
          className="workflow-item-btn danger"
          onClick={handleDeleteClick}
          disabled={isDeleting || isLoading}
          title="删除"
        >
          <DeleteIcon />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 删除确认对话框
// ============================================================================

interface DeleteConfirmDialogProps {
  workflowName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

function DeleteConfirmDialog({
  workflowName,
  onConfirm,
  onCancel,
  isDeleting,
}: DeleteConfirmDialogProps) {
  return (
    <div className="delete-confirm-overlay" onClick={onCancel}>
      <div
        className="delete-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="delete-confirm-title">确认删除</div>
        <div className="delete-confirm-message">
          确定要删除流程 "<strong>{workflowName}</strong>" 吗？
          <br />
          此操作不可撤销。
        </div>
        <div className="delete-confirm-actions">
          <button
            className="toolbar-btn"
            onClick={onCancel}
            disabled={isDeleting}
          >
            取消
          </button>
          <button
            className="toolbar-btn danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? '删除中...' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 流程列表对话框
 *
 * 显示用户保存的流程，支持加载和删除
 */
function WorkflowListDialogComponent({
  isOpen,
  onClose,
  onLoadList,
  onLoad,
  onDelete,
}: WorkflowListDialogProps) {
  // 状态
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // 加载流程列表
  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const list = await onLoadList();
      setWorkflows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [onLoadList]);

  // 打开时加载列表
  useEffect(() => {
    if (isOpen) {
      loadWorkflows();
    }
  }, [isOpen, loadWorkflows]);

  // 处理加载流程（传递 ID，由调用方获取完整数据）
  const handleLoad = useCallback(
    async (workflowId: string) => {
      setLoadingId(workflowId);
      setError(null);

      try {
        await onLoad(workflowId);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoadingId(null);
      }
    },
    [onLoad, onClose],
  );

  // 请求删除（显示确认对话框）
  const handleRequestDelete = useCallback((workflow: Workflow) => {
    setPendingDelete({ id: workflow.id, name: workflow.name });
  }, []);

  // 取消删除
  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  // 确认删除
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    setDeletingId(pendingDelete.id);

    try {
      await onDelete(pendingDelete.id);
      setWorkflows((prev) => prev.filter((w) => w.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, onDelete]);

  // 处理关闭
  const handleClose = useCallback(() => {
    if (!deletingId && !pendingDelete && !loadingId) {
      onClose();
    }
  }, [deletingId, pendingDelete, loadingId, onClose]);

  // 阻止点击内容区域关闭
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog dialog-md" onClick={handleContentClick}>
        <div className="dialog-header">
          <div className="dialog-title">我的流程</div>
          <div className="dialog-header-actions">
            <button
              className="toolbar-btn"
              onClick={loadWorkflows}
              disabled={isLoading}
              title="刷新"
            >
              <RefreshIcon />
            </button>
            <button className="dialog-close" onClick={handleClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="dialog-body">
          {/* 加载中 */}
          {isLoading && (
            <div className="workflow-list-loading">
              <div className="loading-spinner-small" />
              <span>加载中...</span>
            </div>
          )}

          {/* 错误 */}
          {error && !isLoading && (
            <div className="workflow-list-error">
              <p>{error}</p>
              <button className="toolbar-btn" onClick={loadWorkflows}>
                重试
              </button>
            </div>
          )}

          {/* 空状态 */}
          {!isLoading && !error && workflows.length === 0 && (
            <div className="workflow-list-empty">
              <p>暂无保存的流程</p>
              <p>创建并保存您的第一个流程吧</p>
            </div>
          )}

          {/* 流程列表 */}
          {!isLoading && !error && workflows.length > 0 && (
            <div className="workflow-list">
              {workflows.map((workflow) => (
                <WorkflowItem
                  key={workflow.id}
                  workflow={workflow}
                  onLoad={() => handleLoad(workflow.id)}
                  onRequestDelete={() => handleRequestDelete(workflow)}
                  isDeleting={deletingId === workflow.id}
                  isLoading={loadingId === workflow.id}
                />
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="toolbar-btn" onClick={handleClose}>
            关闭
          </button>
        </div>
      </div>

      {/* 删除确认对话框 */}
      {pendingDelete && (
        <DeleteConfirmDialog
          workflowName={pendingDelete.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          isDeleting={deletingId === pendingDelete.id}
        />
      )}
    </div>
  );
}

export const WorkflowListDialog = memo(WorkflowListDialogComponent);
export default WorkflowListDialog;
