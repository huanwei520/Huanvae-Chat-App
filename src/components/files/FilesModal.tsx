/**
 * 个人文件管理弹窗
 *
 * 功能：
 * - 文件列表展示（网格视图）
 * - 分类筛选：总览、图片、视频、文件
 * - 文件名搜索
 * - 文件预览和下载（本地优先）
 * - 文件上传（复用聊天上传进度条）
 *
 * 使用 useFileCache 服务实现本地优先和自动缓存
 * 图片和视频使用独立窗口预览，文档使用模态框预览
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useFiles, type FileCategory } from '../../hooks/useFiles';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useImageCache, useVideoCache } from '../../hooks/useFileCache';
import { formatFileSize, getFileCategory } from '../../api/storage';
import { SearchIcon, CloseIcon, UploadIcon } from '../common/Icons';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { UploadProgress } from '../../chat/shared/UploadProgress';
import { FilePreviewModal } from '../../chat/shared/FilePreviewModal';
import { openMediaWindow } from '../../media';
import { useSession, useApi } from '../../contexts/SessionContext';
import { getPresignedUrl, getCachedFilePath } from '../../services/fileCache';
import { invoke } from '@tauri-apps/api/core';
import { saveFileUuidHash } from '../../db';
import type { FileItem } from '../../api/storage';

// ============================================
// 类型定义
// ============================================

interface FilesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

/** 图片缩略图 - 使用 useImageCache */
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
      <div className="thumbnail-placeholder loading">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="thumbnail-placeholder error">
        <FileIcon contentType={file.content_type} />
      </div>
    );
  }

  return (
    <div className="thumbnail-image">
      {isLocal && <LocalBadge />}
      <img src={src} alt={file.filename} draggable={false} onLoad={onLoad} />
    </div>
  );
}

/** 视频缩略图 - 使用 useVideoCache */
function VideoThumbnail({
  file,
  onLocalPathFound,
}: {
  file: FileItem;
  onLocalPathFound?: (path: string | null, hash: string | null) => void;
}) {
  const { src, isLocal, loading, error, localPath } = useVideoCache(
    file.file_uuid,
    file.file_hash ?? null,
    file.filename,
    file.file_size,
    'user',
  );

  useEffect(() => {
    onLocalPathFound?.(localPath, file.file_hash ?? null);
  }, [localPath, file.file_hash, onLocalPathFound]);

  if (loading) {
    return (
      <div className="thumbnail-placeholder loading">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="thumbnail-placeholder error">
        <FileIcon contentType={file.content_type} />
      </div>
    );
  }

  return (
    <div className="thumbnail-video">
      {isLocal && <LocalBadge />}
      <video src={src} preload="metadata" />
      <div className="video-play-icon">▶</div>
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
    <div className="thumbnail-placeholder">
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
      <div className="files-loading">
        <LoadingSpinner />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="files-error">
        <span>❌ {error}</span>
      </div>
    );
  }

  if (filesCount === 0) {
    const emptyText = searchQuery ? '未找到匹配的文件' : '暂无文件，点击上方按钮上传';
    return (
      <div className="files-empty">
        <span className="empty-icon">📂</span>
        <span className="empty-text">{emptyText}</span>
      </div>
    );
  }

  return null;
}

// ============================================
// 动画变体
// ============================================

const modalVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, damping: 25, stiffness: 300 },
  },
  exit: { opacity: 0, scale: 0.95, y: 20 },
};

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
};

// ============================================
// 主组件
// ============================================

export function FilesModal({ isOpen, onClose }: FilesModalProps) {
  const { session } = useSession();

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
    refresh,
    loadMore,
  } = useFiles();

  // 文件上传 hook
  const { uploading, progress, uploadFile, resetUpload } = useFileUpload();

  // 预览状态
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewLocalPath, setPreviewLocalPath] = useState<string | null>(null);
  const [previewFileHash, setPreviewFileHash] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

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

  const api = useApi();

  // 预览文件
  const handlePreview = useCallback(
    async (file: FileItem) => {
      const fileCategory = getFileCategory(file.content_type);
      const cached = localInfoCache.get(file.file_uuid);
      let localPath = cached?.path ?? null;
      const fileHash = cached?.hash ?? file.file_hash ?? null;

      // 图片和视频使用独立窗口预览
      if (fileCategory === 'image' || fileCategory === 'video') {
        if (!session) { return; }

        // 如果没有本地路径，尝试通过 fileHash 获取
        if (!localPath && fileHash) {
          try {
            localPath = await getCachedFilePath(fileHash);
          } catch {
            // 忽略错误
          }
        }

        // 如果没有本地缓存，预先获取预签名 URL
        let presignedUrl: string | null = null;
        if (!localPath) {
          try {
            // eslint-disable-next-line no-console
            console.log('[FilesModal] 预获取预签名 URL:', file.file_uuid);
            const result = await getPresignedUrl(api, file.file_uuid, 'user');
            presignedUrl = result.url;
          } catch (err) {
            console.error('[FilesModal] 预获取预签名 URL 失败:', err);
            // 继续打开窗口，让窗口内部尝试获取
          }
        }

        openMediaWindow(
          {
            type: fileCategory as 'image' | 'video',
            fileUuid: file.file_uuid,
            filename: file.filename,
            fileSize: file.file_size,
            fileHash,
            urlType: 'user',
            localPath,
            presignedUrl,
          },
          {
            serverUrl: session.serverUrl,
            accessToken: session.accessToken,
          },
        );
        return;
      }

      // 文档使用模态框预览
      setPreviewFile(file);
      setPreviewLocalPath(localPath);
      setPreviewFileHash(fileHash);
    },
    [localInfoCache, session, api],
  );

  // 关闭预览
  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewLocalPath(null);
    setPreviewFileHash(null);
  }, []);

  // 触发文件选择 - 使用 Tauri 原生对话框获取本地路径
  const handleUploadClick = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: '所有支持的文件',
            extensions: [
              'jpg',
              'jpeg',
              'png',
              'gif',
              'webp',
              'mp4',
              'mov',
              'avi',
              'mkv',
              'webm',
              'pdf',
              'doc',
              'docx',
              'xls',
              'xlsx',
              'ppt',
              'pptx',
              'txt',
              'zip',
              'rar',
            ],
          },
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
          { name: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: '文档', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'] },
        ],
      });

      if (!selected) {
        return;
      }

      // Tauri 2.x 返回的是字符串路径
      const localPath = selected as unknown as string;
      const fileName = localPath.split(/[/\\]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      // 读取文件内容
      const fileBytes = await readFile(localPath);

      // 判断 MIME 类型
      let mimeType = 'application/octet-stream';
      if (['jpg', 'jpeg'].includes(ext)) {
        mimeType = 'image/jpeg';
      } else if (ext === 'png') {
        mimeType = 'image/png';
      } else if (ext === 'gif') {
        mimeType = 'image/gif';
      } else if (ext === 'webp') {
        mimeType = 'image/webp';
      } else if (ext === 'mp4') {
        mimeType = 'video/mp4';
      } else if (ext === 'mov') {
        mimeType = 'video/quicktime';
      } else if (['avi', 'mkv', 'webm'].includes(ext)) {
        mimeType = `video/${ext}`;
      } else if (ext === 'pdf') {
        mimeType = 'application/pdf';
      }

      // 创建 File 对象
      const file = new File([fileBytes], fileName, { type: mimeType });

      setUploadingFile(file);

      // 根据文件类型自动判断 fileType
      let fileType: 'user_image' | 'user_video' | 'user_document' = 'user_document';
      if (mimeType.startsWith('image/')) {
        fileType = 'user_image';
      } else if (mimeType.startsWith('video/')) {
        fileType = 'user_video';
      }

      const result = await uploadFile({
        file,
        fileType,
        storageLocation: 'user_files',
      });

      if (result.success) {
        // eslint-disable-next-line no-console
        console.log('%c[PersonalFiles] 个人文件上传成功', 'color: #4CAF50; font-weight: bold', {
          fileName: file.name,
          fileHash: result.fileHash,
          fileUuid: result.fileUuid,
          instant: result.instant,
          localPath,
        });

        // 保存 file_uuid 到 file_hash 的映射，并复制文件到统一缓存目录
        if (result.fileUuid && result.fileHash) {
          await saveFileUuidHash(result.fileUuid, result.fileHash);

          // 复制文件到统一缓存目录（大文件≥100MB不复制，记录原始路径）
          try {
            // 根据 MIME 类型确定文件类型
            let cacheFileType = 'document';
            if (mimeType.startsWith('image/')) {
              cacheFileType = 'image';
            } else if (mimeType.startsWith('video/')) {
              cacheFileType = 'video';
            }

            const { fileCache } = useSettingsStore.getState();
            const thresholdBytes = fileCache.largeFileThresholdMB * 1024 * 1024;
            const cachedPath = await invoke<string>('copy_file_to_cache', {
              sourcePath: localPath,
              fileHash: result.fileHash,
              fileName: fileName,
              fileType: cacheFileType,
              fileSize: file.size,
              largeFileThreshold: thresholdBytes,
            });
            // eslint-disable-next-line no-console
            console.log('%c[PersonalFiles] 文件已缓存到统一目录', 'color: #2196F3; font-weight: bold', {
              fileHash: result.fileHash,
              originalPath: localPath,
              cachedPath,
              isLargeFile: file.size >= thresholdBytes,
            });
          } catch (cacheErr) {
            console.error('[PersonalFiles] 缓存文件失败:', cacheErr);
          }
        }

        // 刷新文件列表
        await refresh();
      }

      // 延迟清除上传状态
      setTimeout(() => {
        setUploadingFile(null);
        resetUpload();
      }, 1500);
    } catch (err) {
      console.error('[PersonalFiles] 文件选择失败:', err);
      setUploadingFile(null);
      resetUpload();
    }
  }, [uploadFile, refresh, resetUpload]);

  // 取消上传
  const handleCancelUpload = useCallback(() => {
    setUploadingFile(null);
    resetUpload();
  }, [resetUpload]);

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // 判断是否显示文件列表
  const showFilesList = !loading && !error && files.length > 0;
  const showEmptyOrLoading = (loading && files.length === 0) || error || files.length === 0;

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="modal-content files-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <div className="files-header-left">
                <h2>我的文件</h2>
                <span className="files-count">{total} 个文件</span>
              </div>
              <div className="files-header-right">
                <motion.button
                  className="upload-btn"
                  onClick={handleUploadClick}
                  disabled={uploading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <UploadIcon />
                  <span>上传文件</span>
                </motion.button>
                <motion.button
                  className="close-btn"
                  onClick={onClose}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <CloseIcon />
                </motion.button>
              </div>
            </div>

            {/* 上传进度条 */}
            <AnimatePresence>
              {uploading && uploadingFile && progress && (
                <div className="files-upload-progress">
                  <UploadProgress
                    filename={uploadingFile.name}
                    fileSize={uploadingFile.size}
                    progress={progress}
                    onCancel={handleCancelUpload}
                  />
                </div>
              )}
            </AnimatePresence>

            {/* 搜索栏 */}
            <div className="files-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="搜索文件名..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* 分类标签 */}
            <div className="files-tabs">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`files-tab ${category === tab.key ? 'active' : ''}`}
                  onClick={() => setCategory(tab.key)}
                >
                  <span className="tab-icon">{tab.icon}</span>
                  <span className="tab-label">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* 文件列表 */}
            <div className="files-content">
              {showEmptyOrLoading && (
                <EmptyState
                  loading={loading}
                  error={error}
                  searchQuery={searchQuery}
                  filesCount={files.length}
                />
              )}

              {showFilesList && (
                <>
                  <div className="files-grid">
                    <AnimatePresence mode="popLayout">
                      {files.map((file, index) => (
                        <motion.div
                          key={file.file_uuid || `file-${index}`}
                          className="file-card"
                          variants={cardVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          transition={{ delay: index * 0.03 }}
                          onClick={() => handlePreview(file)}
                        >
                          <div className="file-thumbnail">
                            <FileThumbnail
                              file={file}
                              onLocalPathFound={(path, hash) =>
                                handleLocalPathFound(file.file_uuid, path, hash)
                              }
                            />
                          </div>
                          <div className="file-info">
                            <div className="file-name" title={file.filename}>
                              {file.filename}
                            </div>
                            <div className="file-meta">
                              <span className="file-size">{formatFileSize(file.file_size)}</span>
                              <span className="file-date">{formatDate(file.created_at)}</span>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {hasMore && (
                    <div className="files-load-more">
                      <button className="load-more-btn" onClick={loadMore} disabled={loading}>
                        {loading ? '加载中...' : '加载更多'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {createPortal(content, document.body)}

      {/* 文件预览模态框 */}
      <FilePreviewModal
        isOpen={!!previewFile}
        onClose={closePreview}
        fileUuid={previewFile?.file_uuid || ''}
        filename={previewFile?.filename || ''}
        contentType={previewFile?.content_type || ''}
        fileSize={previewFile?.file_size}
        localPath={previewLocalPath ?? undefined}
        fileHash={previewFileHash}
        urlType="user"
      />
    </>
  );
}
