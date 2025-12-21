/**
 * 文件管理 Hook
 *
 * 管理用户个人文件列表的加载、筛选和搜索
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  getFiles,
  getFileCategory,
  type FileItem,
  type FilesQueryParams,
} from '../api/storage';

export type FileCategory = 'all' | 'image' | 'video' | 'file';

interface UseFilesReturn {
  /** 文件列表（已筛选） */
  files: FileItem[];
  /** 所有文件（原始数据） */
  allFiles: FileItem[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前分类 */
  category: FileCategory;
  /** 搜索关键词 */
  searchQuery: string;
  /** 总文件数 */
  total: number;
  /** 当前页 */
  page: number;
  /** 是否有更多 */
  hasMore: boolean;
  /** 设置分类 */
  setCategory: (category: FileCategory) => void;
  /** 设置搜索关键词 */
  setSearchQuery: (query: string) => void;
  /** 刷新文件列表 */
  refresh: () => Promise<void>;
  /** 加载更多 */
  loadMore: () => Promise<void>;
}

export function useFiles(): UseFilesReturn {
  const api = useApi();

  // 状态
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<FileCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 加载文件列表
  const loadFiles = useCallback(async (params: FilesQueryParams = {}) => {
    setLoading(true);
    setError(null);

    try {
      const response = await getFiles(api, {
        page: params.page || 1,
        limit: params.limit || 50,
        sort_by: 'created_at',
        sort_order: 'desc',
      });

      if (params.page === 1 || !params.page) {
        setAllFiles(response.files);
      } else {
        setAllFiles((prev) => [...prev, ...response.files]);
      }

      setTotal(response.total);
      setPage(response.page);
      setHasMore(response.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // 初始加载
  useEffect(() => {
    loadFiles({ page: 1 });
  }, [loadFiles]);

  // 刷新
  const refresh = useCallback(async () => {
    await loadFiles({ page: 1 });
  }, [loadFiles]);

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) { return; }
    await loadFiles({ page: page + 1 });
  }, [loading, hasMore, page, loadFiles]);

  // 筛选后的文件列表
  const files = useMemo(() => {
    let filtered = allFiles;

    // 按分类筛选
    if (category !== 'all') {
      filtered = filtered.filter((file) => getFileCategory(file.content_type) === category);
    }

    // 按搜索关键词筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((file) =>
        file.filename.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [allFiles, category, searchQuery]);

  return {
    files,
    allFiles,
    loading,
    error,
    category,
    searchQuery,
    total,
    page,
    hasMore,
    setCategory,
    setSearchQuery,
    refresh,
    loadMore,
  };
}
