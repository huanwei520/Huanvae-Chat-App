/**
 * 工具栏组件
 *
 * 提供流程的创建、保存、验证、运行等操作
 *
 * @module lowcode/components/Toolbar
 */

import { memo, useCallback } from 'react';

// ============================================================================
// 图标组件
// ============================================================================

/** 新建图标 */
function NewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/** 保存图标 */
function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17,21 17,13 7,13 7,21" />
      <polyline points="7,3 7,8 15,8" />
    </svg>
  );
}

/** 验证图标 */
function ValidateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
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

/** 导出图标 */
function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** 导入图标 */
function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** 列表图标 */
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

/** 清空图标 */
function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
    </svg>
  );
}

/** 模板图标 */
function TemplateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

/** 版本图标 */
function VersionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

/** 分类图标 */
function CategoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 批量执行图标 */
function BatchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

/** 自动布局图标 */
function LayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="8.5" y="14" width="7" height="7" rx="1" />
      <path d="M6.5 10v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
      <line x1="12" y1="12.5" x2="12" y2="14" />
    </svg>
  );
}

/** 临时执行图标 */
function PlayConfigIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5,3 19,12 5,21 5,3" />
      <circle cx="18" cy="18" r="5" fill="none" />
      <path d="M18 16v4" />
      <circle cx="18" cy="21" r="0.5" fill="currentColor" />
    </svg>
  );
}

/** 控制流图标 */
function ControlFlowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v6" />
      <path d="M12 15v6" />
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
    </svg>
  );
}

/** Mermaid 预览图标 */
function MermaidIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10" />
      <path d="M12 8v8" />
      <path d="M7 16h2" />
      <path d="M15 16h2" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

/** 工具栏 Props */
interface ToolbarProps {
  /** 流程名称 */
  workflowName: string;
  /** 流程名称变更回调 */
  onNameChange: (name: string) => void;
  /** 是否有未保存的更改 */
  isDirty: boolean;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 是否正在执行 */
  isExecuting: boolean;
  /** 当前流程 ID（null 表示新建） */
  workflowId: string | null;
  /** 节点数量 */
  nodeCount: number;
  /** 新建流程 */
  onNew: () => void;
  /** 保存流程 */
  onSave: () => void;
  /** 验证流程 */
  onValidate: () => void;
  /** 运行流程 */
  onRun: () => void;
  /** 导出流程 */
  onExport: () => void;
  /** 打开流程列表 */
  onOpenList: () => void;
  /** 清空画布 */
  onClear: () => void;
  /** 打开模板选择器 */
  onOpenTemplates?: () => void;
  /** 打开版本历史 */
  onOpenVersions?: () => void;
  /** 打开分类配置 */
  onOpenCategories?: () => void;
  /** 批量执行 */
  onBatchRun?: () => void;
  /** 自动布局 */
  onAutoLayout?: () => void;
  /** 导入配置文件 */
  onImport?: () => void;
  /** 临时执行（不保存） */
  onRunConfig?: () => void;
  /** 打开控制流配置 */
  onOpenControlFlow?: () => void;
  /** 打开 Mermaid 预览 */
  onOpenMermaidPreview?: () => void;
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 工具栏组件
 *
 * 提供流程编辑的各种操作按钮
 */
function ToolbarComponent({
  workflowName,
  onNameChange,
  isDirty,
  isSaving,
  isExecuting,
  workflowId,
  nodeCount,
  onNew,
  onSave,
  onValidate,
  onRun,
  onExport,
  onOpenList,
  onClear,
  onOpenTemplates,
  onOpenVersions,
  onOpenCategories,
  onBatchRun,
  onAutoLayout,
  onImport,
  onRunConfig,
  onOpenControlFlow,
  onOpenMermaidPreview,
}: ToolbarProps) {
  /** 处理名称变更 */
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onNameChange(e.target.value);
    },
    [onNameChange],
  );

  /** 处理新建确认 */
  const handleNew = useCallback(() => {
    if (isDirty) {
      // eslint-disable-next-line no-alert
      if (!confirm('当前有未保存的更改，确定要新建流程吗？')) {
        return;
      }
    }
    onNew();
  }, [isDirty, onNew]);

  /** 处理清空确认 */
  const handleClear = useCallback(() => {
    if (nodeCount === 0) { return; }
    // eslint-disable-next-line no-alert
    if (confirm('确定要清空画布吗？此操作不可撤销。')) {
      onClear();
    }
  }, [nodeCount, onClear]);

  return (
    <div className="lowcode-toolbar">
      {/* 左侧：流程名称 */}
      <div className="toolbar-group">
        <input
          type="text"
          className="workflow-name-input"
          value={workflowName}
          onChange={handleNameChange}
          placeholder="输入流程名称"
        />
        <div className="toolbar-status">
          <span
            className={`status-dot ${isDirty ? 'unsaved' : ''}`}
            title={isDirty ? '有未保存的更改' : '已保存'}
          />
          <span>
            {workflowId ? '编辑中' : '新流程'}
            {isDirty && ' (未保存)'}
          </span>
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="toolbar-group">
        {/* 流程管理 */}
        <button
          className="toolbar-btn"
          onClick={handleNew}
          title="新建流程"
        >
          <NewIcon />
          <span>新建</span>
        </button>

        <button
          className="toolbar-btn"
          onClick={onOpenList}
          title="打开流程列表"
        >
          <ListIcon />
          <span>打开</span>
        </button>

        {onOpenTemplates && (
          <button
            className="toolbar-btn"
            onClick={onOpenTemplates}
            title="从模板创建"
          >
            <TemplateIcon />
            <span>模板</span>
          </button>
        )}

        <button
          className="toolbar-btn"
          onClick={onSave}
          disabled={isSaving || !workflowName.trim()}
          title="保存流程"
        >
          <SaveIcon />
          <span>{isSaving ? '保存中...' : '保存'}</span>
        </button>

        <div className="toolbar-divider" />

        {/* 验证和运行 */}
        <button
          className="toolbar-btn"
          onClick={onValidate}
          disabled={nodeCount === 0}
          title="验证流程"
        >
          <ValidateIcon />
          <span>验证</span>
        </button>

        <button
          className="toolbar-btn primary"
          onClick={onRun}
          disabled={isExecuting || nodeCount === 0}
          title="运行流程"
        >
          <RunIcon />
          <span>{isExecuting ? '运行中...' : '运行'}</span>
        </button>

        {onBatchRun && (
          <button
            className="toolbar-btn"
            onClick={onBatchRun}
            disabled={isExecuting || nodeCount === 0}
            title="批量执行"
          >
            <BatchIcon />
            <span>批量</span>
          </button>
        )}

        {onRunConfig && (
          <button
            className="toolbar-btn"
            onClick={onRunConfig}
            disabled={isExecuting || nodeCount === 0}
            title="临时执行（不保存到数据库）"
          >
            <PlayConfigIcon />
            <span>临时</span>
          </button>
        )}

        <div className="toolbar-divider" />

        {/* 其他操作 */}
        {onOpenVersions && (
          <button
            className="toolbar-btn"
            onClick={onOpenVersions}
            disabled={!workflowId}
            title="版本历史"
          >
            <VersionIcon />
            <span>版本</span>
          </button>
        )}

        <button
          className="toolbar-btn"
          onClick={onExport}
          disabled={!workflowId}
          title="导出流程配置"
        >
          <ExportIcon />
          <span>导出</span>
        </button>

        {onImport && (
          <button
            className="toolbar-btn"
            onClick={onImport}
            title="导入配置文件"
          >
            <ImportIcon />
            <span>导入</span>
          </button>
        )}

        {onOpenCategories && (
          <button
            className="toolbar-btn"
            onClick={onOpenCategories}
            title="分类配置"
          >
            <CategoryIcon />
            <span>分类</span>
          </button>
        )}

        {onOpenControlFlow && (
          <button
            className="toolbar-btn"
            onClick={onOpenControlFlow}
            disabled={nodeCount === 0}
            title="控制流配置"
          >
            <ControlFlowIcon />
            <span>控制流</span>
          </button>
        )}

        {onOpenMermaidPreview && (
          <button
            className="toolbar-btn"
            onClick={onOpenMermaidPreview}
            disabled={nodeCount === 0}
            title="Mermaid 图预览"
          >
            <MermaidIcon />
            <span>预览</span>
          </button>
        )}

        {onAutoLayout && (
          <button
            className="toolbar-btn"
            onClick={onAutoLayout}
            disabled={nodeCount < 2}
            title="自动布局"
          >
            <LayoutIcon />
            <span>布局</span>
          </button>
        )}

        <button
          className="toolbar-btn danger"
          onClick={handleClear}
          disabled={nodeCount === 0}
          title="清空画布"
        >
          <ClearIcon />
          <span>清空</span>
        </button>
      </div>
    </div>
  );
}

export const Toolbar = memo(ToolbarComponent);
export default Toolbar;
