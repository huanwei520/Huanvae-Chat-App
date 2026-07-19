/**
 * 低代码编辑器模块测试
 *
 * 测试内容：
 * - openLowcodeWindow 窗口行为（移动端守门 / 已有窗口去重 / URL 参数 Base64 编码）
 * - localStorage 数据传递（saveLowcodeData / loadLowcodeData / clearLowcodeData）
 * - 流程画布 store（flowStore）
 * - 工作流序列化工具（workflowSerializer）
 * - 动态算子服务（dynamicOperatorService）
 *
 * @module tests/unit/lowcode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 平台检测 mock：isMobile 有模块级缓存，必须 mock 模块本身而非 UA
const platformMock = vi.hoisted(() => ({ isMobile: vi.fn(() => false) }));
vi.mock('../../src/utils/platform', () => ({ isMobile: platformMock.isMobile }));

// WebviewWindow mock：setup.ts 的全局 mock 无静态 getByLabel，此处用带静态方法的
// 可构造 class 覆盖，并记录每次构造的实例供断言
const wvw = vi.hoisted(() => {
  const getByLabel = vi.fn();
  class FakeWebviewWindow {
    label: string;
    options: Record<string, unknown>;
    once = vi.fn();
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label;
      this.options = options;
      instances.push(this);
    }
  }
  const instances: FakeWebviewWindow[] = [];
  return { instances, getByLabel, FakeWebviewWindow };
});
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(wvw.FakeWebviewWindow, { getByLabel: wvw.getByLabel }),
}));

import {
  openLowcodeWindow,
  saveLowcodeData,
  loadLowcodeData,
  clearLowcodeData,
} from '../../src/lowcode/api';
import { useFlowStore } from '../../src/lowcode/stores/flowStore';
import {
  serializeToWorkflow,
  deserializeFromWorkflow,
  validateDefinition,
  getExecutionOrder,
} from '../../src/lowcode/utils/workflowSerializer';
import type {
  LowcodeWindowData,
  Operator,
  EdgeType,
} from '../../src/lowcode/types/lowcode';

describe('lowcode/api openLowcodeWindow', () => {
  beforeEach(() => {
    // setup.ts 的全局 beforeEach 跑 vi.clearAllMocks()，此处重置默认值 + 清空实例记录
    platformMock.isMobile.mockReturnValue(false);
    wvw.getByLabel.mockResolvedValue(null);
    wvw.instances.length = 0;
  });

  it('移动端守门：isMobile 为 true 时不查窗口也不建窗口', async () => {
    platformMock.isMobile.mockReturnValue(true);

    await openLowcodeWindow('u1', 'https://srv.example.com', 'tokA', 'tokR');

    expect(wvw.getByLabel).not.toHaveBeenCalled();
    expect(wvw.instances).toHaveLength(0);
  });

  it('已有窗口去重：getByLabel 命中时聚焦已有窗口，不再新建', async () => {
    const setFocus = vi.fn().mockResolvedValue(undefined);
    wvw.getByLabel.mockResolvedValue({ setFocus });

    await openLowcodeWindow('u1', 'https://srv.example.com', 'tokA', 'tokR');

    expect(wvw.getByLabel).toHaveBeenCalledTimes(1);
    expect(wvw.getByLabel).toHaveBeenCalledWith('lowcode-editor');
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(wvw.instances).toHaveLength(0);
  });

  it('新开窗口：URL 参数 Base64 编码可 roundtrip，配置正确并监听创建错误', async () => {
    await openLowcodeWindow('u1', 'https://srv.example.com', 'tokA', 'tokR');

    expect(wvw.instances).toHaveLength(1);
    const win = wvw.instances[0];
    expect(win.label).toBe('lowcode-editor');

    const url = win.options.url as string;
    expect(url.startsWith('/lowcode?')).toBe(true);

    const params = new URLSearchParams(url.slice('/lowcode?'.length));
    expect(params.get('userId')).toBe('u1');
    expect(atob(params.get('serverUrl') ?? '')).toBe('https://srv.example.com');
    expect(atob(params.get('accessToken') ?? '')).toBe('tokA');
    expect(atob(params.get('refreshToken') ?? '')).toBe('tokR');

    expect(win.options.dragDropEnabled).toBe(false);
    expect(win.once).toHaveBeenCalledWith('tauri://error', expect.any(Function));
  });

  it('反向断言：凭据不以明文出现在 URL query 中', async () => {
    await openLowcodeWindow('u1', 'https://srv.example.com', 'tokA', 'tokR');

    expect(wvw.instances).toHaveLength(1);
    const url = wvw.instances[0].options.url as string;
    expect(url).not.toContain('tokA');
    expect(url).not.toContain('tokR');
  });
});

describe('lowcode/api 数据传递（localStorage）', () => {
  const data: LowcodeWindowData = {
    userId: 'u1',
    serverUrl: 'https://srv.example.com',
    accessToken: 'tokA',
    refreshToken: 'tokR',
  };

  it('saveLowcodeData 以固定 key 写入 JSON 序列化数据', () => {
    saveLowcodeData(data);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'huanvae_lowcode_data',
      JSON.stringify(data),
    );
  });

  it('loadLowcodeData 解析已存在的合法 JSON', () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce(JSON.stringify(data));

    expect(loadLowcodeData()).toEqual(data);
    expect(localStorage.getItem).toHaveBeenCalledWith('huanvae_lowcode_data');
  });

  it('loadLowcodeData 无数据时返回 null', () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce(null);

    expect(loadLowcodeData()).toBeNull();
  });

  it('loadLowcodeData 遇到损坏 JSON 时返回 null', () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce('{broken');

    expect(loadLowcodeData()).toBeNull();
  });

  it('clearLowcodeData 以固定 key 删除数据', () => {
    clearLowcodeData();

    expect(localStorage.removeItem).toHaveBeenCalledWith('huanvae_lowcode_data');
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
