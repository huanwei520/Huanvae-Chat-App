/**
 * 属性面板组件
 *
 * 显示选中节点的属性信息，支持编辑节点名称和配置流程输入/输出
 * 支持虚拟节点（_input / _virtual）的专用属性展示
 *
 * @module lowcode/components/PropertyPanel
 * @updated 2026-02-06 添加虚拟节点属性面板，修复选中虚拟节点白屏崩溃
 * @updated 2026-02-07 将 window.confirm() 替换为 useConfirmDialog 自定义确认弹窗
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { memo, useCallback, useMemo, useState, useEffect } from 'react';
import { useFlowStore } from '../stores/flowStore';
import { MathFormula } from './MathFormula';
import { useConfirmDialog } from './ConfirmDialog';
import type { Operator, OperatorInput, OperatorOutput } from '../types/lowcode';

// ============================================================================
// 图标组件
// ============================================================================

/** 节点图标 */
function NodeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

/** 输入图标 */
function InputIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="15,18 9,12 15,6" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/** 输出图标 */
function OutputIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="9,18 15,12 9,6" />
      <line x1="3" y1="12" x2="15" y2="12" />
    </svg>
  );
}

/** 删除图标 */
function DeleteIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="3,6 5,6 21,6" />
      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

/** 节点数据 */
interface OperatorNodeData {
  operator: Operator;
  label?: string;
}

/** 属性面板 Props */
interface PropertyPanelProps {
  /** 流程输入绑定 */
  workflowInputs: Array<{ name: string; nodeId: string; port: string }>;
  /** 流程输出绑定（支持节点端口和累加器来源） */
  workflowOutputs: Array<{ name: string; nodeId?: string; port?: string; accumulator?: string }>;
  /** 添加流程输入 */
  onAddInput: (nodeId: string, port: string, name: string) => void;
  /** 移除流程输入 */
  onRemoveInput: (nodeId: string, port: string) => void;
  /** 添加流程输出 */
  onAddOutput: (nodeId: string, port: string, name: string) => void;
  /** 移除流程输出 */
  onRemoveOutput: (nodeId: string, port: string) => void;
  /** 重命名流程输入 */
  onRenameInput: (nodeId: string, port: string, newName: string) => void;
  /** 重命名流程输出 */
  onRenameOutput: (nodeId: string, port: string, newName: string) => void;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取数据类型的显示名称
 */
function getDataTypeLabel(
  input: OperatorInput | OperatorOutput,
): string {
  const dataType = input.data_type || input.type;
  if (!dataType) { return '未知'; }

  const typeLabels: Record<string, string> = {
    string: '字符串',
    number: '数字',
    boolean: '布尔值',
    object: '对象',
    array: '数组',
  };

  return typeLabels[dataType] || dataType;
}

// ============================================================================
// 端口配置组件
// ============================================================================

interface PortItemProps {
  nodeId: string;
  nodeName: string;
  port: OperatorInput | OperatorOutput;
  type: 'input' | 'output';
  isBound: boolean;
  boundName?: string;
  allBoundNames: string[];
  onBind: (name: string) => void;
  onUnbind: () => void;
  onRename: (newName: string) => void;
}

/** 端口配置项 */
function PortItem({
  nodeName,
  port,
  type,
  isBound,
  boundName,
  allBoundNames,
  onBind,
  onUnbind,
  onRename,
}: PortItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(boundName || '');
  const [error, setError] = useState<string | null>(null);

  // 当 boundName 变化时更新编辑值
  useEffect(() => {
    setEditValue(boundName || '');
  }, [boundName]);

  const handleToggle = useCallback(() => {
    if (isBound) {
      onUnbind();
    } else {
      // 使用 "节点名.端口名" 作为默认名称
      const defaultName = `${nodeName}.${port.name}`;
      onBind(defaultName);
    }
  }, [isBound, nodeName, port.name, onBind, onUnbind]);

  // 开始编辑
  const handleStartEdit = useCallback(() => {
    setEditValue(boundName || '');
    setError(null);
    setIsEditing(true);
  }, [boundName]);

  // 确认编辑
  const handleConfirmEdit = useCallback(() => {
    const trimmed = editValue.trim();

    if (!trimmed) {
      setError('名称不能为空');
      return;
    }

    // 检查是否与其他绑定名称重复（排除自己）
    const isDuplicate = allBoundNames.some(
      (name) => name === trimmed && name !== boundName,
    );

    if (isDuplicate) {
      setError('名称已被使用');
      return;
    }

    if (trimmed !== boundName) {
      onRename(trimmed);
    }
    setIsEditing(false);
    setError(null);
  }, [editValue, boundName, allBoundNames, onRename]);

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setEditValue(boundName || '');
    setIsEditing(false);
    setError(null);
  }, [boundName]);

  // 处理按键
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConfirmEdit();
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleConfirmEdit, handleCancelEdit],
  );

  // 检查是否为输入端口（有 required 属性）
  const isRequired = 'required' in port && port.required;

  // 获取端口的扩展属性
  const portLatexName = port.latex_name;
  const portDescription = port.description;
  const portPaperRef = (port as { paper_ref?: string }).paper_ref;
  const portDefaultValue = (port as { default_value?: unknown }).default_value;

  return (
    <div className="property-port-item">
      <div className="port-info">
        {type === 'input' ? <InputIcon /> : <OutputIcon />}
        <span className="port-name">{port.name}</span>
        <span className="port-type">{getDataTypeLabel(port)}</span>
        {isRequired && <span className="port-required">*</span>}
      </div>

      {/* LaTeX 名称、描述、论文引用和默认值 */}
      {(portLatexName || portDescription || portPaperRef || portDefaultValue !== undefined) && (
        <div className="port-meta">
          {portLatexName && (
            <span className="port-latex-name">
              <MathFormula latex={portLatexName} inline />
            </span>
          )}
          {portDescription && (
            <span className="port-description">{portDescription}</span>
          )}
          {portPaperRef && (
            <span className="port-paper-ref" title="论文引用">
              📄 {portPaperRef}
            </span>
          )}
          {portDefaultValue !== undefined && (
            <span className="port-default-value" title="默认值">
              默认: {String(portDefaultValue)}
            </span>
          )}
        </div>
      )}
      <div className="port-actions">
        <label className="port-bind-toggle">
          <input
            type="checkbox"
            checked={isBound}
            onChange={handleToggle}
          />
          <span className="toggle-label">
            {type === 'input' ? '流程输入' : '流程输出'}
          </span>
        </label>
      </div>

      {/* 绑定名称编辑区域 */}
      {isBound && (
        <div className="port-name-editor">
          {isEditing ? (
            <div className="port-name-edit-row">
              <input
                type="text"
                className={`port-name-input ${error ? 'error' : ''}`}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入参数名称"
                autoFocus
              />
              <button
                className="port-name-btn confirm"
                onClick={handleConfirmEdit}
                title="确认"
              >
                ✓
              </button>
              <button
                className="port-name-btn cancel"
                onClick={handleCancelEdit}
                title="取消"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="port-name-display" onClick={handleStartEdit}>
              <span className="port-bound-label">参数名:</span>
              <span className="port-bound-name">{boundName}</span>
              <span className="port-edit-hint">点击编辑</span>
            </div>
          )}
          {error && <div className="port-name-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 属性面板组件
 *
 * 显示选中节点的详细信息和配置选项
 */
function PropertyPanelComponent({
  workflowInputs,
  workflowOutputs,
  onAddInput,
  onRemoveInput,
  onAddOutput,
  onRemoveOutput,
  onRenameInput,
  onRenameOutput,
}: PropertyPanelProps) {
  const { nodes, edges, selectedNodeId, selectedEdgeId, deleteNode, deleteEdge, selectEdge, setNodes } = useFlowStore();
  const { confirm: showConfirm, dialogElement: confirmDialogElement } = useConfirmDialog();

  // 获取所有已绑定的名称（用于重名校验）
  const allInputNames = useMemo(
    () => workflowInputs.map((i) => i.name),
    [workflowInputs],
  );
  const allOutputNames = useMemo(
    () => workflowOutputs.map((o) => o.name),
    [workflowOutputs],
  );

  // 获取选中的节点
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) { return null; }
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // 获取节点数据
  const nodeData = useMemo(() => {
    if (!selectedNode) { return null; }
    return selectedNode.data as unknown as OperatorNodeData;
  }, [selectedNode]);

  // 处理节点名称更改
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedNodeId) { return; }

      const newName = e.target.value;
      setNodes(
        nodes.map((n) =>
          n.id === selectedNodeId
            ? {
              ...n,
              data: {
                ...n.data,
                label: newName,
              },
            }
            : n,
        ),
      );
    },
    [selectedNodeId, nodes, setNodes],
  );

  // 处理删除节点
  const handleDelete = useCallback(async () => {
    if (!selectedNodeId) { return; }
    const confirmed = await showConfirm({
      title: '确认删除',
      message: '确定要删除此节点吗？此操作不可撤销。',
      confirmLabel: '删除',
      isDanger: true,
    });
    if (confirmed) {
      deleteNode(selectedNodeId);
    }
  }, [selectedNodeId, deleteNode, showConfirm]);

  // 检查端口是否已绑定
  const isInputBound = useCallback(
    (portName: string) => {
      if (!selectedNodeId) { return false; }
      return workflowInputs.some(
        (input) => input.nodeId === selectedNodeId && input.port === portName,
      );
    },
    [selectedNodeId, workflowInputs],
  );

  const isOutputBound = useCallback(
    (portName: string) => {
      if (!selectedNodeId) { return false; }
      return workflowOutputs.some(
        (output) => output.nodeId === selectedNodeId && output.port === portName,
      );
    },
    [selectedNodeId, workflowOutputs],
  );

  // 获取绑定名称
  const getInputBoundName = useCallback(
    (portName: string) => {
      if (!selectedNodeId) { return undefined; }
      const binding = workflowInputs.find(
        (input) => input.nodeId === selectedNodeId && input.port === portName,
      );
      return binding?.name;
    },
    [selectedNodeId, workflowInputs],
  );

  const getOutputBoundName = useCallback(
    (portName: string) => {
      if (!selectedNodeId) { return undefined; }
      const binding = workflowOutputs.find(
        (output) => output.nodeId === selectedNodeId && output.port === portName,
      );
      return binding?.name;
    },
    [selectedNodeId, workflowOutputs],
  );

  // 选中边时显示边详情面板
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) { return null; }
    return edges.find((e) => e.id === selectedEdgeId) || null;
  }, [selectedEdgeId, edges]);

  const handleDeleteEdge = useCallback(async () => {
    if (!selectedEdgeId) { return; }
    const confirmed = await showConfirm({
      title: '确认删除',
      message: '确定要删除此连接线吗？此操作不可撤销。',
      confirmLabel: '删除',
      isDanger: true,
    });
    if (confirmed) {
      deleteEdge(selectedEdgeId);
    }
  }, [selectedEdgeId, deleteEdge, showConfirm]);

  const handleDeselectEdge = useCallback(() => {
    selectEdge(null);
  }, [selectEdge]);

  if (selectedEdge && !selectedNode) {
    const edgeData = selectedEdge.data as { edgeType?: string; lag?: number } | undefined;
    const edgeType = edgeData?.edgeType || selectedEdge.type || 'data';
    const lag = edgeData?.lag;

    const typeLabels: Record<string, string> = {
      data: '数据流',
      state: '状态流',
      accumulator_read: '累加器读取',
      broadcast: '广播',
    };
    const typeColors: Record<string, string> = {
      data: '#6366f1',
      state: '#f59e0b',
      accumulator_read: '#10b981',
      broadcast: '#a855f7',
    };

    return (
      <div className="lowcode-properties">
        <div className="lowcode-properties-header">
          连接线属性
          <button
            className="property-delete-btn"
            onClick={handleDeleteEdge}
            title="删除连接线"
          >
            <DeleteIcon />
          </button>
        </div>
        <div className="lowcode-properties-content">
          <div className="property-section">
            <div className="property-section-title">连接类型</div>
            <div className="property-field">
              <label>类型</label>
              <div className="property-value">
                <span
                  className="edge-type-indicator"
                  style={{ backgroundColor: typeColors[edgeType] || '#6366f1' }}
                />
                <span>{typeLabels[edgeType] || edgeType}</span>
              </div>
            </div>
            {edgeType === 'state' && lag !== undefined && lag > 0 && (
              <div className="property-field">
                <label>延迟步数 (lag)</label>
                <div className="property-value">{lag}</div>
              </div>
            )}
          </div>

          <div className="property-section">
            <div className="property-section-title">来源</div>
            <div className="property-field">
              <label>节点</label>
              <div className="property-value property-id">{selectedEdge.source}</div>
            </div>
            <div className="property-field">
              <label>端口</label>
              <div className="property-value">{selectedEdge.sourceHandle || '默认'}</div>
            </div>
          </div>

          <div className="property-section">
            <div className="property-section-title">目标</div>
            <div className="property-field">
              <label>节点</label>
              <div className="property-value property-id">{selectedEdge.target}</div>
            </div>
            <div className="property-field">
              <label>端口</label>
              <div className="property-value">{selectedEdge.targetHandle || '默认'}</div>
            </div>
          </div>

          <div className="property-section">
            <div className="property-section-title">操作</div>
            <div className="edge-actions">
              <button className="btn-secondary edge-action-btn" onClick={handleDeselectEdge}>
                取消选中
              </button>
              <button className="btn-icon btn-icon--danger edge-action-btn" onClick={handleDeleteEdge}>
                <DeleteIcon />
                <span>删除连接</span>
              </button>
            </div>
          </div>

          <div className="property-section">
            <div className="property-section-title">调试信息</div>
            <div className="property-field">
              <label>边 ID</label>
              <div className="property-value property-id">{selectedEdge.id}</div>
            </div>
          </div>
        </div>
        {confirmDialogElement}
      </div>
    );
  }

  // 未选中节点和边时显示提示
  if (!selectedNode || !nodeData) {
    return (
      <div className="lowcode-properties">
        <div className="lowcode-properties-header">属性面板</div>
        <div className="lowcode-properties-content">
          <div className="property-empty">
            <div className="property-empty-icon">
              <NodeIcon />
            </div>
            <p>请选择一个节点或连接线</p>
            <p className="property-empty-hint">点击画布中的节点或连接线查看其属性</p>
          </div>
        </div>
      </div>
    );
  }

  // 虚拟节点（_input / _virtual）使用专用面板
  if (selectedNode.type === 'virtual') {
    const vData = selectedNode.data as unknown as {
      kind: string;
      label: string;
      ports: string[];
    };
    const isInput = vData.kind === '_input';
    const kindLabel = isInput ? '工作流输入广播' : '虚拟来源（累加器/状态变量）';

    return (
      <div className="lowcode-properties">
        <div className="lowcode-properties-header">
          虚拟节点属性
          <button
            className="property-delete-btn"
            onClick={handleDelete}
            title="删除节点"
          >
            <DeleteIcon />
          </button>
        </div>
        <div className="lowcode-properties-content">
          <div className="property-section">
            <div className="property-section-title">基本信息</div>
            <div className="property-field">
              <label>节点类型</label>
              <div className="property-value">
                <span className={`virtual-kind-badge virtual-kind-badge--${vData.kind}`}>
                  {kindLabel}
                </span>
              </div>
            </div>
            <div className="property-field">
              <label>节点 ID</label>
              <div className="property-value property-id">{selectedNode.id}</div>
            </div>
            <div className="property-field">
              <label>说明</label>
              <div className="property-value property-description">
                {isInput
                  ? '此节点代表工作流外部输入，通过 broadcast 类型边将输入参数广播到目标节点。'
                  : '此节点代表迭代控制流中的虚拟来源，提供累加器读取（@acc）和状态变量（@state）的值。'}
              </div>
            </div>
          </div>

          {/* 输出端口列表 */}
          {vData.ports.length > 0 && (
            <div className="property-section">
              <div className="property-section-title">
                输出端口
                <span className="section-count">{vData.ports.length}</span>
              </div>
              <div className="property-ports">
                {vData.ports.map((port) => {
                  let portDesc = '数据端口';
                  if (port.startsWith('@acc.')) {
                    portDesc = `累加器读取: ${port.slice(5)}`;
                  } else if (port.startsWith('@state.')) {
                    portDesc = `状态变量: ${port.slice(7)}`;
                  } else if (isInput) {
                    portDesc = `工作流输入: ${port}`;
                  }
                  return (
                    <div key={port} className="property-port-item">
                      <div className="port-info">
                        <OutputIcon />
                        <span className="port-name">{port}</span>
                        <span className="port-type">{portDesc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { operator } = nodeData;
  const displayName = nodeData.label || operator.name;

  return (
    <div className="lowcode-properties">
      <div className="lowcode-properties-header">
        节点属性
        <button
          className="property-delete-btn"
          onClick={handleDelete}
          title="删除节点"
        >
          <DeleteIcon />
        </button>
      </div>

      <div className="lowcode-properties-content">
        {/* 基本信息 */}
        <div className="property-section">
          <div className="property-section-title">基本信息</div>

          <div className="property-field">
            <label>节点名称</label>
            <input
              type="text"
              value={displayName}
              onChange={handleNameChange}
              placeholder="输入节点名称"
            />
          </div>

          <div className="property-field">
            <label>算子</label>
            <div className="property-value">{operator.name}</div>
          </div>

          <div className="property-field">
            <label>算子 ID</label>
            <div className="property-value property-id">{operator.id}</div>
          </div>

          <div className="property-field">
            <label>分类</label>
            <div className="property-value">{operator.category}</div>
          </div>

          {operator.description && (
            <div className="property-field">
              <label>描述</label>
              <div className="property-value property-description">
                {operator.description}
              </div>
            </div>
          )}

          {/* 算子类型 */}
          {(operator as { operator_type?: string }).operator_type && (
            <div className="property-field">
              <label>类型</label>
              <div className="property-value">
                <span className="operator-type-badge">
                  {(operator as { operator_type?: string }).operator_type === 'operator' && '运算符'}
                  {(operator as { operator_type?: string }).operator_type === 'formula' && '公式'}
                  {(operator as { operator_type?: string }).operator_type === 'equation_network' && '方程网络'}
                </span>
              </div>
            </div>
          )}

          {/* LaTeX 公式 */}
          {(operator as { latex_formula?: string }).latex_formula && (
            <div className="property-field">
              <label>公式</label>
              <div className="property-value property-formula">
                <MathFormula latex={(operator as { latex_formula?: string }).latex_formula!} />
              </div>
            </div>
          )}
        </div>

        {/* 输入端口 */}
        {operator.inputs.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">
              输入端口
              <span className="section-count">{operator.inputs.length}</span>
            </div>

            <div className="property-ports">
              {operator.inputs.map((input) => (
                <PortItem
                  key={input.name}
                  nodeId={selectedNodeId!}
                  nodeName={displayName}
                  port={input}
                  type="input"
                  isBound={isInputBound(input.name)}
                  boundName={getInputBoundName(input.name)}
                  allBoundNames={allInputNames}
                  onBind={(name) => onAddInput(selectedNodeId!, input.name, name)}
                  onUnbind={() => onRemoveInput(selectedNodeId!, input.name)}
                  onRename={(newName) => onRenameInput(selectedNodeId!, input.name, newName)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 输出端口 */}
        {operator.outputs.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">
              输出端口
              <span className="section-count">{operator.outputs.length}</span>
            </div>

            <div className="property-ports">
              {operator.outputs.map((output) => (
                <PortItem
                  key={output.name}
                  nodeId={selectedNodeId!}
                  nodeName={displayName}
                  port={output}
                  type="output"
                  isBound={isOutputBound(output.name)}
                  boundName={getOutputBoundName(output.name)}
                  allBoundNames={allOutputNames}
                  onBind={(name) => onAddOutput(selectedNodeId!, output.name, name)}
                  onUnbind={() => onRemoveOutput(selectedNodeId!, output.name)}
                  onRename={(newName) => onRenameOutput(selectedNodeId!, output.name, newName)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 节点 ID */}
        <div className="property-section">
          <div className="property-section-title">调试信息</div>
          <div className="property-field">
            <label>节点 ID</label>
            <div className="property-value property-id">{selectedNodeId}</div>
          </div>
        </div>
      </div>
      {confirmDialogElement}
    </div>
  );
}

export const PropertyPanel = memo(PropertyPanelComponent);
export default PropertyPanel;
