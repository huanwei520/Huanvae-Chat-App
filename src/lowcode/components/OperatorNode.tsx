/**
 * 算子节点组件
 *
 * 在 React Flow 画布中显示的自定义节点
 * 支持输入/输出端口连接
 *
 * @module lowcode/components/OperatorNode
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Operator } from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

export interface OperatorNodeData {
  /** 算子信息 */
  operator: Operator;
  /** 节点显示名称 */
  label?: string;
}

// ============================================================================
// 节点组件
// ============================================================================

function OperatorNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as OperatorNodeData;
  const { operator, label } = nodeData;

  return (
    <div className={`operator-node ${selected ? 'selected' : ''}`}>
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
        <div className="node-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width={16}
            height={16}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
            />
          </svg>
        </div>
        <div className="node-title">{label || operator.name}</div>
      </div>

      <div className="node-category">{operator.category}</div>

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

// 节点类型映射
export const nodeTypes = {
  operator: OperatorNode,
};
