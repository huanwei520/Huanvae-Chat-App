/**
 * 个人文件管理弹窗
 *
 * 功能：
 * - 文件列表展示（网格视图）
 * - 分类筛选：总览、图片、视频、文件
 * - 文件名搜索
 * - 文件预览和下载
 * - 文件上传（复用聊天上传进度条）
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { useFiles, type FileCategory } from '../../hooks/useFiles';
import { useFileUpload, getPresignedUrl } from '../../hooks/useFileUpload';
import { useApi } from '../../contexts/SessionContext';
import { formatFileSize, getFileCategory } from '../../api/storage';
import { SearchIcon, CloseIcon, UploadIcon } from '../common/Icons';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { UploadProgress } from '../chat/UploadProgress';
import { FilePreviewModal } from '../chat/FilePreviewModal';
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

/** 缩略图 - 本地优先加载（与好友/群聊消息一致） */
function FileThumbnail({ file, onLocalPathFound }: { file: FileItem; onLocalPathFound?: (path: string | null) => void }) {
  const api = useApi();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isLocal, setIsLocal] = useState(false);

  const category = getFileCategory(file.content_type);
  const isImage = category === 'image';
  const isVideo = category === 'video';

  // 本地优先加载（与 FileMessageContent 一致）
  useEffect(() => {
    // 只有图片和视频需要加载缩略图
    if (!isImage && !isVideo) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);

    const loadFile = async () => {
      try {
        // 1. 尝试从本地数据库获取 file_hash
        const { getFileHashByUuid } = await import('../../db');
        const fileHash = await getFileHashByUuid(file.file_uuid);

        if (fileHash) {
          // 2. 获取远程 URL 作为备用
          const remoteUrl = await getPresignedUrl(api, file.file_uuid);

          // 3. 检查本地文件
          const { getFileSource } = await import('../../services/fileService');
          const result = await getFileSource(fileHash, remoteUrl, file.file_size);

          setThumbnailUrl(result.url);
          setIsLocal(result.source === 'local');
          onLocalPathFound?.(result.localPath || null);
        } else {
          // 无 file_hash，直接使用远程
          const url = await getPresignedUrl(api, file.file_uuid);
          setThumbnailUrl(url);
          setIsLocal(false);
          onLocalPathFound?.(null);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [api, file.file_uuid, file.file_size, isImage, isVideo, onLocalPathFound]);

  // 加载中
  if (loading) {
    return (
      <div className="thumbnail-placeholder loading">
        <LoadingSpinner />
      </div>
    );
  }

  // 加载失败
  if (error) {
    return (
      <div className="thumbnail-placeholder error">
        <FileIcon contentType={file.content_type} />
      </div>
    );
  }

  // 图片缩略图
  if (isImage && thumbnailUrl) {
    return (
      <div className="thumbnail-image">
        {isLocal && <span className="file-local-badge" title="本地文件">📁</span>}
        <img src={thumbnailUrl} alt={file.filename} draggable={false} />
      </div>
    );
  }

  // 视频缩略图
  if (isVideo && thumbnailUrl) {
    return (
      <div className="thumbnail-video">
        {isLocal && <span className="file-local-badge" title="本地文件">📁</span>}
        <video src={thumbnailUrl} preload="metadata" />
        <div className="video-play-icon">▶</div>
      </div>
    );
  }

  // 文件图标（默认）
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
  const {
    uploading,
    progress,
    uploadFile,
    resetUpload,
  } = useFileUpload();

  // 预览状态 - 存储文件信息用于 FilePreviewModal
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewLocalPath, setPreviewLocalPath] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  // 预览文件 - 先查找本地路径
  const handlePreview = useCallback(async (file: FileItem) => {
    setPreviewFile(file);
    
    // 尝试获取本地路径
    try {
      const { getFileHashByUuid, getFileMapping } = await import('../../db');
      const fileHash = await getFileHashByUuid(file.file_uuid);
      
      if (fileHash) {
        const mapping = await getFileMapping(fileHash);
        if (mapping?.local_path) {
          setPreviewLocalPath(mapping.local_path);
          // eslint-disable-next-line no-console
          console.log('[PersonalFiles] 预览使用本地文件', {
            fileUuid: file.file_uuid,
            fileHash,
            localPath: mapping.local_path,
          });
          return;
        }
      }
    } catch {
      // 查找失败，使用远程
    }
    
    setPreviewLocalPath(null);
  }, []);

  // 关闭预览
  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewLocalPath(null);
  }, []);

  // 触发文件选择 - 使用 Tauri 原生对话框获取本地路径
  const handleUploadClick = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: '所有支持的文件',
            extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar'],
          },
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
          { name: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: '文档', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'] },
        ],
      });

      if (!selected) { return; }

      // Tauri 2.x 返回的是字符串路径
      const localPath = selected as unknown as string;
      const fileName = localPath.split(/[/\\]/).pop() || 'file';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      // 读取文件内容
      const fileBytes = await readFile(localPath);
      const fileStat = await stat(localPath);
      const fileSize = fileStat.size;

      // 判断 MIME 类型
      let mimeType = 'application/octet-stream';
      if (['jpg', 'jpeg'].includes(ext)) { mimeType = 'image/jpeg'; }
      else if (ext === 'png') { mimeType = 'image/png'; }
      else if (ext === 'gif') { mimeType = 'image/gif'; }
      else if (ext === 'webp') { mimeType = 'image/webp'; }
      else if (ext === 'mp4') { mimeType = 'video/mp4'; }
      else if (ext === 'mov') { mimeType = 'video/quicktime'; }
      else if (['avi', 'mkv', 'webm'].includes(ext)) { mimeType = `video/${ext}`; }
      else if (ext === 'pdf') { mimeType = 'application/pdf'; }

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

        // 保存 file_uuid 到 file_hash 的映射
        if (result.fileUuid && result.fileHash) {
          const { saveFileUuidHash, saveFileMapping } = await import('../../db');
          await saveFileUuidHash(result.fileUuid, result.fileHash);
          
          // 保存 file_hash -> local_path 的映射（与好友/群聊文件一致）
          await saveFileMapping({
            file_hash: result.fileHash,
            local_path: localPath,
            file_size: fileSize,
            file_name: fileName,
            content_type: mimeType,
            source: 'uploaded',
            last_verified: new Date().toISOString(),
          });
          
          // eslint-disable-next-line no-console
          console.log('%c[PersonalFiles] 保存本地文件映射', 'color: #2196F3; font-weight: bold', {
            fileHash: result.fileHash,
            localPath,
          });
          // eslint-disable-next-line no-console
          console.log('%c[PersonalFiles] 保存 UUID-Hash 映射', 'color: #FF9800; font-weight: bold', {
            fileUuid: result.fileUuid,
            fileHash: result.fileHash,
          });
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
                            <FileThumbnail file={file} />
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
                      <button
                        className="load-more-btn"
                        onClick={loadMore}
                        disabled={loading}
                      >
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

      {/* 文件预览模态框 - 与群聊/好友界面一致，使用 createPortal 独立渲染 */}
      <FilePreviewModal
        isOpen={!!previewFile}
        onClose={closePreview}
        fileUuid={previewFile?.file_uuid || ''}
        filename={previewFile?.filename || ''}
        contentType={previewFile?.content_type || ''}
        fileSize={previewFile?.file_size}
        localPath={previewLocalPath || undefined}
      />
    </>
  );
}
