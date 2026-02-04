/**
 * 边条件编辑器组件
 *
 * 提供可视化的条件表达式构建器
 *
 * @module lowcode/components/EdgeConditionEditor
 */

import { memo, useState, useCallback } from 'react';
import type {
  ConditionalEdge,
  ConditionExpr,
  ConditionExprType,
  ValueRef,
  ValueRefType,
  CompareOp,
  WorkflowNode,
  AccumulatorConfig,
  StateVarConfig,
} from '../types/lowcode';

// ============================================================================
// 图标组件
// ============================================================================

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface EdgeConditionEditorProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 边 ID */
  edgeId: string;
  /** 边显示名称 */
  edgeLabel?: string;
  /** 当前条件 */
  condition?: ConditionExpr;
  /** 保存回调 */
  onSave: (edge: ConditionalEdge) => void;
  /** 删除条件回调 */
  onDelete?: () => void;
  /** 流程节点列表 */
  nodes: WorkflowNode[];
  /** 累加器列表 */
  accumulators?: AccumulatorConfig[];
  /** 状态变量列表 */
  stateVars?: StateVarConfig[];
  /** 工作流输入名称列表 */
  workflowInputs?: string[];
}

// ============================================================================
// 常量
// ============================================================================

const CONDITION_TYPES: { value: ConditionExprType; label: string }[] = [
  { value: 'compare', label: '比较' },
  { value: 'and', label: '与 (AND)' },
  { value: 'or', label: '或 (OR)' },
  { value: 'not', label: '非 (NOT)' },
  { value: 'const', label: '常量' },
];

const VALUE_REF_TYPES: { value: ValueRefType; label: string }[] = [
  { value: 'literal', label: '字面量' },
  { value: 'node_output', label: '节点输出' },
  { value: 'accumulator', label: '累加器' },
  { value: 'state_var', label: '状态变量' },
  { value: 'iteration_index', label: '迭代索引' },
  { value: 'workflow_input', label: '工作流输入' },
];

const COMPARE_OPS: { value: CompareOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
];

// ============================================================================
// 子组件：值引用编辑器
// ============================================================================

interface ValueRefEditorProps {
  value: ValueRef;
  onChange: (value: ValueRef) => void;
  nodes: WorkflowNode[];
  accumulators?: AccumulatorConfig[];
  stateVars?: StateVarConfig[];
  workflowInputs?: string[];
}

function ValueRefEditor({
  value,
  onChange,
  nodes,
  accumulators = [],
  stateVars = [],
  workflowInputs = [],
}: ValueRefEditorProps) {
  return (
    <div className="value-ref-editor">
      <select
        className="config-select"
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as ValueRefType })}
      >
        {VALUE_REF_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {value.type === 'literal' && (
        <input
          type="text"
          className="config-input"
          value={String(value.value ?? '')}
          onChange={(e) => {
            // 尝试解析数字
            const num = Number(e.target.value);
            const parsed = isNaN(num) ? e.target.value : num;
            onChange({ ...value, value: parsed });
          }}
          placeholder="值"
        />
      )}

      {value.type === 'node_output' && (
        <>
          <select
            className="config-select"
            value={value.node ?? ''}
            onChange={(e) => onChange({ ...value, node: e.target.value })}
          >
            <option value="">选择节点</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name || n.id}</option>
            ))}
          </select>
          <input
            type="text"
            className="config-input config-input-sm"
            value={value.port ?? ''}
            onChange={(e) => onChange({ ...value, port: e.target.value })}
            placeholder="端口"
          />
        </>
      )}

      {value.type === 'accumulator' && (
        <select
          className="config-select"
          value={value.name ?? ''}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        >
          <option value="">选择累加器</option>
          {accumulators.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))}
        </select>
      )}

      {value.type === 'state_var' && (
        <select
          className="config-select"
          value={value.name ?? ''}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        >
          <option value="">选择状态变量</option>
          {stateVars.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      )}

      {value.type === 'workflow_input' && (
        <select
          className="config-select"
          value={value.name ?? ''}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        >
          <option value="">选择输入</option>
          {workflowInputs.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ============================================================================
// 子组件：条件表达式编辑器
// ============================================================================

interface ConditionExprEditorProps {
  condition: ConditionExpr;
  onChange: (condition: ConditionExpr) => void;
  onDelete?: () => void;
  depth?: number;
  nodes: WorkflowNode[];
  accumulators?: AccumulatorConfig[];
  stateVars?: StateVarConfig[];
  workflowInputs?: string[];
}

function ConditionExprEditor({
  condition,
  onChange,
  onDelete,
  depth = 0,
  nodes,
  accumulators = [],
  stateVars = [],
  workflowInputs = [],
}: ConditionExprEditorProps) {
  const handleAddCondition = useCallback(() => {
    const newConditions = [...(condition.conditions || []), { type: 'compare' as ConditionExprType, left: { type: 'literal' as ValueRefType }, op: 'eq' as CompareOp, right: { type: 'literal' as ValueRefType } }];
    onChange({ ...condition, conditions: newConditions });
  }, [condition, onChange]);

  const handleDeleteCondition = useCallback((index: number) => {
    const newConditions = (condition.conditions || []).filter((_, i) => i !== index);
    onChange({ ...condition, conditions: newConditions });
  }, [condition, onChange]);

  const handleUpdateCondition = useCallback((index: number, updated: ConditionExpr) => {
    const newConditions = (condition.conditions || []).map((c, i) => (i === index ? updated : c));
    onChange({ ...condition, conditions: newConditions });
  }, [condition, onChange]);

  return (
    <div className={`condition-expr-editor depth-${Math.min(depth, 3)}`}>
      <div className="condition-type-row">
        <select
          className="config-select"
          value={condition.type}
          onChange={(e) => onChange({ ...condition, type: e.target.value as ConditionExprType })}
        >
          {CONDITION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {onDelete && (
          <button className="config-delete-btn" onClick={onDelete} title="删除条件">
            <DeleteIcon />
          </button>
        )}
      </div>

      {/* 比较条件 */}
      {condition.type === 'compare' && (
        <div className="compare-condition">
          <div className="compare-operand">
            <span className="operand-label">左操作数:</span>
            <ValueRefEditor
              value={condition.left || { type: 'literal' }}
              onChange={(left) => onChange({ ...condition, left })}
              nodes={nodes}
              accumulators={accumulators}
              stateVars={stateVars}
              workflowInputs={workflowInputs}
            />
          </div>
          <div className="compare-operator">
            <select
              className="config-select"
              value={condition.op ?? 'eq'}
              onChange={(e) => onChange({ ...condition, op: e.target.value as CompareOp })}
            >
              {COMPARE_OPS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          <div className="compare-operand">
            <span className="operand-label">右操作数:</span>
            <ValueRefEditor
              value={condition.right || { type: 'literal' }}
              onChange={(right) => onChange({ ...condition, right })}
              nodes={nodes}
              accumulators={accumulators}
              stateVars={stateVars}
              workflowInputs={workflowInputs}
            />
          </div>
        </div>
      )}

      {/* AND/OR 条件 */}
      {(condition.type === 'and' || condition.type === 'or') && (
        <div className="compound-condition">
          <div className="compound-header">
            <span>子条件:</span>
            <button className="config-add-btn" onClick={handleAddCondition}>
              <AddIcon /> 添加
            </button>
          </div>
          <div className="compound-conditions">
            {(condition.conditions || []).map((c, i) => (
              <ConditionExprEditor
                key={i}
                condition={c}
                onChange={(updated) => handleUpdateCondition(i, updated)}
                onDelete={() => handleDeleteCondition(i)}
                depth={depth + 1}
                nodes={nodes}
                accumulators={accumulators}
                stateVars={stateVars}
                workflowInputs={workflowInputs}
              />
            ))}
          </div>
        </div>
      )}

      {/* NOT 条件 */}
      {condition.type === 'not' && (
        <div className="not-condition">
          <span className="not-label">取反条件:</span>
          <ConditionExprEditor
            condition={condition.condition || { type: 'compare', left: { type: 'literal' }, op: 'eq', right: { type: 'literal' } }}
            onChange={(updated) => onChange({ ...condition, condition: updated })}
            depth={depth + 1}
            nodes={nodes}
            accumulators={accumulators}
            stateVars={stateVars}
            workflowInputs={workflowInputs}
          />
        </div>
      )}

      {/* 常量条件 */}
      {condition.type === 'const' && (
        <div className="const-condition">
          <label>
            <input
              type="checkbox"
              checked={condition.value ?? false}
              onChange={(e) => onChange({ ...condition, value: e.target.checked })}
            />
            始终为真
          </label>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function EdgeConditionEditorComponent({
  isOpen,
  onClose,
  edgeId,
  edgeLabel,
  condition,
  onSave,
  onDelete,
  nodes,
  accumulators = [],
  stateVars = [],
  workflowInputs = [],
}: EdgeConditionEditorProps) {
  const [currentCondition, setCurrentCondition] = useState<ConditionExpr>(
    condition || { type: 'compare', left: { type: 'literal' }, op: 'eq', right: { type: 'literal' } },
  );

  const handleSave = useCallback(() => {
    onSave({
      edge_id: edgeId,
      condition: currentCondition,
    });
    onClose();
  }, [edgeId, currentCondition, onSave, onClose]);

  const handleDelete = useCallback(() => {
    onDelete?.();
    onClose();
  }, [onDelete, onClose]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) { return null; }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-lg edge-condition-dialog" onClick={handleContentClick}>
        <div className="dialog-header">
          <div className="dialog-title">
            边条件配置
            {edgeLabel && <span className="edge-label-hint">（{edgeLabel}）</span>}
          </div>
          <button className="dialog-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-body">
          <div className="condition-info">
            <p>当条件为 true 时，此边的数据流才会执行。</p>
          </div>

          <ConditionExprEditor
            condition={currentCondition}
            onChange={setCurrentCondition}
            nodes={nodes}
            accumulators={accumulators}
            stateVars={stateVars}
            workflowInputs={workflowInputs}
          />
        </div>

        <div className="dialog-footer">
          {onDelete && condition && (
            <button className="toolbar-btn danger" onClick={handleDelete}>
              删除条件
            </button>
          )}
          <div className="footer-spacer" />
          <button className="toolbar-btn" onClick={onClose}>
            取消
          </button>
          <button className="toolbar-btn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export const EdgeConditionEditor = memo(EdgeConditionEditorComponent);
