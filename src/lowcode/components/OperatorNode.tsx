/**
 * 算子节点组件
 *
 * 在 React Flow 画布中显示的自定义节点
 * 支持输入/输出端口连接
 *
 * 节点类型：
 * - operator: 运算符（圆角矩形）
 * - formula: 公式（矩形，默认）
 * - equation_network: 方程网络（菱形边框）
 * - virtual: 虚拟节点（_input 工作流输入广播 / _virtual 累加器与状态变量来源）
 *
 * @module lowcode/components/OperatorNode
 * @updated 2026-01-26 添加多节点类型支持
 * @updated 2026-02-06 添加虚拟节点组件（VirtualNode），支持 _input / _virtual 来源渲染
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Operator } from '../types/lowcode';
import { MathFormula } from './MathFormula';

// ============================================================================
// 类型定义
// ============================================================================

/** 算子类型 */
export type OperatorType = 'operator' | 'formula' | 'equation_network';

export interface OperatorNodeData {
  /** 算子信息 */
  operator: Operator;
  /** 节点显示名称 */
  label?: string;
  /** 算子类型（影响节点样式） */
  operatorType?: OperatorType;
  /** LaTeX 公式 */
  latexFormula?: string;
}

// ============================================================================
// 节点组件
// ============================================================================

// ============================================================================
// 节点图标
// ============================================================================

/** 运算符图标 */
function OperatorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  );
}

/** 公式图标 */
function FormulaIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.745 3A23.933 23.933 0 003 12c0 3.183.62 6.22 1.745 9M19.5 3c.967 2.78 1.5 5.817 1.5 9s-.533 6.22-1.5 9M8.25 8.885l1.444-.89a.75.75 0 011.105.402l2.402 7.206a.75.75 0 001.105.401l1.444-.889m-8.25.75l.213.09a1.687 1.687 0 002.062-.617l4.45-6.676a1.688 1.688 0 012.062-.618l.213.09" />
    </svg>
  );
}

/** 方程网络图标 */
function EquationNetworkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  );
}

/** 根据类型获取图标 */
function getNodeIcon(type?: OperatorType) {
  switch (type) {
    case 'operator':
      return <OperatorIcon />;
    case 'equation_network':
      return <EquationNetworkIcon />;
    case 'formula':
    default:
      return <FormulaIcon />;
  }
}

/** 根据类型获取类型标签 */
function getTypeLabel(type?: OperatorType): string {
  switch (type) {
    case 'operator':
      return '运算符';
    case 'equation_network':
      return '方程网络';
    case 'formula':
    default:
      return '公式';
  }
}

// ============================================================================
// 节点组件
// ============================================================================

function OperatorNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as OperatorNodeData;
  const { operator, label, operatorType, latexFormula } = nodeData;

  // 确定节点类型（优先使用 nodeData，其次使用 operator 中的类型）
  const nodeType: OperatorType = operatorType
    || (operator as { operator_type?: OperatorType }).operator_type
    || 'formula';

  // 获取 LaTeX 公式（优先使用 nodeData，其次使用 operator 中的公式）
  const formula = latexFormula
    || (operator as { latex_formula?: string }).latex_formula;

  return (
    <div className={`operator-node operator-node--${nodeType} ${selected ? 'selected' : ''}`}>
      {/* 输入端口 */}
      <div className="node-inputs">
        {operator.inputs?.map((input, index) => (
          <div key={input.name} className="node-port input-port">
            <Handle
              type="target"
              position={Position.Left}
              id={input.name}
              style={{ top: 40 + index * 24 }}
              title={`${input.name} (${input.data_type || input.type})`}
            />
            <span className="port-label">{input.name}</span>
          </div>
        ))}
      </div>

      {/* 节点内容 */}
      <div className="node-header">
        <div className="node-icon">{getNodeIcon(nodeType)}</div>
        <div className="node-title">{label || operator.name}</div>
      </div>

      <div className="node-meta">
        <span className="node-category">{operator.category}</span>
        <span className="node-type-badge">{getTypeLabel(nodeType)}</span>
      </div>

      {/* LaTeX 公式显示 */}
      {formula && (
        <div className="node-formula">
          <MathFormula latex={formula} inline />
        </div>
      )}

      {/* 输出端口 */}
      <div className="node-outputs">
        {operator.outputs?.map((output, index) => (
          <div key={output.name} className="node-port output-port">
            <span className="port-label">{output.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.name}
              style={{ top: 40 + index * 24 }}
              title={`${output.name} (${output.data_type || output.type})`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const OperatorNode = memo(OperatorNodeComponent);

// ============================================================================
// 虚拟节点组件
// ============================================================================

/** 虚拟节点类型 */
export type VirtualNodeKind = '_input' | '_virtual';

/** 虚拟节点数据 */
export interface VirtualNodeData {
  /** 虚拟节点类型 */
  kind: VirtualNodeKind;
  /** 显示标签 */
  label: string;
  /** 输出端口列表（从边的 sourceHandle 收集） */
  ports: string[];
}

/** 虚拟节点图标 - 输入节点 */
function InputNodeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

/** 虚拟节点图标 - 虚拟/系统节点 */
function VirtualNodeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={14} height={14}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

/**
 * 虚拟节点组件
 *
 * 用于渲染 _input（工作流输入广播）和 _virtual（累加器/状态变量来源）节点
 * 比普通节点更紧凑，使用虚线边框区分
 */
function VirtualNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as VirtualNodeData;
  const { kind, label, ports } = nodeData;

  const isInput = kind === '_input';

  return (
    <div className={`virtual-node virtual-node--${kind} ${selected ? 'selected' : ''}`}>
      <div className="virtual-node-header">
        <div className="virtual-node-icon">
          {isInput ? <InputNodeIcon /> : <VirtualNodeIcon />}
        </div>
        <div className="virtual-node-label">{label}</div>
      </div>

      {/* 输出端口 */}
      <div className="virtual-node-ports">
        {ports.map((port, index) => (
          <div key={port} className="node-port output-port">
            <span className="port-label port-label-sm">{port}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port}
              style={{ top: 28 + index * 20 }}
              title={port}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const VirtualNode = memo(VirtualNodeComponent);

/**
 * 节点类型映射
 *
 * 所有类型使用相同的组件，通过 CSS 类名区分样式
 * - operator: 运算符（圆角矩形）
 * - formula: 公式（矩形，默认）
 * - equation_network: 方程网络（菱形边框）
 * - virtual: 虚拟节点（_input, _virtual）
 */
export const nodeTypes = {
  operator: OperatorNode,
  formula: OperatorNode,
  equation_network: OperatorNode,
  virtual: VirtualNode,
};
