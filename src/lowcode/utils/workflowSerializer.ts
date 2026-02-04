/**
 * 流程序列化工具
 *
 * 负责 React Flow 画布状态与后端 API 格式的双向转换
 *
 * @module lowcode/utils/workflowSerializer
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import type { Node, Edge } from '@xyflow/react';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInput,
  WorkflowOutput,
  Operator,
  ControlFlowConfig,
  VisualizationConfig,
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
  /** 数据类型 */
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

/** 流程输出绑定（前端格式） */
export interface OutputBinding {
  name: string;
  /** 节点 ID（节点端口来源时使用） */
  nodeId?: string;
  /** 端口名称（节点端口来源时使用） */
  port?: string;
  /** 累加器名称（累加器来源时使用） */
  accumulator?: string;
  /** 数据类型 */
  type?: string;
  /** 参数描述 */
  description?: string;
  /** 来源类型：node=节点端口, accumulator=累加器 */
  source_type?: 'node' | 'accumulator';
  /** LaTeX 格式的参数名 */
  latex_name?: string;
}

// ============================================================================
// 序列化：React Flow -> API 格式
// ============================================================================

/**
 * 将 React Flow 节点转换为 API 格式的节点
 *
 * 保留节点的增强字段：type, latex_formula, input_params, output_params
 */
function serializeNode(node: Node): WorkflowNode {
  const data = node.data as unknown as OperatorNodeData;

  const result: WorkflowNode = {
    id: node.id,
    operator_id: data.operator.id,
    position: {
      x: node.position.x,
      y: node.position.y,
    },
    name: data.label || data.operator.name,
  };

  // 保留算子类型字段
  if (data.operator.operator_type) {
    result.type = data.operator.operator_type;
  }

  // 保留 LaTeX 公式字段
  if (data.operator.latex_formula) {
    result.latex_formula = data.operator.latex_formula;
  }

  return result;
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
 *
 * 保留增强字段：type, required, description, default, latex_name, paper_ref
 */
function serializeInputBindings(bindings: InputBinding[]): WorkflowInput[] {
  return bindings.map((binding) => {
    const result: WorkflowInput = {
      name: binding.name,
      bind_to: {
        node: binding.nodeId,
        port: binding.port,
      },
    };

    // 保留可选字段
    if (binding.type) { result.type = binding.type; }
    if (binding.required !== undefined) { result.required = binding.required; }
    if (binding.description) { result.description = binding.description; }
    if (binding.default) { result.default = binding.default; }
    if (binding.latex_name) { result.latex_name = binding.latex_name; }
    if (binding.paper_ref) { result.paper_ref = binding.paper_ref; }

    return result;
  });
}

/**
 * 将前端输出绑定转换为 API 格式
 *
 * 保留增强字段：type, description, source_type, latex_name
 * 支持两种来源格式：节点端口 和 累加器
 */
function serializeOutputBindings(bindings: OutputBinding[]): WorkflowOutput[] {
  return bindings.map((binding) => {
    // 根据来源类型构建 bind_from
    let bindFrom: WorkflowOutput['bind_from'];
    if (binding.accumulator) {
      bindFrom = { accumulator: binding.accumulator };
    } else {
      bindFrom = {
        node: binding.nodeId || '',
        port: binding.port || '',
      };
    }

    const result: WorkflowOutput = {
      name: binding.name,
      bind_from: bindFrom,
    };

    // 保留可选字段
    if (binding.type) { result.type = binding.type; }
    if (binding.description) { result.description = binding.description; }
    if (binding.source_type) { result.source_type = binding.source_type; }
    if (binding.latex_name) { result.latex_name = binding.latex_name; }

    return result;
  });
}

/** 序列化选项 */
export interface SerializeOptions {
  /** 默认输入参数值 */
  defaultInputs?: Record<string, unknown>;
  /** 控制流配置 */
  controlFlow?: ControlFlowConfig;
  /** 可视化配置 */
  visualization?: VisualizationConfig;
}

/**
 * 将 React Flow 状态序列化为 API 格式的流程定义
 *
 * @param nodes - React Flow 节点列表
 * @param edges - React Flow 边列表
 * @param inputBindings - 流程输入绑定
 * @param outputBindings - 流程输出绑定
 * @param options - 可选的额外配置（control_flow, default_inputs, visualization）
 * @returns API 格式的流程定义
 */
export function serializeToWorkflow(
  nodes: Node[],
  edges: Edge[],
  inputBindings: InputBinding[],
  outputBindings: OutputBinding[],
  options?: SerializeOptions,
): WorkflowDefinition {
  const definition: WorkflowDefinition = {
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
    inputs: serializeInputBindings(inputBindings),
    outputs: serializeOutputBindings(outputBindings),
  };

  // 添加可选配置
  if (options?.defaultInputs && Object.keys(options.defaultInputs).length > 0) {
    definition.default_inputs = options.defaultInputs;
  }
  if (options?.controlFlow) {
    definition.control_flow = options.controlFlow;
  }
  if (options?.visualization) {
    definition.visualization = options.visualization;
  }

  return definition;
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
 *
 * 保留增强字段：type, required, description, default, latex_name, paper_ref
 */
function deserializeInputBindings(inputs: WorkflowInput[]): InputBinding[] {
  return inputs.map((input) => {
    const result: InputBinding = {
      name: input.name,
      nodeId: input.bind_to.node,
      port: input.bind_to.port,
    };

    // 保留可选字段
    if (input.type) { result.type = input.type; }
    if (input.required !== undefined) { result.required = input.required; }
    if (input.description) { result.description = input.description; }
    if (input.default) { result.default = input.default; }
    if (input.latex_name) { result.latex_name = input.latex_name; }
    if (input.paper_ref) { result.paper_ref = input.paper_ref; }

    return result;
  });
}

/**
 * 将 API 格式的输出绑定转换为前端格式
 *
 * 保留增强字段：type, description, source_type, latex_name
 * 支持两种来源格式：节点端口 和 累加器
 */
function deserializeOutputBindings(outputs: WorkflowOutput[]): OutputBinding[] {
  return outputs.map((output) => {
    const result: OutputBinding = {
      name: output.name,
    };

    // 根据 bind_from 格式设置来源
    if ('accumulator' in output.bind_from) {
      result.accumulator = output.bind_from.accumulator;
      result.source_type = 'accumulator';
    } else {
      result.nodeId = output.bind_from.node;
      result.port = output.bind_from.port;
      result.source_type = 'node';
    }

    // 覆盖 source_type（如果 API 明确指定）
    if (output.source_type) { result.source_type = output.source_type; }

    // 保留其他可选字段
    if (output.type) { result.type = output.type; }
    if (output.description) { result.description = output.description; }
    if (output.latex_name) { result.latex_name = output.latex_name; }

    return result;
  });
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
    // 检查是否是节点端口绑定（有 node 属性）还是累加器绑定（有 accumulator 属性）
    if ('node' in output.bind_from && output.bind_from.node) {
      if (!nodeIds.has(output.bind_from.node)) {
        errors.push(
          `输出 ${output.name} 绑定了不存在的节点: ${output.bind_from.node}`,
        );
      }
    }
    // 累加器绑定不需要验证节点存在性
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
