/**
 * 分类配置管理对话框
 *
 * 支持自定义算子分类，包括嵌套分类、算子分配、导入导出
 *
 * @module lowcode/components/CategoryConfigDialog
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CategoryNode, CategoryConfig, CategoryValidationResult, Operator } from '../types/lowcode';
import type { CategoryService } from '../services/categoryService';

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

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="9,18 15,12 9,6" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51,9a9,9,0,0,1,14.85-3.36L23,10M1,14l4.64,4.36A9,9,0,0,0,20.49,15" />
    </svg>
  );
}

function OperatorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface CategoryConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  categoryService: CategoryService | null;
  /** 可用的算子列表 */
  operators?: Operator[];
}

// ============================================================================
// 算子选择器组件
// ============================================================================

interface OperatorSelectorProps {
  selectedOperators: string[];
  availableOperators: Operator[];
  assignedOperators: Set<string>;
  onToggle: (operatorId: string) => void;
}

function OperatorSelector({
  selectedOperators,
  availableOperators,
  assignedOperators,
  onToggle,
}: OperatorSelectorProps) {
  const [showSelector, setShowSelector] = useState(false);

  // 可选的算子（未被其他分类分配的，或已被当前分类分配的）
  const selectableOperators = availableOperators.filter(
    (op) => !assignedOperators.has(op.id) || selectedOperators.includes(op.id),
  );

  return (
    <div className="operator-selector">
      <div className="selected-operators">
        {selectedOperators.length === 0 ? (
          <span className="no-operators">暂无算子</span>
        ) : (
          selectedOperators.map((opId) => {
            const op = availableOperators.find((o) => o.id === opId);
            return (
              <span key={opId} className="operator-tag">
                <OperatorIcon />
                <span>{op?.name || opId}</span>
                <button
                  className="operator-remove-btn"
                  onClick={() => onToggle(opId)}
                  title="移除"
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      <button
        className="add-operator-btn"
        onClick={() => setShowSelector(!showSelector)}
      >
        <AddIcon />
        <span>添加算子</span>
      </button>

      {showSelector && (
        <div className="operator-dropdown">
          {selectableOperators.length === 0 ? (
            <div className="operator-dropdown-empty">没有可用的算子</div>
          ) : (
            selectableOperators.map((op) => (
              <label key={op.id} className="operator-dropdown-item">
                <input
                  type="checkbox"
                  checked={selectedOperators.includes(op.id)}
                  onChange={() => onToggle(op.id)}
                />
                <OperatorIcon />
                <span className="operator-dropdown-name">{op.name}</span>
                <span className="operator-dropdown-id">({op.id})</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 分类节点组件
// ============================================================================

interface CategoryNodeItemProps {
  node: CategoryNode;
  level: number;
  operators: Operator[];
  assignedOperators: Set<string>;
  onUpdate: (id: string, updates: Partial<CategoryNode>) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onToggleOperator: (categoryId: string, operatorId: string) => void;
}

function CategoryNodeItem({
  node,
  level,
  operators,
  assignedOperators,
  onUpdate,
  onDelete,
  onAddChild,
  onToggleOperator,
}: CategoryNodeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);

  // 当 node.name 变化时同步 editName
  useEffect(() => {
    setEditName(node.name);
  }, [node.name]);

  const hasChildren = node.children && node.children.length > 0;

  const handleNameSave = useCallback(() => {
    if (editName.trim() && editName !== node.name) {
      onUpdate(node.id, { name: editName.trim() });
    }
    setIsEditing(false);
  }, [editName, node.id, node.name, onUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNameSave();
      } else if (e.key === 'Escape') {
        setEditName(node.name);
        setIsEditing(false);
      }
    },
    [handleNameSave, node.name],
  );

  const handleToggleOperator = useCallback(
    (operatorId: string) => {
      onToggleOperator(node.id, operatorId);
    },
    [node.id, onToggleOperator],
  );

  return (
    <div className="category-node" style={{ marginLeft: level * 20 }}>
      <div className="category-node-header">
        <button
          className="category-expand-btn"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon expanded={expanded} />
        </button>

        <FolderIcon />

        {isEditing ? (
          <input
            type="text"
            className="category-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="category-name"
            onDoubleClick={() => setIsEditing(true)}
          >
            {node.name}
          </span>
        )}

        <span className="category-id">({node.id})</span>

        {node.operators && node.operators.length > 0 && (
          <span className="category-count">{node.operators.length} 个算子</span>
        )}

        <div className="category-actions">
          <button
            className="category-action-btn"
            onClick={() => onAddChild(node.id)}
            title="添加子分类"
          >
            <AddIcon />
          </button>
          <button
            className="category-action-btn delete"
            onClick={() => onDelete(node.id)}
            title="删除分类"
          >
            <DeleteIcon />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="category-content">
          {/* 算子选择器（所有分类都可以添加算子） */}
          <div className="category-operators-section">
            <OperatorSelector
              selectedOperators={node.operators || []}
              availableOperators={operators}
              assignedOperators={assignedOperators}
              onToggle={handleToggleOperator}
            />
          </div>

          {/* 子分类 */}
          {hasChildren && (
            <div className="category-children">
              {node.children!.map((child) => (
                <CategoryNodeItem
                  key={child.id}
                  node={child}
                  level={level + 1}
                  operators={operators}
                  assignedOperators={assignedOperators}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddChild={onAddChild}
                  onToggleOperator={onToggleOperator}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function CategoryConfigDialogComponent({
  isOpen,
  onClose,
  categoryService,
  operators = [],
}: CategoryConfigDialogProps) {
  const [config, setConfig] = useState<CategoryConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<CategoryValidationResult | null>(null);

  // 计算已分配的算子 ID 集合
  const assignedOperators = useCallback((categories: CategoryNode[]): Set<string> => {
    const assigned = new Set<string>();
    const traverse = (nodes: CategoryNode[]) => {
      for (const node of nodes) {
        if (node.operators) {
          node.operators.forEach((id) => assigned.add(id));
        }
        if (node.children) {
          traverse(node.children);
        }
      }
    };
    traverse(categories);
    return assigned;
  }, []);

  const currentAssigned = config ? assignedOperators(config.categories) : new Set<string>();

  // 加载配置
  const loadConfig = useCallback(async () => {
    if (!categoryService) {
      console.warn('[CategoryConfig] categoryService 为空，初始化默认配置');
      setConfig({
        version: '1.0',
        categories: [],
        uncategorized: [],
      });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('[CategoryConfig] 正在加载配置...');
      const data = await categoryService.getConfig();
      console.log('[CategoryConfig] 配置加载成功:', data);
      // 如果后端返回 null 或空数据，初始化空配置
      if (data && data.categories) {
        setConfig(data);
      } else {
        console.warn('[CategoryConfig] 后端返回空数据，初始化默认配置');
        setConfig({
          version: '1.0',
          categories: [],
          uncategorized: [],
        });
      }
    } catch (err) {
      // 如果没有配置或请求失败，初始化空配置
      console.warn('[CategoryConfig] 加载失败，初始化空配置:', err);
      setConfig({
        version: '1.0',
        categories: [],
        uncategorized: [],
      });
    } finally {
      setLoading(false);
    }
  }, [categoryService]);

  // 打开时加载
  useEffect(() => {
    console.log('[CategoryConfig] useEffect 触发, isOpen:', isOpen, 'categoryService:', !!categoryService);
    if (isOpen && categoryService) {
      loadConfig();
    } else if (isOpen && !categoryService) {
      // 如果没有 categoryService，直接初始化空配置
      console.warn('[CategoryConfig] 没有 categoryService，初始化空配置');
      setConfig({
        version: '1.0',
        categories: [],
        uncategorized: [],
      });
    }
  }, [isOpen, categoryService, loadConfig]);

  // 保存配置
  const handleSave = useCallback(async () => {
    if (!categoryService || !config) { return; }

    setSaving(true);
    setError(null);

    try {
      // 计算未分类的算子
      const assigned = assignedOperators(config.categories);
      const uncategorized = operators
        .map((op) => op.id)
        .filter((id) => !assigned.has(id));

      await categoryService.saveConfig({
        categories: config.categories,
        uncategorized,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [categoryService, config, operators, assignedOperators, onClose]);

  // 验证配置
  const handleValidate = useCallback(async () => {
    if (!categoryService || !config) { return; }

    try {
      const assigned = assignedOperators(config.categories);
      const uncategorized = operators
        .map((op) => op.id)
        .filter((id) => !assigned.has(id));

      const result = await categoryService.validateConfig({
        categories: config.categories,
        uncategorized,
      });
      setValidation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败');
    }
  }, [categoryService, config, operators, assignedOperators]);

  // 导出配置
  const handleExport = useCallback(async () => {
    if (!categoryService) { return; }

    try {
      const exported = await categoryService.exportConfig();
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'category-config.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  }, [categoryService]);

  // 导入配置
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !categoryService) { return; }

      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const result = await categoryService.importConfig({
          config: imported.config || imported,
          merge: false,
        });
        setConfig(result.config);
      } catch (err) {
        setError(err instanceof Error ? err.message : '导入失败');
      }
    };
    input.click();
  }, [categoryService]);

  // 更新节点
  const updateNode = useCallback((id: string, updates: Partial<CategoryNode>) => {
    if (!config) { return; }

    const updateInTree = (nodes: CategoryNode[]): CategoryNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, ...updates };
        }
        if (node.children) {
          return { ...node, children: updateInTree(node.children) };
        }
        return node;
      });
    };

    setConfig({
      ...config,
      categories: updateInTree(config.categories),
    });
  }, [config]);

  // 删除节点
  const deleteNode = useCallback((id: string) => {
    if (!config) { return; }

    const deleteFromTree = (nodes: CategoryNode[]): CategoryNode[] => {
      return nodes
        .filter((node) => node.id !== id)
        .map((node) => {
          if (node.children) {
            return { ...node, children: deleteFromTree(node.children) };
          }
          return node;
        });
    };

    setConfig({
      ...config,
      categories: deleteFromTree(config.categories),
    });
  }, [config]);

  // 添加子分类
  const addChild = useCallback((parentId: string) => {
    if (!config) { return; }

    const newId = `${parentId}.sub_${Date.now()}`;
    const newNode: CategoryNode = {
      id: newId,
      name: '新子分类',
      children: [],
      operators: [],
    };

    const addToTree = (nodes: CategoryNode[]): CategoryNode[] => {
      return nodes.map((node) => {
        if (node.id === parentId) {
          return {
            ...node,
            children: [...(node.children || []), newNode],
            // 保留父分类的算子，不清空
          };
        }
        if (node.children) {
          return { ...node, children: addToTree(node.children) };
        }
        return node;
      });
    };

    setConfig({
      ...config,
      categories: addToTree(config.categories),
    });
  }, [config]);

  // 添加根分类
  const addRootCategory = useCallback(() => {
    console.log('[CategoryConfig] addRootCategory 被调用, config:', config);
    if (!config) {
      console.warn('[CategoryConfig] config 为空，无法添加分类');
      return;
    }

    const newId = `category_${Date.now()}`;
    const newNode: CategoryNode = {
      id: newId,
      name: '新分类',
      children: [],
      operators: [],
    };

    console.log('[CategoryConfig] 添加新分类:', newNode);
    setConfig({
      ...config,
      categories: [...config.categories, newNode],
    });
  }, [config]);

  // 切换算子分配
  const toggleOperator = useCallback((categoryId: string, operatorId: string) => {
    if (!config) { return; }

    const toggleInTree = (nodes: CategoryNode[]): CategoryNode[] => {
      return nodes.map((node) => {
        if (node.id === categoryId) {
          const currentOps = node.operators || [];
          const newOps = currentOps.includes(operatorId)
            ? currentOps.filter((id) => id !== operatorId)
            : [...currentOps, operatorId];
          return { ...node, operators: newOps };
        }
        if (node.children) {
          return { ...node, children: toggleInTree(node.children) };
        }
        return node;
      });
    };

    setConfig({
      ...config,
      categories: toggleInTree(config.categories),
    });
  }, [config]);

  if (!isOpen) { return null; }

  // 未分类的算子
  const uncategorizedOps = operators.filter((op) => !currentAssigned.has(op.id));

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
          className="dialog-content category-config-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="dialog-header">
            <h2 className="dialog-title">分类配置</h2>
            <button className="dialog-close-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {/* 工具栏 */}
          <div className="category-toolbar">
            <button className="category-toolbar-btn" onClick={addRootCategory}>
              <AddIcon />
              <span>添加分类</span>
            </button>
            <button className="category-toolbar-btn" onClick={handleValidate}>
              <RefreshIcon />
              <span>验证</span>
            </button>
            <div className="category-toolbar-divider" />
            <button className="category-toolbar-btn" onClick={handleExport}>
              <ExportIcon />
              <span>导出</span>
            </button>
            <button className="category-toolbar-btn" onClick={handleImport}>
              <ImportIcon />
              <span>导入</span>
            </button>
          </div>

          {/* 内容区 */}
          <div className="dialog-body">
            {loading && (
              <div className="category-loading">加载中...</div>
            )}

            {error && (
              <div className="category-error">{error}</div>
            )}

            {validation && (
              <div className={`category-validation ${validation.is_valid ? 'valid' : 'invalid'}`}>
                <div className="validation-status">
                  {validation.is_valid ? '✓ 配置有效' : '✕ 配置无效'}
                </div>
                {validation.errors.length > 0 && (
                  <ul className="validation-errors">
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
                {validation.warnings.length > 0 && (
                  <ul className="validation-warnings">
                    {validation.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {config && !loading && (
              <div className="category-tree">
                {config.categories.length === 0 ? (
                  <div className="category-empty">
                    暂无分类配置，点击上方&quot;添加分类&quot;创建
                  </div>
                ) : (
                  config.categories.map((node) => (
                    <CategoryNodeItem
                      key={node.id}
                      node={node}
                      level={0}
                      operators={operators}
                      assignedOperators={currentAssigned}
                      onUpdate={updateNode}
                      onDelete={deleteNode}
                      onAddChild={addChild}
                      onToggleOperator={toggleOperator}
                    />
                  ))
                )}

                {uncategorizedOps.length > 0 && (
                  <div className="uncategorized-section">
                    <div className="uncategorized-title">
                      未分类算子 ({uncategorizedOps.length})
                    </div>
                    <div className="uncategorized-operators">
                      {uncategorizedOps.map((op) => (
                        <span key={op.id} className="operator-tag">
                          <OperatorIcon />
                          <span>{op.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="dialog-footer">
            <button className="dialog-btn secondary" onClick={onClose}>
              取消
            </button>
            <button
              className="dialog-btn primary"
              onClick={handleSave}
              disabled={saving || !config}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const CategoryConfigDialog = memo(CategoryConfigDialogComponent);
