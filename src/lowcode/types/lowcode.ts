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
}

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
}

/** 流程连接定义 */
export interface WorkflowEdge {
  /** 连接唯一标识 */
  id: string;
  /** 源端口 */
  source: PortReference;
  /** 目标端口 */
  target: PortReference;
}

/** 流程输入映射 */
export interface WorkflowInput {
  /** 输入参数名称 */
  name: string;
  /** 绑定到的节点端口 */
  bind_to: PortReference;
}

/** 流程输出映射 */
export interface WorkflowOutput {
  /** 输出参数名称 */
  name: string;
  /** 来源节点端口 */
  bind_from: PortReference;
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
  /** 输出数据 */
  outputs: Record<string, unknown>;
  /** 执行追踪 */
  trace?: NodeTrace[];
  /** 错误信息 */
  error: string | null;
  /** 总耗时（毫秒） */
  total_duration_ms: number;
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
