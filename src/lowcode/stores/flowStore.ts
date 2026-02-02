/**
 * 低代码画布状态管理
 *
 * 使用 Zustand 管理 React Flow 的节点和边状态，以及流程级状态
 *
 * @module lowcode/stores/flowStore
 */

import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import type { InputBinding, OutputBinding } from '../utils/workflowSerializer';
import { getLayoutedElements, type LayoutDirection, type NodeSize } from '../utils/layout';

// ============================================================================
// 类型定义
// ============================================================================

/** 画布状态 */
interface FlowState {
  // ---- 画布状态 ----
  /** 节点列表 */
  nodes: Node[];
  /** 边列表 */
  edges: Edge[];
  /** 当前选中的节点 ID */
  selectedNodeId: string | null;

  // ---- 流程状态 ----
  /** 当前流程 ID（null 表示新建） */
  workflowId: string | null;
  /** 流程名称 */
  workflowName: string;
  /** 流程描述 */
  workflowDescription: string;
  /** 流程输入绑定 */
  workflowInputs: InputBinding[];
  /** 流程输出绑定 */
  workflowOutputs: OutputBinding[];
  /** 是否有未保存的更改 */
  isDirty: boolean;

  // ---- 画布 Actions ----
  /** 设置节点 */
  setNodes: (nodes: Node[]) => void;
  /** 设置边 */
  setEdges: (edges: Edge[]) => void;
  /** 处理节点变化 */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 处理边变化 */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 处理连接 */
  onConnect: (connection: Connection) => void;
  /** 添加节点 */
  addNode: (node: Node) => void;
  /** 删除节点 */
  deleteNode: (nodeId: string) => void;
  /** 选中节点 */
  selectNode: (nodeId: string | null) => void;
  /** 清空画布 */
  clearCanvas: () => void;
  /** 自动布局 */
  autoLayout: (direction?: LayoutDirection, nodeSizes?: Map<string, NodeSize>) => void;

  // ---- 流程 Actions ----
  /** 设置流程 ID */
  setWorkflowId: (id: string | null) => void;
  /** 设置流程名称 */
  setWorkflowName: (name: string) => void;
  /** 设置流程描述 */
  setWorkflowDescription: (description: string) => void;
  /** 添加流程输入绑定 */
  addWorkflowInput: (nodeId: string, port: string, name: string) => void;
  /** 移除流程输入绑定 */
  removeWorkflowInput: (nodeId: string, port: string) => void;
  /** 重命名流程输入绑定 */
  renameWorkflowInput: (nodeId: string, port: string, newName: string) => void;
  /** 添加流程输出绑定 */
  addWorkflowOutput: (nodeId: string, port: string, name: string) => void;
  /** 移除流程输出绑定 */
  removeWorkflowOutput: (nodeId: string, port: string) => void;
  /** 重命名流程输出绑定 */
  renameWorkflowOutput: (nodeId: string, port: string, newName: string) => void;
  /** 设置所有流程输入绑定 */
  setWorkflowInputs: (inputs: InputBinding[]) => void;
  /** 设置所有流程输出绑定 */
  setWorkflowOutputs: (outputs: OutputBinding[]) => void;
  /** 标记为已保存 */
  markSaved: () => void;
  /** 标记为已修改 */
  markDirty: () => void;
  /** 重置流程状态（新建） */
  resetWorkflow: () => void;
  /** 加载流程 */
  loadWorkflow: (
    id: string,
    name: string,
    description: string,
    nodes: Node[],
    edges: Edge[],
    inputs: InputBinding[],
    outputs: OutputBinding[],
  ) => void;
}

// ============================================================================
// Store 创建
// ============================================================================

/**
 * 画布状态 Store
 *
 * 管理 React Flow 的节点、边、选中状态和流程级状态
 */
export const useFlowStore = create<FlowState>((set, get) => ({
  // 画布初始状态
  nodes: [],
  edges: [],
  selectedNodeId: null,

  // 流程初始状态
  workflowId: null,
  workflowName: '未命名流程',
  workflowDescription: '',
  workflowInputs: [],
  workflowOutputs: [],
  isDirty: false,

  // ---- 画布 Actions ----

  setNodes: (nodes) => set({ nodes, isDirty: true }),

  setEdges: (edges) => set({ edges, isDirty: true }),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },

  onConnect: (connection) => {
    set({
      edges: addEdge({ ...connection, animated: true }, get().edges),
      isDirty: true,
    });
  },

  addNode: (node) => {
    set({
      nodes: [...get().nodes, node],
      isDirty: true,
    });
  },

  deleteNode: (nodeId) => {
    // 同时移除相关的输入/输出绑定
    const newInputs = get().workflowInputs.filter((i) => i.nodeId !== nodeId);
    const newOutputs = get().workflowOutputs.filter((o) => o.nodeId !== nodeId);

    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId:
        get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      workflowInputs: newInputs,
      workflowOutputs: newOutputs,
      isDirty: true,
    });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      workflowInputs: [],
      workflowOutputs: [],
      isDirty: true,
    });
  },

  autoLayout: (direction = 'TB', nodeSizes) => {
    const { nodes, edges } = get();
    if (nodes.length === 0) { return; }

    // 根据布局方向调整间距参数
    const isVertical = direction === 'TB' || direction === 'BT';
    const layoutedNodes = getLayoutedElements(nodes, edges, {
      direction,
      nodeSizes,
      // 优化参数：垂直布局时增加层级间距，减少同层间距
      nodesep: isVertical ? 30 : 50,
      ranksep: isVertical ? 80 : 100,
      align: 'UL',
      ranker: 'tight-tree', // 使用 tight-tree 使布局更紧凑有序
    });
    set({ nodes: layoutedNodes, isDirty: true });
  },

  // ---- 流程 Actions ----

  setWorkflowId: (id) => set({ workflowId: id }),

  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

  setWorkflowDescription: (description) =>
    set({ workflowDescription: description, isDirty: true }),

  addWorkflowInput: (nodeId, port, name) => {
    const existing = get().workflowInputs.find(
      (i) => i.nodeId === nodeId && i.port === port,
    );
    if (existing) { return; }

    set({
      workflowInputs: [...get().workflowInputs, { nodeId, port, name }],
      isDirty: true,
    });
  },

  removeWorkflowInput: (nodeId, port) => {
    set({
      workflowInputs: get().workflowInputs.filter(
        (i) => !(i.nodeId === nodeId && i.port === port),
      ),
      isDirty: true,
    });
  },

  renameWorkflowInput: (nodeId, port, newName) => {
    set({
      workflowInputs: get().workflowInputs.map((i) =>
        i.nodeId === nodeId && i.port === port ? { ...i, name: newName } : i,
      ),
      isDirty: true,
    });
  },

  addWorkflowOutput: (nodeId, port, name) => {
    const existing = get().workflowOutputs.find(
      (o) => o.nodeId === nodeId && o.port === port,
    );
    if (existing) { return; }

    set({
      workflowOutputs: [...get().workflowOutputs, { nodeId, port, name }],
      isDirty: true,
    });
  },

  removeWorkflowOutput: (nodeId, port) => {
    set({
      workflowOutputs: get().workflowOutputs.filter(
        (o) => !(o.nodeId === nodeId && o.port === port),
      ),
      isDirty: true,
    });
  },

  renameWorkflowOutput: (nodeId, port, newName) => {
    set({
      workflowOutputs: get().workflowOutputs.map((o) =>
        o.nodeId === nodeId && o.port === port ? { ...o, name: newName } : o,
      ),
      isDirty: true,
    });
  },

  setWorkflowInputs: (inputs) => set({ workflowInputs: inputs }),

  setWorkflowOutputs: (outputs) => set({ workflowOutputs: outputs }),

  markSaved: () => set({ isDirty: false }),

  markDirty: () => set({ isDirty: true }),

  resetWorkflow: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      workflowId: null,
      workflowName: '未命名流程',
      workflowDescription: '',
      workflowInputs: [],
      workflowOutputs: [],
      isDirty: false,
    });
  },

  loadWorkflow: (id, name, description, nodes, edges, inputs, outputs) => {
    set({
      workflowId: id,
      workflowName: name,
      workflowDescription: description,
      nodes,
      edges,
      workflowInputs: inputs,
      workflowOutputs: outputs,
      selectedNodeId: null,
      isDirty: false,
    });
  },
}));
