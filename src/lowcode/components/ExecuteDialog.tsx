/**
 * 执行对话框组件
 *
 * 提供流程执行的输入表单和结果展示
 *
 * @module lowcode/components/ExecuteDialog
 */

import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { MathFormula } from './MathFormula';
import { CloseIcon, RunIcon, HistoryIcon } from './icons';
import {
  getDefaultValue,
  parseValue,
  formatValue,
  isNumberType,
  isBooleanType,
  isJsonType,
  isArrayType,
} from '../utils/formUtils';
import type {
  ExecutionResult,
  DataType,
  InputHistoryEntry,
  ExecuteOptions,
  IterationInfo,
  PortReference,
  ExecutionMode,
} from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

/** 输入定义（包含数据类型） */
export interface InputDefinition {
  /** 输入参数名称 */
  name: string;
  /** 用户友好的显示名称（如 "加法.a"） */
  displayName?: string;
  /** 绑定到的节点端口（时间序列输入可能为空） */
  bind_to?: PortReference;
  data_type?: DataType;
  description?: string;
  required?: boolean;
  /** 默认值（可选） */
  default_value?: unknown;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
  /** 论文引用说明 */
  paper_ref?: string;
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
  onExecute: (inputs: Record<string, unknown>, options?: ExecuteOptions) => Promise<ExecutionResult>;
  /** 参数历史列表（可选） */
  inputHistory?: InputHistoryEntry[];
  /** 加载参数历史回调（可选） */
  onLoadHistory?: () => Promise<void>;
  /** 是否显示执行选项 */
  showOptions?: boolean;
  /** 当前执行模式（从 control_flow 配置） */
  executionMode?: ExecutionMode;
  /** 时间序列输入名称列表 */
  timeSeriesInputs?: string[];
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
  // 使用导入的类型判断函数
  const isArray = isArrayType(dataType);
  const isJson = isJsonType(dataType);
  const isBoolean = isBooleanType(dataType);
  const isNumber = isNumberType(dataType);

  // 渲染输入控件
  const renderInputControl = () => {
    if (isJson) {
      return (
        <textarea
          className="form-input form-textarea"
          value={value}
          onChange={handleChange}
          placeholder={`输入 ${isArray ? '数组' : '对象'} (JSON 格式，如: [1, 2, 3])`}
          rows={4}
        />
      );
    }

    if (isBoolean) {
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
        type={isNumber ? 'number' : 'text'}
        className="form-input"
        value={value}
        onChange={handleChange}
        placeholder={`输入${isNumber ? '数字' : '文本'}`}
      />
    );
  };

  // 使用 displayName 显示，如果没有则回退到 name
  const labelText = input.displayName || input.name;

  // 渲染标签：如果有 latex_name 则使用 MathFormula 渲染
  const renderLabel = () => {
    if (input.latex_name) {
      return (
        <span className="input-label-with-latex">
          <span className="input-label-name">{labelText}</span>
          <span className="input-label-latex">
            {'('}<MathFormula latex={input.latex_name} inline />{')'}
          </span>
        </span>
      );
    }
    return <span>{labelText}</span>;
  };

  return (
    <div className="form-field">
      <label className="form-label" title={input.paper_ref || undefined}>
        {renderLabel()}
        {input.required && <span className="required-mark">*</span>}
        <span className="input-type">({dataType})</span>
      </label>

      {renderInputControl()}

      {/* 描述和论文引用 */}
      {(input.description || input.paper_ref) && (
        <div className="form-hint">
          {input.description}
          {input.paper_ref && (
            <span className="form-paper-ref" title="论文引用">
              {' '}📄 {input.paper_ref}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 执行结果组件
// ============================================================================

// ============================================================================
// 迭代信息视图组件
// ============================================================================

interface IterationInfoViewProps {
  info: IterationInfo;
}

/**
 * 迭代执行信息展示
 */
function IterationInfoView({ info }: IterationInfoViewProps) {
  return (
    <div className="iteration-info">
      <h4 className="iteration-info-title">迭代执行信息</h4>
      <div className="iteration-info-grid">
        <div className="iteration-info-item">
          <span className="iteration-info-label">总迭代次数:</span>
          <span className="iteration-info-value">{info.total_iterations}</span>
        </div>
        {info.termination_reason && (
          <div className="iteration-info-item">
            <span className="iteration-info-label">终止原因:</span>
            <span className="iteration-info-value">{info.termination_reason}</span>
          </div>
        )}
        {info.terminated_at_index !== undefined && (
          <div className="iteration-info-item">
            <span className="iteration-info-label">终止索引:</span>
            <span className="iteration-info-value">{info.terminated_at_index}</span>
          </div>
        )}
      </div>
      {Object.keys(info.accumulators).length > 0 && (
        <div className="iteration-accumulators">
          <h5 className="accumulator-title">累加器值</h5>
          <div className="accumulator-grid">
            {Object.entries(info.accumulators).map(([name, value]) => (
              <div key={name} className="accumulator-item">
                <span className="accumulator-name">{name}:</span>
                <span className="accumulator-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

  // 导出执行结果
  const handleExportResult = useCallback(() => {
    const exportData = {
      execution_id: result.execution_id,
      status: result.status,
      outputs: result.outputs,
      error: result.error,
      total_duration_ms: result.total_duration_ms,
      trace: result.trace,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-result-${result.execution_id || Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="execution-result">
      <div className="execution-status">
        <span className={`execution-status-badge ${result.status}`}>
          {statusText}
        </span>
        <span className="execution-duration">
          耗时: {result.total_duration_ms}ms
        </span>
        <button
          className="export-result-btn"
          onClick={handleExportResult}
          title="导出执行结果"
        >
          导出
        </button>
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

      {/* 迭代执行信息 */}
      {result.iteration_info && (
        <IterationInfoView info={result.iteration_info} />
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
  executionMode = 'single',
  timeSeriesInputs = [],
}: ExecuteDialogProps) {
  // 输入值状态
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    inputs.forEach((input) => {
      // 优先使用算子定义的 default_value，其次使用数据类型的默认值
      const defaultVal = input.default_value !== undefined
        ? input.default_value
        : getDefaultValue(input.data_type);
      initial[input.name] = formatValue(defaultVal, input.data_type);
    });
    return initial;
  });

  // 执行状态
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 执行选项
  const [enableTrace, setEnableTrace] = useState(true);
  const [enableParallel, setEnableParallel] = useState(false);

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

  // 打开时重置输入值和历史下拉
  useEffect(() => {
    if (isOpen) {
      // 重置输入值为默认值
      const initial: Record<string, string> = {};
      inputs.forEach((input) => {
        const defaultVal = input.default_value !== undefined
          ? input.default_value
          : getDefaultValue(input.data_type);
        initial[input.name] = formatValue(defaultVal, input.data_type);
      });
      setInputValues(initial);
      setResult(null);
      setError(null);
    } else {
      setShowHistory(false);
    }
  }, [isOpen, inputs]);

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

      // 构建执行选项
      const options: ExecuteOptions = {
        trace: enableTrace,
        parallel: enableParallel,
      };

      const executionResult = await onExecute(parsedInputs, options);
      setResult(executionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
    } finally {
      setIsExecuting(false);
    }
  }, [inputs, inputValues, onExecute, enableTrace, enableParallel]);

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
          {/* 执行模式指示器 */}
          <div className="execute-mode-indicator">
            <span className="mode-label">执行模式:</span>
            <span className={`mode-value mode-${executionMode}`}>
              {executionMode === 'iterative' ? '迭代执行' : '单次执行'}
            </span>
            {executionMode === 'iterative' && timeSeriesInputs.length > 0 && (
              <span className="mode-hint">
                (时间序列: {timeSeriesInputs.join(', ')})
              </span>
            )}
          </div>

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

          {/* 执行选项 */}
          <div className="execute-options">
            <div className="execute-options-title">执行选项</div>
            <div className="execute-options-row">
              <label className="execute-option">
                <input
                  type="checkbox"
                  checked={enableTrace}
                  onChange={(e) => setEnableTrace(e.target.checked)}
                />
                <span>启用执行追踪</span>
              </label>
              <label className="execute-option">
                <input
                  type="checkbox"
                  checked={enableParallel}
                  onChange={(e) => setEnableParallel(e.target.checked)}
                />
                <span>启用并行执行</span>
              </label>
            </div>
          </div>

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
