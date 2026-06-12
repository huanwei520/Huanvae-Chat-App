/**
 * DAG 自动布局工具
 *
 * 使用 dagre 库实现流程图的自动布局
 *
 * ## 使用方式
 * ```typescript
 * import { getLayoutedElements } from './layout';
 *
 * // 基础用法（使用默认尺寸）
 * const layoutedNodes = getLayoutedElements(nodes, edges, { direction: 'LR' });
 *
 * // 使用实际测量的节点尺寸（推荐）
 * const nodeSizes = new Map([
 *   ['node-1', { width: 200, height: 150 }],
 *   ['node-2', { width: 180, height: 120 }],
 * ]);
 * const layoutedNodes = getLayoutedElements(nodes, edges, {
 *   direction: 'LR',
 *   nodeSizes,
 * });
 * ```
 *
 * @module lowcode/utils/layout
 * @created 2026-01-26
 * @updated 2026-02-02 添加动态节点尺寸支持
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

// ============================================================================
// 类型定义
// ============================================================================

/** 布局方向 */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

/** 节点尺寸 */
export interface NodeSize {
  width: number;
  height: number;
}

/** 布局选项 */
export interface LayoutOptions {
  /** 布局方向：TB=从上到下, LR=从左到右, BT=从下到上, RL=从右到左 */
  direction?: LayoutDirection;
  /** 节点水平间距（默认 50） */
  nodesep?: number;
  /** 层级间距（默认 80） */
  ranksep?: number;
  /** 默认节点宽度（当 nodeSizes 中没有时使用，默认 200） */
  nodeWidth?: number;
  /** 默认节点高度（当 nodeSizes 中没有时使用，默认 150） */
  nodeHeight?: number;
  /** 节点尺寸映射（键为节点 ID，值为测量的尺寸） */
  nodeSizes?: Map<string, NodeSize>;
  /** 节点对齐方式：UL=左上, UR=右上, DL=左下, DR=右下, undefined=居中 */
  align?: 'UL' | 'UR' | 'DL' | 'DR';
  /** 层级分配算法：network-simplex（默认）, tight-tree, longest-path */
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
}

// ============================================================================
// 布局函数
// ============================================================================

/**
 * 对节点进行自动布局
 *
 * @param nodes - React Flow 节点数组
 * @param edges - React Flow 边数组
 * @param options - 布局选项
 * @returns 更新位置后的节点数组
 *
 * @example
 * ```typescript
 * // 使用动态尺寸
 * const nodeSizes = new Map();
 * nodes.forEach(node => {
 *   const internalNode = getInternalNode(node.id);
 *   if (internalNode?.measured) {
 *     nodeSizes.set(node.id, internalNode.measured);
 *   }
 * });
 * const layoutedNodes = getLayoutedElements(nodes, edges, {
 *   direction: 'LR',
 *   nodeSizes,
 * });
 * ```
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  const {
    direction = 'LR',
    nodesep = 50,
    ranksep = 80,
    nodeWidth = 200,
    nodeHeight = 150,
    nodeSizes,
    align,
    ranker = 'network-simplex',
  } = options;

  // 创建 dagre 图
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep,
    ranksep,
    marginx: 50,
    marginy: 50,
    align,
    ranker,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // 添加节点（使用实际测量的尺寸或默认值）
  nodes.forEach((node) => {
    const measured = nodeSizes?.get(node.id);
    g.setNode(node.id, {
      width: measured?.width || nodeWidth,
      height: measured?.height || nodeHeight,
    });
  });

  // 添加边
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // 执行布局计算
  dagre.layout(g);

  // 更新节点位置
  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) {
      return node;
    }

    // 使用实际尺寸计算偏移
    const measured = nodeSizes?.get(node.id);
    const width = measured?.width || nodeWidth;
    const height = measured?.height || nodeHeight;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });
}

/**
 * 从 React Flow 内部节点获取节点尺寸映射
 *
 * @param nodes - 节点数组
 * @param getInternalNode - React Flow 的 getInternalNode 函数
 * @returns 节点尺寸映射
 */
export function getNodeSizesFromInternals(
  nodes: Node[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getInternalNode: (id: string) => any,
): Map<string, NodeSize> {
  const sizes = new Map<string, NodeSize>();

  nodes.forEach((node) => {
    const internalNode = getInternalNode(node.id);
    if (internalNode?.measured) {
      sizes.set(node.id, {
        width: internalNode.measured.width,
        height: internalNode.measured.height,
      });
    }
  });

  return sizes;
}
