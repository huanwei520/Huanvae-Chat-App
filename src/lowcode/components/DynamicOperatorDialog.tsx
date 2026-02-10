/**
 * 动态算子管理对话框
 *
 * 提供 S-expression 动态算子的上传、查询、更新、删除功能。
 * 两个标签页：「上传」用于编写和上传 S-expression 源；「管理」用于查看、编辑、删除已有动态算子。
 *
 * @module lowcode/components/DynamicOperatorDialog
 * @created 2026-02-07
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon, DeleteIcon } from './icons';
import { useConfirmDialog } from './ConfirmDialog';
import type { DynamicOperatorService } from '../services/dynamicOperatorService';
import type {
  DynamicOperatorSource,
  UploadOperatorsResponse,
  UploadWorkflowResponse,
  ConservationWarning,
} from '../types/lowcode';

// ============================================================================
// 图标组件
// ============================================================================

/** 上传图标 */
function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** 编辑图标 */
function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** 刷新图标 */
function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23,4 23,10 17,10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

/** 帮助图标 */
function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ============================================================================
// 常量
// ============================================================================

/** S-expression 示例模板 */
const SEXPR_TEMPLATE = `;; @module: custom.math
;; @name: 自定义数学模块
;; @description: 用户自定义的数学函数

;; @operator: custom.math.quadratic
;; @name: 二次函数
;; @category: 数学函数
;; @description: 计算 ax² + bx + c
;; @latex: f(x) = ax^2 + bx + c
;; @input: a, Number, required, 二次系数
;; @input: b, Number, required, 一次系数
;; @input: c, Number, required, 常数项
;; @input: x, Number, required, 自变量
;; @output: result, Number, 函数值
(add (add (mul a (mul x x)) (mul b x)) c)
`;

type TabId = 'upload' | 'manage';

/** 根据上传状态和模式返回按钮文案 */
function getUploadButtonLabel(uploading: boolean, mode: UploadMode): string {
  if (uploading && mode === 'upload_workflow') {
    return '上传并加载工作流中...';
  }
  if (uploading) {
    return '上传中...';
  }
  if (mode === 'upload_workflow') {
    return '上传并生成工作流';
  }
  return '上传并注册';
}

// ============================================================================
// 类型定义
// ============================================================================

type UploadMode = 'upload' | 'upload_workflow';

interface DynamicOperatorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  service: DynamicOperatorService | null;
  onOperatorsChanged: () => void;
  /** 上传并生成工作流成功后，回调通知外部加载新工作流（应返回 Promise） */
  onWorkflowCreated?: (workflowId: string) => Promise<void> | void;
}

// ============================================================================
// 子组件：守恒律警告列表
// ============================================================================

function ConservationWarnings({ warnings }: { warnings: ConservationWarning[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="conservation-warnings">
      <h4 className="conservation-warnings-title">守恒律验证</h4>
      {warnings.map((w, i) => (
        <div
          key={`${w.node}-${i}`}
          className={`conservation-warning conservation-warning--${w.level}`}
        >
          <span className="conservation-warning-level">
            {w.level === 'error' ? '错误' : '警告'}
          </span>
          <span className="conservation-warning-node">{w.node}</span>
          <span className="conservation-warning-msg">{w.message}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// 子组件：语法参考面板
// ============================================================================

function SyntaxReference({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="sexpr-help">
      <h4>S-expression 语法参考</h4>
      <div className="sexpr-help-section">
        <strong>模块声明</strong>
        <code>{';; @module: 模块ID'}</code>
        <code>{';; @name: 模块名称'}</code>
        <code>{';; @description: 模块描述'}</code>
      </div>
      <div className="sexpr-help-section">
        <strong>算子定义</strong>
        <code>{';; @operator: 算子ID'}</code>
        <code>{';; @name: 算子名称'}</code>
        <code>{';; @category: 分类名称'}</code>
        <code>{';; @latex: LaTeX 公式（可选）'}</code>
        <code>{';; @input: 名称, 类型, required|optional, 描述[, 默认值]'}</code>
        <code>{';; @output: 名称, 类型, 描述'}</code>
        <code>{'(数学表达式)'}</code>
      </div>
      <div className="sexpr-help-section">
        <strong>数学运算</strong>
        <code>{'算术: add, sub, mul, div, pow, neg, abs, mod'}</code>
        <code>{'函数: exp, ln, sqrt, sin, cos, tan, log10'}</code>
        <code>{'条件: if + geq/leq/gt/lt/eq/neq'}</code>
        <code>{'常量: pi, e'}</code>
      </div>
      <div className="sexpr-help-section">
        <strong>SVRD 扩展注解</strong>
        <code>{';; @workflow_input: T, Array<Number>, required, 温度序列, class driving'}</code>
        <code>{';; @edge: a.x -> b.x, flow material'}</code>
        <code>{';; @boundary: env, source, 环境源'}</code>
        <code>{';; @connector_out: bloom_date, Number, 盛花期'}</code>
        <code>{';; @connector_in: bloom_date, Number, from phenoflex.bloom_date'}</code>
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function DynamicOperatorDialogComponent({
  isOpen,
  onClose,
  service,
  onOperatorsChanged,
  onWorkflowCreated,
}: DynamicOperatorDialogProps) {
  // ---- 标签页状态 ----
  const [activeTab, setActiveTab] = useState<TabId>('upload');

  // ---- 上传标签页状态 ----
  const [sexprSource, setSexprSource] = useState(SEXPR_TEMPLATE);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadOperatorsResponse | null>(null);
  const [workflowResult, setWorkflowResult] = useState<UploadWorkflowResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>('upload');
  const [wfName, setWfName] = useState('');
  const [wfDescription, setWfDescription] = useState('');

  // ---- 确认对话框 ----
  const { confirm: showConfirm, dialogElement: confirmDialogElement } = useConfirmDialog();

  // ---- 管理标签页状态 ----
  const [sources, setSources] = useState<DynamicOperatorSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [editingOperator, setEditingOperator] = useState<string | null>(null);
  const [editSource, setEditSource] = useState('');
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ---- 加载源列表 ----
  const loadSources = useCallback(async () => {
    if (!service) {
      return;
    }
    setLoadingSources(true);
    setSourcesError(null);
    try {
      const resp = await service.getSources();
      setSources(resp.sources);
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoadingSources(false);
    }
  }, [service]);

  // 打开对话框时加载源列表
  useEffect(() => {
    if (isOpen && activeTab === 'manage') {
      loadSources();
    }
  }, [isOpen, activeTab, loadSources]);

  // ---- 上传操作 ----
  const handleUpload = useCallback(async () => {
    if (!service || !sexprSource.trim()) {
      return;
    }
    if (uploadMode === 'upload_workflow' && !wfName.trim()) {
      setUploadError('请输入工作流名称');
      return;
    }
    setUploading(true);
    setUploadResult(null);
    setWorkflowResult(null);
    setUploadError(null);
    try {
      if (uploadMode === 'upload_workflow') {
        const result = await service.uploadWorkflow({
          name: wfName.trim(),
          description: wfDescription.trim() || undefined,
          sexpr_source: sexprSource,
        });
        setWorkflowResult(result);
        // upload_workflow 模式下，由 onWorkflowCreated 回调负责刷新算子列表并加载工作流
        if (onWorkflowCreated) {
          // 等待工作流加载完成后再关闭对话框，确保用户看到反馈
          await onWorkflowCreated(result.workflow.id);
          onClose();
        } else {
          onOperatorsChanged();
        }
      } else {
        const result = await service.upload(sexprSource);
        setUploadResult(result);
        onOperatorsChanged();
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [service, sexprSource, uploadMode, wfName, wfDescription, onOperatorsChanged, onWorkflowCreated, onClose]);

  // ---- 更新操作 ----
  const handleUpdate = useCallback(async (operatorId: string) => {
    if (!service || !editSource.trim()) {
      return;
    }
    setUpdating(true);
    try {
      await service.update(operatorId, editSource);
      setEditingOperator(null);
      setEditSource('');
      onOperatorsChanged();
      await loadSources();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`更新失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setUpdating(false);
    }
  }, [service, editSource, onOperatorsChanged, loadSources]);

  // ---- 删除操作 ----
  const handleDelete = useCallback(async (operatorId: string) => {
    if (!service) {
      return;
    }
    const confirmed = await showConfirm({
      title: '确认删除',
      message: (
        <>
          确定要删除算子 &ldquo;<strong>{operatorId}</strong>&rdquo; 吗？
          <br />
          此操作不可撤销。
        </>
      ),
      confirmLabel: '删除',
      isDanger: true,
    });
    if (!confirmed) {
      return;
    }
    setDeleting(operatorId);
    try {
      await service.remove(operatorId);
      onOperatorsChanged();
      await loadSources();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setDeleting(null);
    }
  }, [service, onOperatorsChanged, loadSources, showConfirm]);

  // ---- 进入编辑模式 ----
  const handleStartEdit = useCallback((operatorId: string) => {
    setEditingOperator(operatorId);
    setEditSource('');
  }, []);

  // ---- 取消编辑 ----
  const handleCancelEdit = useCallback(() => {
    setEditingOperator(null);
    setEditSource('');
  }, []);

  // ---- 格式化时间 ----
  const formatTime = useCallback((isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleString('zh-CN');
    } catch {
      return isoStr;
    }
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        className="dialog-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="dialog-content dynamic-operator-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 标题栏 */}
          <div className="dialog-header">
            <h3>动态算子管理</h3>
            <button className="dialog-close-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {/* 标签页切换 */}
          <div className="dynamic-operator-tabs">
            <button
              className={`dynamic-operator-tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <UploadIcon />
              <span>上传</span>
            </button>
            <button
              className={`dynamic-operator-tab ${activeTab === 'manage' ? 'active' : ''}`}
              onClick={() => setActiveTab('manage')}
            >
              <RefreshIcon />
              <span>管理</span>
            </button>
          </div>

          {/* 内容区 */}
          <div className="dialog-body">
            {/* ---- 上传标签页 ---- */}
            {activeTab === 'upload' && (
              <div className="dynamic-upload-panel">
                {/* 上传模式切换 */}
                <div className="upload-mode-switcher">
                  <label className="upload-mode-option">
                    <input
                      type="radio"
                      name="uploadMode"
                      checked={uploadMode === 'upload'}
                      onChange={() => setUploadMode('upload')}
                    />
                    <span>仅注册算子</span>
                  </label>
                  <label className="upload-mode-option">
                    <input
                      type="radio"
                      name="uploadMode"
                      checked={uploadMode === 'upload_workflow'}
                      onChange={() => setUploadMode('upload_workflow')}
                    />
                    <span>注册算子并生成工作流</span>
                  </label>
                </div>

                {/* 工作流名称/描述（仅 upload_workflow 模式） */}
                {uploadMode === 'upload_workflow' && (
                  <div className="workflow-fields">
                    <div className="workflow-field">
                      <label className="workflow-field-label">
                        工作流名称 <span className="required">*</span>
                      </label>
                      <input
                        type="text"
                        className="workflow-field-input"
                        value={wfName}
                        onChange={(e) => setWfName(e.target.value)}
                        placeholder="输入工作流名称"
                      />
                    </div>
                    <div className="workflow-field">
                      <label className="workflow-field-label">描述</label>
                      <input
                        type="text"
                        className="workflow-field-input"
                        value={wfDescription}
                        onChange={(e) => setWfDescription(e.target.value)}
                        placeholder="可选：输入工作流描述"
                      />
                    </div>
                  </div>
                )}

                {/* 编辑器标题行 */}
                <div className="sexpr-editor-header">
                  <span className="sexpr-editor-label">S-expression 源代码</span>
                  <button
                    className="sexpr-help-toggle"
                    onClick={() => setShowHelp((prev) => !prev)}
                    title="语法参考"
                  >
                    <HelpIcon />
                    <span>{showHelp ? '隐藏参考' : '语法参考'}</span>
                  </button>
                </div>

                {/* 语法参考 */}
                <SyntaxReference visible={showHelp} />

                {/* S-expression 编辑器 */}
                <textarea
                  className="sexpr-editor"
                  value={sexprSource}
                  onChange={(e) => setSexprSource(e.target.value)}
                  placeholder="在此输入 S-expression 源代码..."
                  spellCheck={false}
                />

                {/* 上传按钮 */}
                <div className="sexpr-editor-actions">
                  <button
                    className="btn-primary"
                    onClick={handleUpload}
                    disabled={
                      uploading
                      || !sexprSource.trim()
                      || !service
                      || (uploadMode === 'upload_workflow' && !wfName.trim())
                    }
                  >
                    <UploadIcon />
                    <span>{getUploadButtonLabel(uploading, uploadMode)}</span>
                  </button>
                </div>

                {/* 上传错误 */}
                {uploadError && (
                  <div className="upload-result upload-result--error">
                    <strong>上传失败</strong>
                    <p>{uploadError}</p>
                  </div>
                )}

                {/* 仅注册算子的结果 */}
                {uploadResult && (
                  <div className="upload-result upload-result--success">
                    <strong>{uploadResult.message}</strong>
                    <p>共注册 {uploadResult.count} 个算子：</p>
                    <ul className="upload-operator-list">
                      {uploadResult.operators.map((op) => (
                        <li key={op.id}>
                          <code>{op.id}</code>
                          <span>{op.name}</span>
                          <span className="upload-operator-category">{op.category}</span>
                        </li>
                      ))}
                    </ul>
                    {uploadResult.conservation_warnings && (
                      <ConservationWarnings warnings={uploadResult.conservation_warnings} />
                    )}
                  </div>
                )}

                {/* 注册算子并生成工作流的结果 */}
                {workflowResult && (
                  <div className="upload-result upload-result--success">
                    <strong>{workflowResult.message}</strong>
                    <p>注册了 {workflowResult.operator_count} 个算子，工作流已自动加载。</p>
                    <div className="workflow-created-info">
                      <span>工作流 ID: </span>
                      <code>{workflowResult.workflow.id}</code>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---- 管理标签页 ---- */}
            {activeTab === 'manage' && (
              <div className="dynamic-manage-panel">
                {/* 工具栏 */}
                <div className="source-list-toolbar">
                  <span className="source-list-count">
                    共 {sources.length} 个动态算子
                  </span>
                  <button
                    className="btn-secondary"
                    onClick={loadSources}
                    disabled={loadingSources}
                  >
                    <RefreshIcon />
                    <span>{loadingSources ? '刷新中...' : '刷新'}</span>
                  </button>
                </div>

                {/* 错误提示 */}
                {sourcesError && (
                  <div className="upload-result upload-result--error">
                    <p>{sourcesError}</p>
                  </div>
                )}

                {/* 加载中 */}
                {loadingSources && sources.length === 0 && (
                  <div className="source-list-loading">加载中...</div>
                )}

                {/* 空状态 */}
                {!loadingSources && sources.length === 0 && !sourcesError && (
                  <div className="source-list-empty">
                    暂无动态算子。切换到「上传」标签页上传 S-expression 以注册新算子。
                  </div>
                )}

                {/* 源列表 */}
                {sources.length > 0 && (
                  <div className="source-list">
                    <table className="source-list-table">
                      <thead>
                        <tr>
                          <th>算子 ID</th>
                          <th>名称</th>
                          <th>模块</th>
                          <th>分类</th>
                          <th>版本</th>
                          <th>更新时间</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map((src) => (
                          <tr key={src.operator_id}>
                            <td><code>{src.operator_id}</code></td>
                            <td>{src.name}</td>
                            <td>{src.module_id}</td>
                            <td>{src.category}</td>
                            <td>v{src.version}</td>
                            <td>{formatTime(src.updated_at)}</td>
                            <td className="source-actions">
                              <button
                                className="btn-icon"
                                title="编辑"
                                onClick={() => handleStartEdit(src.operator_id)}
                                disabled={!!editingOperator}
                              >
                                <EditIcon />
                              </button>
                              <button
                                className="btn-icon btn-icon--danger"
                                title="删除"
                                onClick={() => handleDelete(src.operator_id)}
                                disabled={deleting === src.operator_id}
                              >
                                <DeleteIcon />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 编辑面板 */}
                {editingOperator && (
                  <div className="source-edit-panel">
                    <h4>
                      编辑算子: <code>{editingOperator}</code>
                    </h4>
                    <textarea
                      className="sexpr-editor sexpr-editor--compact"
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value)}
                      placeholder="输入新的 S-expression 源代码（需包含完整模块声明和算子定义）..."
                      spellCheck={false}
                    />
                    <div className="source-edit-actions">
                      <button
                        className="btn-primary"
                        onClick={() => handleUpdate(editingOperator)}
                        disabled={updating || !editSource.trim()}
                      >
                        {updating ? '更新中...' : '更新'}
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={handleCancelEdit}
                        disabled={updating}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
      {confirmDialogElement}
    </AnimatePresence>
  );
}

export const DynamicOperatorDialog = memo(DynamicOperatorDialogComponent);
