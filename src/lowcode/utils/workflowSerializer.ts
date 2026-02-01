/**
 * 流程序列化工具
 *
 * 负责 React Flow 画布状态与后端 API 格式的双向转换
 *
 * @module lowcode/utils/workflowSerializer
 */

import type { Node, Edge } from '@xyflow/react';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInput,
  WorkflowOutput,
  Operator,
} from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

/** 节点数据类型 */
interface OperatorNodeData {
  operator: Operator;
  label?: string;
}

/** 反序列化结果 */
export interface DeserializeResult {
  nodes: Node[];
  edges: Edge[];
}

/** 流程输入绑定（前端格式） */
export interface InputBinding {
  name: string;
  nodeId: string;
  port: string;
}

/** 流程输出绑定（前端格式） */
export interface OutputBinding {
  name: string;
  nodeId: string;
  port: string;
}

// ============================================================================
// 序列化：React Flow -> API 格式
// ============================================================================

/**
 * 将 React Flow 节点转换为 API 格式的节点
 */
function serializeNode(node: Node): WorkflowNode {
  const data = node.data as unknown as OperatorNodeData;

  return {
    id: node.id,
    operator_id: data.operator.id,
    position: {
      x: node.position.x,
      y: node.position.y,
    },
    name: data.label || data.operator.name,
  };
}

/**
 * 将 React Flow 边转换为 API 格式的边
 *
 * React Flow 的边格式：
 * - source: 源节点 ID
 * - target: 目标节点 ID
 * - sourceHandle: 源端口名称（直接使用端口名，如 "result"）
 * - targetHandle: 目标端口名称（直接使用端口名，如 "a"）
 *
 * API 格式的边：
 * - source: { node: string, port: string }
 * - target: { node: string, port: string }
 */
function serializeEdge(edge: Edge): WorkflowEdge {
  // Handle ID 直接是端口名称，无需提取
  const sourcePort = edge.sourceHandle || 'output';
  const targetPort = edge.targetHandle || 'input';

  return {
    id: edge.id,
    source: {
      node: edge.source,
      port: sourcePort,
    },
    target: {
      node: edge.target,
      port: targetPort,
    },
  };
}

/**
 * 将前端输入绑定转换为 API 格式
 */
function serializeInputBindings(bindings: InputBinding[]): WorkflowInput[] {
  return bindings.map((binding) => ({
    name: binding.name,
    bind_to: {
      node: binding.nodeId,
      port: binding.port,
    },
  }));
}

/**
 * 将前端输出绑定转换为 API 格式
 */
function serializeOutputBindings(bindings: OutputBinding[]): WorkflowOutput[] {
  return bindings.map((binding) => ({
    name: binding.name,
    bind_from: {
      node: binding.nodeId,
      port: binding.port,
    },
  }));
}

/**
 * 将 React Flow 状态序列化为 API 格式的流程定义
 *
 * @param nodes - React Flow 节点列表
 * @param edges - React Flow 边列表
 * @param inputBindings - 流程输入绑定
 * @param outputBindings - 流程输出绑定
 * @returns API 格式的流程定义
 */
export function serializeToWorkflow(
  nodes: Node[],
  edges: Edge[],
  inputBindings: InputBinding[],
  outputBindings: OutputBinding[],
): WorkflowDefinition {
  return {
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
    inputs: serializeInputBindings(inputBindings),
    outputs: serializeOutputBindings(outputBindings),
  };
}

// ============================================================================
// 反序列化：API 格式 -> React Flow
// ============================================================================

/**
 * 将 API 格式的节点转换为 React Flow 节点
 *
 * 注意：需要提供算子信息才能完整构建节点数据
 */
function deserializeNode(
  workflowNode: WorkflowNode,
  operatorMap: Map<string, Operator>,
): Node | null {
  const operator = operatorMap.get(workflowNode.operator_id);

  if (!operator) {
    console.warn(
      `[WorkflowSerializer] 未找到算子: ${workflowNode.operator_id}`,
    );
    return null;
  }

  return {
    id: workflowNode.id,
    type: 'operator',
    position: workflowNode.position || { x: 0, y: 0 },
    data: {
      operator,
      label: workflowNode.name,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * 将 API 格式的边转换为 React Flow 边
 *
 * 注意：Handle ID 直接使用端口名称，不添加前缀
 * 这与 OperatorNode 中的 Handle id={port.name} 保持一致
 */
function deserializeEdge(workflowEdge: WorkflowEdge): Edge {
  return {
    id: workflowEdge.id,
    source: workflowEdge.source.node,
    target: workflowEdge.target.node,
    sourceHandle: workflowEdge.source.port,
    targetHandle: workflowEdge.target.port,
    animated: true,
  };
}

/**
 * 将 API 格式的输入绑定转换为前端格式
 */
function deserializeInputBindings(inputs: WorkflowInput[]): InputBinding[] {
  return inputs.map((input) => ({
    name: input.name,
    nodeId: input.bind_to.node,
    port: input.bind_to.port,
  }));
}

/**
 * 将 API 格式的输出绑定转换为前端格式
 */
function deserializeOutputBindings(outputs: WorkflowOutput[]): OutputBinding[] {
  return outputs.map((output) => ({
    name: output.name,
    nodeId: output.bind_from.node,
    port: output.bind_from.port,
  }));
}

/**
 * 将 API 格式的流程定义反序列化为 React Flow 状态
 *
 * @param definition - API 格式的流程定义
 * @param operators - 可用的算子列表（用于恢复节点数据）
 * @returns React Flow 状态和绑定信息
 */
export function deserializeFromWorkflow(
  definition: WorkflowDefinition | undefined | null,
  operators: Operator[],
): {
  result: DeserializeResult;
  inputBindings: InputBinding[];
  outputBindings: OutputBinding[];
  missingOperators: string[];
} {
  // 处理空定义
  if (!definition) {
    return {
      result: { nodes: [], edges: [] },
      inputBindings: [],
      outputBindings: [],
      missingOperators: [],
    };
  }

  // 构建算子查找表
  const operatorMap = new Map<string, Operator>();
  operators.forEach((op) => operatorMap.set(op.id, op));

  // 跟踪缺失的算子
  const missingOperators: string[] = [];

  // 转换节点（安全访问）
  const nodes: Node[] = [];
  const definitionNodes = definition.nodes || [];
  for (const workflowNode of definitionNodes) {
    const node = deserializeNode(workflowNode, operatorMap);
    if (node) {
      nodes.push(node);
    } else {
      missingOperators.push(workflowNode.operator_id);
    }
  }

  // 转换边（安全访问）
  const definitionEdges = definition.edges || [];
  const edges = definitionEdges.map(deserializeEdge);

  // 转换绑定（安全访问）
  const inputBindings = deserializeInputBindings(definition.inputs || []);
  const outputBindings = deserializeOutputBindings(definition.outputs || []);

  return {
    result: { nodes, edges },
    inputBindings,
    outputBindings,
    missingOperators,
  };
}

// ============================================================================
// 验证工具
// ============================================================================

/**
 * 验证流程定义的完整性
 *
 * @param definition - 流程定义
 * @returns 验证错误列表
 */
export function validateDefinition(
  definition: WorkflowDefinition,
): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(definition.nodes.map((n) => n.id));

  // 验证节点
  if (definition.nodes.length === 0) {
    errors.push('流程必须至少包含一个节点');
  }

  // 验证边引用的节点存在
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source.node)) {
      errors.push(`边 ${edge.id} 引用了不存在的源节点: ${edge.source.node}`);
    }
    if (!nodeIds.has(edge.target.node)) {
      errors.push(`边 ${edge.id} 引用了不存在的目标节点: ${edge.target.node}`);
    }
  }

  // 验证输入绑定的节点存在
  for (const input of definition.inputs) {
    if (!nodeIds.has(input.bind_to.node)) {
      errors.push(
        `输入 ${input.name} 绑定了不存在的节点: ${input.bind_to.node}`,
      );
    }
  }

  // 验证输出绑定的节点存在
  for (const output of definition.outputs) {
    if (!nodeIds.has(output.bind_from.node)) {
      errors.push(
        `输出 ${output.name} 绑定了不存在的节点: ${output.bind_from.node}`,
      );
    }
  }

  // 检查循环依赖（简单检测）
  const graph = new Map<string, string[]>();
  for (const node of definition.nodes) {
    graph.set(node.id, []);
  }
  for (const edge of definition.edges) {
    const deps = graph.get(edge.target.node);
    if (deps) {
      deps.push(edge.source.node);
    }
  }

  // DFS 检测循环
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) { return true; }
    if (visited.has(nodeId)) { return false; }

    visited.add(nodeId);
    inStack.add(nodeId);

    const deps = graph.get(nodeId) || [];
    for (const dep of deps) {
      if (hasCycle(dep)) { return true; }
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of nodeIds) {
    if (hasCycle(nodeId)) {
      errors.push('检测到循环依赖');
      break;
    }
  }

  return errors;
}

/**
 * 生成流程的执行顺序
 *
 * @param definition - 流程定义
 * @returns 按执行顺序排列的节点 ID 列表
 */
export function getExecutionOrder(definition: WorkflowDefinition): string[] {
  const nodeIds = definition.nodes.map((n) => n.id);
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  // 初始化
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0);
    graph.set(nodeId, []);
  }

  // 构建图
  for (const edge of definition.edges) {
    const deps = graph.get(edge.source.node);
    if (deps) {
      deps.push(edge.target.node);
    }
    inDegree.set(edge.target.node, (inDegree.get(edge.target.node) || 0) + 1);
  }

  // 拓扑排序
  const queue: string[] = [];
  const result: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const neighbors = graph.get(current) || [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  return result;
}
