/**
 * 控制流配置对话框
 *
 * 提供执行模式配置：单次执行、迭代执行、Monte Carlo 模拟
 * 包含累加器、状态变量（含动态初始化）、终止条件、MC 分布配置
 * 集成条件边编辑器和错误处理配置
 *
 * @module lowcode/components/ControlFlowDialog
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { CloseIcon, AddIcon, DeleteIcon } from './icons';
import { EdgeConditionEditor } from './EdgeConditionEditor';
import { ErrorHandlingDialog } from './ErrorHandlingDialog';
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
  MonteCarloConfig,
  MonteCarloOutputFormat,
  ParameterDistribution,
  DistributionType,
  ConditionalEdge,
  ErrorHandlingConfig,
  DynamicInitConfig,
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
  /** 工作流输入名称列表（用于 MC 分布参数选择） */
  workflowInputNames?: string[];
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

const DISTRIBUTION_TYPES: { value: DistributionType; label: string; params: string[] }[] = [
  { value: 'normal', label: '正态分布', params: ['mean', 'std'] },
  { value: 'log_normal', label: '对数正态分布', params: ['mean', 'std'] },
  { value: 'uniform', label: '均匀分布', params: ['min', 'max'] },
  { value: 'truncated_normal', label: '截断正态分布', params: ['mean', 'std', 'min', 'max'] },
  { value: 'triangular', label: '三角分布', params: ['min', 'max', 'mode'] },
  { value: 'beta', label: 'Beta 分布', params: ['alpha', 'beta'] },
  { value: 'gamma', label: 'Gamma 分布', params: ['shape', 'rate'] },
  { value: 'fixed', label: '固定值', params: ['value'] },
];

// ============================================================================
// 子组件：累加器行
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

// ============================================================================
// 子组件：状态变量行（含 dynamic_init）
// ============================================================================

interface StateVarRowProps {
  stateVar: StateVarConfig;
  index: number;
  nodes: WorkflowNode[];
  onUpdate: (index: number, stateVar: StateVarConfig) => void;
  onDelete: (index: number) => void;
}

function StateVarRow({ stateVar, index, nodes, onUpdate, onDelete }: StateVarRowProps) {
  const hasDynamicInit = !!stateVar.dynamic_init;

  const handleToggleDynamicInit = useCallback((checked: boolean) => {
    if (checked) {
      onUpdate(index, {
        ...stateVar,
        dynamic_init: { source_node: '', source_port: '' },
      });
    } else {
      const { dynamic_init: _, ...rest } = stateVar;
      onUpdate(index, rest as StateVarConfig);
    }
  }, [stateVar, index, onUpdate]);

  const handleUpdateDynamicInit = useCallback((field: keyof DynamicInitConfig, value: string) => {
    const currentInit = stateVar.dynamic_init ?? { source_node: '', source_port: '' };
    onUpdate(index, {
      ...stateVar,
      dynamic_init: {
        ...currentInit,
        [field]: value,
      },
    });
  }, [stateVar, index, onUpdate]);

  return (
    <div className="state-var-row-wrapper">
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
      {/* 动态初始化配置 */}
      <div className="dynamic-init-row">
        <label className="dynamic-init-toggle">
          <input
            type="checkbox"
            checked={hasDynamicInit}
            onChange={(e) => handleToggleDynamicInit(e.target.checked)}
          />
          <span>动态初始化</span>
        </label>
        {hasDynamicInit && stateVar.dynamic_init && (
          <div className="dynamic-init-fields">
            <select
              className="config-select config-select-sm"
              value={stateVar.dynamic_init.source_node}
              onChange={(e) => handleUpdateDynamicInit('source_node', e.target.value)}
            >
              <option value="">初始化来源节点</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id}</option>
              ))}
            </select>
            <input
              type="text"
              className="config-input config-input-sm"
              value={stateVar.dynamic_init.source_port}
              onChange={(e) => handleUpdateDynamicInit('source_port', e.target.value)}
              placeholder="初始化来源端口"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 子组件：MC 分布配置行
// ============================================================================

interface DistributionRowProps {
  dist: ParameterDistribution;
  index: number;
  inputNames: string[];
  onUpdate: (index: number, dist: ParameterDistribution) => void;
  onDelete: (index: number) => void;
}

function DistributionRow({ dist, index, inputNames, onUpdate, onDelete }: DistributionRowProps) {
  const distInfo = DISTRIBUTION_TYPES.find((d) => d.value === dist.distribution);
  const requiredParams = distInfo?.params || [];

  return (
    <div className="mc-distribution-row">
      <div className="mc-dist-main">
        <select
          className="config-select"
          value={dist.name}
          onChange={(e) => onUpdate(index, { ...dist, name: e.target.value })}
        >
          <option value="">选择参数</option>
          {inputNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          className="config-select"
          value={dist.distribution}
          onChange={(e) => onUpdate(index, {
            ...dist,
            distribution: e.target.value as DistributionType,
            params: {},
          })}
        >
          {DISTRIBUTION_TYPES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <button className="config-delete-btn" onClick={() => onDelete(index)} title="删除">
          <DeleteIcon />
        </button>
      </div>
      <div className="mc-dist-params">
        {requiredParams.map((paramName) => (
          <label key={paramName} className="mc-dist-param">
            <span>{paramName}:</span>
            <input
              type="number"
              className="config-input config-input-sm"
              value={dist.params[paramName] ?? ''}
              onChange={(e) => onUpdate(index, {
                ...dist,
                params: { ...dist.params, [paramName]: Number(e.target.value) },
              })}
              step="any"
            />
          </label>
        ))}
      </div>
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
  workflowInputNames = [],
}: ControlFlowDialogProps) {
  // 执行模式
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    config?.execution_mode || 'single',
  );

  // 迭代配置
  const [timeSeriesInputs, setTimeSeriesInputs] = useState<string[]>(
    config?.iteration?.time_series_inputs || [],
  );
  const [accumulators, setAccumulators] = useState<AccumulatorConfig[]>(
    config?.iteration?.accumulators || [],
  );
  const [stateVars, setStateVars] = useState<StateVarConfig[]>(
    config?.iteration?.state_vars || [],
  );
  const [termination, setTermination] = useState<TerminationConditionExpr>(
    config?.iteration?.termination?.condition || { type: 'fixed_iterations', iterations: 10 },
  );

  // Monte Carlo 配置
  const [mcSamples, setMcSamples] = useState(config?.monte_carlo?.samples ?? 1000);
  const [mcSeed, setMcSeed] = useState<number | undefined>(config?.monte_carlo?.seed);
  const [mcParallel, setMcParallel] = useState(config?.monte_carlo?.parallel ?? false);
  const [mcPercentiles, setMcPercentiles] = useState<string>(
    (config?.monte_carlo?.output_format?.percentiles || [5, 25, 50, 75, 95]).join(', '),
  );
  const [mcRawSamples, setMcRawSamples] = useState(config?.monte_carlo?.output_format?.raw_samples ?? false);
  const [mcHistogramBins, setMcHistogramBins] = useState<number | undefined>(
    config?.monte_carlo?.output_format?.histogram_bins,
  );
  const [mcDistributions, setMcDistributions] = useState<ParameterDistribution[]>(
    config?.monte_carlo?.distributions || [],
  );

  // 条件边和错误处理
  const [conditionalEdges, setConditionalEdges] = useState<ConditionalEdge[]>(
    config?.conditional_edges || [],
  );
  const [errorHandling, setErrorHandling] = useState<ErrorHandlingConfig | undefined>(
    config?.error_handling,
  );

  // 子对话框状态
  const [editingEdgeIndex, setEditingEdgeIndex] = useState<number | null>(null);
  const [showErrorHandling, setShowErrorHandling] = useState(false);

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
    // MC 配置
    setMcSamples(config?.monte_carlo?.samples ?? 1000);
    setMcSeed(config?.monte_carlo?.seed);
    setMcParallel(config?.monte_carlo?.parallel ?? false);
    setMcPercentiles(
      (config?.monte_carlo?.output_format?.percentiles || [5, 25, 50, 75, 95]).join(', '),
    );
    setMcRawSamples(config?.monte_carlo?.output_format?.raw_samples ?? false);
    setMcHistogramBins(config?.monte_carlo?.output_format?.histogram_bins);
    setMcDistributions(config?.monte_carlo?.distributions || []);
    // 条件边和错误处理
    setConditionalEdges(config?.conditional_edges || []);
    setErrorHandling(config?.error_handling);
  }, [config]);

  // ---- 累加器操作 ----
  const handleAddAccumulator = useCallback(() => {
    setAccumulators((prev) => [
      ...prev,
      { name: `acc_${prev.length + 1}`, source_node: '', source_port: '', operation: 'sum', initial_value: 0 },
    ]);
  }, []);
  const handleUpdateAccumulator = useCallback((index: number, updated: AccumulatorConfig) => {
    setAccumulators((prev) => prev.map((a, i) => (i === index ? updated : a)));
  }, []);
  const handleDeleteAccumulator = useCallback((index: number) => {
    setAccumulators((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- 状态变量操作 ----
  const handleAddStateVar = useCallback(() => {
    setStateVars((prev) => [
      ...prev,
      { name: `state_${prev.length + 1}`, source_node: '', source_port: '', initial_value: 0, lag: 1 },
    ]);
  }, []);
  const handleUpdateStateVar = useCallback((index: number, updated: StateVarConfig) => {
    setStateVars((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }, []);
  const handleDeleteStateVar = useCallback((index: number) => {
    setStateVars((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- 时间序列操作 ----
  const handleAddTimeSeriesInput = useCallback(() => {
    if (newTimeSeriesInput.trim() && !timeSeriesInputs.includes(newTimeSeriesInput.trim())) {
      setTimeSeriesInputs((prev) => [...prev, newTimeSeriesInput.trim()]);
      setNewTimeSeriesInput('');
    }
  }, [newTimeSeriesInput, timeSeriesInputs]);
  const handleDeleteTimeSeriesInput = useCallback((input: string) => {
    setTimeSeriesInputs((prev) => prev.filter((i) => i !== input));
  }, []);

  // ---- MC 分布操作 ----
  const handleAddDistribution = useCallback(() => {
    setMcDistributions((prev) => [
      ...prev,
      { name: '', distribution: 'normal', params: { mean: 0, std: 1 } },
    ]);
  }, []);
  const handleUpdateDistribution = useCallback((index: number, updated: ParameterDistribution) => {
    setMcDistributions((prev) => prev.map((d, i) => (i === index ? updated : d)));
  }, []);
  const handleDeleteDistribution = useCallback((index: number) => {
    setMcDistributions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- 条件边操作 ----
  const handleSaveConditionalEdge = useCallback((edge: ConditionalEdge) => {
    if (editingEdgeIndex !== null && editingEdgeIndex < conditionalEdges.length) {
      setConditionalEdges((prev) => prev.map((e, i) => (i === editingEdgeIndex ? edge : e)));
    } else {
      setConditionalEdges((prev) => [...prev, edge]);
    }
    setEditingEdgeIndex(null);
  }, [editingEdgeIndex, conditionalEdges.length]);

  const handleDeleteConditionalEdge = useCallback(() => {
    if (editingEdgeIndex !== null) {
      setConditionalEdges((prev) => prev.filter((_, i) => i !== editingEdgeIndex));
      setEditingEdgeIndex(null);
    }
  }, [editingEdgeIndex]);

  // ---- 保存配置 ----
  const handleSave = useCallback(() => {
    const needsIteration = executionMode === 'iterative' || executionMode === 'monte_carlo';
    const iterationConfig: IterationConfig | undefined = needsIteration ? {
      time_series_inputs: timeSeriesInputs,
      accumulators,
      state_vars: stateVars,
      termination: { condition: termination },
    } : undefined;

    let mcConfig: MonteCarloConfig | undefined;
    if (executionMode === 'monte_carlo') {
      const percentiles = mcPercentiles
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n));
      const outputFormat: MonteCarloOutputFormat = {
        percentiles: percentiles.length > 0 ? percentiles : [5, 25, 50, 75, 95],
        raw_samples: mcRawSamples,
        histogram_bins: mcHistogramBins,
      };
      mcConfig = {
        samples: mcSamples,
        seed: mcSeed,
        parallel: mcParallel,
        output_format: outputFormat,
        distributions: mcDistributions,
      };
    }

    const newConfig: ControlFlowConfig = {
      execution_mode: executionMode,
      iteration: iterationConfig,
      monte_carlo: mcConfig,
      conditional_edges: conditionalEdges.length > 0 ? conditionalEdges : undefined,
      error_handling: errorHandling,
    };

    onSave(newConfig);
    onClose();
  }, [
    executionMode, timeSeriesInputs, accumulators, stateVars, termination,
    mcSamples, mcSeed, mcParallel, mcPercentiles, mcRawSamples, mcHistogramBins, mcDistributions,
    conditionalEdges, errorHandling, onSave, onClose,
  ]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  const showIterationConfig = executionMode === 'iterative' || executionMode === 'monte_carlo';

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
              <label className="config-mode-option">
                <input
                  type="radio"
                  name="executionMode"
                  value="monte_carlo"
                  checked={executionMode === 'monte_carlo'}
                  onChange={() => setExecutionMode('monte_carlo')}
                />
                <span className="mode-label">Monte Carlo 模拟</span>
                <span className="mode-desc">多次随机采样参数运行，统计输出分布</span>
              </label>
            </div>
          </div>

          {/* 迭代配置（迭代 + MC 模式显示） */}
          {showIterationConfig && (
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
                      <span />
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
                <div className="config-section-desc">跨迭代传递状态（可设置滞后步数和动态初始化）</div>
                {stateVars.length > 0 && (
                  <div className="config-table">
                    <div className="config-table-header">
                      <span>名称</span>
                      <span>源节点</span>
                      <span>端口</span>
                      <span>初始值</span>
                      <span>滞后</span>
                      <span />
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

          {/* Monte Carlo 配置（仅 MC 模式显示） */}
          {executionMode === 'monte_carlo' && (
            <>
              <div className="config-section">
                <div className="config-section-title">Monte Carlo 参数</div>
                <div className="mc-basic-config">
                  <label className="mc-param">
                    <span>采样次数:</span>
                    <input
                      type="number"
                      className="config-input"
                      value={mcSamples}
                      onChange={(e) => setMcSamples(Number(e.target.value))}
                      min={1}
                    />
                  </label>
                  <label className="mc-param">
                    <span>随机种子 (可选):</span>
                    <input
                      type="number"
                      className="config-input"
                      value={mcSeed ?? ''}
                      onChange={(e) => setMcSeed(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="留空为随机"
                    />
                  </label>
                  <label className="mc-param mc-param-toggle">
                    <input
                      type="checkbox"
                      checked={mcParallel}
                      onChange={(e) => setMcParallel(e.target.checked)}
                    />
                    <span>启用并行执行</span>
                  </label>
                </div>
              </div>

              <div className="config-section">
                <div className="config-section-title">输出格式</div>
                <div className="mc-output-config">
                  <label className="mc-param">
                    <span>百分位数:</span>
                    <input
                      type="text"
                      className="config-input config-input-wide"
                      value={mcPercentiles}
                      onChange={(e) => setMcPercentiles(e.target.value)}
                      placeholder="5, 25, 50, 75, 95"
                    />
                  </label>
                  <label className="mc-param mc-param-toggle">
                    <input
                      type="checkbox"
                      checked={mcRawSamples}
                      onChange={(e) => setMcRawSamples(e.target.checked)}
                    />
                    <span>输出原始样本</span>
                  </label>
                  <label className="mc-param">
                    <span>直方图分箱数 (可选):</span>
                    <input
                      type="number"
                      className="config-input"
                      value={mcHistogramBins ?? ''}
                      onChange={(e) => setMcHistogramBins(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="留空不生成"
                      min={2}
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <div className="config-section-header">
                  <div className="config-section-title">参数分布</div>
                  <button className="config-add-btn" onClick={handleAddDistribution}>
                    <AddIcon /> 添加
                  </button>
                </div>
                <div className="config-section-desc">为工作流输入参数配置随机分布</div>
                {mcDistributions.length > 0 && (
                  <div className="mc-distributions">
                    {mcDistributions.map((dist, i) => (
                      <DistributionRow
                        key={i}
                        dist={dist}
                        index={i}
                        inputNames={workflowInputNames}
                        onUpdate={handleUpdateDistribution}
                        onDelete={handleDeleteDistribution}
                      />
                    ))}
                  </div>
                )}
                {mcDistributions.length === 0 && (
                  <div className="config-empty-hint">暂无分布配置，点击&ldquo;添加&rdquo;配置参数分布</div>
                )}
              </div>
            </>
          )}

          {/* 条件边配置 */}
          <div className="config-section">
            <div className="config-section-header">
              <div className="config-section-title">条件边</div>
              <button
                className="config-add-btn"
                onClick={() => setEditingEdgeIndex(conditionalEdges.length)}
              >
                <AddIcon /> 添加
              </button>
            </div>
            <div className="config-section-desc">为边添加条件，只有条件满足时数据才能通过</div>
            {conditionalEdges.length > 0 ? (
              <div className="conditional-edges-list">
                {conditionalEdges.map((edge, i) => (
                  <div key={i} className="conditional-edge-item">
                    <span className="conditional-edge-id">边: {edge.edge_id}</span>
                    <span className="conditional-edge-type">类型: {edge.condition.type}</span>
                    <button
                      className="toolbar-btn toolbar-btn-sm"
                      onClick={() => setEditingEdgeIndex(i)}
                    >
                      编辑
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="config-empty-hint">暂无条件边配置</div>
            )}
          </div>

          {/* 错误处理配置 */}
          <div className="config-section">
            <div className="config-section-header">
              <div className="config-section-title">错误处理</div>
              <button
                className="toolbar-btn toolbar-btn-sm"
                onClick={() => setShowErrorHandling(true)}
              >
                配置
              </button>
            </div>
            <div className="config-section-desc">
              {errorHandling
                ? `已配置 (${errorHandling.retry ? '全局重试' : '无全局重试'}, ${errorHandling.node_handlers?.length || 0} 个节点处理器)`
                : '未配置错误处理策略'}
            </div>
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

      {/* 条件边编辑子对话框 */}
      {editingEdgeIndex !== null && (
        <EdgeConditionEditor
          isOpen
          onClose={() => setEditingEdgeIndex(null)}
          edgeId={editingEdgeIndex < conditionalEdges.length
            ? conditionalEdges[editingEdgeIndex].edge_id
            : ''}
          edgeLabel={editingEdgeIndex < conditionalEdges.length
            ? `条件边 #${editingEdgeIndex + 1}`
            : '新条件边'}
          condition={editingEdgeIndex < conditionalEdges.length
            ? conditionalEdges[editingEdgeIndex].condition
            : undefined}
          onSave={handleSaveConditionalEdge}
          onDelete={editingEdgeIndex < conditionalEdges.length
            ? handleDeleteConditionalEdge
            : undefined}
          nodes={nodes}
          accumulators={accumulators}
          stateVars={stateVars}
          workflowInputs={workflowInputNames}
        />
      )}

      {/* 错误处理子对话框 */}
      <ErrorHandlingDialog
        isOpen={showErrorHandling}
        onClose={() => setShowErrorHandling(false)}
        config={errorHandling}
        onSave={(cfg) => setErrorHandling(cfg)}
        nodes={nodes}
      />
    </div>
  );
}

export const ControlFlowDialog = memo(ControlFlowDialogComponent);
