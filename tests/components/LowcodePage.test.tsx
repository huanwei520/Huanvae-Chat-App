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
