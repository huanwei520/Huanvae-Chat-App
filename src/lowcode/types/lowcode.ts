/**
 * 低代码平台类型定义
 *
 * 定义算子、流程、节点等核心数据结构
 *
 * @module lowcode/types
 */

// ============================================================================
// 算子相关类型
// ============================================================================

/** 数据类型 */
export type DataType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** 算子输入端口 */
export interface OperatorInput {
  /** 端口名称 */
  name: string;
  /** 数据类型（后端可能返回 data_type 或 type） */
  data_type?: DataType;
  type?: DataType;
  /** 是否必填 */
  required?: boolean;
  /** 端口描述 */
  description?: string;
  /** LaTeX 格式的参数名（如 T_K, \xi） */
  latex_name?: string;
  /** 论文引用说明（参数在论文中的含义） */
  paper_ref?: string;
  /** 默认值 */
  default_value?: unknown;
}

/** 算子输出端口 */
export interface OperatorOutput {
  /** 端口名称 */
  name: string;
  /** 数据类型（后端可能返回 data_type 或 type） */
  data_type?: DataType;
  type?: DataType;
  /** 端口描述 */
  description?: string;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
}

/** 算子类型 */
export type OperatorType = 'operator' | 'formula' | 'equation_network';

/** 算子定义 */
export interface Operator {
  /** 算子 ID（如 examples.add） */
  id: string;
  /** 算子名称 */
  name: string;
  /** 算子分类 */
  category: string;
  /** 算子描述 */
  description?: string;
  /** 版本号 */
  version?: string;
  /** 输入端口列表 */
  inputs: OperatorInput[];
  /** 输出端口列表 */
  outputs: OperatorOutput[];
  /** 算子类型：operator=运算符, formula=公式, equation_network=方程网络 */
  operator_type?: OperatorType;
  /** LaTeX 公式 */
  latex_formula?: string;
}

// ============================================================================
// 流程相关类型
// ============================================================================

/** 节点位置 */
export interface Position {
  x: number;
  y: number;
}

/** 端口引用 */
export interface PortReference {
  /** 节点 ID */
  node: string;
  /** 端口名称 */
  port: string;
}

/** 累加器引用（用于迭代模式输出） */
export interface AccumulatorReference {
  /** 累加器名称 */
  accumulator: string;
}

/** 输出来源类型 */
export type OutputSourceType = 'node' | 'accumulator';

/** 输出绑定来源（支持节点端口或累加器） */
export type OutputBindFrom = PortReference | AccumulatorReference;

/** 节点输入参数（用于模板定义） */
export interface NodeInputParam {
  /** 参数名称 */
  name: string;
  /** 数据类型 */
  type: string;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
  /** 论文引用说明 */
  paper_ref?: string;
  /** 是否必填 */
  required?: boolean;
}

/** 节点输出参数（用于模板定义） */
export interface NodeOutputParam {
  /** 参数名称 */
  name: string;
  /** 数据类型 */
  type: string;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
}

/** 流程节点定义 */
export interface WorkflowNode {
  /** 节点唯一标识 */
  id: string;
  /** 算子 ID */
  operator_id: string;
  /** 节点位置 */
  position?: Position;
  /** 节点配置 */
  config?: Record<string, unknown>;
  /** 节点显示名称 */
  name?: string;
  /** 节点类型（operator/formula/equation_network） */
  type?: OperatorType;
  /** LaTeX 公式 */
  latex_formula?: string;
  /** 输入参数列表（模板定义时使用） */
  input_params?: NodeInputParam[];
  /** 输出参数列表（模板定义时使用） */
  output_params?: NodeOutputParam[];
}

/** 边类型：data=即时数据流, state=时间滞后, accumulator_read=累加器读取, broadcast=广播 */
export type EdgeType = 'data' | 'state' | 'accumulator_read' | 'broadcast';

/** 流程连接定义 */
export interface WorkflowEdge {
  /** 连接唯一标识 */
  id: string;
  /** 源端口 */
  source: PortReference;
  /** 目标端口 */
  target: PortReference;
  /** 边类型，默认 data */
  edge_type?: EdgeType;
  /** 滞后步数（仅 state 类型有效），默认 0 */
  lag?: number;
}

/** 流程输入映射 */
export interface WorkflowInput {
  /** 输入参数名称 */
  name: string;
  /** 绑定到的节点端口 */
  bind_to: PortReference;
  /** 数据类型（如 Number, String, Array<Number>） */
  type?: string;
  /** 是否必填 */
  required?: boolean;
  /** 参数描述 */
  description?: string;
  /** 默认值 */
  default?: string;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
  /** 论文引用说明 */
  paper_ref?: string;
}

/** 流程输出映射 */
export interface WorkflowOutput {
  /** 输出参数名称 */
  name: string;
  /** 来源（节点端口或累加器） */
  bind_from: OutputBindFrom;
  /** 数据类型 */
  type?: string;
  /** 参数描述 */
  description?: string;
  /** 来源类型：node=节点端口, accumulator=累加器 */
  source_type?: OutputSourceType;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
}

/** 流程定义 */
export interface WorkflowDefinition {
  /** 节点列表 */
  nodes: WorkflowNode[];
  /** 连接列表 */
  edges: WorkflowEdge[];
  /** 输入映射 */
  inputs: WorkflowInput[];
  /** 输出映射 */
  outputs: WorkflowOutput[];
  /** 默认输入参数值 */
  default_inputs?: Record<string, unknown>;
  /** 控制流配置 */
  control_flow?: ControlFlowConfig;
  /** 可视化配置 */
  visualization?: VisualizationConfig;
  /** 耦合接口定义（Connector，用于模块间数据交换） */
  connectors?: ConnectorDefinition[];
  /** Forrester 变量分类映射（键为分类名，值为该分类下的变量名数组） */
  var_classes?: Record<string, string[]>;
  /** Forrester 系统边界定义 */
  boundaries?: ForresterBoundary[];
}

/** 完整流程数据 */
export interface Workflow {
  /** 流程 ID */
  id: string;
  /** 流程名称 */
  name: string;
  /** 流程描述 */
  description?: string;
  /** 流程定义 */
  definition: WorkflowDefinition;
  /** 是否激活 */
  is_active?: boolean;
  /** 创建时间 */
  created_at?: string;
  /** 更新时间 */
  updated_at?: string;
}

// ============================================================================
// 执行相关类型
// ============================================================================

/** 执行状态 */
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'timeout';

/** 节点执行追踪 */
export interface NodeTrace {
  /** 节点 ID */
  node_id: string;
  /** 算子 ID */
  operator_id: string;
  /** 输入数据 */
  input: Record<string, unknown>;
  /** 输出数据 */
  output: Record<string, unknown>;
  /** 执行耗时（毫秒） */
  duration_ms: number;
  /** 执行状态 */
  status: 'success' | 'error';
  /** 错误信息 */
  error: string | null;
}

/** 执行结果 */
export interface ExecutionResult {
  /** 执行 ID */
  execution_id: string;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 输出数据（MC 模式下为 MonteCarloOutputStats 对象） */
  outputs: Record<string, unknown>;
  /** 执行追踪 */
  trace?: NodeTrace[];
  /** 错误信息 */
  error: string | null;
  /** 总耗时（毫秒） */
  total_duration_ms: number;
  /** 迭代执行信息（迭代模式时有值） */
  iteration_info?: IterationInfo;
  /** Monte Carlo 信息（monte_carlo 模式时有值） */
  monte_carlo_info?: MonteCarloInfo;
}

// ============================================================================
// 窗口数据传递类型
// ============================================================================

/** 存储在 localStorage 中的窗口数据 */
export interface LowcodeWindowData {
  /** 用户 ID */
  userId: string;
  /** 服务器地址 */
  serverUrl: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌（用于自动刷新过期的访问令牌） */
  refreshToken: string;
}

// ============================================================================
// 分类配置相关类型
// ============================================================================

/** 分类节点（支持嵌套） */
export interface CategoryNode {
  /** 分类唯一标识（如 math.basic） */
  id: string;
  /** 分类显示名称 */
  name: string;
  /** 分类描述 */
  description?: string;
  /** 子分类列表（与 operators 互斥） */
  children?: CategoryNode[];
  /** 算子 ID 列表（与 children 互斥） */
  operators?: string[];
}

/** 分类配置 */
export interface CategoryConfig {
  /** 配置版本 */
  version: string;
  /** 用户 ID */
  user_id?: string;
  /** 创建时间 */
  created_at?: string;
  /** 更新时间 */
  updated_at?: string;
  /** 分类列表 */
  categories: CategoryNode[];
  /** 未分类的算子 ID 列表 */
  uncategorized: string[];
}

/** 分类配置验证结果 */
export interface CategoryValidationResult {
  /** 是否有效 */
  is_valid: boolean;
  /** 错误列表 */
  errors: string[];
  /** 警告列表 */
  warnings: string[];
  /** 缺失的算子 ID 列表 */
  missing_operators: string[];
  /** 重复的算子 ID 列表 */
  duplicate_operators: string[];
}

/** 导出的分类配置 */
export interface ExportedCategoryConfig {
  /** 配置内容 */
  config: {
    version: string;
    categories: CategoryNode[];
    uncategorized: string[];
  };
  /** 导出时间 */
  exported_at: string;
}

// ============================================================================
// 流程模板相关类型
// ============================================================================

/** 流程模板 */
export interface WorkflowTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /** 模板分类 */
  category: string;
  /** 是否激活 */
  is_active: boolean;
  /** 流程定义（详情接口返回） */
  definition?: WorkflowDefinition;
  /** 创建时间 */
  created_at: string;
}

/** 创建模板参数 */
export interface CreateTemplateParams {
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /** 模板分类 */
  category: string;
  /** 流程定义 */
  definition: WorkflowDefinition;
}

/** 更新模板参数 */
export interface UpdateTemplateParams {
  /** 模板名称 */
  name?: string;
  /** 模板描述 */
  description?: string;
  /** 模板分类 */
  category?: string;
  /** 是否激活 */
  is_active?: boolean;
  /** 流程定义 */
  definition?: WorkflowDefinition;
}

// ============================================================================
// 版本管理相关类型
// ============================================================================

/** 流程版本 */
export interface WorkflowVersion {
  /** 版本记录 ID */
  id: string;
  /** 所属流程 ID */
  workflow_id?: string;
  /** 版本号 */
  version: number;
  /** 版本名称 */
  name: string;
  /** 版本描述 */
  description?: string;
  /** 流程定义（详情接口返回） */
  definition?: WorkflowDefinition;
  /** 创建者 ID */
  created_by: string;
  /** 创建时间 */
  created_at: string;
}

// ============================================================================
// 参数历史相关类型
// ============================================================================

/** 输入参数历史记录 */
export interface InputHistoryEntry {
  /** 输入参数 */
  inputs: Record<string, unknown>;
  /** 执行时间 */
  executed_at: string;
  /** 执行状态 */
  status: ExecutionStatus;
}

/** 参数历史响应 */
export interface InputHistoryResponse {
  /** 流程 ID */
  workflow_id: string;
  /** 历史记录列表 */
  history: InputHistoryEntry[];
  /** 总记录数 */
  total: number;
}

// ============================================================================
// 批量执行相关类型
// ============================================================================

/** 批量执行参数 */
export interface BatchExecuteParams {
  /** 流程 ID */
  workflow_id: string;
  /** 批量输入参数列表 */
  batch_inputs: Record<string, unknown>[];
  /** 执行选项 */
  options?: {
    /** 是否记录执行追踪 */
    trace?: boolean;
  };
  /** 是否并行执行（暂时只支持顺序） */
  parallel?: boolean;
}

/** 批量执行单项结果 */
export interface BatchExecutionItem {
  /** 索引 */
  index: number;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 输出数据 */
  outputs: Record<string, unknown>;
  /** 错误信息 */
  error: string | null;
  /** 执行耗时（毫秒） */
  duration_ms: number;
}

/** 批量执行结果 */
export interface BatchExecutionResult {
  /** 批次 ID */
  batch_id: string;
  /** 各项执行结果 */
  results: BatchExecutionItem[];
  /** 汇总信息 */
  summary: {
    /** 总数 */
    total: number;
    /** 成功数 */
    succeeded: number;
    /** 失败数 */
    failed: number;
    /** 总耗时（毫秒） */
    total_duration_ms: number;
  };
}

// ============================================================================
// 流程配置文件相关类型
// ============================================================================

/** 流程配置文件 */
export interface WorkflowConfig {
  /** 流程名称 */
  name: string;
  /** 流程描述 */
  description?: string;
  /** 流程定义 */
  definition: WorkflowDefinition;
}

/** 配置文件验证结果 */
export interface ConfigValidationResult {
  /** 是否有效 */
  is_valid: boolean;
  /** 错误列表 */
  errors: string[];
  /** 警告列表 */
  warnings: string[];
  /** 缺失的算子 ID 列表 */
  missing_operators: string[];
}

// ============================================================================
// 控制流配置相关类型
// ============================================================================

/** 执行模式 */
export type ExecutionMode = 'single' | 'iterative' | 'monte_carlo';

/** 累积操作类型 */
export type AccumulatorOperation = 'sum' | 'max' | 'min' | 'count' | 'last' | 'average';

/** 累加器配置 */
export interface AccumulatorConfig {
  /** 累加器名称 */
  name: string;
  /** 数据来源节点 */
  source_node: string;
  /** 数据来源端口 */
  source_port: string;
  /** 累积操作类型 */
  operation: AccumulatorOperation;
  /** 初始值 */
  initial_value: number;
}

/** 动态初始化配置（首次迭代时从指定节点获取初始值） */
export interface DynamicInitConfig {
  /** 来源节点 ID */
  source_node: string;
  /** 来源端口名称 */
  source_port: string;
}

/** 状态变量配置 */
export interface StateVarConfig {
  /** 变量名称 */
  name: string;
  /** 数据来源节点 */
  source_node: string;
  /** 数据来源端口 */
  source_port: string;
  /** 初始值 */
  initial_value: number;
  /** 滞后步数（1 = 上一步） */
  lag?: number;
  /** 动态初始化（可选）：首次迭代时从指定节点获取初始值 */
  dynamic_init?: DynamicInitConfig;
}

/** 终止条件类型 */
export type TerminationConditionType = 'fixed_iterations' | 'accumulator_threshold' | 'exhaust_input' | 'custom';

/** 比较操作符 */
export type CompareOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gte' | 'gt';

/** 终止条件表达式 */
export interface TerminationConditionExpr {
  /** 条件类型 */
  type: TerminationConditionType;
  /** 固定迭代次数（fixed_iterations 时使用） */
  iterations?: number;
  /** 累加器名称（accumulator_threshold 时使用） */
  name?: string;
  /** 阈值（accumulator_threshold 时使用） */
  threshold?: number;
  /** 比较操作符（accumulator_threshold 时使用） */
  op?: CompareOp;
  /** 自定义表达式（custom 时使用） */
  expression?: string;
}

/** 终止条件配置（包装条件表达式） */
export interface TerminationCondition {
  /** 条件表达式 */
  condition: TerminationConditionExpr;
}

/** 迭代配置 */
export interface IterationConfig {
  /** 时间序列输入（每次迭代取一个元素） */
  time_series_inputs: string[];
  /** 累加器配置列表 */
  accumulators: AccumulatorConfig[];
  /** 状态变量配置列表 */
  state_vars: StateVarConfig[];
  /** 终止条件 */
  termination: TerminationCondition;
}

// ============================================================================
// 条件分支相关类型
// ============================================================================

/** 值引用类型 */
export type ValueRefType = 'literal' | 'node_output' | 'accumulator' | 'state_var' | 'iteration_index' | 'workflow_input';

/** 值引用 */
export interface ValueRef {
  /** 引用类型 */
  type: ValueRefType;
  /** 字面量值（literal 时使用） */
  value?: unknown;
  /** 节点 ID（node_output 时使用） */
  node?: string;
  /** 端口名称（node_output 时使用） */
  port?: string;
  /** 名称（accumulator/state_var/workflow_input 时使用） */
  name?: string;
}

/** 条件表达式类型 */
export type ConditionExprType = 'compare' | 'and' | 'or' | 'not' | 'const';

/** 条件表达式 */
export interface ConditionExpr {
  /** 表达式类型 */
  type: ConditionExprType;
  /** 左操作数（compare 时使用） */
  left?: ValueRef;
  /** 比较操作符（compare 时使用） */
  op?: CompareOp;
  /** 右操作数（compare 时使用） */
  right?: ValueRef;
  /** 子条件列表（and/or 时使用） */
  conditions?: ConditionExpr[];
  /** 取反条件（not 时使用） */
  condition?: ConditionExpr;
  /** 常量值（const 时使用） */
  value?: boolean;
}

/** 条件边 */
export interface ConditionalEdge {
  /** 边 ID */
  edge_id: string;
  /** 条件表达式 */
  condition: ConditionExpr;
}

// ============================================================================
// 错误处理相关类型
// ============================================================================

/** 重试策略配置 */
export interface RetryConfig {
  /** 最大重试次数 */
  max_attempts: number;
  /** 初始重试间隔（毫秒） */
  delay_ms: number;
  /** 退避乘数 */
  backoff_multiplier?: number;
  /** 最大延迟（毫秒） */
  max_delay_ms?: number;
}

/** 节点错误处理配置 */
export interface NodeErrorHandler {
  /** 节点 ID */
  node_id: string;
  /** 节点级重试策略（覆盖全局） */
  retry?: RetryConfig;
  /** 失败后执行的备用节点 */
  fallback_node?: string;
  /** 是否忽略错误继续执行 */
  ignore_error?: boolean;
}

/** 错误处理配置 */
export interface ErrorHandlingConfig {
  /** 全局重试策略 */
  retry?: RetryConfig;
  /** 失败时是否继续执行其他独立节点 */
  continue_on_error?: boolean;
  /** 节点级错误处理配置 */
  node_handlers?: NodeErrorHandler[];
}

// ============================================================================
// 控制流完整配置
// ============================================================================

/** 控制流配置 */
export interface ControlFlowConfig {
  /** 执行模式：single=单次执行, iterative=迭代执行, monte_carlo=蒙特卡洛模拟 */
  execution_mode: ExecutionMode;
  /** 迭代配置（iterative/monte_carlo 模式时使用） */
  iteration?: IterationConfig;
  /** Monte Carlo 配置（monte_carlo 模式时使用） */
  monte_carlo?: MonteCarloConfig;
  /** 条件边配置 */
  conditional_edges?: ConditionalEdge[];
  /** 错误处理配置 */
  error_handling?: ErrorHandlingConfig;
}

/** 可视化配置 */
export interface VisualizationConfig {
  /** Mermaid 图形定义 */
  mermaid?: string;
}

// ============================================================================
// 迭代执行结果相关类型
// ============================================================================

/** 迭代执行信息 */
export interface IterationInfo {
  /** 总迭代次数 */
  total_iterations: number;
  /** 累加器最终值 */
  accumulators: Record<string, number>;
  /** 终止原因 */
  termination_reason?: string;
  /** 终止时的迭代索引 */
  terminated_at_index?: number;
}

// ============================================================================
// Monte Carlo 相关类型
// ============================================================================

/** 分布类型 */
export type DistributionType =
  | 'normal'
  | 'log_normal'
  | 'uniform'
  | 'truncated_normal'
  | 'triangular'
  | 'beta'
  | 'gamma'
  | 'fixed';

/** 参数分布配置 */
export interface ParameterDistribution {
  /** 参数名（必须是 workflow 的某个 input 名称） */
  name: string;
  /** 分布类型 */
  distribution: DistributionType;
  /** 分布参数（键值对，如 { mean: 100, std: 10 }） */
  params: Record<string, number>;
}

/** Monte Carlo 输出格式配置 */
export interface MonteCarloOutputFormat {
  /** 输出的百分位数列表 */
  percentiles?: number[];
  /** 是否返回全部原始采样结果 */
  raw_samples?: boolean;
  /** 直方图分箱数（设置后返回直方图数据） */
  histogram_bins?: number;
}

/** Monte Carlo 配置 */
export interface MonteCarloConfig {
  /** 采样次数 */
  samples: number;
  /** 随机种子（可选，确保可复现） */
  seed?: number;
  /** 是否使用多线程并行 */
  parallel?: boolean;
  /** 输出格式配置 */
  output_format?: MonteCarloOutputFormat;
  /** 参数分布列表 */
  distributions: ParameterDistribution[];
}

/** Monte Carlo 执行信息 */
export interface MonteCarloInfo {
  /** 总采样次数 */
  total_samples: number;
  /** 使用的随机种子 */
  seed?: number;
  /** 是否并行执行 */
  parallel: boolean;
  /** 参数分布配置 */
  parameter_distributions: ParameterDistribution[];
}

/** Monte Carlo 输出变量的统计信息 */
export interface MonteCarloOutputStats {
  /** 均值 */
  mean: number;
  /** 标准差 */
  std: number;
  /** 百分位数（键为百分位，值为对应值） */
  percentiles: Record<string, number>;
  /** 直方图数据 */
  histogram?: {
    /** 分箱边界 */
    bins: number[];
    /** 各箱计数 */
    counts: number[];
  };
}

// ============================================================================
// 动态算子管理相关类型
// ============================================================================

/** 动态算子源信息 */
export interface DynamicOperatorSource {
  /** 算子 ID */
  operator_id: string;
  /** 模块 ID */
  module_id: string;
  /** 算子名称 */
  name: string;
  /** 分类 */
  category: string;
  /** 版本号 */
  version: number;
  /** 最后更新时间 */
  updated_at: string;
}

/** 上传算子响应中的单个算子摘要 */
export interface UploadedOperatorSummary {
  /** 算子 ID */
  id: string;
  /** 算子名称 */
  name: string;
  /** 分类 */
  category: string;
}

/** 上传算子响应 */
export interface UploadOperatorsResponse {
  /** 提示消息 */
  message: string;
  /** 注册成功的算子列表 */
  operators: UploadedOperatorSummary[];
  /** 注册数量 */
  count: number;
  /** 守恒律验证警告（可选） */
  conservation_warnings?: ConservationWarning[];
}

/** 更新动态算子响应 */
export interface UpdateOperatorResponse {
  /** 提示消息 */
  message: string;
  /** 更新后的版本号 */
  version: number;
}

/** 删除动态算子响应 */
export interface DeleteOperatorResponse {
  /** 提示消息 */
  message: string;
}

/** 动态算子源列表响应 */
export interface DynamicOperatorSourcesResponse {
  /** 源列表 */
  sources: DynamicOperatorSource[];
  /** 总数 */
  total: number;
}

/** 上传 S-expression 并生成工作流的响应 */
export interface UploadWorkflowResponse {
  /** 提示消息 */
  message: string;
  /** 注册成功的算子列表 */
  operators: UploadedOperatorSummary[];
  /** 注册的算子数量 */
  operator_count: number;
  /** 自动生成的工作流信息 */
  workflow: {
    /** 工作流 ID */
    id: string;
    /** 工作流名称 */
    name: string;
    /** 工作流描述 */
    description: string;
    /** 版本号 */
    version: number;
    /** 创建时间 */
    created_at: string;
  };
}

// ============================================================================
// Forrester 系统动力学相关类型
// ============================================================================

/** Forrester 系统边界定义 */
export interface ForresterBoundary {
  /** 边界名称 */
  name: string;
  /** 边界类型：source=来源, sink=汇 */
  kind: 'source' | 'sink';
  /** 边界描述 */
  description: string;
}

// ============================================================================
// Connector 耦合接口相关类型
// ============================================================================

/** 耦合接口定义（用于模块间数据交换） */
export interface ConnectorDefinition {
  /** 接口名称 */
  name: string;
  /** 数据类型（Number, Array<Number>, Boolean 等） */
  data_type: string;
  /** 接口描述 */
  description: string;
  /** 方向：in=输入, out=输出 */
  direction: 'in' | 'out';
  /** 远程来源（仅 in 方向有效，格式 module.port） */
  remote_source?: string | null;
}

/** 守恒律验证警告 */
export interface ConservationWarning {
  /** 警告级别 */
  level: 'warning' | 'error';
  /** 触发警告的节点名称 */
  node: string;
  /** 警告描述 */
  message: string;
}

// ============================================================================
// 执行选项增强
// ============================================================================

/** 执行选项 */
export interface ExecuteOptions {
  /** 是否记录执行追踪 */
  trace?: boolean;
  /** 超时时间（毫秒） */
  timeout_ms?: number;
  /** 是否启用并行执行 */
  parallel?: boolean;
}
