/**
 * 低代码画布组件
 *
 * 基于 React Flow 实现的可视化流程编排画布
 * 支持节点拖拽、连线、缩放和平移
 *
 * @module lowcode/components/FlowCanvas
 * @updated 2026-02-02 添加自动布局功能（动态节点尺寸）
 * @updated 2026-02-07 边交互改进：统一 StyledEdge 组件、类型标签、选中高亮、点击选中/删除
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useNodesInitialized,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type EdgeProps,
} from '@xyflow/react';
import { useFlowStore } from '../stores/flowStore';
import { nodeTypes } from './OperatorNode';
import { getNodeSizesFromInternals } from '../utils/layout';
import type { Operator } from '../types/lowcode';
import type { LayoutDirection } from '../utils/layout';

// 导入 React Flow 样式
import '@xyflow/react/dist/style.css';

// 节点 ID 计数器
let nodeIdCounter = 0;

/**
 * 生成唯一节点 ID
 */
function generateNodeId(): string {
  nodeIdCounter += 1;
  return `node-${Date.now()}-${nodeIdCounter}`;
}

// ============================================================================
// 边类型配置 - 颜色、标签、线型
// ============================================================================

interface EdgeStyleConfig {
  color: string;
  label: string;
  strokeWidth: number;
  dashArray?: string;
}

const EDGE_STYLE_MAP: Record<string, EdgeStyleConfig> = {
  data: { color: '#6366f1', label: '数据', strokeWidth: 2 },
  state: { color: '#f59e0b', label: '状态', strokeWidth: 2, dashArray: '8 4' },
  accumulator_read: { color: '#10b981', label: '累加器', strokeWidth: 2, dashArray: '4 2 1 2' },
  broadcast: { color: '#a855f7', label: '广播', strokeWidth: 3 },
};

const DEFAULT_EDGE_STYLE: EdgeStyleConfig = { color: '#6366f1', label: '数据', strokeWidth: 2 };

// ============================================================================
// 自定义边组件 - 4 种边类型的视觉区分（含类型标签和选中高亮）
// ============================================================================

/** 通用边组件：支持类型标签、选中高亮、透明交互热区 */
function StyledEdge(props: EdgeProps) {
  const edgeData = props.data as { edgeType?: string; lag?: number } | undefined;
  const edgeType = edgeData?.edgeType || props.type || 'data';
  const lag = edgeData?.lag;
  const config = EDGE_STYLE_MAP[edgeType] || DEFAULT_EDGE_STYLE;

  const [edgePath, labelX, labelY] = getBezierPath(props);

  // 从 store 获取选中状态
  const isSelected = useFlowStore((s) => s.selectedEdgeId === props.id);

  // 构建描述文本
  let labelText = config.label;
  if (edgeType === 'state' && lag !== undefined && lag > 0) {
    labelText = `状态(lag=${lag})`;
  }

  return (
    <>
      {/* 透明宽热区，方便点击选中 */}
      <BaseEdge
        path={edgePath}
        style={{ stroke: 'transparent', strokeWidth: 20, fill: 'none' }}
        interactionWidth={20}
      />
      {/* 实际可见的边 */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: isSelected ? '#ef4444' : config.color,
          strokeWidth: isSelected ? config.strokeWidth + 1 : config.strokeWidth,
          strokeDasharray: config.dashArray,
          filter: isSelected ? 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.5))' : undefined,
        }}
      />
      {/* 类型标签 */}
      <EdgeLabelRenderer>
        <div
          className={`edge-type-badge edge-type-badge--${edgeType}${isSelected ? ' edge-type-badge--selected' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          {labelText}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** 自定义边类型映射（全部使用统一的 StyledEdge 组件） */
const customEdgeTypes = {
  data: StyledEdge,
  state: StyledEdge,
  accumulator_read: StyledEdge,
  broadcast: StyledEdge,
};

/** FlowCanvas 组件属性 */
interface FlowCanvasProps {
  /** 布局触发器（值变化时触发重新布局） */
  layoutTrigger?: number;
  /** 布局方向 */
  layoutDirection?: LayoutDirection;
  /** 布局完成回调 */
  onLayoutComplete?: () => void;
}

/**
 * 画布组件
 *
 * 提供：
 * - 节点渲染和拖拽
 * - 节点连线
 * - 缩放和平移控制
 * - 小地图导航
 * - 网格背景
 * - 拖放算子创建节点
 * - 自动布局（使用实际测量的节点尺寸）
 */
export function FlowCanvas({
  layoutTrigger,
  layoutDirection = 'LR',
  onLayoutComplete,
}: FlowCanvasProps = {}) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getInternalNode, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  // 追踪已处理的 layoutTrigger 值
  const lastProcessedTrigger = useRef<number>(0);
  // 追踪待处理的布局请求
  const [pendingLayout, setPendingLayout] = useState<number>(0);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    selectNode,
    selectEdge,
    deleteEdge,
    selectedEdgeId,
    autoLayout,
  } = useFlowStore();

  // 当 layoutTrigger 变化时，标记为待处理
  useEffect(() => {
    if (layoutTrigger !== undefined && layoutTrigger > lastProcessedTrigger.current) {
      setPendingLayout(layoutTrigger);
    }
  }, [layoutTrigger]);

  // 当节点初始化完成且有待处理的布局请求时执行布局
  useEffect(() => {
    if (pendingLayout > 0 && nodesInitialized && nodes.length > 0) {
      // 标记为已处理
      lastProcessedTrigger.current = pendingLayout;
      setPendingLayout(0);

      // 获取实际测量的节点尺寸
      const nodeSizes = getNodeSizesFromInternals(nodes, getInternalNode);

      console.warn('[FlowCanvas] 执行自动布局，节点数:', nodes.length, '尺寸映射:', nodeSizes.size);

      // 执行布局
      autoLayout(layoutDirection, nodeSizes);

      // 延迟执行 fitView 以确保布局完成
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
        onLayoutComplete?.();
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 使用 nodes.length 而非完整 nodes 数组，避免每次节点位置更新都触发布局
  }, [pendingLayout, nodesInitialized, nodes.length, layoutDirection, getInternalNode, autoLayout, fitView, onLayoutComplete]);

  // 节点点击处理
  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  // 边点击处理
  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  // 画布点击处理（取消选中节点和边）
  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  // 键盘删除边
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
      }
    },
    [selectedEdgeId, deleteEdge],
  );

  // 拖放处理 - 允许放置
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // 拖放处理 - 放置算子创建节点
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      console.warn('[FlowCanvas] Drop 事件触发');

      // 尝试多种 MIME 类型获取数据
      const operatorJson =
        event.dataTransfer.getData('application/json') ||
        event.dataTransfer.getData('application/reactflow') ||
        event.dataTransfer.getData('text/plain');

      console.warn('[FlowCanvas] 获取到的数据:', operatorJson ? '有数据' : '无数据');

      if (!operatorJson) {
        console.warn('[FlowCanvas] 无法获取拖放数据');
        return;
      }

      let operator: Operator;
      try {
        operator = JSON.parse(operatorJson);
        console.warn('[FlowCanvas] 解析算子成功:', operator.name);
      } catch (e) {
        console.error('[FlowCanvas] 解析算子数据失败:', e);
        return;
      }

      // 计算放置位置（转换为画布坐标）
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      console.warn('[FlowCanvas] 放置位置:', position);

      // 创建新节点
      const newNode = {
        id: generateNodeId(),
        type: 'operator',
        position,
        data: {
          operator,
          label: operator.name,
        },
      };

      console.warn('[FlowCanvas] 创建节点:', newNode.id);
      addNode(newNode);
    },
    [screenToFlowPosition, addNode],
  );

  return (
    <div className="lowcode-canvas" ref={reactFlowWrapper} onKeyDown={handleKeyDown} tabIndex={-1} role="application">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={customEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        snapToGrid
        snapGrid={[15, 15]}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'data',
          animated: true,
          style: { strokeWidth: 2 },
        }}
        connectionLineStyle={{ strokeWidth: 2 }}
      >
        {/* 控制面板：缩放、适应视图 */}
        <Controls />

        {/* 小地图 */}
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
        />

        {/* 网格背景 */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
        />
      </ReactFlow>
    </div>
  );
}

export default FlowCanvas;
