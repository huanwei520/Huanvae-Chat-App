/**
 * 错误处理配置对话框
 *
 * 提供全局和节点级的错误处理配置
 *
 * @module lowcode/components/ErrorHandlingDialog
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion, react/no-unescaped-entities */

import { memo, useState, useCallback } from 'react';
import type {
  ErrorHandlingConfig,
  RetryConfig,
  NodeErrorHandler,
  WorkflowNode,
} from '../types/lowcode';

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

function AddIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface ErrorHandlingDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前配置 */
  config?: ErrorHandlingConfig;
  /** 保存回调 */
  onSave: (config: ErrorHandlingConfig) => void;
  /** 流程节点列表 */
  nodes: WorkflowNode[];
}

// ============================================================================
// 子组件：重试配置编辑器
// ============================================================================

interface RetryConfigEditorProps {
  config?: RetryConfig;
  onChange: (config: RetryConfig | undefined) => void;
  label: string;
}

function RetryConfigEditor({ config, onChange, label }: RetryConfigEditorProps) {
  const [enabled, setEnabled] = useState(!!config);

  const handleToggle = useCallback((checked: boolean) => {
    setEnabled(checked);
    if (checked && !config) {
      onChange({
        max_attempts: 3,
        delay_ms: 1000,
        backoff_multiplier: 2,
        max_delay_ms: 30000,
      });
    } else if (!checked) {
      onChange(undefined);
    }
  }, [config, onChange]);

  return (
    <div className="retry-config-editor">
      <label className="retry-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span>{label}</span>
      </label>

      {enabled && config && (
        <div className="retry-params">
          <div className="retry-param">
            <label>最大重试次数:</label>
            <input
              type="number"
              className="config-input"
              value={config.max_attempts}
              onChange={(e) => onChange({ ...config, max_attempts: Number(e.target.value) })}
              min={1}
              max={10}
            />
          </div>
          <div className="retry-param">
            <label>初始延迟 (ms):</label>
            <input
              type="number"
              className="config-input"
              value={config.delay_ms}
              onChange={(e) => onChange({ ...config, delay_ms: Number(e.target.value) })}
              min={100}
              step={100}
            />
          </div>
          <div className="retry-param">
            <label>退避乘数:</label>
            <input
              type="number"
              className="config-input"
              value={config.backoff_multiplier ?? 1}
              onChange={(e) => onChange({ ...config, backoff_multiplier: Number(e.target.value) })}
              min={1}
              max={10}
              step={0.5}
            />
          </div>
          <div className="retry-param">
            <label>最大延迟 (ms):</label>
            <input
              type="number"
              className="config-input"
              value={config.max_delay_ms ?? 60000}
              onChange={(e) => onChange({ ...config, max_delay_ms: Number(e.target.value) })}
              min={1000}
              step={1000}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 子组件：节点错误处理行
// ============================================================================

interface NodeHandlerRowProps {
  handler: NodeErrorHandler;
  index: number;
  nodes: WorkflowNode[];
  onUpdate: (index: number, handler: NodeErrorHandler) => void;
  onDelete: (index: number) => void;
}

function NodeHandlerRow({ handler, index, nodes, onUpdate, onDelete }: NodeHandlerRowProps) {
  const [showRetry, setShowRetry] = useState(!!handler.retry);

  return (
    <div className="node-handler-row">
      <div className="node-handler-main">
        <select
          className="config-select"
          value={handler.node_id}
          onChange={(e) => onUpdate(index, { ...handler, node_id: e.target.value })}
        >
          <option value="">选择节点</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.name || n.id}</option>
          ))}
        </select>

        <label className="handler-option">
          <input
            type="checkbox"
            checked={handler.ignore_error ?? false}
            onChange={(e) => onUpdate(index, { ...handler, ignore_error: e.target.checked })}
          />
          <span>忽略错误</span>
        </label>

        <label className="handler-option">
          <input
            type="checkbox"
            checked={showRetry}
            onChange={(e) => {
              setShowRetry(e.target.checked);
              if (!e.target.checked) {
                onUpdate(index, { ...handler, retry: undefined });
              } else if (!handler.retry) {
                onUpdate(index, {
                  ...handler,
                  retry: { max_attempts: 3, delay_ms: 1000 },
                });
              }
            }}
          />
          <span>启用重试</span>
        </label>

        <select
          className="config-select"
          value={handler.fallback_node ?? ''}
          onChange={(e) => onUpdate(index, { ...handler, fallback_node: e.target.value || undefined })}
        >
          <option value="">备用节点（可选）</option>
          {nodes.filter((n) => n.id !== handler.node_id).map((n) => (
            <option key={n.id} value={n.id}>{n.name || n.id}</option>
          ))}
        </select>

        <button className="config-delete-btn" onClick={() => onDelete(index)} title="删除">
          <DeleteIcon />
        </button>
      </div>

      {showRetry && handler.retry && (
        <div className="node-handler-retry">
          <div className="retry-param-inline">
            <label>重试:</label>
            <input
              type="number"
              className="config-input config-input-sm"
              value={handler.retry.max_attempts}
              onChange={(e) => onUpdate(index, {
                ...handler,
                retry: { ...handler.retry!, max_attempts: Number(e.target.value) },
              })}
              min={1}
              max={10}
            />
            <span>次,</span>
            <label>延迟:</label>
            <input
              type="number"
              className="config-input config-input-sm"
              value={handler.retry.delay_ms}
              onChange={(e) => onUpdate(index, {
                ...handler,
                retry: { ...handler.retry!, delay_ms: Number(e.target.value) },
              })}
              min={100}
              step={100}
            />
            <span>ms</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function ErrorHandlingDialogComponent({
  isOpen,
  onClose,
  config,
  onSave,
  nodes,
}: ErrorHandlingDialogProps) {
  // 全局重试配置
  const [globalRetry, setGlobalRetry] = useState<RetryConfig | undefined>(config?.retry);

  // 失败时继续执行
  const [continueOnError, setContinueOnError] = useState(config?.continue_on_error ?? false);

  // 节点级处理配置
  const [nodeHandlers, setNodeHandlers] = useState<NodeErrorHandler[]>(
    config?.node_handlers || [],
  );

  // 添加节点处理器
  const handleAddNodeHandler = useCallback(() => {
    setNodeHandlers((prev) => [
      ...prev,
      {
        node_id: '',
        ignore_error: false,
      },
    ]);
  }, []);

  // 更新节点处理器
  const handleUpdateNodeHandler = useCallback((index: number, handler: NodeErrorHandler) => {
    setNodeHandlers((prev) => prev.map((h, i) => (i === index ? handler : h)));
  }, []);

  // 删除节点处理器
  const handleDeleteNodeHandler = useCallback((index: number) => {
    setNodeHandlers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 保存配置
  const handleSave = useCallback(() => {
    const newConfig: ErrorHandlingConfig = {
      retry: globalRetry,
      continue_on_error: continueOnError,
      node_handlers: nodeHandlers.filter((h) => h.node_id), // 过滤掉未选择节点的
    };

    onSave(newConfig);
    onClose();
  }, [globalRetry, continueOnError, nodeHandlers, onSave, onClose]);

  // 阻止点击内容区域关闭
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-lg error-handling-dialog" onClick={handleContentClick}>
        <div className="dialog-header">
          <div className="dialog-title">错误处理配置</div>
          <button className="dialog-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-body">
          {/* 全局配置 */}
          <div className="config-section">
            <div className="config-section-title">全局配置</div>

            <div className="global-options">
              <label className="global-option">
                <input
                  type="checkbox"
                  checked={continueOnError}
                  onChange={(e) => setContinueOnError(e.target.checked)}
                />
                <span>失败时继续执行其他独立节点</span>
              </label>
            </div>

            <RetryConfigEditor
              config={globalRetry}
              onChange={setGlobalRetry}
              label="启用全局重试策略"
            />
          </div>

          {/* 节点级配置 */}
          <div className="config-section">
            <div className="config-section-header">
              <div className="config-section-title">节点级错误处理</div>
              <button className="config-add-btn" onClick={handleAddNodeHandler}>
                <AddIcon /> 添加
              </button>
            </div>
            <div className="config-section-desc">
              为特定节点配置错误处理策略（覆盖全局配置）
            </div>

            {nodeHandlers.length > 0 && (
              <div className="node-handlers">
                {nodeHandlers.map((handler, i) => (
                  <NodeHandlerRow
                    key={i}
                    handler={handler}
                    index={i}
                    nodes={nodes}
                    onUpdate={handleUpdateNodeHandler}
                    onDelete={handleDeleteNodeHandler}
                  />
                ))}
              </div>
            )}

            {nodeHandlers.length === 0 && (
              <div className="no-handlers">
                暂无节点级配置，点击"添加"为特定节点配置错误处理
              </div>
            )}
          </div>
        </div>

        <div className="dialog-footer">
          <button className="toolbar-btn" onClick={onClose}>
            取消
          </button>
          <button className="toolbar-btn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export const ErrorHandlingDialog = memo(ErrorHandlingDialogComponent);
