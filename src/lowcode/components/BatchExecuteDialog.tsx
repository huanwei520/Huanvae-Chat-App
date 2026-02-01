/**
 * 批量执行对话框
 *
 * 支持一次执行多组输入参数，显示批量执行结果
 *
 * @module lowcode/components/BatchExecuteDialog
 */

import { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WorkflowInput, BatchExecutionResult, DataType } from '../types/lowcode';

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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5,3 19,12 5,21 5,3" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface InputDefinition extends WorkflowInput {
  displayName?: string;
  data_type?: DataType;
  description?: string;
  required?: boolean;
}

interface BatchExecuteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workflowName: string;
  inputs: InputDefinition[];
  onExecute: (batchInputs: Record<string, unknown>[]) => Promise<BatchExecutionResult>;
}

// ============================================================================
// 辅助函数
// ============================================================================

function getDefaultValue(dataType?: DataType): unknown {
  switch (dataType) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default:
      return '';
  }
}

function parseValue(value: string, dataType?: DataType): unknown {
  switch (dataType) {
    case 'number':
      return Number(value) || 0;
    case 'boolean':
      return value === 'true';
    case 'array':
    case 'object': {
      try {
        return JSON.parse(value);
      } catch {
        return dataType === 'array' ? [] : {};
      }
    }
    case 'string':
    default:
      return value;
  }
}

// ============================================================================
// 主组件
// ============================================================================

function BatchExecuteDialogComponent({
  isOpen,
  onClose,
  workflowName,
  inputs,
  onExecute,
}: BatchExecuteDialogProps) {
  // 初始化一行数据
  const createEmptyRow = useCallback(() => {
    const row: Record<string, unknown> = {};
    inputs.forEach((input) => {
      row[input.name] = getDefaultValue(input.data_type);
    });
    return row;
  }, [inputs]);

  const [rows, setRows] = useState<Record<string, unknown>[]>([createEmptyRow()]);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<BatchExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 添加行
  const handleAddRow = useCallback(() => {
    setRows((prev) => [...prev, createEmptyRow()]);
  }, [createEmptyRow]);

  // 删除行
  const handleDeleteRow = useCallback((index: number) => {
    setRows((prev) => {
      if (prev.length <= 1) { return prev; }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // 更新单元格
  const handleCellChange = useCallback(
    (rowIndex: number, inputName: string, value: string, dataType?: DataType) => {
      setRows((prev) => {
        const newRows = [...prev];
        newRows[rowIndex] = {
          ...newRows[rowIndex],
          [inputName]: parseValue(value, dataType),
        };
        return newRows;
      });
    },
    [],
  );

  // 执行
  const handleExecute = useCallback(async () => {
    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const batchResult = await onExecute(rows);
      setResult(batchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
    } finally {
      setExecuting(false);
    }
  }, [rows, onExecute]);

  // 重置
  const handleReset = useCallback(() => {
    setRows([createEmptyRow()]);
    setResult(null);
    setError(null);
  }, [createEmptyRow]);

  if (!isOpen) { return null; }

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
          className="dialog-content batch-execute-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="dialog-header">
            <h2 className="dialog-title">批量执行 - {workflowName}</h2>
            <button className="dialog-close-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {/* 内容区 */}
          <div className="dialog-body">
            {inputs.length === 0 ? (
              <div className="batch-empty">
                该流程没有定义输入参数
              </div>
            ) : (
              <>
                {/* 输入表格 */}
                <div className="batch-table-wrapper">
                  <table className="batch-table">
                    <thead>
                      <tr>
                        <th className="batch-row-num">#</th>
                        {inputs.map((input) => (
                          <th key={input.name}>
                            {input.displayName || input.name}
                            {input.required && <span className="required">*</span>}
                          </th>
                        ))}
                        <th className="batch-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <td className="batch-row-num">{rowIndex + 1}</td>
                          {inputs.map((input) => (
                            <td key={input.name}>
                              <input
                                type={input.data_type === 'number' ? 'number' : 'text'}
                                value={String(row[input.name] ?? '')}
                                onChange={(e) =>
                                  handleCellChange(
                                    rowIndex,
                                    input.name,
                                    e.target.value,
                                    input.data_type,
                                  )
                                }
                                className="batch-input"
                                placeholder={input.description}
                              />
                            </td>
                          ))}
                          <td className="batch-actions">
                            <button
                              className="batch-delete-btn"
                              onClick={() => handleDeleteRow(rowIndex)}
                              disabled={rows.length <= 1}
                              title="删除行"
                            >
                              <DeleteIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button className="batch-add-btn" onClick={handleAddRow}>
                  <AddIcon />
                  <span>添加一行</span>
                </button>

                {/* 错误信息 */}
                {error && (
                  <div className="batch-error">{error}</div>
                )}

                {/* 执行结果 */}
                {result && (
                  <div className="batch-result">
                    <div className="batch-result-header">
                      <span className="batch-result-title">执行结果</span>
                      <span className="batch-result-summary">
                        总计: {result.summary.total} |
                        成功: <span className="success">{result.summary.succeeded}</span> |
                        失败: <span className="failed">{result.summary.failed}</span> |
                        耗时: {result.summary.total_duration_ms}ms
                      </span>
                    </div>

                    <div className="batch-result-list">
                      {result.results.map((item) => (
                        <div
                          key={item.index}
                          className={`batch-result-item ${item.status}`}
                        >
                          <span className="result-index">#{item.index + 1}</span>
                          <span className={`result-status ${item.status}`}>
                            {item.status === 'completed' ? '成功' : '失败'}
                          </span>
                          {item.status === 'completed' ? (
                            <span className="result-output">
                              {JSON.stringify(item.outputs)}
                            </span>
                          ) : (
                            <span className="result-error">{item.error}</span>
                          )}
                          <span className="result-duration">{item.duration_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="dialog-footer">
            <button className="dialog-btn secondary" onClick={handleReset}>
              重置
            </button>
            <button className="dialog-btn secondary" onClick={onClose}>
              关闭
            </button>
            <button
              className="dialog-btn primary"
              onClick={handleExecute}
              disabled={executing || inputs.length === 0}
            >
              <RunIcon />
              <span>{executing ? '执行中...' : `批量执行 (${rows.length})`}</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const BatchExecuteDialog = memo(BatchExecuteDialogComponent);
