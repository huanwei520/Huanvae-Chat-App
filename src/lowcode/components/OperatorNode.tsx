/**
 * 算子节点组件
 *
 * 在 React Flow 画布中显示的自定义节点
 * 支持输入/输出端口连接
 *
 * 节点类型：
 * - operator: 运算符（圆角矩形）
 * - formula: 公式（矩形，默认）
 * - equation_network: 方程网络（菱形）
 *
 * @module lowcode/components/OperatorNode
 * @updated 2026-01-26 添加多节点类型支持
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

/**
 * 节点类型映射
 *
 * 所有类型使用相同的组件，通过 CSS 类名区分样式
 * - operator: 运算符（圆角矩形）
 * - formula: 公式（矩形，默认）
 * - equation_network: 方程网络（菱形边框）
 */
export const nodeTypes = {
  operator: OperatorNode,
  formula: OperatorNode,
  equation_network: OperatorNode,
};
