/**
 * 移动端个人文件页面
 *
 * 功能：
 * - 文件列表展示（网格视图）
 * - 分类筛选：总览、图片、视频、文件
 * - 文件名搜索
 * - 文件预览（使用 MobileMediaPreview）
 *
 * 样式：
 * - 使用与抽屉一致的白色毛玻璃效果
 * - 颜色通过 CSS 变量统一管理，支持主题切换
 *
 * 注意：
 * - 移动端不支持 openMediaWindow（WebviewWindow）
 * - 使用 MobileMediaPreview 进行图片/视频预览
 * - 暂不支持文件上传（需要适配移动端文件选择器）
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFiles, type FileCategory } from '../../hooks/useFiles';
import { useImageCache } from '../../hooks/useFileCache';
import { getFileCategory } from '../../api/storage';
import { formatFileSize } from '../../utils/format';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { MobileMediaPreview } from '../../chat/shared/MobileMediaPreview';
import { useSession, useApi } from '../../contexts/SessionContext';
import { getPresignedUrl, getCachedFilePath, getVideoSource } from '../../services/fileCache';
import type { FileItem } from '../../api/storage';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// 搜索图标
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
    />
  </svg>
);

// ============================================
// 分类标签配置
// ============================================

const CATEGORY_TABS: { key: FileCategory; label: string; icon: string }[] = [
  { key: 'all', label: '总览', icon: '📁' },
  { key: 'image', label: '图片', icon: '🖼️' },
  { key: 'video', label: '视频', icon: '🎬' },
  { key: 'file', label: '文件', icon: '📄' },
];

// ============================================
// 子组件
// ============================================

/** 文件图标 */
function FileIcon({ contentType }: { contentType: string }) {
  const category = getFileCategory(contentType);

  if (category === 'image') {
    return <span className="file-icon image">🖼️</span>;
  }
  if (category === 'video') {
    return <span className="file-icon video">🎬</span>;
  }
  return <span className="file-icon document">📄</span>;
}

/** 本地文件标识 */
function LocalBadge() {
  return (
    <span className="file-local-badge" title="本地文件">
      📁
    </span>
  );
}

/** 图片缩略图 */
function ImageThumbnail({
  file,
  onLocalPathFound,
}: {
  file: FileItem;
  onLocalPathFound?: (path: string | null, hash: string | null) => void;
}) {
  const { src, isLocal, loading, error, onLoad, localPath } = useImageCache(
    file.file_uuid,
    file.file_hash ?? null,
    file.filename,
    'user',
  );

  useEffect(() => {
    onLocalPathFound?.(localPath, file.file_hash ?? null);
  }, [localPath, file.file_hash, onLocalPathFound]);

  if (loading) {
    return (
      <div className="mobile-file-thumbnail-placeholder loading">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="mobile-file-thumbnail-placeholder error">
        <FileIcon contentType={file.content_type} />
      </div>
    );
  }

  return (
    <div className="mobile-file-thumbnail-image">
      {isLocal && <LocalBadge />}
      <img src={src} alt={file.filename} draggable={false} onLoad={onLoad} />
    </div>
  );
}

/** 视频缩略图 - 使用 getVideoSource 获取移动端兼容的视频 URL */
function VideoThumbnail({
  file,
  onLocalPathFound,
}: {
  file: FileItem;
  onLocalPathFound?: (path: string | null, hash: string | null) => void;
}) {
  const api = useApi();
  const [src, setSrc] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadVideoSource() {
      try {
        setLoading(true);
        setError(false);

        // 使用 getVideoSource 获取移动端兼容的视频 URL
        // 本地视频会通过 HTTP 服务器提供，远程视频使用预签名 URL
        const result = await getVideoSource(
          api,
          file.file_uuid,
          file.file_hash,
          'user',
        );

        if (!cancelled) {
          setSrc(result.src);
          setIsLocal(result.isLocal);
          onLocalPathFound?.(result.isLocal ? result.src : null, file.file_hash ?? null);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadVideoSource();

    return () => {
      cancelled = true;
    };
  }, [api, file.file_uuid, file.file_hash, onLocalPathFound]);

  if (loading) {
    return (
      <div className="mobile-file-thumbnail-placeholder loading">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="mobile-file-thumbnail-placeholder error">
        <FileIcon contentType={file.content_type} />
      </div>
    );
  }

  return (
    <div className="mobile-file-thumbnail-video">
      {isLocal && <LocalBadge />}
      <video
        src={src}
        preload="metadata"
        muted
        playsInline
        onLoadedData={(e) => {
          // 暂停在第一帧作为缩略图
          const video = e.currentTarget;
          video.currentTime = 0;
          video.pause();
        }}
      />
      <div className="mobile-file-play-icon">▶</div>
    </div>
  );
}

/** 文件缩略图分发器 */
function FileThumbnail({
  file,
  onLocalPathFound,
}: {
  file: FileItem;
  onLocalPathFound?: (path: string | null, hash: string | null) => void;
}) {
  const category = getFileCategory(file.content_type);

  if (category === 'image') {
    return <ImageThumbnail file={file} onLocalPathFound={onLocalPathFound} />;
  }

  if (category === 'video') {
    return <VideoThumbnail file={file} onLocalPathFound={onLocalPathFound} />;
  }

  // 普通文件
  return (
    <div className="mobile-file-thumbnail-placeholder">
      <FileIcon contentType={file.content_type} />
    </div>
  );
}

/** 空状态 */
function EmptyState({
  loading,
  error,
  searchQuery,
  filesCount,
}: {
  loading: boolean;
  error: string | null;
  searchQuery: string;
  filesCount: number;
}) {
  if (loading && filesCount === 0) {
    return (
      <div className="mobile-files-loading">
        <LoadingSpinner />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mobile-files-error">
        <span>❌ {error}</span>
      </div>
    );
  }

  if (filesCount === 0) {
    const emptyText = searchQuery ? '未找到匹配的文件' : '暂无文件';
    return (
      <div className="mobile-files-empty">
        <span className="empty-icon">📂</span>
        <span className="empty-text">{emptyText}</span>
      </div>
    );
  }

  return null;
}

// ============================================
// 类型定义
// ============================================

interface MobileFilesPageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

// ============================================
// 主组件
// ============================================

export function MobileFilesPage({ onClose }: MobileFilesPageProps) {
  const { session } = useSession();
  const api = useApi();

  // 文件列表 hook
  const {
    files,
    loading,
    error,
    category,
    searchQuery,
    total,
    hasMore,
    setCategory,
    setSearchQuery,
    loadMore,
  } = useFiles();

  // 预览状态
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewFilename, setPreviewFilename] = useState('');

  // 缓存每个文件的本地信息
  const [localInfoCache] = useState<Map<string, { path: string | null; hash: string | null }>>(
    new Map(),
  );

  // 更新文件本地信息
  const handleLocalPathFound = useCallback(
    (fileUuid: string, path: string | null, hash: string | null) => {
      localInfoCache.set(fileUuid, { path, hash });
    },
    [localInfoCache],
  );

  // 预览文件
  const handlePreview = useCallback(
    async (file: FileItem) => {
      const fileCategory = getFileCategory(file.content_type);

      // 只支持图片和视频预览
      if (fileCategory !== 'image' && fileCategory !== 'video') {
        return;
      }

      if (!session) {
        return;
      }

      let previewUrl: string;

      if (fileCategory === 'video') {
        // 视频：使用 getVideoSource 获取移动端兼容的 URL
        // 本地视频通过 HTTP 服务器提供，远程视频使用预签名 URL
        try {
          const result = await getVideoSource(api, file.file_uuid, file.file_hash, 'user');
          previewUrl = result.src;
        } catch (err) {
          console.error('[MobileFilesPage] 获取视频 URL 失败:', err);
          return;
        }
      } else {
        // 图片：使用原有逻辑（asset:// 协议对图片有效）
        const cached = localInfoCache.get(file.file_uuid);
        let localPath = cached?.path ?? null;
        const fileHash = cached?.hash ?? file.file_hash ?? null;

        // 如果没有本地路径，尝试通过 fileHash 获取
        if (!localPath && fileHash) {
          try {
            localPath = await getCachedFilePath(fileHash);
          } catch {
            // 忽略错误
          }
        }

        if (localPath) {
          // 使用本地路径
          const { convertFileSrc } = await import('@tauri-apps/api/core');
          previewUrl = convertFileSrc(localPath);
        } else {
          // 获取预签名 URL
          try {
            const result = await getPresignedUrl(api, file.file_uuid, 'user');
            previewUrl = result.url;
          } catch (err) {
            console.error('[MobileFilesPage] 获取预签名 URL 失败:', err);
            return;
          }
        }
      }

      setPreviewType(fileCategory as 'image' | 'video');
      setPreviewSrc(previewUrl);
      setPreviewFilename(file.filename);
      setPreviewOpen(true);
    },
    [session, api, localInfoCache],
  );

  // 页面动画
  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  // 卡片动画
  const cardVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="mobile-files-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-files-header">
        <button className="mobile-files-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-files-title">我的文件</h1>
        <div className="mobile-files-placeholder" />
      </header>

      {/* 搜索栏 */}
      <div className="mobile-files-search">
        <div className="mobile-files-search-input">
          <SearchIcon />
          <input
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 分类标签 */}
      <div className="mobile-files-tabs">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`mobile-files-tab ${category === tab.key ? 'active' : ''}`}
            onClick={() => setCategory(tab.key)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 文件统计 */}
      <div className="mobile-files-stats">
        <span>共 {total} 个文件</span>
      </div>

      {/* 文件列表 */}
      <div className="mobile-files-content">
        <EmptyState
          loading={loading}
          error={error}
          searchQuery={searchQuery}
          filesCount={files.length}
        />

        {files.length > 0 && (
          <div className="mobile-files-grid">
            <AnimatePresence>
              {files.map((file, index) => (
                <motion.div
                  key={file.file_uuid}
                  className="mobile-file-card"
                  variants={cardVariants}
                  initial="initial"
                  animate="animate"
                  transition={{ delay: index * 0.03 }}
                  onClick={() => handlePreview(file)}
                >
                  <div className="mobile-file-thumbnail">
                    <FileThumbnail
                      file={file}
                      onLocalPathFound={(path, hash) =>
                        handleLocalPathFound(file.file_uuid, path, hash)
                      }
                    />
                  </div>
                  <div className="mobile-file-info">
                    <div className="mobile-file-name" title={file.filename}>
                      {file.filename}
                    </div>
                    <div className="mobile-file-size">{formatFileSize(file.file_size)}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* 加载更多 */}
        {hasMore && (
          <div className="mobile-files-load-more">
            <button
              className="mobile-files-load-more-btn"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? <LoadingSpinner /> : '加载更多'}
            </button>
          </div>
        )}
      </div>

      {/* 媒体预览 */}
      <MobileMediaPreview
        isOpen={previewOpen}
        type={previewType}
        src={previewSrc}
        filename={previewFilename}
        onClose={() => setPreviewOpen(false)}
      />
    </motion.div>
  );
}
