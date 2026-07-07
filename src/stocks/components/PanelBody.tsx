/**
 * 面板状态包装：loading / error / empty / 内容 四态收口。
 *
 * 用早返回替代 JSX 内嵌套三元（满足 no-nested-ternary），各面板统一复用。
 */

import type { ReactNode } from 'react';
import { ListLoading, ListError, ListEmpty } from '../../components/common/ListStates';
import { isSnapshotMissing } from '../classify';

interface PanelBodyProps {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  /**
   * 需求驱动端点专用：后端 404「快照不存在」按优雅空态（灰字 emptyMessage）渲染，
   * 而非红字「加载失败」；网络 / 500 等真错误仍红字报错。默认 false —— 总览类恒可用
   * 端点保持"任何错误即红字"，不受影响（防回归）。
   */
  gracefulNotFound?: boolean;
  children: ReactNode;
}

export function PanelBody({
  loading,
  error,
  isEmpty,
  loadingMessage = '加载中...',
  emptyMessage = '暂无数据',
  gracefulNotFound = false,
  children,
}: PanelBodyProps) {
  if (loading) { return <ListLoading message={loadingMessage} />; }
  // 404「快照不存在」视为"暂无数据"走灰字空态；真错误（网络 / 500）仍红字报错。
  const notFound = gracefulNotFound && isSnapshotMissing(error);
  if (error && !notFound) { return <ListError error={error} />; }
  if (notFound || isEmpty) { return <ListEmpty message={emptyMessage} />; }
  return <>{children}</>;
}
