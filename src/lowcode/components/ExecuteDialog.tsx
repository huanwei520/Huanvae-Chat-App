/**
 * 执行对话框组件
 *
 * 提供流程执行的输入表单和结果展示
 *
 * @module lowcode/components/ExecuteDialog
 */

import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import type { WorkflowInput, ExecutionResult, DataType, InputHistoryEntry } from '../types/lowcode';

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

/** 运行图标 */
function RunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5,3 19,12 5,21 5,3" />
    </svg>
  );
}

/** 历史图标 */
function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

/** 输入定义（包含数据类型） */
interface InputDefinition extends WorkflowInput {
  /** 用户友好的显示名称（如 "加法.a"） */
  displayName?: string;
  data_type?: DataType;
  description?: string;
  required?: boolean;
}

/** 对话框 Props */
interface ExecuteDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 流程名称 */
  workflowName: string;
  /** 流程输入定义 */
  inputs: InputDefinition[];
  /** 执行回调 */
  onExecute: (inputs: Record<string, unknown>) => Promise<ExecutionResult>;
  /** 参数历史列表（可选） */
  inputHistory?: InputHistoryEntry[];
  /** 加载参数历史回调（可选） */
  onLoadHistory?: () => Promise<void>;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取输入类型的默认值
 */
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

/**
 * 解析输入值
 */
function parseValue(value: string, dataType?: DataType): unknown {
  if (!value.trim()) {
    return getDefaultValue(dataType);
  }

  switch (dataType) {
    case 'number': {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }
    case 'boolean':
      return value.toLowerCase() === 'true';
    case 'array':
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return dataType === 'array' ? [] : {};
      }
    case 'string':
    default:
      return value;
  }
}

/**
 * 格式化值为字符串
 */
function formatValue(value: unknown, dataType?: DataType): string {
  if (value === null || value === undefined) {
    return '';
  }

  switch (dataType) {
    case 'array':
    case 'object':
      return JSON.stringify(value, null, 2);
    default:
      return String(value);
  }
}

// ============================================================================
// 输入字段组件
// ============================================================================

interface InputFieldProps {
  input: InputDefinition;
  value: string;
  onChange: (value: string) => void;
}

function InputField({ input, value, onChange }: InputFieldProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const dataType = input.data_type || 'string';
  const isJsonType = dataType === 'array' || dataType === 'object';
  const isBooleanType = dataType === 'boolean';

  // 渲染输入控件
  const renderInputControl = () => {
    if (isJsonType) {
      return (
        <textarea
          className="form-input form-textarea"
          value={value}
          onChange={handleChange}
          placeholder={`输入 ${dataType === 'array' ? '数组' : '对象'} (JSON 格式)`}
          rows={4}
        />
      );
    }

    if (isBooleanType) {
      return (
        <select
          className="form-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    return (
      <input
        type={dataType === 'number' ? 'number' : 'text'}
        className="form-input"
        value={value}
        onChange={handleChange}
        placeholder={`输入${dataType === 'number' ? '数字' : '文本'}`}
      />
    );
  };

  // 使用 displayName 显示，如果没有则回退到 name
  const labelText = input.displayName || input.name;

  return (
    <div className="form-field">
      <label className="form-label">
        {labelText}
        {input.required && <span className="required-mark">*</span>}
        <span className="input-type">({dataType})</span>
      </label>

      {renderInputControl()}

      {input.description && (
        <div className="form-hint">{input.description}</div>
      )}
    </div>
  );
}

// ============================================================================
// 执行结果组件
// ============================================================================

interface ExecutionResultViewProps {
  result: ExecutionResult;
}

function ExecutionResultView({ result }: ExecutionResultViewProps) {
  const [showTrace, setShowTrace] = useState(false);

  const statusText = useMemo(() => {
    switch (result.status) {
      case 'completed':
        return '执行成功';
      case 'failed':
        return '执行失败';
      case 'running':
        return '执行中';
      case 'timeout':
        return '执行超时';
      default:
        return result.status;
    }
  }, [result.status]);

  return (
    <div className="execution-result">
      <div className="execution-status">
        <span className={`execution-status-badge ${result.status}`}>
          {statusText}
        </span>
        <span className="execution-duration">
          耗时: {result.total_duration_ms}ms
        </span>
      </div>

      {result.error && (
        <div className="execution-error">
          <strong>错误:</strong> {result.error}
        </div>
      )}

      {result.outputs && Object.keys(result.outputs).length > 0 && (
        <div className="execution-outputs">
          <div className="outputs-title">输出结果:</div>
          <pre>{JSON.stringify(result.outputs, null, 2)}</pre>
        </div>
      )}

      {result.trace && result.trace.length > 0 && (
        <div className="execution-trace">
          <button
            className="trace-toggle"
            onClick={() => setShowTrace(!showTrace)}
          >
            {showTrace ? '隐藏' : '显示'}执行追踪 ({result.trace.length} 步)
          </button>

          {showTrace && (
            <div className="trace-list">
              {result.trace.map((trace, index) => (
                <div key={index} className={`trace-item ${trace.status}`}>
                  <div className="trace-header">
                    <span className="trace-step">#{index + 1}</span>
                    <span className="trace-node">{trace.node_id}</span>
                    <span className="trace-operator">{trace.operator_id}</span>
                    <span className="trace-duration">{trace.duration_ms}ms</span>
                  </div>
                  <div className="trace-io">
                    <div className="trace-input">
                      <strong>输入:</strong>
                      <pre>{JSON.stringify(trace.input, null, 2)}</pre>
                    </div>
                    <div className="trace-output">
                      <strong>输出:</strong>
                      <pre>{JSON.stringify(trace.output, null, 2)}</pre>
                    </div>
                  </div>
                  {trace.error && (
                    <div className="trace-error">
                      <strong>错误:</strong> {trace.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 执行对话框
 *
 * 提供输入表单和执行结果展示
 */
function ExecuteDialogComponent({
  isOpen,
  onClose,
  workflowName,
  inputs,
  onExecute,
  inputHistory,
  onLoadHistory,
}: ExecuteDialogProps) {
  // 输入值状态
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    inputs.forEach((input) => {
      initial[input.name] = formatValue(getDefaultValue(input.data_type), input.data_type);
    });
    return initial;
  });

  // 执行状态
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 历史下拉状态
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 加载历史
  const handleLoadHistory = useCallback(async () => {
    if (!onLoadHistory) { return; }

    setLoadingHistory(true);
    try {
      await onLoadHistory();
    } finally {
      setLoadingHistory(false);
    }
  }, [onLoadHistory]);

  // 打开历史下拉时加载
  const handleToggleHistory = useCallback(() => {
    if (!showHistory && onLoadHistory) {
      handleLoadHistory();
    }
    setShowHistory(!showHistory);
  }, [showHistory, onLoadHistory, handleLoadHistory]);

  // 选择历史记录
  const handleSelectHistory = useCallback((entry: InputHistoryEntry) => {
    const newValues: Record<string, string> = {};
    inputs.forEach((input) => {
      const historyValue = entry.inputs[input.name];
      if (historyValue !== undefined) {
        newValues[input.name] = formatValue(historyValue, input.data_type);
      } else {
        newValues[input.name] = formatValue(getDefaultValue(input.data_type), input.data_type);
      }
    });
    setInputValues(newValues);
    setShowHistory(false);
  }, [inputs]);

  // 关闭时重置历史下拉
  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
    }
  }, [isOpen]);

  // 处理输入变更
  const handleInputChange = useCallback((name: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // 处理执行
  const handleExecute = useCallback(async () => {
    setIsExecuting(true);
    setError(null);
    setResult(null);

    try {
      // 解析输入值
      const parsedInputs: Record<string, unknown> = {};
      inputs.forEach((input) => {
        const rawValue = inputValues[input.name] || '';
        parsedInputs[input.name] = parseValue(rawValue, input.data_type);
      });

      const executionResult = await onExecute(parsedInputs);
      setResult(executionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
    } finally {
      setIsExecuting(false);
    }
  }, [inputs, inputValues, onExecute]);

  // 处理关闭
  const handleClose = useCallback(() => {
    if (!isExecuting) {
      setResult(null);
      setError(null);
      onClose();
    }
  }, [isExecuting, onClose]);

  // 阻止点击内容区域关闭
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog dialog-md" onClick={handleContentClick}>
        <div className="dialog-header">
          <div className="dialog-title">运行流程: {workflowName}</div>
          <button className="dialog-close" onClick={handleClose} disabled={isExecuting}>
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-body">
          {/* 输入表单 */}
          {inputs.length > 0 ? (
            <div className="execute-inputs">
              <div className="section-title-row">
                <div className="section-title">输入参数</div>
                {onLoadHistory && (
                  <div className="history-dropdown">
                    <button
                      className="history-btn"
                      onClick={handleToggleHistory}
                      disabled={loadingHistory}
                      title="从历史记录填充"
                    >
                      <HistoryIcon />
                      <span>{loadingHistory ? '加载中...' : '历史'}</span>
                    </button>

                    {showHistory && inputHistory && inputHistory.length > 0 && (
                      <div className="history-menu">
                        {inputHistory.map((entry, index) => (
                          <button
                            key={index}
                            className="history-item"
                            onClick={() => handleSelectHistory(entry)}
                          >
                            <span className="history-time">
                              {new Date(entry.executed_at).toLocaleString()}
                            </span>
                            <span className={`history-status ${entry.status}`}>
                              {entry.status === 'completed' ? '成功' : '失败'}
                            </span>
                            <span className="history-preview">
                              {Object.entries(entry.inputs)
                                .slice(0, 3)
                                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                                .join(', ')}
                              {Object.keys(entry.inputs).length > 3 && '...'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {showHistory && (!inputHistory || inputHistory.length === 0) && !loadingHistory && (
                      <div className="history-menu">
                        <div className="history-empty">暂无历史记录</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {inputs.map((input) => (
                <InputField
                  key={input.name}
                  input={input}
                  value={inputValues[input.name] || ''}
                  onChange={(value) => handleInputChange(input.name, value)}
                />
              ))}
            </div>
          ) : (
            <div className="execute-no-inputs">
              此流程没有输入参数
            </div>
          )}

          {/* 错误信息 */}
          {error && (
            <div className="execute-error">
              {error}
            </div>
          )}

          {/* 执行结果 */}
          {result && <ExecutionResultView result={result} />}
        </div>

        <div className="dialog-footer">
          <button
            className="toolbar-btn"
            onClick={handleClose}
            disabled={isExecuting}
          >
            关闭
          </button>
          <button
            className="toolbar-btn primary"
            onClick={handleExecute}
            disabled={isExecuting}
          >
            <RunIcon />
            <span>{isExecuting ? '执行中...' : '执行'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export const ExecuteDialog = memo(ExecuteDialogComponent);
export default ExecuteDialog;
