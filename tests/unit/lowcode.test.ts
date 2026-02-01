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
});
