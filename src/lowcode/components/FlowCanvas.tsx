/**
 * 低代码画布组件
 *
 * 基于 React Flow 实现的可视化流程编排画布
 * 支持节点拖拽、连线、缩放和平移
 *
 * @module lowcode/components/FlowCanvas
 */

import { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useFlowStore } from '../stores/flowStore';
import { nodeTypes } from './OperatorNode';
import type { Operator } from '../types/lowcode';

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
 */
export function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    selectNode,
  } = useFlowStore();

  // 节点点击处理
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  // 画布点击处理（取消选中）
  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

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

      console.log('[FlowCanvas] Drop 事件触发');

      // 尝试多种 MIME 类型获取数据
      const operatorJson =
        event.dataTransfer.getData('application/json') ||
        event.dataTransfer.getData('application/reactflow') ||
        event.dataTransfer.getData('text/plain');

      console.log('[FlowCanvas] 获取到的数据:', operatorJson ? '有数据' : '无数据');

      if (!operatorJson) {
        console.warn('[FlowCanvas] 无法获取拖放数据');
        return;
      }

      let operator: Operator;
      try {
        operator = JSON.parse(operatorJson);
        console.log('[FlowCanvas] 解析算子成功:', operator.name);
      } catch (e) {
        console.error('[FlowCanvas] 解析算子数据失败:', e);
        return;
      }

      // 计算放置位置（转换为画布坐标）
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      console.log('[FlowCanvas] 放置位置:', position);

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

      console.log('[FlowCanvas] 创建节点:', newNode.id);
      addNode(newNode);
    },
    [screenToFlowPosition, addNode],
  );

  return (
    <div className="lowcode-canvas" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        snapToGrid
        snapGrid={[15, 15]}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
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
