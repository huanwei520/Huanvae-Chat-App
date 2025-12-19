/**
 * 列表状态组件
 * 
 * 用于显示列表的加载中、错误、空状态
 */

import { LoadingSpinner } from './LoadingSpinner';

interface ListLoadingProps {
  message?: string;
}

export function ListLoading({ message = '加载中...' }: ListLoadingProps) {
  return (
    <div className="list-loading">
      <LoadingSpinner />
      <span className="conv-text">{message}</span>
    </div>
  );
}

interface ListErrorProps {
  error: string;
}

export function ListError({ error }: ListErrorProps) {
  return (
    <div className="list-error">
      <span className="conv-text">加载失败: {error}</span>
    </div>
  );
}

interface ListEmptyProps {
  message: string;
}

export function ListEmpty({ message }: ListEmptyProps) {
  return (
    <div className="list-empty">
      <span className="conv-text">{message}</span>
    </div>
  );
}

