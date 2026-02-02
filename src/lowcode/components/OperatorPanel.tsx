/**
 * 算子面板组件
 *
 * 显示可用算子列表，支持分类筛选和拖拽
 * 支持使用自定义分类配置
 *
 * @module lowcode/components/OperatorPanel
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { fetchOperators } from '../services/operatorService';
import { OperatorDetailDialog } from './OperatorDetailDialog';
import type { Operator, CategoryConfig, CategoryNode } from '../types/lowcode';
import type { CategoryService } from '../services/categoryService';

// ============================================================================
// 类型定义
// ============================================================================

interface OperatorPanelProps {
  /** 服务器地址 */
  serverUrl: string;
  /** 拖拽开始回调 */
  onDragStart?: (operator: Operator) => void;
  /** 分类配置服务（可选，用于加载自定义分类） */
  categoryService?: CategoryService | null;
}

// ============================================================================
// 图标组件
// ============================================================================

const OperatorIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="operator-icon"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
    />
  </svg>
);

const RefreshIcon = () => (
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
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width={12}
    height={12}
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s',
    }}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
  </svg>
);

const FolderIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width={14}
    height={14}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

// ============================================================================
// 算子卡片组件
// ============================================================================

interface OperatorCardProps {
  operator: Operator;
  onDragStart?: (operator: Operator) => void;
  onShowDetail?: (operator: Operator) => void;
}

function OperatorCard({ operator, onDragStart, onShowDetail }: OperatorCardProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // 设置拖拽数据（使用多种 MIME 类型确保兼容性）
      const operatorData = JSON.stringify(operator);
      e.dataTransfer.setData('application/json', operatorData);
      e.dataTransfer.setData('application/reactflow', operatorData);
      e.dataTransfer.setData('text/plain', operatorData);
      e.dataTransfer.effectAllowed = 'move';
      console.log('[OperatorCard] 开始拖拽算子:', operator.name);
      onDragStart?.(operator);
    },
    [operator, onDragStart],
  );

  const handleDoubleClick = useCallback(() => {
    onShowDetail?.(operator);
  }, [operator, onShowDetail]);

  return (
    <motion.div
      className="operator-card"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div
        className="operator-card-inner"
        draggable
        onDragStart={handleDragStart}
        onDoubleClick={handleDoubleClick}
        title={`${operator.description || operator.name}\n双击查看详情`}
      >
        <div className="operator-card-icon">
          <OperatorIcon />
        </div>
        <div className="operator-card-content">
          <div className="operator-card-name">{operator.name}</div>
          <div className="operator-card-meta">
            <span className="operator-card-io">
              {operator.inputs?.length || 0} 输入 / {operator.outputs?.length || 0} 输出
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// 分类树节点组件
// ============================================================================

interface CategoryTreeNodeProps {
  node: CategoryNode;
  operators: Operator[];
  operatorMap: Map<string, Operator>;
  level: number;
  onDragStart?: (operator: Operator) => void;
  onShowDetail?: (operator: Operator) => void;
}

function CategoryTreeNode({
  node,
  operators,
  operatorMap,
  level,
  onDragStart,
  onShowDetail,
}: CategoryTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);

  const hasChildren = node.children && node.children.length > 0;
  const nodeOperators = (node.operators || [])
    .map((id) => operatorMap.get(id))
    .filter((op): op is Operator => op !== undefined);

  return (
    <div className="category-tree-node">
      <div
        className="category-tree-header"
        onClick={() => setExpanded(!expanded)}
        style={{ paddingLeft: level * 12 + 8 }}
      >
        <ChevronIcon expanded={expanded} />
        <FolderIcon />
        <span className="category-tree-name">{node.name}</span>
        {nodeOperators.length > 0 && (
          <span className="category-tree-count">({nodeOperators.length})</span>
        )}
      </div>

      {expanded && (
        <div className="category-tree-content">
          {/* 子分类 */}
          {hasChildren &&
            node.children!.map((child) => (
              <CategoryTreeNode
                key={child.id}
                node={child}
                operators={operators}
                operatorMap={operatorMap}
                level={level + 1}
                onDragStart={onDragStart}
                onShowDetail={onShowDetail}
              />
            ))}

          {/* 该分类下的算子 */}
          {nodeOperators.length > 0 && (
            <div className="category-tree-operators" style={{ paddingLeft: (level + 1) * 12 + 8 }}>
              {nodeOperators.map((op) => (
                <OperatorCard
                  key={op.id}
                  operator={op}
                  onDragStart={onDragStart}
                  onShowDetail={onShowDetail}
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

export function OperatorPanel({
  serverUrl,
  onDragStart,
  categoryService,
}: OperatorPanelProps) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [defaultCategories, setDefaultCategories] = useState<string[]>([]);
  const [customConfig, setCustomConfig] = useState<CategoryConfig | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useCustomCategories, setUseCustomCategories] = useState(false);
  const [detailOperator, setDetailOperator] = useState<Operator | null>(null);

  // 显示算子详情
  const handleShowDetail = useCallback((operator: Operator) => {
    setDetailOperator(operator);
  }, []);

  // 算子 ID 到算子的映射
  const operatorMap = useMemo(() => {
    const map = new Map<string, Operator>();
    operators.forEach((op) => map.set(op.id, op));
    return map;
  }, [operators]);

  // 加载算子列表
  const loadOperators = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchOperators(serverUrl);
      setOperators(result.operators);
      setDefaultCategories(result.categories);
    } catch (e) {
      console.error('[OperatorPanel] 加载算子失败:', e);
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  // 加载自定义分类配置
  const loadCustomConfig = useCallback(async () => {
    if (!categoryService) { return; }

    try {
      const config = await categoryService.getConfig();
      if (config && config.categories && config.categories.length > 0) {
        setCustomConfig(config);
        setUseCustomCategories(true);
      }
    } catch {
      // 没有自定义配置，使用默认分类
      setUseCustomCategories(false);
    }
  }, [categoryService]);

  // 初始化加载
  useEffect(() => {
    loadOperators();
  }, [loadOperators]);

  // 加载自定义分类
  useEffect(() => {
    if (categoryService) {
      loadCustomConfig();
    }
  }, [categoryService, loadCustomConfig]);

  // 过滤算子（仅在使用默认分类时）
  const filteredOperators = useMemo(() => {
    if (useCustomCategories) { return operators; }
    return selectedCategory
      ? operators.filter((op) => op.category === selectedCategory)
      : operators;
  }, [operators, selectedCategory, useCustomCategories]);

  // 加载中状态
  if (loading) {
    return (
      <div className="operator-panel">
        <div className="operator-panel-header">
          <span>算子列表</span>
        </div>
        <div className="operator-panel-loading">
          <div className="loading-spinner-small" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="operator-panel">
        <div className="operator-panel-header">
          <span>算子列表</span>
          <button className="refresh-btn" onClick={loadOperators} title="重试">
            <RefreshIcon />
          </button>
        </div>
        <div className="operator-panel-error">
          <span>{error}</span>
          <button onClick={loadOperators}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="operator-panel">
      {/* 头部 */}
      <div className="operator-panel-header">
        <span>算子列表</span>
        <button className="refresh-btn" onClick={loadOperators} title="刷新">
          <RefreshIcon />
        </button>
      </div>

      {/* 分类模式切换 */}
      {customConfig && (
        <div className="category-mode-toggle">
          <button
            className={`mode-btn ${!useCustomCategories ? 'active' : ''}`}
            onClick={() => setUseCustomCategories(false)}
          >
            默认分类
          </button>
          <button
            className={`mode-btn ${useCustomCategories ? 'active' : ''}`}
            onClick={() => setUseCustomCategories(true)}
          >
            自定义分类
          </button>
        </div>
      )}

      {/* 使用自定义分类树 */}
      {useCustomCategories && customConfig ? (
        <div className="operator-tree">
          {customConfig.categories.map((node) => (
            <CategoryTreeNode
              key={node.id}
              node={node}
              operators={operators}
              operatorMap={operatorMap}
              level={0}
              onDragStart={onDragStart}
              onShowDetail={handleShowDetail}
            />
          ))}

          {/* 未分类算子 */}
          {customConfig.uncategorized && customConfig.uncategorized.length > 0 && (
            <div className="category-tree-node">
              <div className="category-tree-header uncategorized">
                <FolderIcon />
                <span className="category-tree-name">未分类</span>
                <span className="category-tree-count">
                  ({customConfig.uncategorized.length})
                </span>
              </div>
              <div className="category-tree-operators" style={{ paddingLeft: 20 }}>
                {customConfig.uncategorized
                  .map((id) => operatorMap.get(id))
                  .filter((op): op is Operator => op !== undefined)
                  .map((op) => (
                    <OperatorCard
                      key={op.id}
                      operator={op}
                      onDragStart={onDragStart}
                      onShowDetail={handleShowDetail}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 默认分类筛选 */}
          {defaultCategories.length > 0 && (
            <div className="operator-categories">
              <button
                className={`category-btn ${selectedCategory === null ? 'active' : ''}`}
                onClick={() => setSelectedCategory(null)}
              >
                全部
              </button>
              {defaultCategories.map((cat) => (
                <button
                  key={cat}
                  className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* 算子列表 */}
          <div className="operator-list">
            {filteredOperators.length === 0 ? (
              <div className="operator-empty">暂无算子</div>
            ) : (
              filteredOperators.map((operator) => (
                <OperatorCard
                  key={operator.id}
                  operator={operator}
                  onDragStart={onDragStart}
                  onShowDetail={handleShowDetail}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* 统计信息 */}
      <div className="operator-panel-footer">
        共 {operators.length} 个算子
      </div>

      {/* 算子详情对话框 */}
      <OperatorDetailDialog
        isOpen={detailOperator !== null}
        onClose={() => setDetailOperator(null)}
        operator={detailOperator}
      />
    </div>
  );
}

export default OperatorPanel;
