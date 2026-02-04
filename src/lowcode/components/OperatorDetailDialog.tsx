/**
 * 算子详情对话框
 *
 * 显示算子的完整信息，包括输入/输出端口、LaTeX 公式、论文引用等
 *
 * @module lowcode/components/OperatorDetailDialog
 * @created 2026-02-02
 */

import { memo } from 'react';
import { MathFormula } from './MathFormula';
import type { Operator, OperatorInput, OperatorOutput } from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

interface OperatorDetailDialogProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 算子数据 */
  operator: Operator | null;
}

// ============================================================================
// 辅助函数
// ============================================================================

function getTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    string: '字符串',
    number: '数字',
    boolean: '布尔值',
    object: '对象',
    array: '数组',
  };
  return labels[type || ''] || type || '未知';
}

function getOperatorTypeLabel(type?: string): string {
  switch (type) {
    case 'operator':
      return '运算符';
    case 'formula':
      return '公式';
    case 'equation_network':
      return '方程网络';
    default:
      return '公式';
  }
}

// ============================================================================
// 端口信息组件
// ============================================================================

interface PortDetailProps {
  port: OperatorInput | OperatorOutput;
  type: 'input' | 'output';
}

function PortDetail({ port, type }: PortDetailProps) {
  const isInput = type === 'input';
  const inputPort = port as OperatorInput;

  return (
    <div className="operator-detail-port">
      <div className="port-detail-header">
        <span className="port-detail-name">{port.name}</span>
        <span className="port-detail-type">{getTypeLabel(port.data_type || port.type)}</span>
        {isInput && inputPort.required && (
          <span className="port-detail-required">必填</span>
        )}
      </div>

      {port.description && (
        <div className="port-detail-desc">{port.description}</div>
      )}

      <div className="port-detail-meta">
        {port.latex_name && (
          <div className="port-detail-latex">
            <span className="meta-label">LaTeX:</span>
            <MathFormula latex={port.latex_name} inline />
          </div>
        )}

        {isInput && inputPort.paper_ref && (
          <div className="port-detail-paper-ref">
            <span className="meta-label">论文引用:</span>
            <span>{inputPort.paper_ref}</span>
          </div>
        )}

        {isInput && inputPort.default_value !== undefined && (
          <div className="port-detail-default">
            <span className="meta-label">默认值:</span>
            <code>{JSON.stringify(inputPort.default_value)}</code>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function OperatorDetailDialogComponent({
  isOpen,
  onClose,
  operator,
}: OperatorDetailDialogProps) {
  if (!isOpen || !operator) { return null; }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog operator-detail-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>算子详情</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* 基本信息 */}
          <div className="operator-detail-section">
            <h3>基本信息</h3>
            <div className="operator-detail-info">
              <div className="info-row">
                <span className="info-label">名称</span>
                <span className="info-value">{operator.name}</span>
              </div>
              <div className="info-row">
                <span className="info-label">ID</span>
                <code className="info-value">{operator.id}</code>
              </div>
              <div className="info-row">
                <span className="info-label">分类</span>
                <span className="info-value">{operator.category}</span>
              </div>
              {operator.version && (
                <div className="info-row">
                  <span className="info-label">版本</span>
                  <span className="info-value">{operator.version}</span>
                </div>
              )}
              {operator.operator_type && (
                <div className="info-row">
                  <span className="info-label">类型</span>
                  <span className="info-value operator-type-badge">
                    {getOperatorTypeLabel(operator.operator_type)}
                  </span>
                </div>
              )}
            </div>

            {operator.description && (
              <div className="operator-detail-desc">
                <strong>描述:</strong> {operator.description}
              </div>
            )}
          </div>

          {/* LaTeX 公式 */}
          {operator.latex_formula && (
            <div className="operator-detail-section">
              <h3>数学公式</h3>
              <div className="operator-detail-formula">
                <MathFormula latex={operator.latex_formula} />
              </div>
            </div>
          )}

          {/* 输入端口 */}
          {operator.inputs.length > 0 && (
            <div className="operator-detail-section">
              <h3>输入端口 ({operator.inputs.length})</h3>
              <div className="operator-detail-ports">
                {operator.inputs.map((input) => (
                  <PortDetail key={input.name} port={input} type="input" />
                ))}
              </div>
            </div>
          )}

          {/* 输出端口 */}
          {operator.outputs.length > 0 && (
            <div className="operator-detail-section">
              <h3>输出端口 ({operator.outputs.length})</h3>
              <div className="operator-detail-ports">
                {operator.outputs.map((output) => (
                  <PortDetail key={output.name} port={output} type="output" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="dialog-btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export const OperatorDetailDialog = memo(OperatorDetailDialogComponent);
export default OperatorDetailDialog;
