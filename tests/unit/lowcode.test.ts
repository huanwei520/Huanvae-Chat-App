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
import {
  serializeToWorkflow,
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
});
