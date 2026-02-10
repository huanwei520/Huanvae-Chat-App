/**
 * 低代码编辑器模块测试
 *
 * 测试内容：
 * - API 函数存在性
 * - 类型定义正确性
 * - 模块导出完整性
 * - 流程服务 API
 * - 序列化工具
 *
 * @module tests/unit/lowcode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openLowcodeWindow,
  saveLowcodeData,
  loadLowcodeData,
  clearLowcodeData,
} from '../../src/lowcode/api';
import { useFlowStore } from '../../src/lowcode/stores/flowStore';
import type { ConfirmDialogProps, ConfirmOptions } from '../../src/lowcode/components/ConfirmDialog';
import {
  serializeToWorkflow,
  deserializeFromWorkflow,
  validateDefinition,
  getExecutionOrder,
} from '../../src/lowcode/utils/workflowSerializer';
import type {
  LowcodeWindowData,
  Operator,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInput,
  WorkflowOutput,
  OperatorInput,
  WorkflowConfig,
  ConfigValidationResult,
  CategoryValidationResult,
  ControlFlowConfig,
  IterationInfo,
  ConditionalEdge,
  ErrorHandlingConfig,
  ExecuteOptions,
  ExecutionResult,
  AccumulatorConfig,
  StateVarConfig,
  TerminationCondition,
  NodeInputParam,
  NodeOutputParam,
  AccumulatorReference,
  OutputBindFrom,
  EdgeType,
  DynamicInitConfig,
  MonteCarloConfig,
  MonteCarloOutputFormat,
  ParameterDistribution,
  DistributionType,
  MonteCarloInfo,
  MonteCarloOutputStats,
  DynamicOperatorSource,
  UploadOperatorsResponse,
  UploadedOperatorSummary,
  UpdateOperatorResponse,
  DeleteOperatorResponse,
  DynamicOperatorSourcesResponse,
  ConnectorDefinition,
  ConservationWarning,
  WorkflowDefinition,
  BatchExecuteParams,
  ForresterBoundary,
  UploadWorkflowResponse,
} from '../../src/lowcode/types/lowcode';

describe('lowcode/api', () => {
  describe('exports', () => {
    it('should export openLowcodeWindow function', () => {
      expect(typeof openLowcodeWindow).toBe('function');
    });

    it('should export saveLowcodeData function', () => {
      expect(typeof saveLowcodeData).toBe('function');
    });

    it('should export loadLowcodeData function', () => {
      expect(typeof loadLowcodeData).toBe('function');
    });

    it('should export clearLowcodeData function', () => {
      expect(typeof clearLowcodeData).toBe('function');
    });
  });
});

describe('lowcode/stores/flowStore', () => {
  beforeEach(() => {
    // 每个测试前重置状态
    useFlowStore.getState().resetWorkflow();
  });

  it('should export useFlowStore', () => {
    expect(typeof useFlowStore).toBe('function');
  });

  it('should have initial empty state', () => {
    const state = useFlowStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });

  it('should have canvas state management functions', () => {
    const state = useFlowStore.getState();
    expect(typeof state.setNodes).toBe('function');
    expect(typeof state.setEdges).toBe('function');
    expect(typeof state.onNodesChange).toBe('function');
    expect(typeof state.onEdgesChange).toBe('function');
    expect(typeof state.onConnect).toBe('function');
    expect(typeof state.addNode).toBe('function');
    expect(typeof state.deleteNode).toBe('function');
    expect(typeof state.selectNode).toBe('function');
    expect(typeof state.clearCanvas).toBe('function');
  });

  it('should have workflow state management functions', () => {
    const state = useFlowStore.getState();
    expect(typeof state.setWorkflowId).toBe('function');
    expect(typeof state.setWorkflowName).toBe('function');
    expect(typeof state.setWorkflowDescription).toBe('function');
    expect(typeof state.addWorkflowInput).toBe('function');
    expect(typeof state.removeWorkflowInput).toBe('function');
    expect(typeof state.addWorkflowOutput).toBe('function');
    expect(typeof state.removeWorkflowOutput).toBe('function');
    expect(typeof state.markSaved).toBe('function');
    expect(typeof state.markDirty).toBe('function');
    expect(typeof state.resetWorkflow).toBe('function');
    expect(typeof state.loadWorkflow).toBe('function');
  });

  it('should have selectedEdgeId state and selectEdge/deleteEdge actions', () => {
    const state = useFlowStore.getState();
    expect(state.selectedEdgeId).toBeNull();
    expect(typeof state.selectEdge).toBe('function');
    expect(typeof state.deleteEdge).toBe('function');
  });

  it('should select and deselect edge, clearing node selection', () => {
    const { selectNode, selectEdge } = useFlowStore.getState();

    // First select a node
    selectNode('node-1');
    expect(useFlowStore.getState().selectedNodeId).toBe('node-1');

    // Select an edge - should clear node selection
    selectEdge('edge-1');
    expect(useFlowStore.getState().selectedEdgeId).toBe('edge-1');
    expect(useFlowStore.getState().selectedNodeId).toBeNull();

    // Select a node - should clear edge selection
    selectNode('node-2');
    expect(useFlowStore.getState().selectedNodeId).toBe('node-2');
    expect(useFlowStore.getState().selectedEdgeId).toBeNull();

    // Deselect edge
    selectEdge(null);
    expect(useFlowStore.getState().selectedEdgeId).toBeNull();
  });

  it('should delete edge and clear selection if deleted edge was selected', () => {
    const { setEdges, selectEdge, deleteEdge } = useFlowStore.getState();

    setEdges([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ]);
    selectEdge('e1');
    expect(useFlowStore.getState().selectedEdgeId).toBe('e1');

    deleteEdge('e1');
    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().edges[0].id).toBe('e2');
    expect(useFlowStore.getState().selectedEdgeId).toBeNull();
    expect(useFlowStore.getState().isDirty).toBe(true);
  });

  it('should track dirty state correctly', () => {
    const { setWorkflowName, markSaved, markDirty } = useFlowStore.getState();

    expect(useFlowStore.getState().isDirty).toBe(false);

    setWorkflowName('New Name');
    expect(useFlowStore.getState().isDirty).toBe(true);

    markSaved();
    expect(useFlowStore.getState().isDirty).toBe(false);

    markDirty();
    expect(useFlowStore.getState().isDirty).toBe(true);
  });

  it('should manage workflow inputs correctly', () => {
    const { addWorkflowInput, removeWorkflowInput } = useFlowStore.getState();

    addWorkflowInput('node-1', 'port-a', 'input_a');
    expect(useFlowStore.getState().workflowInputs).toHaveLength(1);
    expect(useFlowStore.getState().workflowInputs[0]).toEqual({
      nodeId: 'node-1',
      port: 'port-a',
      name: 'input_a',
    });

    removeWorkflowInput('node-1', 'port-a');
    expect(useFlowStore.getState().workflowInputs).toHaveLength(0);
  });

  it('should manage workflow outputs correctly', () => {
    const { addWorkflowOutput, removeWorkflowOutput } = useFlowStore.getState();

    addWorkflowOutput('node-1', 'port-b', 'output_b');
    expect(useFlowStore.getState().workflowOutputs).toHaveLength(1);
    expect(useFlowStore.getState().workflowOutputs[0]).toEqual({
      nodeId: 'node-1',
      port: 'port-b',
      name: 'output_b',
    });

    removeWorkflowOutput('node-1', 'port-b');
    expect(useFlowStore.getState().workflowOutputs).toHaveLength(0);
  });
});

describe('lowcode/utils/workflowSerializer', () => {
  it('should serialize empty workflow', () => {
    const result = serializeToWorkflow([], [], [], []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.inputs).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  it('should validate empty workflow with error', () => {
    const errors = validateDefinition({
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
    });
    expect(errors).toContain('流程必须至少包含一个节点');
  });

  it('should validate edge references', () => {
    const errors = validateDefinition({
      nodes: [{ id: 'n1', operator_id: 'op1' }],
      edges: [
        {
          id: 'e1',
          source: { node: 'n1', port: 'out' },
          target: { node: 'n2', port: 'in' }, // n2 不存在
        },
      ],
      inputs: [],
      outputs: [],
    });
    expect(errors.some((e) => e.includes('n2'))).toBe(true);
  });

  it('should calculate execution order', () => {
    const order = getExecutionOrder({
      nodes: [
        { id: 'n1', operator_id: 'op1' },
        { id: 'n2', operator_id: 'op2' },
        { id: 'n3', operator_id: 'op3' },
      ],
      edges: [
        { id: 'e1', source: { node: 'n1', port: 'out' }, target: { node: 'n2', port: 'in' } },
        { id: 'e2', source: { node: 'n2', port: 'out' }, target: { node: 'n3', port: 'in' } },
      ],
      inputs: [],
      outputs: [],
    });
    expect(order).toEqual(['n1', 'n2', 'n3']);
  });

  it('should serialize edge with edge_type and lag from data', () => {
    const mockOperator: Operator = {
      id: 'test.op',
      name: 'Test',
      category: 'test',
      inputs: [{ name: 'in' }],
      outputs: [{ name: 'out' }],
    };

    const nodes = [
      {
        id: 'n1',
        type: 'operator',
        position: { x: 0, y: 0 },
        data: { operator: mockOperator } as unknown as Record<string, unknown>,
      },
      {
        id: 'n2',
        type: 'operator',
        position: { x: 200, y: 0 },
        data: { operator: mockOperator } as unknown as Record<string, unknown>,
      },
    ];

    const edges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'out',
        targetHandle: 'in',
        data: { edgeType: 'state' as const, lag: 3 },
      },
    ];

    const result = serializeToWorkflow(nodes, edges, [], []);
    expect(result.edges[0].edge_type).toBe('state');
    expect(result.edges[0].lag).toBe(3);
  });

  it('should not include edge_type when data has no edgeType', () => {
    const mockOperator: Operator = {
      id: 'test.op',
      name: 'Test',
      category: 'test',
      inputs: [],
      outputs: [],
    };

    const nodes = [
      {
        id: 'n1',
        type: 'operator',
        position: { x: 0, y: 0 },
        data: { operator: mockOperator } as unknown as Record<string, unknown>,
      },
      {
        id: 'n2',
        type: 'operator',
        position: { x: 200, y: 0 },
        data: { operator: mockOperator } as unknown as Record<string, unknown>,
      },
    ];

    const edges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'out',
        targetHandle: 'in',
      },
    ];

    const result = serializeToWorkflow(nodes, edges, [], []);
    expect(result.edges[0].edge_type).toBeUndefined();
    expect(result.edges[0].lag).toBeUndefined();
  });

  it('should create virtual nodes for _input source in deserializeFromWorkflow', () => {
    const mockOperator: Operator = {
      id: 'op1',
      name: 'Op1',
      category: 'test',
      inputs: [{ name: 'T' }],
      outputs: [{ name: 'TK' }],
    };

    const definition = {
      nodes: [{ id: 'n1', operator_id: 'op1' }],
      edges: [
        {
          id: 'e-broadcast',
          source: { node: '_input', port: 'T' },
          target: { node: 'n1', port: 'T' },
          edge_type: 'broadcast' as EdgeType,
        },
      ],
      inputs: [],
      outputs: [],
    };

    const { result } = deserializeFromWorkflow(definition, [mockOperator]);

    // 应该有 2 个节点：1 个真实 + 1 个虚拟
    expect(result.nodes).toHaveLength(2);
    const virtualNode = result.nodes.find((n) => n.id === '_input');
    expect(virtualNode).toBeDefined();
    expect(virtualNode?.type).toBe('virtual');

    const vData = virtualNode?.data as unknown as { kind: string; label: string; ports: string[] };
    expect(vData.kind).toBe('_input');
    expect(vData.label).toBe('工作流输入');
    expect(vData.ports).toContain('T');
  });

  it('should create virtual nodes for _virtual source in deserializeFromWorkflow', () => {
    const mockOperator: Operator = {
      id: 'op1',
      name: 'Op1',
      category: 'test',
      inputs: [{ name: 'y' }, { name: 'z' }],
      outputs: [{ name: 'out' }],
    };

    const definition = {
      nodes: [{ id: 'n1', operator_id: 'op1' }],
      edges: [
        {
          id: 'e-acc-y',
          source: { node: '_virtual', port: '@acc.y' },
          target: { node: 'n1', port: 'y' },
          edge_type: 'accumulator_read' as EdgeType,
        },
        {
          id: 'e-state-s',
          source: { node: '_virtual', port: '@state.S' },
          target: { node: 'n1', port: 'z' },
          edge_type: 'state' as EdgeType,
          lag: 1,
        },
      ],
      inputs: [],
      outputs: [],
    };

    const { result } = deserializeFromWorkflow(definition, [mockOperator]);

    // 应该有 2 个节点：1 个真实 + 1 个 _virtual
    expect(result.nodes).toHaveLength(2);
    const virtualNode = result.nodes.find((n) => n.id === '_virtual');
    expect(virtualNode).toBeDefined();
    expect(virtualNode?.type).toBe('virtual');

    const vData = virtualNode?.data as unknown as { kind: string; label: string; ports: string[] };
    expect(vData.kind).toBe('_virtual');
    expect(vData.label).toBe('虚拟节点');
    expect(vData.ports).toContain('@acc.y');
    expect(vData.ports).toContain('@state.S');
  });

  it('should create separate virtual nodes for _input and _virtual sources', () => {
    const mockOperator: Operator = {
      id: 'op1',
      name: 'Op1',
      category: 'test',
      inputs: [{ name: 'T' }, { name: 'y' }],
      outputs: [{ name: 'out' }],
    };

    const definition = {
      nodes: [{ id: 'n1', operator_id: 'op1' }],
      edges: [
        {
          id: 'e-broadcast',
          source: { node: '_input', port: 'T' },
          target: { node: 'n1', port: 'T' },
          edge_type: 'broadcast' as EdgeType,
        },
        {
          id: 'e-acc',
          source: { node: '_virtual', port: '@acc.y' },
          target: { node: 'n1', port: 'y' },
          edge_type: 'accumulator_read' as EdgeType,
        },
      ],
      inputs: [],
      outputs: [],
    };

    const { result } = deserializeFromWorkflow(definition, [mockOperator]);

    // 应该有 3 个节点：1 个真实 + 2 个虚拟
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.filter((n) => n.type === 'virtual')).toHaveLength(2);
    expect(result.nodes.find((n) => n.id === '_input')).toBeDefined();
    expect(result.nodes.find((n) => n.id === '_virtual')).toBeDefined();
  });

  it('should not create virtual nodes when all source nodes are real', () => {
    const mockOperator: Operator = {
      id: 'op1',
      name: 'Op1',
      category: 'test',
      inputs: [{ name: 'in' }],
      outputs: [{ name: 'out' }],
    };

    const definition = {
      nodes: [
        { id: 'n1', operator_id: 'op1' },
        { id: 'n2', operator_id: 'op1' },
      ],
      edges: [
        {
          id: 'e-data',
          source: { node: 'n1', port: 'out' },
          target: { node: 'n2', port: 'in' },
        },
      ],
      inputs: [],
      outputs: [],
    };

    const { result } = deserializeFromWorkflow(definition, [mockOperator]);

    // 应只有 2 个真实节点，无虚拟节点
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.filter((n) => n.type === 'virtual')).toHaveLength(0);
  });

  it('should filter out virtual nodes when serializing back', () => {
    const mockOperator: Operator = {
      id: 'op1',
      name: 'Op1',
      category: 'test',
      inputs: [{ name: 'T' }],
      outputs: [{ name: 'out' }],
    };

    const nodes = [
      {
        id: 'n1',
        type: 'operator',
        position: { x: 0, y: 0 },
        data: { operator: mockOperator } as unknown as Record<string, unknown>,
      },
      {
        id: '_input',
        type: 'virtual',
        position: { x: -200, y: 0 },
        data: { kind: '_input', label: '工作流输入', ports: ['T'] } as unknown as Record<string, unknown>,
      },
    ];

    const edges = [
      {
        id: 'e1',
        source: '_input',
        target: 'n1',
        sourceHandle: 'T',
        targetHandle: 'T',
        data: { edgeType: 'broadcast' },
      },
    ];

    const result = serializeToWorkflow(nodes, edges, [], []);
    // 序列化时应该过滤掉虚拟节点
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('n1');
    // 边仍保留（后端需要）
    expect(result.edges).toHaveLength(1);
  });

  it('should allow _virtual/_input in validateDefinition without errors', () => {
    const errors = validateDefinition({
      nodes: [{ id: 'n1', operator_id: 'op1' }],
      edges: [
        {
          id: 'e1',
          source: { node: '_input', port: 'T' },
          target: { node: 'n1', port: 'T' },
          edge_type: 'broadcast' as EdgeType,
        },
        {
          id: 'e2',
          source: { node: '_virtual', port: '@acc.y' },
          target: { node: 'n1', port: 'y' },
          edge_type: 'accumulator_read' as EdgeType,
        },
      ],
      inputs: [],
      outputs: [],
    });

    // 不应有关于 _input 或 _virtual 不存在的错误
    expect(errors.filter((e) => e.includes('_input') || e.includes('_virtual'))).toHaveLength(0);
  });
});

describe('lowcode/types', () => {
  it('should have correct LowcodeWindowData structure', () => {
    const data: LowcodeWindowData = {
      userId: 'user',
      serverUrl: 'http://localhost',
      accessToken: 'token',
      refreshToken: 'refresh_token',
    };

    expect(data.userId).toBe('user');
    expect(data.serverUrl).toBe('http://localhost');
    expect(data.accessToken).toBe('token');
    expect(data.refreshToken).toBe('refresh_token');
  });

  it('should have correct Operator structure', () => {
    const operator: Operator = {
      id: 'test.op',
      name: 'Test Operator',
      category: 'test',
      inputs: [{ name: 'input1', data_type: 'string', required: true }],
      outputs: [{ name: 'output1', data_type: 'number' }],
    };

    expect(operator.id).toBe('test.op');
    expect(operator.inputs).toHaveLength(1);
    expect(operator.outputs).toHaveLength(1);
  });

  it('should have correct WorkflowNode structure', () => {
    const node: WorkflowNode = {
      id: 'node-1',
      operator_id: 'test.op',
      position: { x: 100, y: 200 },
    };

    expect(node.id).toBe('node-1');
    expect(node.operator_id).toBe('test.op');
    expect(node.position).toEqual({ x: 100, y: 200 });
  });

  it('should have correct WorkflowEdge structure', () => {
    const edge: WorkflowEdge = {
      id: 'edge-1',
      source: { node: 'node-1', port: 'output1' },
      target: { node: 'node-2', port: 'input1' },
    };

    expect(edge.id).toBe('edge-1');
    expect(edge.source.node).toBe('node-1');
    expect(edge.target.node).toBe('node-2');
  });

  it('should have correct Workflow structure', () => {
    const workflow: Workflow = {
      id: 'workflow-1',
      name: 'Test Workflow',
      definition: {
        nodes: [],
        edges: [],
        inputs: [],
        outputs: [],
      },
    };

    expect(workflow.id).toBe('workflow-1');
    expect(workflow.name).toBe('Test Workflow');
    expect(workflow.definition.nodes).toEqual([]);
  });

  it('should have correct OperatorInput with paper_ref and latex_name', () => {
    const input: OperatorInput = {
      name: 'temperature',
      data_type: 'number',
      required: true,
      description: '温度参数',
      latex_name: 'T_K',
      paper_ref: 'Eq. 3.2 in Smith et al. 2023',
      default_value: 300,
    };

    expect(input.name).toBe('temperature');
    expect(input.latex_name).toBe('T_K');
    expect(input.paper_ref).toBe('Eq. 3.2 in Smith et al. 2023');
    expect(input.default_value).toBe(300);
  });

  it('should have correct Operator with operator_type and latex_formula', () => {
    const operator: Operator = {
      id: 'thermo.heat_transfer',
      name: '热传导计算',
      category: 'thermodynamics',
      inputs: [],
      outputs: [],
      operator_type: 'formula',
      latex_formula: 'Q = kA\\frac{dT}{dx}',
    };

    expect(operator.operator_type).toBe('formula');
    expect(operator.latex_formula).toBe('Q = kA\\frac{dT}{dx}');
  });

  it('should have correct WorkflowConfig structure', () => {
    const config: WorkflowConfig = {
      name: 'Test Config',
      description: 'Test workflow configuration',
      definition: {
        nodes: [{ id: 'n1', operator_id: 'op1' }],
        edges: [],
        inputs: [],
        outputs: [],
      },
    };

    expect(config.name).toBe('Test Config');
    expect(config.definition.nodes).toHaveLength(1);
  });

  it('should have correct ConfigValidationResult structure', () => {
    const result: ConfigValidationResult = {
      is_valid: false,
      errors: ['Missing required operator'],
      warnings: ['Node position not set'],
      missing_operators: ['math.add'],
    };

    expect(result.is_valid).toBe(false);
    expect(result.errors).toContain('Missing required operator');
    expect(result.missing_operators).toContain('math.add');
  });

  it('should have correct CategoryValidationResult structure', () => {
    const result: CategoryValidationResult = {
      is_valid: true,
      errors: [],
      warnings: ['Some operators not categorized'],
      missing_operators: ['new.operator'],
      duplicate_operators: ['math.add'],
    };

    expect(result.is_valid).toBe(true);
    expect(result.duplicate_operators).toContain('math.add');
  });

  it('should have correct ControlFlowConfig structure', () => {
    const config: ControlFlowConfig = {
      execution_mode: 'iterative',
      iteration: {
        time_series_inputs: ['prices', 'volumes'],
        accumulators: [
          {
            name: 'total_value',
            source_node: 'calc_node',
            source_port: 'value',
            operation: 'sum',
            initial_value: 0,
          },
        ],
        state_vars: [
          {
            name: 'prev_price',
            source_node: 'calc_node',
            source_port: 'price',
            initial_value: 0,
            lag: 1,
          },
        ],
        termination: {
          condition: {
            type: 'fixed_iterations',
            iterations: 100,
          },
        },
      },
    };

    expect(config.execution_mode).toBe('iterative');
    expect(config.iteration?.time_series_inputs).toContain('prices');
    expect(config.iteration?.accumulators).toHaveLength(1);
    expect(config.iteration?.state_vars).toHaveLength(1);
    expect(config.iteration?.termination.condition.type).toBe('fixed_iterations');
  });

  it('should have correct IterationInfo structure', () => {
    const info: IterationInfo = {
      total_iterations: 50,
      accumulators: {
        total_value: 12500.5,
        count: 50,
      },
      termination_reason: 'fixed_iterations',
      terminated_at_index: 49,
    };

    expect(info.total_iterations).toBe(50);
    expect(info.accumulators.total_value).toBe(12500.5);
    expect(info.termination_reason).toBe('fixed_iterations');
  });

  it('should have correct ConditionalEdge structure', () => {
    const edge: ConditionalEdge = {
      edge_id: 'edge-1',
      condition: {
        type: 'compare',
        left: { type: 'node_output', node: 'node-1', port: 'result' },
        op: 'gt',
        right: { type: 'literal', value: 100 },
      },
    };

    expect(edge.edge_id).toBe('edge-1');
    expect(edge.condition.type).toBe('compare');
    expect(edge.condition.left?.type).toBe('node_output');
    expect(edge.condition.op).toBe('gt');
  });

  it('should have correct ErrorHandlingConfig structure', () => {
    const config: ErrorHandlingConfig = {
      retry: {
        max_attempts: 3,
        delay_ms: 1000,
        backoff_multiplier: 2,
        max_delay_ms: 30000,
      },
      continue_on_error: true,
      node_handlers: [
        {
          node_id: 'node-1',
          retry: { max_attempts: 5, delay_ms: 500 },
          fallback_node: 'fallback-node',
          ignore_error: false,
        },
      ],
    };

    expect(config.retry?.max_attempts).toBe(3);
    expect(config.continue_on_error).toBe(true);
    expect(config.node_handlers).toHaveLength(1);
    expect(config.node_handlers?.[0].fallback_node).toBe('fallback-node');
  });

  it('should have correct ExecuteOptions structure', () => {
    const options: ExecuteOptions = {
      trace: true,
      timeout_ms: 30000,
      parallel: true,
    };

    expect(options.trace).toBe(true);
    expect(options.parallel).toBe(true);
    expect(options.timeout_ms).toBe(30000);
  });

  it('should have correct ExecutionResult with iteration_info', () => {
    const result: ExecutionResult = {
      execution_id: 'exec-123',
      status: 'completed',
      outputs: { result: 42 },
      trace: [],
      error: null,
      total_duration_ms: 1500,
      iteration_info: {
        total_iterations: 10,
        accumulators: { sum: 100 },
        termination_reason: 'accumulator_threshold',
      },
    };

    expect(result.execution_id).toBe('exec-123');
    expect(result.iteration_info?.total_iterations).toBe(10);
    expect(result.iteration_info?.accumulators.sum).toBe(100);
  });

  it('should have correct AccumulatorConfig structure', () => {
    const acc: AccumulatorConfig = {
      name: 'running_total',
      source_node: 'sum_node',
      source_port: 'output',
      operation: 'average',
      initial_value: 0,
    };

    expect(acc.name).toBe('running_total');
    expect(acc.operation).toBe('average');
    expect(acc.initial_value).toBe(0);
  });

  it('should have correct StateVarConfig structure', () => {
    const sv: StateVarConfig = {
      name: 'previous_value',
      source_node: 'calc_node',
      source_port: 'value',
      initial_value: 0,
      lag: 2,
    };

    expect(sv.name).toBe('previous_value');
    expect(sv.lag).toBe(2);
  });

  it('should have correct TerminationCondition structure for accumulator_threshold', () => {
    // 后端格式：termination.condition 包装条件表达式
    const term: TerminationCondition = {
      condition: {
        type: 'accumulator_threshold',
        name: 'total', // 使用 name 而不是 accumulator_name
        threshold: 1000,
        op: 'gte',
      },
    };

    expect(term.condition.type).toBe('accumulator_threshold');
    expect(term.condition.name).toBe('total');
    expect(term.condition.threshold).toBe(1000);
    expect(term.condition.op).toBe('gte');
  });

  // =====================================================
  // 新增：增强字段测试
  // =====================================================

  it('should have correct WorkflowInput with enhanced fields', () => {
    const workflowInput: WorkflowInput = {
      name: 'temperature',
      bind_to: { node: 'temp_node', port: 'T' },
      type: 'Array<Number>',
      required: true,
      description: '小时温度序列(摄氏度)',
      default: '[]',
      latex_name: 'T',
      paper_ref: '原始温度输入，单位摄氏度',
    };

    expect(workflowInput.name).toBe('temperature');
    expect(workflowInput.bind_to.node).toBe('temp_node');
    expect(workflowInput.bind_to.port).toBe('T');
    expect(workflowInput.type).toBe('Array<Number>');
    expect(workflowInput.required).toBe(true);
    expect(workflowInput.description).toBe('小时温度序列(摄氏度)');
    expect(workflowInput.default).toBe('[]');
    expect(workflowInput.latex_name).toBe('T');
    expect(workflowInput.paper_ref).toBe('原始温度输入，单位摄氏度');
  });

  it('should have correct WorkflowOutput with node port source', () => {
    const workflowOutput: WorkflowOutput = {
      name: 'bloom_reached',
      bind_from: { node: 'stage_check', port: 'reached' },
      type: 'Boolean',
      description: '是否达到初花期',
      source_type: 'node',
      latex_name: 'B',
    };

    expect(workflowOutput.name).toBe('bloom_reached');
    expect('node' in workflowOutput.bind_from).toBe(true);
    if ('node' in workflowOutput.bind_from) {
      expect(workflowOutput.bind_from.node).toBe('stage_check');
      expect(workflowOutput.bind_from.port).toBe('reached');
    }
    expect(workflowOutput.type).toBe('Boolean');
    expect(workflowOutput.description).toBe('是否达到初花期');
    expect(workflowOutput.source_type).toBe('node');
    expect(workflowOutput.latex_name).toBe('B');
  });

  it('should have correct WorkflowOutput with accumulator source', () => {
    const workflowOutput: WorkflowOutput = {
      name: 'y_final',
      bind_from: { accumulator: 'y' },
      type: 'Number',
      description: '最终冷量累积(CP)',
      source_type: 'accumulator',
      latex_name: 'y',
    };

    expect(workflowOutput.name).toBe('y_final');
    expect('accumulator' in workflowOutput.bind_from).toBe(true);
    if ('accumulator' in workflowOutput.bind_from) {
      expect(workflowOutput.bind_from.accumulator).toBe('y');
    }
    expect(workflowOutput.type).toBe('Number');
    expect(workflowOutput.description).toBe('最终冷量累积(CP)');
    expect(workflowOutput.source_type).toBe('accumulator');
    expect(workflowOutput.latex_name).toBe('y');
  });

  it('should have correct AccumulatorReference structure', () => {
    const accRef: AccumulatorReference = {
      accumulator: 'z',
    };

    expect(accRef.accumulator).toBe('z');
  });

  it('should have correct OutputBindFrom union type', () => {
    // 节点端口来源
    const portRef: OutputBindFrom = { node: 'n1', port: 'out' };
    expect('node' in portRef).toBe(true);

    // 累加器来源
    const accRef: OutputBindFrom = { accumulator: 'y' };
    expect('accumulator' in accRef).toBe(true);
  });

  it('should have correct NodeInputParam structure', () => {
    const inputParam: NodeInputParam = {
      name: 'T',
      type: 'Number',
      latex_name: 'T_K',
      paper_ref: '论文公式(4)，原始温度输入',
      required: true,
    };

    expect(inputParam.name).toBe('T');
    expect(inputParam.type).toBe('Number');
    expect(inputParam.latex_name).toBe('T_K');
    expect(inputParam.paper_ref).toBe('论文公式(4)，原始温度输入');
    expect(inputParam.required).toBe(true);
  });

  it('should have correct NodeOutputParam structure', () => {
    const outputParam: NodeOutputParam = {
      name: 'TK',
      type: 'Number',
      latex_name: 'T_K',
    };

    expect(outputParam.name).toBe('TK');
    expect(outputParam.type).toBe('Number');
    expect(outputParam.latex_name).toBe('T_K');
  });

  it('should have correct WorkflowNode with enhanced fields', () => {
    const node: WorkflowNode = {
      id: 'gdh',
      operator_id: 'phenoflex.gdh',
      position: { x: 600, y: 300 },
      name: 'GDH响应函数',
      type: 'equation_network',
      latex_formula: 'GDH = \\begin{cases} ... \\end{cases}',
    };

    expect(node.id).toBe('gdh');
    expect(node.operator_id).toBe('phenoflex.gdh');
    expect(node.name).toBe('GDH响应函数');
    expect(node.type).toBe('equation_network');
    expect(node.latex_formula).toBe('GDH = \\begin{cases} ... \\end{cases}');
  });

  it('should have correct WorkflowNode with input_params and output_params', () => {
    const node: WorkflowNode = {
      id: 'temp_kelvin',
      operator_id: 'phenoflex.temp_kelvin',
      position: { x: 100, y: 100 },
      name: '温度转开尔文',
      type: 'formula',
      latex_formula: 'T_K = T + 273',
      input_params: [
        { name: 'T', type: 'Number', latex_name: 'T', paper_ref: '原始温度输入', required: true },
      ],
      output_params: [
        { name: 'TK', type: 'Number', latex_name: 'T_K' },
      ],
    };

    expect(node.input_params).toHaveLength(1);
    expect(node.input_params![0].name).toBe('T');
    expect(node.input_params![0].latex_name).toBe('T');
    expect(node.input_params![0].paper_ref).toBe('原始温度输入');
    expect(node.input_params![0].required).toBe(true);

    expect(node.output_params).toHaveLength(1);
    expect(node.output_params![0].name).toBe('TK');
    expect(node.output_params![0].latex_name).toBe('T_K');
  });

  // =====================================================
  // 新增：EdgeType 类型测试
  // =====================================================

  it('should have correct EdgeType variants', () => {
    const data: EdgeType = 'data';
    const state: EdgeType = 'state';
    const accRead: EdgeType = 'accumulator_read';
    const broadcast: EdgeType = 'broadcast';

    expect(data).toBe('data');
    expect(state).toBe('state');
    expect(accRead).toBe('accumulator_read');
    expect(broadcast).toBe('broadcast');
  });

  it('should have correct WorkflowEdge with edge_type and lag', () => {
    const edge: WorkflowEdge = {
      id: 'edge-state-1',
      source: { node: 'node-1', port: 'output' },
      target: { node: 'node-2', port: 'input' },
      edge_type: 'state',
      lag: 2,
    };

    expect(edge.edge_type).toBe('state');
    expect(edge.lag).toBe(2);
  });

  it('should allow WorkflowEdge without edge_type and lag (defaults)', () => {
    const edge: WorkflowEdge = {
      id: 'edge-data-1',
      source: { node: 'n1', port: 'out' },
      target: { node: 'n2', port: 'in' },
    };

    expect(edge.edge_type).toBeUndefined();
    expect(edge.lag).toBeUndefined();
  });

  // =====================================================
  // 新增：DynamicInitConfig 类型测试
  // =====================================================

  it('should have correct DynamicInitConfig structure', () => {
    const dynInit: DynamicInitConfig = {
      source_node: 'init_node',
      source_port: 'initial_value',
    };

    expect(dynInit.source_node).toBe('init_node');
    expect(dynInit.source_port).toBe('initial_value');
  });

  it('should have correct StateVarConfig with dynamic_init', () => {
    const sv: StateVarConfig = {
      name: 'prev_price',
      source_node: 'calc_node',
      source_port: 'price',
      initial_value: 0,
      lag: 1,
      dynamic_init: {
        source_node: 'init_node',
        source_port: 'first_price',
      },
    };

    expect(sv.dynamic_init).toBeDefined();
    expect(sv.dynamic_init?.source_node).toBe('init_node');
    expect(sv.dynamic_init?.source_port).toBe('first_price');
  });

  // =====================================================
  // 新增：Monte Carlo 类型测试
  // =====================================================

  it('should have correct DistributionType variants', () => {
    const types: DistributionType[] = [
      'normal', 'log_normal', 'uniform', 'truncated_normal',
      'triangular', 'beta', 'gamma', 'fixed',
    ];

    expect(types).toHaveLength(8);
    expect(types).toContain('normal');
    expect(types).toContain('fixed');
  });

  it('should have correct ParameterDistribution structure', () => {
    const dist: ParameterDistribution = {
      name: 'temperature',
      distribution: 'normal',
      params: { mean: 25, std: 5 },
    };

    expect(dist.name).toBe('temperature');
    expect(dist.distribution).toBe('normal');
    expect(dist.params.mean).toBe(25);
    expect(dist.params.std).toBe(5);
  });

  it('should have correct MonteCarloOutputFormat structure', () => {
    const format: MonteCarloOutputFormat = {
      percentiles: [5, 25, 50, 75, 95],
      raw_samples: false,
      histogram_bins: 50,
    };

    expect(format.percentiles).toEqual([5, 25, 50, 75, 95]);
    expect(format.raw_samples).toBe(false);
    expect(format.histogram_bins).toBe(50);
  });

  it('should have correct MonteCarloConfig structure', () => {
    const config: MonteCarloConfig = {
      samples: 10000,
      seed: 42,
      parallel: true,
      output_format: {
        percentiles: [5, 50, 95],
        raw_samples: false,
        histogram_bins: 100,
      },
      distributions: [
        { name: 'temp', distribution: 'normal', params: { mean: 25, std: 5 } },
        { name: 'humidity', distribution: 'uniform', params: { min: 30, max: 90 } },
      ],
    };

    expect(config.samples).toBe(10000);
    expect(config.seed).toBe(42);
    expect(config.parallel).toBe(true);
    expect(config.distributions).toHaveLength(2);
    expect(config.distributions[0].distribution).toBe('normal');
    expect(config.distributions[1].distribution).toBe('uniform');
  });

  it('should have correct MonteCarloInfo structure', () => {
    const info: MonteCarloInfo = {
      total_samples: 10000,
      seed: 42,
      parallel: true,
      parameter_distributions: [
        { name: 'temp', distribution: 'normal', params: { mean: 25, std: 5 } },
      ],
    };

    expect(info.total_samples).toBe(10000);
    expect(info.seed).toBe(42);
    expect(info.parallel).toBe(true);
    expect(info.parameter_distributions).toHaveLength(1);
  });

  it('should have correct MonteCarloOutputStats structure', () => {
    const stats: MonteCarloOutputStats = {
      mean: 24.87,
      std: 5.02,
      percentiles: { '5': 16.5, '50': 24.9, '95': 33.1 },
      histogram: {
        bins: [10, 15, 20, 25, 30, 35, 40],
        counts: [50, 200, 500, 480, 190, 45],
      },
    };

    expect(stats.mean).toBeCloseTo(24.87);
    expect(stats.std).toBeCloseTo(5.02);
    expect(stats.percentiles['50']).toBeCloseTo(24.9);
    expect(stats.histogram?.bins).toHaveLength(7);
    expect(stats.histogram?.counts).toHaveLength(6);
  });

  it('should have correct ControlFlowConfig with monte_carlo mode', () => {
    const config: ControlFlowConfig = {
      execution_mode: 'monte_carlo',
      monte_carlo: {
        samples: 5000,
        parallel: true,
        distributions: [
          { name: 'x', distribution: 'normal', params: { mean: 0, std: 1 } },
        ],
      },
    };

    expect(config.execution_mode).toBe('monte_carlo');
    expect(config.monte_carlo).toBeDefined();
    expect(config.monte_carlo?.samples).toBe(5000);
    expect(config.monte_carlo?.distributions).toHaveLength(1);
  });

  it('should have correct ExecutionResult with monte_carlo_info', () => {
    const result: ExecutionResult = {
      execution_id: 'mc-exec-001',
      status: 'completed',
      outputs: {
        y: {
          mean: 100,
          std: 10,
          percentiles: { '5': 83.5, '50': 100.1, '95': 116.4 },
        },
      },
      error: null,
      total_duration_ms: 5000,
      monte_carlo_info: {
        total_samples: 10000,
        seed: 42,
        parallel: true,
        parameter_distributions: [
          { name: 'x', distribution: 'normal', params: { mean: 50, std: 10 } },
        ],
      },
    };

    expect(result.execution_id).toBe('mc-exec-001');
    expect(result.monte_carlo_info).toBeDefined();
    expect(result.monte_carlo_info?.total_samples).toBe(10000);
  });
});

// ============================================================================
// 动态算子管理类型测试
// ============================================================================

describe('Dynamic Operator Management types', () => {
  it('should have correct DynamicOperatorSource structure', () => {
    const source: DynamicOperatorSource = {
      operator_id: 'custom.math.quadratic',
      module_id: 'custom.math',
      name: '二次函数',
      category: '数学函数',
      version: 2,
      updated_at: '2026-02-07T15:00:00Z',
    };

    expect(source.operator_id).toBe('custom.math.quadratic');
    expect(source.module_id).toBe('custom.math');
    expect(source.version).toBe(2);
    expect(source.updated_at).toBe('2026-02-07T15:00:00Z');
  });

  it('should have correct UploadedOperatorSummary structure', () => {
    const summary: UploadedOperatorSummary = {
      id: 'custom.math.distance',
      name: '欧氏距离',
      category: '数学函数',
    };

    expect(summary.id).toBe('custom.math.distance');
    expect(summary.name).toBe('欧氏距离');
  });

  it('should have correct UploadOperatorsResponse structure', () => {
    const resp: UploadOperatorsResponse = {
      message: '成功注册 2 个算子',
      operators: [
        { id: 'custom.math.quadratic', name: '二次函数', category: '数学函数' },
        { id: 'custom.math.distance', name: '欧氏距离', category: '数学函数' },
      ],
      count: 2,
    };

    expect(resp.count).toBe(2);
    expect(resp.operators).toHaveLength(2);
    expect(resp.operators[0].id).toBe('custom.math.quadratic');
  });

  it('should have correct UploadOperatorsResponse with conservation warnings', () => {
    const resp: UploadOperatorsResponse = {
      message: '成功注册 1 个算子',
      operators: [{ id: 'eco.carbon', name: '碳循环', category: '生态' }],
      count: 1,
      conservation_warnings: [
        {
          level: 'warning',
          node: 'atmosphere_co2',
          message: "Source boundary 'atmosphere_co2' 没有 material 出边",
        },
      ],
    };

    expect(resp.conservation_warnings).toHaveLength(1);
    expect(resp.conservation_warnings?.[0].level).toBe('warning');
    expect(resp.conservation_warnings?.[0].node).toBe('atmosphere_co2');
  });

  it('should have correct UpdateOperatorResponse structure', () => {
    const resp: UpdateOperatorResponse = {
      message: '算子 custom.math.quadratic 已更新到 v2',
      version: 2,
    };

    expect(resp.message).toContain('已更新');
    expect(resp.version).toBe(2);
  });

  it('should have correct DeleteOperatorResponse structure', () => {
    const resp: DeleteOperatorResponse = {
      message: '算子 custom.math.quadratic 已删除',
    };

    expect(resp.message).toContain('已删除');
  });

  it('should have correct DynamicOperatorSourcesResponse structure', () => {
    const resp: DynamicOperatorSourcesResponse = {
      sources: [
        {
          operator_id: 'custom.math.quadratic',
          module_id: 'custom.math',
          name: '二次函数',
          category: '数学函数',
          version: 1,
          updated_at: '2026-02-07T15:00:00Z',
        },
      ],
      total: 1,
    };

    expect(resp.total).toBe(1);
    expect(resp.sources).toHaveLength(1);
    expect(resp.sources[0].operator_id).toBe('custom.math.quadratic');
  });
});

// ============================================================================
// Connector 耦合接口类型测试
// ============================================================================

describe('Connector and Conservation types', () => {
  it('should have correct ConnectorDefinition for output', () => {
    const connector: ConnectorDefinition = {
      name: 'bloom_date',
      data_type: 'Number',
      description: '盛花期日期(JDay)',
      direction: 'out',
      remote_source: null,
    };

    expect(connector.direction).toBe('out');
    expect(connector.remote_source).toBeNull();
  });

  it('should have correct ConnectorDefinition for input with remote source', () => {
    const connector: ConnectorDefinition = {
      name: 'bloom_date',
      data_type: 'Number',
      description: '',
      direction: 'in',
      remote_source: 'phenoflex.bloom_date',
    };

    expect(connector.direction).toBe('in');
    expect(connector.remote_source).toBe('phenoflex.bloom_date');
  });

  it('should have correct ConservationWarning for warning level', () => {
    const warning: ConservationWarning = {
      level: 'warning',
      node: 'atmosphere_co2',
      message: "Source boundary 没有 material 出边",
    };

    expect(warning.level).toBe('warning');
    expect(warning.node).toBe('atmosphere_co2');
  });

  it('should have correct ConservationWarning for error level', () => {
    const err: ConservationWarning = {
      level: 'error',
      node: 'soil_carbon',
      message: '状态变量没有 material 入流',
    };

    expect(err.level).toBe('error');
  });

  it('should include connectors in WorkflowDefinition', () => {
    const def: WorkflowDefinition = {
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
      connectors: [
        {
          name: 'bloom_date',
          data_type: 'Number',
          description: '盛花期日期',
          direction: 'out',
        },
        {
          name: 'n_fruits',
          data_type: 'Number',
          description: '',
          direction: 'in',
          remote_source: 'vmapplet.n_fruits',
        },
      ],
    };

    expect(def.connectors).toHaveLength(2);
    expect(def.connectors?.[0].direction).toBe('out');
    expect(def.connectors?.[1].remote_source).toBe('vmapplet.n_fruits');
  });

  it('should support BatchExecuteParams with parallel flag', () => {
    const params: BatchExecuteParams = {
      workflow_id: 'wf-001',
      batch_inputs: [{ x: 1 }, { x: 2 }],
      parallel: true,
    };

    expect(params.parallel).toBe(true);
    expect(params.batch_inputs).toHaveLength(2);
  });
});

// ============================================================================
// 动态算子服务存在性测试
// ============================================================================

describe('dynamicOperatorService', () => {
  it('should export createDynamicOperatorService function', async () => {
    const module = await import('../../src/lowcode/services/dynamicOperatorService');
    expect(typeof module.createDynamicOperatorService).toBe('function');
  });

  it('should return an object with upload, getSources, update, remove methods', async () => {
    const module = await import('../../src/lowcode/services/dynamicOperatorService');

    // 创建 mock client
    const mockClient = {
      get: () => Promise.resolve({}),
      post: () => Promise.resolve({}),
      put: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
      getServerUrl: () => 'http://localhost',
      getAccessToken: () => 'mock-token',
    };

    const service = module.createDynamicOperatorService(mockClient as never);

    expect(typeof service.upload).toBe('function');
    expect(typeof service.getSources).toBe('function');
    expect(typeof service.update).toBe('function');
    expect(typeof service.remove).toBe('function');
  });

  it('should include uploadWorkflow method in service', async () => {
    const module = await import('../../src/lowcode/services/dynamicOperatorService');

    const mockClient = {
      get: () => Promise.resolve({}),
      post: () => Promise.resolve({}),
      put: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
      getServerUrl: () => 'http://localhost',
      getAccessToken: () => 'mock-token',
    };

    const service = module.createDynamicOperatorService(mockClient as never);

    expect(typeof service.uploadWorkflow).toBe('function');
  });
});

// ============================================================================
// Forrester 系统动力学相关类型测试
// ============================================================================

describe('Forrester types', () => {
  it('should instantiate ForresterBoundary with source kind', () => {
    const boundary: ForresterBoundary = {
      name: 'atmosphere_co2',
      kind: 'source',
      description: '大气CO2外部来源',
    };

    expect(boundary.kind).toBe('source');
    expect(boundary.name).toBe('atmosphere_co2');
    expect(boundary.description).toBe('大气CO2外部来源');
  });

  it('should instantiate ForresterBoundary with sink kind', () => {
    const boundary: ForresterBoundary = {
      name: 'river_outflow',
      kind: 'sink',
      description: '河流出水汇',
    };

    expect(boundary.kind).toBe('sink');
  });

  it('should include var_classes and boundaries in WorkflowDefinition', () => {
    const def: WorkflowDefinition = {
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
      var_classes: {
        state: ['soil_carbon', 'litter_carbon'],
        rate: ['decomposition_rate'],
        driving: ['temperature'],
        auxiliary: ['q10_factor'],
      },
      boundaries: [
        { name: 'atm_input', kind: 'source', description: '大气输入' },
        { name: 'river_output', kind: 'sink', description: '河流输出' },
      ],
    };

    expect(def.var_classes).toBeDefined();
    expect(def.var_classes?.state).toHaveLength(2);
    expect(def.var_classes?.rate).toContain('decomposition_rate');
    expect(def.boundaries).toHaveLength(2);
    expect(def.boundaries?.[0].kind).toBe('source');
    expect(def.boundaries?.[1].kind).toBe('sink');
  });
});

// ============================================================================
// UploadWorkflowResponse 类型测试
// ============================================================================

describe('UploadWorkflowResponse type', () => {
  it('should instantiate with all required fields', () => {
    const resp: UploadWorkflowResponse = {
      message: '成功上传并生成工作流',
      operators: [
        { id: 'op-1', name: '分解速率', category: '碳循环', version: 1 },
        { id: 'op-2', name: 'Q10温度系数', category: '碳循环', version: 1 },
      ],
      operator_count: 2,
      workflow: {
        id: 'wf-gen-001',
        name: '碳循环模型',
        description: '自动生成的碳循环工作流',
        version: 1,
        created_at: '2026-02-07T12:00:00Z',
      },
    };

    expect(resp.operator_count).toBe(2);
    expect(resp.operators).toHaveLength(2);
    expect(resp.workflow.id).toBe('wf-gen-001');
    expect(resp.workflow.name).toBe('碳循环模型');
    expect(resp.workflow.version).toBe(1);
    expect(resp.workflow.created_at).toBe('2026-02-07T12:00:00Z');
  });

  it('should have workflow sub-object with all fields', () => {
    const resp: UploadWorkflowResponse = {
      message: 'ok',
      operators: [],
      operator_count: 0,
      workflow: {
        id: 'wf-empty',
        name: 'Empty',
        description: '',
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    };

    expect(resp.workflow).toHaveProperty('id');
    expect(resp.workflow).toHaveProperty('name');
    expect(resp.workflow).toHaveProperty('description');
    expect(resp.workflow).toHaveProperty('version');
    expect(resp.workflow).toHaveProperty('created_at');
  });
});

// ============================================================================
// ConfirmDialog 类型测试
// ============================================================================

describe('ConfirmDialog types', () => {
  it('ConfirmDialogProps should accept required fields', () => {
    const props: ConfirmDialogProps = {
      message: '确定要执行此操作吗？',
      onConfirm: () => {},
      onCancel: () => {},
    };
    expect(props.message).toBe('确定要执行此操作吗？');
    expect(typeof props.onConfirm).toBe('function');
    expect(typeof props.onCancel).toBe('function');
  });

  it('ConfirmDialogProps should accept all optional fields', () => {
    const props: ConfirmDialogProps = {
      title: '确认删除',
      message: '此操作不可撤销',
      confirmLabel: '删除',
      cancelLabel: '取消',
      processingLabel: '删除中...',
      isDanger: true,
      isProcessing: false,
      onConfirm: () => {},
      onCancel: () => {},
    };
    expect(props.title).toBe('确认删除');
    expect(props.confirmLabel).toBe('删除');
    expect(props.cancelLabel).toBe('取消');
    expect(props.processingLabel).toBe('删除中...');
    expect(props.isDanger).toBe(true);
    expect(props.isProcessing).toBe(false);
  });

  it('ConfirmOptions should accept message and optional fields', () => {
    const options: ConfirmOptions = {
      title: '警告',
      message: '未保存的更改将丢失',
      confirmLabel: '继续',
      isDanger: false,
    };
    expect(options.title).toBe('警告');
    expect(options.message).toBe('未保存的更改将丢失');
    expect(options.confirmLabel).toBe('继续');
    expect(options.isDanger).toBe(false);
  });

  it('ConfirmOptions should work with minimal fields', () => {
    const options: ConfirmOptions = {
      message: '确认？',
    };
    expect(options.message).toBe('确认？');
    expect(options.title).toBeUndefined();
    expect(options.confirmLabel).toBeUndefined();
    expect(options.isDanger).toBeUndefined();
  });
});
