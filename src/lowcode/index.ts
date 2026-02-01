/**
 * 低代码编辑器模块
 *
 * 核心功能：
 * - 可视化流程编排：拖拽算子到画布，创建节点
 * - 算子连接：通过端口连线建立数据流
 * - 属性配置：选中节点编辑属性，配置流程输入/输出
 * - 流程保存：将画布状态保存到服务器
 * - 流程加载：从服务器加载已保存的流程
 * - 流程验证：检查流程定义的有效性
 * - 流程执行：运行流程并查看结果
 * - 流程导出：导出流程配置为 JSON 文件
 *
 * 高级功能（v1.0.30+）：
 * - 分类配置：自定义算子分类结构（CategoryConfigDialog）
 * - 流程模板：从预设模板创建新流程（TemplateDialog）
 * - 版本管理：查看历史版本并回滚（VersionHistoryPanel）
 * - 批量执行：一次执行多组输入参数（BatchExecuteDialog）
 * - 参数历史：执行时可选择历史参数（ExecuteDialog 扩展）
 * - 自定义输入名称：为流程输入定义唯一名称
 *
 * 模块结构：
 * - components/: UI 组件
 *   - FlowCanvas, OperatorPanel, PropertyPanel, Toolbar
 *   - ExecuteDialog, WorkflowListDialog
 *   - CategoryConfigDialog, TemplateDialog, VersionHistoryPanel, BatchExecuteDialog
 * - services/: API 服务
 *   - apiClient: 带自动 Token 刷新的 API 客户端
 *   - operatorService: 算子相关 API
 *   - workflowService: 流程 CRUD、执行、历史等
 *   - categoryService: 分类配置管理
 *   - templateService: 流程模板管理
 *   - versionService: 版本历史管理
 * - stores/: 状态管理（flowStore）
 * - utils/: 工具函数（workflowSerializer）
 * - types/: 类型定义（lowcode.ts）
 *
 * 使用：
 * - 通过侧边栏按钮打开独立窗口
 * - 仅支持桌面端（移动端已隔离）
 * - 窗口数据通过 URL 查询参数传递
 *
 * @module lowcode
 */

// ============================================================================
// 页面组件
// ============================================================================

export { default as LowcodePage } from './LowcodePage';

// ============================================================================
// 子组件
// ============================================================================

export { FlowCanvas } from './components/FlowCanvas';
export { OperatorPanel } from './components/OperatorPanel';
export { PropertyPanel } from './components/PropertyPanel';
export { Toolbar } from './components/Toolbar';
export { ExecuteDialog } from './components/ExecuteDialog';
export { WorkflowListDialog } from './components/WorkflowListDialog';
export { CategoryConfigDialog } from './components/CategoryConfigDialog';
export { TemplateDialog } from './components/TemplateDialog';
export { VersionHistoryPanel } from './components/VersionHistoryPanel';
export { BatchExecuteDialog } from './components/BatchExecuteDialog';

// ============================================================================
// API 和工具函数
// ============================================================================

export {
  openLowcodeWindow,
  loadLowcodeData,
  clearLowcodeData,
  saveLowcodeData,
} from './api';

// 算子服务
export { fetchOperators, fetchOperatorDetail } from './services/operatorService';

// API 客户端（带自动 Token 刷新）
export { createLowcodeApiClient } from './services/apiClient';

// 流程服务（推荐使用 createWorkflowService 工厂函数）
export {
  createWorkflowService,
  // 兼容旧 API（不推荐使用）
  createWorkflow,
  getWorkflows,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  validateWorkflow,
  validateDefinition,
  exportWorkflow,
  executeWorkflow,
  executeConfig,
  getExecution,
} from './services/workflowService';

// 分类配置服务
export { createCategoryService } from './services/categoryService';

// 模板服务
export { createTemplateService } from './services/templateService';

// 版本服务
export { createVersionService } from './services/versionService';

// 序列化工具
export {
  serializeToWorkflow,
  deserializeFromWorkflow,
  validateDefinition as validateWorkflowDefinition,
  getExecutionOrder,
} from './utils/workflowSerializer';

// Store
export { useFlowStore } from './stores/flowStore';

// ============================================================================
// 类型导出
// ============================================================================

export type {
  LowcodeWindowData,
  Operator,
  OperatorInput,
  OperatorOutput,
  Workflow,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInput,
  WorkflowOutput,
  ExecutionResult,
  ExecutionStatus,
  NodeTrace,
  PortReference,
  Position,
  DataType,
  // 新增类型
  CategoryNode,
  CategoryConfig,
  CategoryValidationResult,
  ExportedCategoryConfig,
  WorkflowTemplate,
  CreateTemplateParams,
  UpdateTemplateParams,
  WorkflowVersion,
  InputHistoryEntry,
  InputHistoryResponse,
  BatchExecuteParams,
  BatchExecutionItem,
  BatchExecutionResult,
  WorkflowConfig,
  ConfigValidationResult,
} from './types/lowcode';

export type {
  ValidationResult,
  CreateWorkflowParams,
  UpdateWorkflowParams,
  ExecuteWorkflowParams,
  ExecuteConfigParams,
  ExportedWorkflow,
  WorkflowService,
} from './services/workflowService';

export type {
  LowcodeApiClientConfig,
  LowcodeApiClient,
} from './services/apiClient';

export type {
  SaveCategoryConfigParams,
  ImportCategoryConfigParams,
  ImportCategoryConfigResponse,
  CategoryService,
} from './services/categoryService';

export type {
  TemplateListResponse,
  CreateFromTemplateParams,
  TemplateService,
} from './services/templateService';

export type {
  VersionListResponse,
  RollbackResponse,
  VersionService,
} from './services/versionService';

export type {
  InputBinding,
  OutputBinding,
  DeserializeResult,
} from './utils/workflowSerializer';
