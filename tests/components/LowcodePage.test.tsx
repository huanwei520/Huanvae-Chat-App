/**
 * 低代码编辑器页面组件测试
 *
 * 测试内容：
 * - 组件模块存在性
 * - 导出完整性
 *
 * @module tests/components/LowcodePage
 */

import { describe, it, expect } from 'vitest';
import LowcodePage from '../../src/lowcode/LowcodePage';
import { FlowCanvas } from '../../src/lowcode/components/FlowCanvas';
import { ControlFlowDialog } from '../../src/lowcode/components/ControlFlowDialog';
import { ExecuteDialog } from '../../src/lowcode/components/ExecuteDialog';
import { OperatorPanel } from '../../src/lowcode/components/OperatorPanel';
import { EdgeConditionEditor } from '../../src/lowcode/components/EdgeConditionEditor';
import { ErrorHandlingDialog } from '../../src/lowcode/components/ErrorHandlingDialog';
import { VirtualNode, nodeTypes } from '../../src/lowcode/components/OperatorNode';

describe('LowcodePage', () => {
  it('should be a valid React component', () => {
    expect(typeof LowcodePage).toBe('function');
  });

  it('should have displayName or name', () => {
    // React 函数组件有 name 属性
    expect(LowcodePage.name).toBe('LowcodePage');
  });
});

describe('FlowCanvas', () => {
  it('should be a valid React component', () => {
    expect(typeof FlowCanvas).toBe('function');
  });

  it('should have displayName or name', () => {
    expect(FlowCanvas.name).toBe('FlowCanvas');
  });
});

describe('ControlFlowDialog', () => {
  it('should be a valid React memo component', () => {
    // memo() wraps the component in an object with $$typeof
    expect(ControlFlowDialog).toBeDefined();
    expect(typeof ControlFlowDialog).toBe('object');
    expect((ControlFlowDialog as { $$typeof?: symbol }).$$typeof).toBeDefined();
  });
});

describe('ExecuteDialog', () => {
  it('should be a valid React memo component', () => {
    expect(ExecuteDialog).toBeDefined();
    expect(typeof ExecuteDialog).toBe('object');
    expect((ExecuteDialog as { $$typeof?: symbol }).$$typeof).toBeDefined();
  });
});

describe('OperatorPanel', () => {
  it('should be a valid React component', () => {
    expect(typeof OperatorPanel).toBe('function');
  });
});

describe('EdgeConditionEditor', () => {
  it('should be a valid React memo component', () => {
    expect(EdgeConditionEditor).toBeDefined();
    expect(typeof EdgeConditionEditor).toBe('object');
    expect((EdgeConditionEditor as { $$typeof?: symbol }).$$typeof).toBeDefined();
  });
});

describe('ErrorHandlingDialog', () => {
  it('should be a valid React memo component', () => {
    expect(ErrorHandlingDialog).toBeDefined();
    expect(typeof ErrorHandlingDialog).toBe('object');
    expect((ErrorHandlingDialog as { $$typeof?: symbol }).$$typeof).toBeDefined();
  });
});

describe('VirtualNode', () => {
  it('should be a valid React memo component', () => {
    expect(VirtualNode).toBeDefined();
    expect(typeof VirtualNode).toBe('object');
    expect((VirtualNode as { $$typeof?: symbol }).$$typeof).toBeDefined();
  });
});

describe('nodeTypes', () => {
  it('should include virtual node type', () => {
    expect(nodeTypes).toBeDefined();
    expect(nodeTypes.virtual).toBe(VirtualNode);
  });

  it('should include all required node types', () => {
    expect(nodeTypes.operator).toBeDefined();
    expect(nodeTypes.formula).toBeDefined();
    expect(nodeTypes.equation_network).toBeDefined();
    expect(nodeTypes.virtual).toBeDefined();
  });
});

describe('lowcode module exports', () => {
  it('should export LowcodePage from index', async () => {
    const module = await import('../../src/lowcode/index');
    expect(module.LowcodePage).toBeDefined();
    expect(typeof module.LowcodePage).toBe('function');
  });

  it('should export API functions from index', async () => {
    const module = await import('../../src/lowcode/index');
    expect(typeof module.openLowcodeWindow).toBe('function');
    expect(typeof module.saveLowcodeData).toBe('function');
    expect(typeof module.loadLowcodeData).toBe('function');
    expect(typeof module.clearLowcodeData).toBe('function');
  });
});
