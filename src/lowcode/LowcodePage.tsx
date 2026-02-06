/**
 * 低代码编辑器页面
 *
 * 独立窗口页面，提供可视化流程编排功能。作为 Tauri WebviewWindow 运行，
 * 通过 URL 查询参数接收主窗口传递的用户数据（userId, serverUrl, accessToken）。
 *
 * 布局结构：
 * - 顶部：工具栏（Toolbar）- 流程名称、保存/验证/运行等操作按钮
 * - 左侧：算子面板（OperatorPanel）- 可拖拽的算子列表，支持分类筛选
 * - 中间：画布（FlowCanvas）- React Flow 节点编排区域
 * - 右侧：属性面板（PropertyPanel）- 节点属性编辑，流程输入/输出配置
 *
 * 功能：
 * - 新建/保存/加载流程
 * - 验证流程定义
 * - 执行流程并查看结果
 * - 导出流程配置
 *
 * 状态管理：
 * - 使用 Zustand (flowStore) 管理画布状态和流程元数据
 * - 通过 workflowSerializer 实现画布与 API 格式的双向转换
 *
 * @module lowcode/LowcodePage
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { MathJaxContext } from 'better-react-mathjax';
import { FlowCanvas } from './components/FlowCanvas';
import { OperatorPanel } from './components/OperatorPanel';
import { PropertyPanel } from './components/PropertyPanel';
import { Toolbar } from './components/Toolbar';
import { ExecuteDialog } from './components/ExecuteDialog';
import { WorkflowListDialog } from './components/WorkflowListDialog';
import { CategoryConfigDialog } from './components/CategoryConfigDialog';
import { TemplateDialog } from './components/TemplateDialog';
import { VersionHistoryPanel } from './components/VersionHistoryPanel';
import { BatchExecuteDialog } from './components/BatchExecuteDialog';
import { ImportConfigDialog } from './components/ImportConfigDialog';
import { ControlFlowDialog } from './components/ControlFlowDialog';
import { MermaidPreview } from './components/MermaidPreview';
import { useFlowStore } from './stores/flowStore';
import { createLowcodeApiClient } from './services/apiClient';
import { createWorkflowService } from './services/workflowService';
import { createCategoryService } from './services/categoryService';
import { createTemplateService } from './services/templateService';
import { createVersionService } from './services/versionService';
import { fetchOperators } from './services/operatorService';
import {
  serializeToWorkflow,
  deserializeFromWorkflow,
} from './utils/workflowSerializer';
import type {
  LowcodeWindowData,
  Workflow,
  ExecutionResult,
  Operator,
  InputHistoryEntry,
  BatchExecutionResult,
  WorkflowConfig,
  ConfigValidationResult,
  ControlFlowConfig,
  WorkflowNode,
  DataType,
} from './types/lowcode';
import './LowcodePage.css';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从 URL 查询参数解析窗口数据
 */
function parseWindowDataFromUrl(): LowcodeWindowData | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const serverUrlEncoded = params.get('serverUrl');
    const accessTokenEncoded = params.get('accessToken');
    const refreshTokenEncoded = params.get('refreshToken');

    if (!userId || !serverUrlEncoded || !accessTokenEncoded || !refreshTokenEncoded) {
      return null;
    }

    return {
      userId,
      serverUrl: atob(serverUrlEncoded),
      accessToken: atob(accessTokenEncoded),
      refreshToken: atob(refreshTokenEncoded),
    };
  } catch (e) {
    console.error('[Lowcode] 解析 URL 参数失败:', e);
    return null;
  }
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 低代码编辑器页面组件
 *
 * 作为独立窗口运行，通过 URL 查询参数接收主窗口传递的数据
 */
function LowcodePage() {
  // ---- 基础状态 ----
  const [error, setError] = useState<string | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);

  // ---- 操作状态 ----
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // ---- 对话框状态 ----
  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [showWorkflowListDialog, setShowWorkflowListDialog] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showRunConfigDialog, setShowRunConfigDialog] = useState(false);
  const [showControlFlowDialog, setShowControlFlowDialog] = useState(false);
  const [showMermaidPreview, setShowMermaidPreview] = useState(false);

  // ---- 历史记录状态 ----
  const [inputHistory, setInputHistory] = useState<InputHistoryEntry[]>([]);

  // ---- 布局状态 ----
  const [layoutTrigger, setLayoutTrigger] = useState(0);

  // ---- Store 状态 ----
  const {
    nodes,
    edges,
    workflowId,
    workflowName,
    workflowDescription,
    workflowInputs,
    workflowOutputs,
    controlFlowConfig,
    isDirty,
    setWorkflowName,
    addWorkflowInput,
    removeWorkflowInput,
    renameWorkflowInput,
    addWorkflowOutput,
    removeWorkflowOutput,
    renameWorkflowOutput,
    setControlFlowConfig,
    markSaved,
    resetWorkflow,
    loadWorkflow,
    clearCanvas,
  } = useFlowStore();

  // 从 URL 解析数据（只执行一次）
  const windowData = useMemo(() => parseWindowDataFromUrl(), []);

  // 创建 API 客户端（带自动 Token 刷新）
  const apiClient = useMemo(() => {
    if (!windowData) {
      return null;
    }

    return createLowcodeApiClient({
      serverUrl: windowData.serverUrl,
      accessToken: windowData.accessToken,
      refreshToken: windowData.refreshToken,
      onSessionExpired: () => {
        setError('会话已过期，请关闭窗口并重新打开');
      },
    });
  }, [windowData]);

  // 创建流程服务
  const workflowService = useMemo(() => {
    if (!apiClient) {
      return null;
    }
    return createWorkflowService(apiClient);
  }, [apiClient]);

  // 创建分类服务
  const categoryService = useMemo(() => {
    if (!apiClient) {
      return null;
    }
    return createCategoryService(apiClient);
  }, [apiClient]);

  // 创建模板服务
  const templateService = useMemo(() => {
    if (!apiClient) {
      return null;
    }
    return createTemplateService(apiClient);
  }, [apiClient]);

  // 创建版本服务
  const versionService = useMemo(() => {
    if (!apiClient) {
      return null;
    }
    return createVersionService(apiClient);
  }, [apiClient]);

  // ---- 初始化 ----
  useEffect(() => {
    if (!windowData) {
      setError('无法加载编辑器数据，请从主窗口重新打开');
      return;
    }

    // 加载算子列表
    fetchOperators(windowData.serverUrl)
      .then(({ operators: ops }) => {
        setOperators(ops);
      })
      .catch((err) => {
        console.error('[Lowcode] 加载算子列表失败:', err);
      });
  }, [windowData]);

  // ---- 工具栏操作 ----

  /** 新建流程 */
  const handleNew = useCallback(() => {
    resetWorkflow();
  }, [resetWorkflow]);

  /** 保存流程 */
  const handleSave = useCallback(async () => {
    if (!workflowService || !workflowName.trim()) { return; }

    setIsSaving(true);
    try {
      // 包含控制流配置的完整定义
      const definition = serializeToWorkflow(
        nodes,
        edges,
        workflowInputs,
        workflowOutputs,
        {
          controlFlow: controlFlowConfig,
        },
      );

      if (workflowId) {
        // 更新现有流程
        await workflowService.updateWorkflow(workflowId, {
          name: workflowName,
          definition,
        });
      } else {
        // 创建新流程
        const newWorkflow = await workflowService.createWorkflow({
          name: workflowName,
          definition,
        });
        useFlowStore.getState().setWorkflowId(newWorkflow.id);
      }

      markSaved();
      // eslint-disable-next-line no-alert
      alert('保存成功');
    } catch (err) {
      console.error('[Lowcode] 保存失败:', err);
      // eslint-disable-next-line no-alert
      alert(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  }, [
    workflowService,
    workflowId,
    workflowName,
    nodes,
    edges,
    workflowInputs,
    workflowOutputs,
    markSaved,
    controlFlowConfig,
  ]);

  /** 验证流程 */
  const handleValidate = useCallback(async () => {
    if (!workflowService) { return; }

    try {
      let result;
      if (workflowId) {
        result = await workflowService.validateWorkflow(workflowId);
      } else {
        const definition = serializeToWorkflow(
          nodes,
          edges,
          workflowInputs,
          workflowOutputs,
          { controlFlow: controlFlowConfig },
        );
        result = await workflowService.validateDefinition(definition);
      }

      if (result.is_valid) {
        // eslint-disable-next-line no-alert
        alert('验证通过！流程定义有效。');
      } else {
        const errors = result.errors.join('\n');
        const warnings = result.warnings.join('\n');
        // eslint-disable-next-line no-alert
        alert(
          `验证结果:\n\n错误:\n${errors || '无'}\n\n警告:\n${warnings || '无'}`,
        );
      }
    } catch (err) {
      console.error('[Lowcode] 验证失败:', err);
      // eslint-disable-next-line no-alert
      alert(`验证失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, [workflowService, workflowId, nodes, edges, workflowInputs, workflowOutputs, controlFlowConfig]);

  /** 运行流程 */
  const handleRun = useCallback(() => {
    if (nodes.length === 0) {
      // eslint-disable-next-line no-alert
      alert('请先添加节点');
      return;
    }
    setShowExecuteDialog(true);
  }, [nodes.length]);

  /** 执行流程 */
  const handleExecute = useCallback(
    async (inputs: Record<string, unknown>): Promise<ExecutionResult> => {
      if (!workflowService || !workflowId) {
        throw new Error('请先保存流程');
      }

      setIsExecuting(true);
      try {
        const result = await workflowService.executeWorkflow({
          workflow_id: workflowId,
          inputs,
          options: { trace: true },
        });
        return result;
      } finally {
        setIsExecuting(false);
      }
    },
    [workflowService, workflowId],
  );

  /** 导出流程 */
  const handleExport = useCallback(async () => {
    if (!workflowService || !workflowId) {
      // eslint-disable-next-line no-alert
      alert('请先保存流程');
      return;
    }

    try {
      const exported = await workflowService.exportWorkflow(workflowId);

      // 下载 JSON 文件
      const blob = new Blob([JSON.stringify(exported.config, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workflowName || 'workflow'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Lowcode] 导出失败:', err);
      // eslint-disable-next-line no-alert
      alert(`导出失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, [workflowService, workflowId, workflowName]);

  /** 打开流程列表 */
  const handleOpenList = useCallback(() => {
    setShowWorkflowListDialog(true);
  }, []);

  /** 加载流程列表 */
  const handleLoadList = useCallback(async (): Promise<Workflow[]> => {
    if (!workflowService) { return []; }

    const response = await workflowService.getWorkflows();
    return response.workflows;
  }, [workflowService]);

  /** 加载流程（通过 ID 获取完整数据） */
  const handleLoadWorkflow = useCallback(
    async (targetWorkflowId: string): Promise<void> => {
      if (!workflowService) {
        throw new Error('服务未初始化');
      }

      if (isDirty) {
        // eslint-disable-next-line no-alert
        if (!confirm('当前有未保存的更改，确定要加载其他流程吗？')) {
          return;
        }
      }

      // 获取完整的流程数据（包含 definition）
      const workflow = await workflowService.getWorkflow(targetWorkflowId);

      // 检查流程定义是否存在
      if (!workflow.definition) {
        throw new Error('流程定义为空，无法加载');
      }

      const { result, inputBindings, outputBindings, missingOperators } =
        deserializeFromWorkflow(workflow.definition, operators);

      if (missingOperators.length > 0) {
        // eslint-disable-next-line no-alert
        alert(`警告: 以下算子未找到:\n${missingOperators.join('\n')}`);
      }

      loadWorkflow(
        workflow.id,
        workflow.name,
        workflow.description || '',
        result.nodes,
        result.edges,
        inputBindings,
        outputBindings,
        workflow.definition.control_flow,
      );

      // 延迟触发自动布局，等待节点渲染完成
      setTimeout(() => {
        setLayoutTrigger((prev) => prev + 1);
      }, 100);
    },
    [workflowService, isDirty, operators, loadWorkflow],
  );

  /** 删除流程 */
  const handleDeleteWorkflow = useCallback(
    async (id: string) => {
      if (!workflowService) { return; }

      await workflowService.deleteWorkflow(id);

      // 如果删除的是当前流程，重置状态
      if (id === workflowId) {
        resetWorkflow();
      }
    },
    [workflowService, workflowId, resetWorkflow],
  );

  /** 清空画布 */
  const handleClear = useCallback(() => {
    clearCanvas();
  }, [clearCanvas]);

  /** 自动布局 - 通过增加 trigger 触发 FlowCanvas 中的布局逻辑 */
  const handleAutoLayout = useCallback(() => {
    setLayoutTrigger((prev) => prev + 1);
  }, []);

  // ---- 新增功能处理器 ----

  /** 打开模板对话框 */
  const handleOpenTemplates = useCallback(() => {
    setShowTemplateDialog(true);
  }, []);

  /** 从模板创建流程 */
  const handleCreateFromTemplate = useCallback(
    async (templateId: string, name: string, description?: string) => {
      if (!templateService) { return; }

      const workflow = await templateService.createFromTemplate(templateId, {
        name,
        description,
      });

      // 加载创建的流程
      if (workflow.definition) {
        const { result, inputBindings, outputBindings } = deserializeFromWorkflow(
          workflow.definition,
          operators,
        );
        loadWorkflow(
          workflow.id,
          workflow.name,
          workflow.description || '',
          result.nodes,
          result.edges,
          inputBindings,
          outputBindings,
          workflow.definition.control_flow,
        );

        // 延迟触发自动布局，等待节点渲染完成
        setTimeout(() => {
          setLayoutTrigger((prev) => prev + 1);
        }, 100);
      }
    },
    [templateService, operators, loadWorkflow],
  );

  /** 打开版本历史 */
  const handleOpenVersions = useCallback(() => {
    setShowVersionPanel(true);
  }, []);

  /** 回滚到指定版本 */
  const handleRollback = useCallback(
    async (version: number) => {
      if (!versionService || !workflowId || !workflowService) { return; }

      await versionService.rollback(workflowId, version);

      // 重新加载当前流程
      const workflow = await workflowService.getWorkflow(workflowId);
      if (workflow.definition) {
        const { result, inputBindings, outputBindings } = deserializeFromWorkflow(
          workflow.definition,
          operators,
        );
        loadWorkflow(
          workflow.id,
          workflow.name,
          workflow.description || '',
          result.nodes,
          result.edges,
          inputBindings,
          outputBindings,
          workflow.definition.control_flow,
        );

        // 延迟触发自动布局
        setTimeout(() => {
          setLayoutTrigger((prev) => prev + 1);
        }, 100);
      }
    },
    [versionService, workflowId, workflowService, operators, loadWorkflow],
  );

  /** 打开分类配置 */
  const handleOpenCategories = useCallback(() => {
    setShowCategoryDialog(true);
  }, []);

  /** 打开批量执行 */
  const handleBatchRun = useCallback(() => {
    setShowBatchDialog(true);
  }, []);

  /** 打开导入对话框 */
  const handleOpenImport = useCallback(() => {
    setShowImportDialog(true);
  }, []);

  /** 打开临时执行对话框 */
  const handleOpenRunConfig = useCallback(() => {
    setShowRunConfigDialog(true);
  }, []);

  /** 打开控制流配置对话框 */
  const handleOpenControlFlow = useCallback(() => {
    setShowControlFlowDialog(true);
  }, []);

  /** 打开 Mermaid 预览 */
  const handleOpenMermaidPreview = useCallback(() => {
    setShowMermaidPreview(true);
  }, []);

  /** 获取当前流程的节点列表 */
  const getWorkflowNodes = useCallback((): WorkflowNode[] => {
    const { nodes } = useFlowStore.getState();
    return nodes.map((n) => ({
      id: n.id,
      operator_id: String(n.data?.operatorId || ''),
      name: String(n.data?.label || ''),
      position: n.position,
    }));
  }, []);

  /** 保存控制流配置 */
  const handleSaveControlFlow = useCallback((config: ControlFlowConfig) => {
    setControlFlowConfig(config);
    // isDirty 已在 store 的 setControlFlowConfig 中自动设置
  }, [setControlFlowConfig]);

  /** 临时执行流程（不保存到数据库） */
  const handleExecuteConfig = useCallback(
    async (inputs: Record<string, unknown>): Promise<ExecutionResult> => {
      if (!workflowService) {
        throw new Error('服务未初始化');
      }

      const { nodes, edges } = useFlowStore.getState();
      const definition = serializeToWorkflow(
        nodes,
        edges,
        workflowInputs.map((i) => ({
          nodeId: i.nodeId,
          port: i.port,
          name: i.name,
        })),
        workflowOutputs.map((o) => ({
          nodeId: o.nodeId,
          port: o.port,
          name: o.name,
        })),
        { controlFlow: controlFlowConfig },
      );

      setIsExecuting(true);
      try {
        const result = await workflowService.executeConfig({
          config: {
            name: workflowName || '临时流程',
            description: workflowDescription,
            definition,
          },
          inputs,
          options: { trace: true },
        });
        return result;
      } finally {
        setIsExecuting(false);
      }
    },
    [workflowService, workflowInputs, workflowOutputs, workflowName, workflowDescription, controlFlowConfig],
  );

  /** 验证配置文件 */
  const handleValidateConfig = useCallback(
    // eslint-disable-next-line require-await
    async (config: WorkflowConfig): Promise<ConfigValidationResult> => {
      if (!workflowService) {
        throw new Error('服务未初始化');
      }
      return workflowService.validateConfig(config);
    },
    [workflowService],
  );

  /** 导入配置文件 */
  const handleImportConfig = useCallback(
    async (config: WorkflowConfig, overwrite: boolean) => {
      if (!workflowService) {
        throw new Error('服务未初始化');
      }

      const imported = await workflowService.importConfig(config, overwrite);

      // 加载导入的流程
      if (imported.workflow.definition) {
        const { result, inputBindings, outputBindings } = deserializeFromWorkflow(
          imported.workflow.definition,
          operators,
        );
        loadWorkflow(
          imported.workflow.id,
          imported.workflow.name,
          imported.workflow.description || '',
          result.nodes,
          result.edges,
          inputBindings,
          outputBindings,
          imported.workflow.definition.control_flow,
        );

        // 延迟触发自动布局
        setTimeout(() => {
          setLayoutTrigger((prev) => prev + 1);
        }, 100);
      }

      // eslint-disable-next-line no-alert
      alert(`导入成功！${imported.created ? '创建了新流程' : '更新了已有流程'}`);
    },
    [workflowService, operators, loadWorkflow],
  );

  /** 批量执行流程 */
  const handleBatchExecute = useCallback(
    // eslint-disable-next-line require-await
    async (batchInputs: Record<string, unknown>[]): Promise<BatchExecutionResult> => {
      if (!workflowService || !workflowId) {
        throw new Error('请先保存流程');
      }

      return workflowService.executeBatch({
        workflow_id: workflowId,
        batch_inputs: batchInputs,
        options: { trace: false },
      });
    },
    [workflowService, workflowId],
  );

  /** 加载参数历史 */
  const handleLoadInputHistory = useCallback(async () => {
    if (!workflowService || !workflowId) { return; }

    try {
      const response = await workflowService.getInputHistory(workflowId, 10);
      setInputHistory(response.history);
    } catch (err) {
      console.error('[Lowcode] 加载参数历史失败:', err);
    }
  }, [workflowService, workflowId]);

  // ---- 构建执行对话框的输入定义 ----
  const executeInputs = useMemo(() => {
    // 基础工作流输入
    const baseInputs = workflowInputs.map((input) => {
      // 查找对应节点的算子信息
      const node = nodes.find((n) => n.id === input.nodeId);
      const nodeData = node?.data as { operator?: Operator; label?: string } | undefined;
      const operatorInput = nodeData?.operator?.inputs.find(
        (i) => i.name === input.port,
      );

      return {
        name: input.name, // 用户自定义的唯一名称
        displayName: input.name, // 直接使用用户定义的名称作为显示名称
        bind_to: { node: input.nodeId, port: input.port },
        // 优先使用模板中保存的类型，其次从算子定义获取
        data_type: (input.type as DataType) || operatorInput?.data_type || operatorInput?.type,
        // 优先使用模板中保存的描述，其次从算子定义获取
        description: input.description || operatorInput?.description,
        // 优先使用模板中保存的必填标记，其次从算子定义获取
        required: input.required ?? operatorInput?.required,
        // 新增字段：LaTeX 名称、论文引用、默认值（优先模板，其次算子）
        latex_name: input.latex_name || operatorInput?.latex_name,
        paper_ref: input.paper_ref || operatorInput?.paper_ref,
        default_value: input.default || operatorInput?.default_value,
      };
    });

    // 如果是迭代模式，添加时间序列输入
    if (controlFlowConfig?.execution_mode === 'iterative' && controlFlowConfig.iteration?.time_series_inputs) {
      const timeSeriesInputs = controlFlowConfig.iteration.time_series_inputs
        .filter((tsName) => !baseInputs.some((bi) => bi.name === tsName)) // 避免重复
        .map((tsName) => ({
          name: tsName,
          displayName: `${tsName} (时间序列)`,
          // bind_to 省略 - 时间序列输入不绑定到特定节点
          data_type: 'Array<Number>' as DataType,
          description: `时间序列输入: ${tsName}`,
          required: true as const,
        }));
      return [...baseInputs, ...timeSeriesInputs];
    }

    return baseInputs;
  }, [workflowInputs, nodes, controlFlowConfig]);

  // MathJax 配置 - 必须在条件返回之前调用
  const mathJaxConfig = useMemo(() => ({
    tex: {
      inlineMath: [['$', '$']],
      displayMath: [['$$', '$$']],
    },
  }), []);

  // ---- 错误状态 ----
  if (error || !windowData) {
    return (
      <div className="lowcode-page">
        <div className="lowcode-error">
          <div className="lowcode-empty-icon">⚠️</div>
          <div>{error || '加载失败'}</div>
        </div>
      </div>
    );
  }

  return (
    <MathJaxContext config={mathJaxConfig}>
      <div className="lowcode-page">
        {/* 顶部工具栏 */}
        <Toolbar
          workflowName={workflowName}
          onNameChange={setWorkflowName}
          isDirty={isDirty}
          isSaving={isSaving}
          isExecuting={isExecuting}
          workflowId={workflowId}
          nodeCount={nodes.length}
          onNew={handleNew}
          onSave={handleSave}
          onValidate={handleValidate}
          onRun={handleRun}
          onExport={handleExport}
          onOpenList={handleOpenList}
          onClear={handleClear}
          onOpenTemplates={handleOpenTemplates}
          onOpenVersions={handleOpenVersions}
          onOpenCategories={handleOpenCategories}
          onBatchRun={handleBatchRun}
          onAutoLayout={handleAutoLayout}
          onImport={handleOpenImport}
          onRunConfig={handleOpenRunConfig}
          onOpenControlFlow={handleOpenControlFlow}
          onOpenMermaidPreview={handleOpenMermaidPreview}
        />

        {/* 主内容区 */}
        <div className="lowcode-content">
          {/* 左侧算子面板 */}
          <OperatorPanel
            serverUrl={windowData.serverUrl}
            categoryService={categoryService}
          />

          {/* 中间画布区域 */}
          <div className="lowcode-canvas-wrapper">
            <ReactFlowProvider>
              <FlowCanvas
                layoutTrigger={layoutTrigger}
                layoutDirection="TB"
              />
            </ReactFlowProvider>
          </div>

          {/* 右侧属性面板 */}
          <PropertyPanel
            workflowInputs={workflowInputs}
            workflowOutputs={workflowOutputs}
            onAddInput={addWorkflowInput}
            onRemoveInput={removeWorkflowInput}
            onRenameInput={renameWorkflowInput}
            onAddOutput={addWorkflowOutput}
            onRemoveOutput={removeWorkflowOutput}
            onRenameOutput={renameWorkflowOutput}
          />
        </div>

        {/* 执行对话框 */}
        <ExecuteDialog
          isOpen={showExecuteDialog}
          onClose={() => setShowExecuteDialog(false)}
          workflowName={workflowName}
          inputs={executeInputs}
          onExecute={handleExecute}
          inputHistory={inputHistory}
          onLoadHistory={workflowId ? handleLoadInputHistory : undefined}
          executionMode={controlFlowConfig?.execution_mode}
          timeSeriesInputs={controlFlowConfig?.iteration?.time_series_inputs}
        />

        {/* 流程列表对话框 */}
        <WorkflowListDialog
          isOpen={showWorkflowListDialog}
          onClose={() => setShowWorkflowListDialog(false)}
          onLoadList={handleLoadList}
          onLoad={handleLoadWorkflow}
          onDelete={handleDeleteWorkflow}
        />

        {/* 分类配置对话框 */}
        <CategoryConfigDialog
          isOpen={showCategoryDialog}
          onClose={() => setShowCategoryDialog(false)}
          categoryService={categoryService}
          operators={operators}
        />

        {/* 模板选择对话框 */}
        <TemplateDialog
          isOpen={showTemplateDialog}
          onClose={() => setShowTemplateDialog(false)}
          templateService={templateService}
          onCreateFromTemplate={handleCreateFromTemplate}
        />

        {/* 版本历史面板 */}
        <VersionHistoryPanel
          isOpen={showVersionPanel}
          onClose={() => setShowVersionPanel(false)}
          workflowId={workflowId}
          workflowName={workflowName}
          versionService={versionService}
          onRollback={handleRollback}
        />

        {/* 批量执行对话框 */}
        <BatchExecuteDialog
          isOpen={showBatchDialog}
          onClose={() => setShowBatchDialog(false)}
          workflowName={workflowName}
          inputs={executeInputs}
          onExecute={handleBatchExecute}
        />

        {/* 导入配置对话框 */}
        <ImportConfigDialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onValidate={handleValidateConfig}
          onImport={handleImportConfig}
        />

        {/* 临时执行对话框（复用 ExecuteDialog） */}
        {showRunConfigDialog && (
          <ExecuteDialog
            isOpen={showRunConfigDialog}
            onClose={() => setShowRunConfigDialog(false)}
            workflowName={workflowName || '临时执行'}
            inputs={executeInputs}
            onExecute={handleExecuteConfig}
            executionMode={controlFlowConfig?.execution_mode}
            timeSeriesInputs={controlFlowConfig?.iteration?.time_series_inputs}
          />
        )}

        {/* 控制流配置对话框 */}
        <ControlFlowDialog
          isOpen={showControlFlowDialog}
          onClose={() => setShowControlFlowDialog(false)}
          config={controlFlowConfig}
          onSave={handleSaveControlFlow}
          nodes={getWorkflowNodes()}
          workflowInputNames={workflowInputs.map((i) => i.name)}
        />

        {/* Mermaid 预览 */}
        <MermaidPreview
          isOpen={showMermaidPreview}
          onClose={() => setShowMermaidPreview(false)}
          nodes={getWorkflowNodes()}
          edges={useFlowStore.getState().edges.map((e) => ({
            id: e.id,
            source: { node: e.source, port: e.sourceHandle || '' },
            target: { node: e.target, port: e.targetHandle || '' },
          }))}
          workflowName={workflowName}
        />
      </div>
    </MathJaxContext>
  );
}

export default LowcodePage;
