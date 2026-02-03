/**
 * Mermaid 预览组件
 *
 * 渲染和预览 Mermaid 图形
 *
 * @module lowcode/components/MermaidPreview
 */

import { memo, useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import type { WorkflowNode, WorkflowEdge } from '../types/lowcode';

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

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

// ResetZoomIcon 备用（暂时未使用）
// function ResetZoomIcon() {
//   return (
//     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
//       <path d="M3.5 2v6h6" />
//       <path d="M21 12A9 9 0 0 0 6 5.3L3.5 8" />
//       <path d="M21 22v-6h-6" />
//       <path d="M3 12a9 9 0 0 0 15 6.7l2.5-2.7" />
//     </svg>
//   );
// }

// ============================================================================
// 类型定义
// ============================================================================

interface MermaidPreviewProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** Mermaid 图形定义（来自 visualization.mermaid） */
  mermaidCode?: string;
  /** 流程节点列表（用于自动生成图形） */
  nodes?: WorkflowNode[];
  /** 流程边列表（用于自动生成图形） */
  edges?: WorkflowEdge[];
  /** 流程名称 */
  workflowName?: string;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从节点和边生成 Mermaid 代码
 */
function generateMermaidFromWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  workflowName?: string
): string {
  const lines: string[] = [];
  lines.push('flowchart TD');
  
  if (workflowName) {
    lines.push(`    subgraph ${sanitizeId(workflowName)}["${workflowName}"]`);
  }

  // 添加节点
  nodes.forEach((node) => {
    const nodeId = sanitizeId(node.id);
    const label = node.name || node.operator_id || node.id;
    lines.push(`    ${nodeId}["${escapeLabel(label)}"]`);
  });

  // 添加边
  edges.forEach((edge) => {
    const sourceId = sanitizeId(edge.source.node);
    const targetId = sanitizeId(edge.target.node);
    const label = `${edge.source.port} → ${edge.target.port}`;
    lines.push(`    ${sourceId} -->|"${escapeLabel(label)}"| ${targetId}`);
  });

  if (workflowName) {
    lines.push('    end');
  }

  return lines.join('\n');
}

/**
 * 清理 ID 使其符合 Mermaid 语法
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * 转义标签中的特殊字符
 */
function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\n/g, ' ');
}

// ============================================================================
// 初始化 Mermaid
// ============================================================================

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
  },
});

// ============================================================================
// 主组件
// ============================================================================

function MermaidPreviewComponent({
  isOpen,
  onClose,
  mermaidCode,
  nodes = [],
  edges = [],
  workflowName,
}: MermaidPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [zoom, setZoom] = useState(1);

  // 缩放常量
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.25;

  // 生成 Mermaid 代码
  const generateCode = useCallback(() => {
    if (mermaidCode) {
      setCurrentCode(mermaidCode);
    } else if (nodes.length > 0) {
      setCurrentCode(generateMermaidFromWorkflow(nodes, edges, workflowName));
    } else {
      setCurrentCode('flowchart TD\n    A[开始] --> B[结束]');
    }
  }, [mermaidCode, nodes, edges, workflowName]);

  // 渲染 Mermaid 图形
  const renderMermaid = useCallback(async () => {
    if (!containerRef.current || !currentCode) { return; }

    try {
      setError(null);
      // 清空容器
      containerRef.current.innerHTML = '';
      
      // 生成唯一 ID
      const id = `mermaid-${Date.now()}`;
      
      // 渲染
      const { svg } = await mermaid.render(id, currentCode);
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '渲染失败');
    }
  }, [currentCode]);

  // 初始化时生成代码
  useEffect(() => {
    if (isOpen) {
      generateCode();
    }
  }, [isOpen, generateCode]);

  // 代码变化时重新渲染
  useEffect(() => {
    if (isOpen && currentCode) {
      renderMermaid();
    }
  }, [isOpen, currentCode, renderMermaid]);

  // 复制代码
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // 忽略复制错误
    }
  }, [currentCode]);

  // 刷新
  const handleRefresh = useCallback(() => {
    generateCode();
  }, [generateCode]);

  // 切换全屏
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // 放大
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, ZOOM_MAX));
  }, []);

  // 缩小
  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, ZOOM_MIN));
  }, []);

  // 重置缩放
  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // 鼠标滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((prev) => Math.min(Math.max(prev + delta, ZOOM_MIN), ZOOM_MAX));
    }
  }, []);

  // 阻止点击内容区域关闭
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`dialog mermaid-preview-dialog ${isFullscreen ? 'fullscreen' : 'dialog-lg'}`}
        onClick={handleContentClick}
      >
        <div className="dialog-header">
          <div className="dialog-title">Mermaid 预览</div>
          <div className="mermaid-toolbar">
            <button
              className="mermaid-toolbar-btn"
              onClick={handleZoomOut}
              title="缩小 (Ctrl + 滚轮)"
              disabled={zoom <= ZOOM_MIN}
            >
              <ZoomOutIcon />
            </button>
            <span className="zoom-level" title="点击重置" onClick={handleResetZoom}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="mermaid-toolbar-btn"
              onClick={handleZoomIn}
              title="放大 (Ctrl + 滚轮)"
              disabled={zoom >= ZOOM_MAX}
            >
              <ZoomInIcon />
            </button>
            <div className="toolbar-divider-v" />
            <button
              className="mermaid-toolbar-btn"
              onClick={handleRefresh}
              title="刷新"
            >
              <RefreshIcon />
            </button>
            <button
              className="mermaid-toolbar-btn"
              onClick={handleCopy}
              title={copySuccess ? '已复制!' : '复制代码'}
            >
              <CopyIcon />
              {copySuccess && <span className="copy-badge">✓</span>}
            </button>
            <button
              className="mermaid-toolbar-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              <FullscreenIcon />
            </button>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-body mermaid-content" ref={wrapperRef} onWheel={handleWheel}>
          {error ? (
            <div className="mermaid-error">
              <strong>渲染错误:</strong> {error}
              <pre className="mermaid-code">{currentCode}</pre>
            </div>
          ) : (
            <div
              className="mermaid-container"
              ref={containerRef}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            />
          )}
        </div>

        <div className="dialog-footer">
          <details className="mermaid-code-details">
            <summary>查看 Mermaid 代码</summary>
            <pre className="mermaid-code">{currentCode}</pre>
          </details>
          <button className="toolbar-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export const MermaidPreview = memo(MermaidPreviewComponent);
