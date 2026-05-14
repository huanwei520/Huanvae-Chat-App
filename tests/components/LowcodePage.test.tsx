/**
 * 低代码编辑器页面组件测试
 *
 * 测试范围：barrel 导出契约 + memo 包装契约
 *
 * 不测：
 * - 组件 displayName / name（TS 编译期已推断，运行时 expect 永真，属于 A 类假测试）
 * - 与 tests/unit/lowcode.test.ts 重复的 4 个 API 函数 typeof 检查（F 类重复覆盖）
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
import { DynamicOperatorDialog } from '../../src/lowcode/components/DynamicOperatorDialog';
import { Toolbar } from '../../src/lowcode/components/Toolbar';
import { ConfirmDialog, useConfirmDialog } from '../../src/lowcode/components/ConfirmDialog';

describe('非 memo 组件 / hook 导出契约', () => {
  it.each([
    ['LowcodePage', LowcodePage],
    ['FlowCanvas', FlowCanvas],
    ['OperatorPanel', OperatorPanel],
    ['useConfirmDialog', useConfirmDialog],
  ] as const)('%s 是函数（普通组件 / hook）', (_name, fn) => {
    expect(typeof fn).toBe('function');
  });
});

describe('memo 组件 $$typeof 契约', () => {
  // 误删 memo() 会让 $$typeof 从 Symbol.for('react.memo') 变为 undefined（普通函数组件没有 $$typeof）。
  // 父组件因此失去 React.memo bail-out 优化，状态不变时仍重渲染。
  // 用精确 Symbol 断言替代 toBeDefined()，让本测试在 memo 包装被误删时真正能 fail。
  it.each([
    ['ControlFlowDialog', ControlFlowDialog],
    ['ExecuteDialog', ExecuteDialog],
    ['EdgeConditionEditor', EdgeConditionEditor],
    ['ErrorHandlingDialog', ErrorHandlingDialog],
    ['VirtualNode', VirtualNode],
    ['DynamicOperatorDialog', DynamicOperatorDialog],
    ['Toolbar', Toolbar],
    ['ConfirmDialog', ConfirmDialog],
  ] as const)('%s 被 React.memo 包装', (_name, comp) => {
    expect((comp as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('nodeTypes 注册表', () => {
  it('包含 virtual / operator / formula / equation_network 四种节点类型', () => {
    expect(nodeTypes.virtual).toBe(VirtualNode);
    expect(nodeTypes.operator).toBeDefined();
    expect(nodeTypes.formula).toBeDefined();
    expect(nodeTypes.equation_network).toBeDefined();
  });
});

describe('lowcode 模块 barrel 导出', () => {
  // 仅验证 src/lowcode/index.ts 是否漏 re-export LowcodePage 主组件。
  // API 函数（openLowcodeWindow / saveLowcodeData 等）的 typeof 检查在
  // tests/unit/lowcode.test.ts 中独立覆盖，此处不重复以避免 F 类重复覆盖。
  it('re-export LowcodePage 主组件', async () => {
    const module = await import('../../src/lowcode/index');
    expect(typeof module.LowcodePage).toBe('function');
  });
});
