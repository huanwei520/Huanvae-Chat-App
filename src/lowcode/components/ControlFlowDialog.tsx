/**
 * 控制流配置对话框
 *
 * 提供迭代执行配置：执行模式、累加器、状态变量、终止条件
 *
 * @module lowcode/components/ControlFlowDialog
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { CloseIcon, AddIcon, DeleteIcon } from './icons';
import type {
  ControlFlowConfig,
  ExecutionMode,
  IterationConfig,
  AccumulatorConfig,
  StateVarConfig,
  TerminationConditionExpr,
  TerminationConditionType,
  AccumulatorOperation,
  CompareOp,
  WorkflowNode,
} from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

interface ControlFlowDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前配置 */
  config?: ControlFlowConfig;
  /** 保存回调 */
  onSave: (config: ControlFlowConfig) => void;
  /** 流程节点列表（用于选择源节点） */
  nodes: WorkflowNode[];
}

// ============================================================================
// 常量
// ============================================================================

const ACCUMULATOR_OPERATIONS: { value: AccumulatorOperation; label: string }[] = [
  { value: 'sum', label: '求和' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
  { value: 'count', label: '计数' },
  { value: 'last', label: '最后值' },
  { value: 'average', label: '平均值' },
];

const TERMINATION_TYPES: { value: TerminationConditionType; label: string }[] = [
  { value: 'fixed_iterations', label: '固定次数' },
  { value: 'accumulator_threshold', label: '累加器阈值' },
  { value: 'exhaust_input', label: '耗尽输入' },
  { value: 'custom', label: '自定义表达式' },
];

const COMPARE_OPS: { value: CompareOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
];

// ============================================================================
// 子组件
// ============================================================================

interface AccumulatorRowProps {
  accumulator: AccumulatorConfig;
  index: number;
  nodes: WorkflowNode[];
  onUpdate: (index: number, accumulator: AccumulatorConfig) => void;
  onDelete: (index: number) => void;
}

function AccumulatorRow({ accumulator, index, nodes, onUpdate, onDelete }: AccumulatorRowProps) {
  return (
    <div className="config-table-row">
      <input
        type="text"
        className="config-input config-input-sm"
        value={accumulator.name}
        onChange={(e) => onUpdate(index, { ...accumulator, name: e.target.value })}
        placeholder="名称"
      />
      <select
        className="config-select"
        value={accumulator.source_node}
        onChange={(e) => onUpdate(index, { ...accumulator, source_node: e.target.value })}
      >
        <option value="">选择节点</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>{n.name || n.id}</option>
        ))}
      </select>
      <input
        type="text"
        className="config-input config-input-sm"
        value={accumulator.source_port}
        onChange={(e) => onUpdate(index, { ...accumulator, source_port: e.target.value })}
        placeholder="端口"
      />
      <select
        className="config-select"
        value={accumulator.operation}
        onChange={(e) => onUpdate(index, { ...accumulator, operation: e.target.value as AccumulatorOperation })}
      >
        {ACCUMULATOR_OPERATIONS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
      <input
        type="number"
        className="config-input config-input-sm"
        value={accumulator.initial_value}
        onChange={(e) => onUpdate(index, { ...accumulator, initial_value: Number(e.target.value) })}
        placeholder="初始值"
      />
      <button className="config-delete-btn" onClick={() => onDelete(index)} title="删除">
        <DeleteIcon />
      </button>
    </div>
  );
}

interface StateVarRowProps {
  stateVar: StateVarConfig;
  index: number;
  nodes: WorkflowNode[];
  onUpdate: (index: number, stateVar: StateVarConfig) => void;
  onDelete: (index: number) => void;
}

function StateVarRow({ stateVar, index, nodes, onUpdate, onDelete }: StateVarRowProps) {
  return (
    <div className="config-table-row">
      <input
        type="text"
        className="config-input config-input-sm"
        value={stateVar.name}
        onChange={(e) => onUpdate(index, { ...stateVar, name: e.target.value })}
        placeholder="名称"
      />
      <select
        className="config-select"
        value={stateVar.source_node}
        onChange={(e) => onUpdate(index, { ...stateVar, source_node: e.target.value })}
      >
        <option value="">选择节点</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>{n.name || n.id}</option>
        ))}
      </select>
      <input
        type="text"
        className="config-input config-input-sm"
        value={stateVar.source_port}
        onChange={(e) => onUpdate(index, { ...stateVar, source_port: e.target.value })}
        placeholder="端口"
      />
      <input
        type="number"
        className="config-input config-input-sm"
        value={stateVar.initial_value}
        onChange={(e) => onUpdate(index, { ...stateVar, initial_value: Number(e.target.value) })}
        placeholder="初始值"
      />
      <input
        type="number"
        className="config-input config-input-sm"
        value={stateVar.lag ?? 1}
        onChange={(e) => onUpdate(index, { ...stateVar, lag: Number(e.target.value) })}
        placeholder="滞后"
        min={1}
      />
      <button className="config-delete-btn" onClick={() => onDelete(index)} title="删除">
        <DeleteIcon />
      </button>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function ControlFlowDialogComponent({
  isOpen,
  onClose,
  config,
  onSave,
  nodes,
}: ControlFlowDialogProps) {
  // 执行模式
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    config?.execution_mode || 'single'
  );

  // 迭代配置
  const [timeSeriesInputs, setTimeSeriesInputs] = useState<string[]>(
    config?.iteration?.time_series_inputs || []
  );
  const [accumulators, setAccumulators] = useState<AccumulatorConfig[]>(
    config?.iteration?.accumulators || []
  );
  const [stateVars, setStateVars] = useState<StateVarConfig[]>(
    config?.iteration?.state_vars || []
  );
  // 使用 TerminationConditionExpr（条件表达式本体）
  const [termination, setTermination] = useState<TerminationConditionExpr>(
    config?.iteration?.termination?.condition || { type: 'fixed_iterations', iterations: 10 }
  );

  // 新增时间序列输入
  const [newTimeSeriesInput, setNewTimeSeriesInput] = useState('');

  // 同步外部 config 变化到内部状态
  useEffect(() => {
    setExecutionMode(config?.execution_mode || 'single');
    setTimeSeriesInputs(config?.iteration?.time_series_inputs || []);
    setAccumulators(config?.iteration?.accumulators || []);
    setStateVars(config?.iteration?.state_vars || []);
    setTermination(config?.iteration?.termination?.condition || { type: 'fixed_iterations', iterations: 10 });
    setNewTimeSeriesInput('');
  }, [config]);

  // 添加累加器
  const handleAddAccumulator = useCallback(() => {
    setAccumulators((prev) => [
      ...prev,
      {
        name: `acc_${prev.length + 1}`,
        source_node: '',
        source_port: '',
        operation: 'sum',
        initial_value: 0,
      },
    ]);
  }, []);

  // 更新累加器
  const handleUpdateAccumulator = useCallback((index: number, updated: AccumulatorConfig) => {
    setAccumulators((prev) => prev.map((a, i) => (i === index ? updated : a)));
  }, []);

  // 删除累加器
  const handleDeleteAccumulator = useCallback((index: number) => {
    setAccumulators((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 添加状态变量
  const handleAddStateVar = useCallback(() => {
    setStateVars((prev) => [
      ...prev,
      {
        name: `state_${prev.length + 1}`,
        source_node: '',
        source_port: '',
        initial_value: 0,
        lag: 1,
      },
    ]);
  }, []);

  // 更新状态变量
  const handleUpdateStateVar = useCallback((index: number, updated: StateVarConfig) => {
    setStateVars((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }, []);

  // 删除状态变量
  const handleDeleteStateVar = useCallback((index: number) => {
    setStateVars((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 添加时间序列输入
  const handleAddTimeSeriesInput = useCallback(() => {
    if (newTimeSeriesInput.trim() && !timeSeriesInputs.includes(newTimeSeriesInput.trim())) {
      setTimeSeriesInputs((prev) => [...prev, newTimeSeriesInput.trim()]);
      setNewTimeSeriesInput('');
    }
  }, [newTimeSeriesInput, timeSeriesInputs]);

  // 删除时间序列输入
  const handleDeleteTimeSeriesInput = useCallback((input: string) => {
    setTimeSeriesInputs((prev) => prev.filter((i) => i !== input));
  }, []);

  // 保存配置
  const handleSave = useCallback(() => {
    const iterationConfig: IterationConfig | undefined = executionMode === 'iterative' ? {
      time_series_inputs: timeSeriesInputs,
      accumulators,
      state_vars: stateVars,
      termination: { condition: termination }, // 包装为后端期望的格式
    } : undefined;

    const newConfig: ControlFlowConfig = {
      execution_mode: executionMode,
      iteration: iterationConfig,
      conditional_edges: config?.conditional_edges,
      error_handling: config?.error_handling,
    };

    onSave(newConfig);
    onClose();
  }, [executionMode, timeSeriesInputs, accumulators, stateVars, termination, config, onSave, onClose]);

  // 阻止点击内容区域关闭
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-lg control-flow-dialog" onClick={handleContentClick}>
        <div className="dialog-header">
          <div className="dialog-title">控制流配置</div>
          <button className="dialog-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-body">
          {/* 执行模式选择 */}
          <div className="config-section">
            <div className="config-section-title">执行模式</div>
            <div className="config-mode-select">
              <label className="config-mode-option">
                <input
                  type="radio"
                  name="executionMode"
                  value="single"
                  checked={executionMode === 'single'}
                  onChange={() => setExecutionMode('single')}
                />
                <span className="mode-label">单次执行</span>
                <span className="mode-desc">执行一次工作流</span>
              </label>
              <label className="config-mode-option">
                <input
                  type="radio"
                  name="executionMode"
                  value="iterative"
                  checked={executionMode === 'iterative'}
                  onChange={() => setExecutionMode('iterative')}
                />
                <span className="mode-label">迭代执行</span>
                <span className="mode-desc">循环执行直到满足终止条件</span>
              </label>
            </div>
          </div>

          {/* 迭代配置（仅迭代模式显示） */}
          {executionMode === 'iterative' && (
            <>
              {/* 时间序列输入 */}
              <div className="config-section">
                <div className="config-section-title">时间序列输入</div>
                <div className="config-section-desc">每次迭代从这些输入中取下一个元素</div>
                <div className="time-series-inputs">
                  {timeSeriesInputs.map((input) => (
                    <span key={input} className="time-series-tag">
                      {input}
                      <button
                        className="tag-delete"
                        onClick={() => handleDeleteTimeSeriesInput(input)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <div className="time-series-add">
                    <input
                      type="text"
                      className="config-input"
                      value={newTimeSeriesInput}
                      onChange={(e) => setNewTimeSeriesInput(e.target.value)}
                      placeholder="输入名称"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTimeSeriesInput()}
                    />
                    <button className="config-add-btn" onClick={handleAddTimeSeriesInput}>
                      <AddIcon />
                    </button>
                  </div>
                </div>
              </div>

              {/* 累加器配置 */}
              <div className="config-section">
                <div className="config-section-header">
                  <div className="config-section-title">累加器</div>
                  <button className="config-add-btn" onClick={handleAddAccumulator}>
                    <AddIcon /> 添加
                  </button>
                </div>
                <div className="config-section-desc">跨迭代累积数据</div>
                {accumulators.length > 0 && (
                  <div className="config-table">
                    <div className="config-table-header">
                      <span>名称</span>
                      <span>源节点</span>
                      <span>端口</span>
                      <span>操作</span>
                      <span>初始值</span>
                      <span></span>
                    </div>
                    {accumulators.map((acc, i) => (
                      <AccumulatorRow
                        key={i}
                        accumulator={acc}
                        index={i}
                        nodes={nodes}
                        onUpdate={handleUpdateAccumulator}
                        onDelete={handleDeleteAccumulator}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 状态变量配置 */}
              <div className="config-section">
                <div className="config-section-header">
                  <div className="config-section-title">状态变量</div>
                  <button className="config-add-btn" onClick={handleAddStateVar}>
                    <AddIcon /> 添加
                  </button>
                </div>
                <div className="config-section-desc">跨迭代传递状态（可设置滞后步数）</div>
                {stateVars.length > 0 && (
                  <div className="config-table">
                    <div className="config-table-header">
                      <span>名称</span>
                      <span>源节点</span>
                      <span>端口</span>
                      <span>初始值</span>
                      <span>滞后</span>
                      <span></span>
                    </div>
                    {stateVars.map((sv, i) => (
                      <StateVarRow
                        key={i}
                        stateVar={sv}
                        index={i}
                        nodes={nodes}
                        onUpdate={handleUpdateStateVar}
                        onDelete={handleDeleteStateVar}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 终止条件 */}
              <div className="config-section">
                <div className="config-section-title">终止条件</div>
                <div className="termination-config">
                  <select
                    className="config-select"
                    value={termination.type}
                    onChange={(e) => setTermination({ ...termination, type: e.target.value as TerminationConditionType })}
                  >
                    {TERMINATION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>

                  {termination.type === 'fixed_iterations' && (
                    <div className="termination-params">
                      <label>
                        迭代次数:
                        <input
                          type="number"
                          className="config-input"
                          value={termination.iterations ?? 10}
                          onChange={(e) => setTermination({ ...termination, iterations: Number(e.target.value) })}
                          min={1}
                        />
                      </label>
                    </div>
                  )}

                  {termination.type === 'accumulator_threshold' && (
                    <div className="termination-params">
                      <label>
                        累加器:
                        <select
                          className="config-select"
                          value={termination.name ?? ''}
                          onChange={(e) => setTermination({ ...termination, name: e.target.value })}
                        >
                          <option value="">选择累加器</option>
                          {accumulators.map((a) => (
                            <option key={a.name} value={a.name}>{a.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        比较:
                        <select
                          className="config-select"
                          value={termination.op ?? 'gte'}
                          onChange={(e) => setTermination({ ...termination, op: e.target.value as CompareOp })}
                        >
                          {COMPARE_OPS.map((op) => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        阈值:
                        <input
                          type="number"
                          className="config-input"
                          value={termination.threshold ?? 0}
                          onChange={(e) => setTermination({ ...termination, threshold: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}

                  {termination.type === 'custom' && (
                    <div className="termination-params">
                      <label>
                        表达式:
                        <input
                          type="text"
                          className="config-input config-input-wide"
                          value={termination.expression ?? ''}
                          onChange={(e) => setTermination({ ...termination, expression: e.target.value })}
                          placeholder="如: accumulators.total > 1000"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
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

export const ControlFlowDialog = memo(ControlFlowDialogComponent);
