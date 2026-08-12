/**
 * 移动端个人文件页面
 *
 * 功能：
 * - 文件列表展示（网格视图）
 * - 分类筛选：总览、图片、视频、文件
 * - 文件名搜索
 * - 文件预览：图片/视频用 MobileMediaPreview，文档用 FilePreviewModal
 *   （文档预览内的下载/打开行为通过 DocumentDownloadAction 共享，与桌面端「我的文件」一致）
 * - 长按 500ms 触发文件菜单：在文件夹中打开（已下载）/ 下载文件（未下载文档）/ 删除文件（含确认）
 * - 文件上传：与桌面端 FilesModal.handleUploadClick 完全一致的逻辑（plugin-dialog + plugin-fs + useFileUpload + copy_file_to_cache）
 * - 已下载图片/视频缩略图右上角文件夹徽章点击打开文件位置（移动端走 openWithExternalApp）
 *
 * 样式：
 * - 使用与抽屉一致的白色毛玻璃效果
 * - 颜色通过 CSS 变量统一管理，支持主题切换
 *
 * 注意：
 * - 移动端不支持 openMediaWindow（WebviewWindow），媒体预览走 MobileMediaPreview
 * - 视频预览时机：handlePreview 视频分支调用 triggerBackgroundDownload，
 *   与桌面端 useVideoCache.onPlay 行为对齐（首次预览即触发后台缓存）
 * - 长按触发后的合成 click 由 longPressFiredRef 抑制，避免误打开预览
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useFiles, type FileCategory } from '../../hooks/useFiles';
import { useImageCache, useFileCache } from '../../hooks/useFileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useSettingsStore } from '../../stores/settingsStore';
import { getFileCategory, deleteFile } from '../../api/storage';
import { formatFileSize } from '../../utils/format';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { UploadIcon } from '../../components/common/Icons';
import { MobileMediaPreview } from '../../chat/shared/MobileMediaPreview';
import { videoPosterSrc } from '../../chat/shared/videoPosterSrc';
import { FilePreviewModal } from '../../chat/shared/FilePreviewModal';
import { LocalBadge } from '../../chat/shared/DocumentDownloadAction';
import { UploadProgress } from '../../chat/shared/UploadProgress';
import { useSession, useApi } from '../../contexts/SessionContext';
import {
  getPresignedUrl,
  getCachedFilePath,
  getVideoSource,
  triggerBackgroundDownload,
} from '../../services/fileCache';
import { saveFileUuidHash } from '../../db';
import { useConfirmDialog } from '../../lowcode/components/ConfirmDialog';
import { FileMenuController } from '../../components/files/FileMenuController';
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

/** 视频缩略图 - 使用 getVideoSource 获取移动端兼容的视频 URL
 *
 * 底层 src 仍由 getVideoSource 提供（保持移动端 HTTP 服务器路径）。
 * 额外引入 useFileCache(autoCache:false) 拿 isLocal —
 * isLocal 以 useFileCache 为准（订阅下载任务 store，下载完成会自动 reload），
 * 与桌面端 useVideoCache 行为对齐：列表内下载完后徽章自动出现，无需手动刷新。
 */
function VideoThumbnail({
  file,
  onLocalPathFound,
}: {
  file: FileItem;
  onLocalPathFound?: (path: string | null, hash: string | null) => void;
}) {
  const api = useApi();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // isLocal 来自 useFileCache（同源；下载完成 reload 驱动徽章）
  const { isLocal } = useFileCache({
    fileUuid: file.file_uuid,
    fileHash: file.file_hash,
    fileName: file.filename,
    fileType: 'video',
    urlType: 'user',
    autoCache: false,
  });

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
      {/* 缩略图 src 追 #t=0.1 逼引擎 seek 出封面（Android WebView 不自发画首帧）
          ——详见 chat/shared/videoPosterSrc.ts */}
      <video
        src={videoPosterSrc(src)}
        preload="metadata"
        muted
        playsInline
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
    refresh,
    loadMore,
  } = useFiles();

  // 文件上传 hook（与桌面端 FilesModal 一致）
  const { uploading, progress, uploadFile, resetUpload } = useFileUpload();
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  // 媒体预览状态（图片/视频）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');
  const [previewSrc, setPreviewSrc] = useState('');
  // 下载专用原始 presigned URL（与 previewSrc 区分：previewSrc 是显示用反代/asset，
  // 下载必须用原始 URL，否则被 directIpUrl 改写 host→源站IP 后变无效路径 → 400）
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState('');
  const [previewFilename, setPreviewFilename] = useState('');
  // 当前预览文件的元信息（用于 useFileCache 订阅 + onDownload/onOpenWith 菜单回调）
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // 订阅当前预览文件的下载状态 + localPath + openInFolder（previewFile=null 时用空占位）
  const previewCache = useFileCache({
    fileUuid: previewFile?.file_uuid ?? '',
    fileHash: previewFile?.file_hash ?? null,
    fileName: previewFile?.filename ?? '',
    fileType: previewType,
    urlType: 'user',
    autoCache: false,
  });
  const previewDownloadTask = useFileCacheStore(
    selectDownloadTask(previewFile?.file_hash ?? ''),
  );
  const previewIsDownloading =
    previewDownloadTask?.status === 'pending'
    || previewDownloadTask?.status === 'downloading';

  // 文档预览状态
  const [documentPreview, setDocumentPreview] = useState<FileItem | null>(null);

  // 右键/长按菜单状态
  const [menuFile, setMenuFile] = useState<FileItem | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);

  // 长按相关
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 删除确认弹窗
  const { confirm, dialogElement } = useConfirmDialog();

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

  // ============================================
  // 长按菜单 + 删除
  // ============================================

  const openMenu = useCallback(
    (file: FileItem, x: number, y: number, rect: DOMRect | null) => {
      setMenuFile(file);
      setMenuPos({ x, y });
      setMenuRect(rect);
    },
    [],
  );

  const closeMenu = useCallback(() => {
    setMenuFile(null);
  }, []);

  const handleCardTouchStart = useCallback(
    (file: FileItem) => (e: React.TouchEvent) => {
      longPressFiredRef.current = false;
      const t = e.touches[0];
      touchStartPosRef.current = { x: t.clientX, y: t.clientY };
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        openMenu(file, t.clientX, t.clientY, rect);
      }, 500);
    },
    [openMenu],
  );

  const handleCardTouchMove = useCallback((e: React.TouchEvent) => {
    if (!longPressTimerRef.current || !touchStartPosRef.current) { return; }
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(t.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCardTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  const wrapClick = useCallback(
    (handler: () => void) => () => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      handler();
    },
    [],
  );

  const handleConfirmDelete = useCallback(
    async (file: FileItem) => {
      const ok = await confirm({
        title: '确认删除',
        message: `文件「${file.filename}」删除后将从云端移除，此操作不可撤销。`,
        confirmLabel: '删除',
        isDanger: true,
      });
      if (!ok) { return; }
      try {
        await deleteFile(api, file.file_uuid);
        await refresh();
      } catch (err) {
        console.error('[MobileFilesPage] 删除文件失败:', err);
      }
    },
    [api, confirm, refresh],
  );

  // ============================================
  // 文件上传（与桌面端 FilesModal.handleUploadClick 完全一致）
  // ============================================

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
        // 保存 file_uuid 到 file_hash 的映射，并复制文件到统一缓存目录
        if (result.fileUuid && result.fileHash) {
          await saveFileUuidHash(result.fileUuid, result.fileHash);

          // 复制文件到统一缓存目录（大文件≥100MB不复制，记录原始路径）
          try {
            let cacheFileType = 'document';
            if (mimeType.startsWith('image/')) {
              cacheFileType = 'image';
            } else if (mimeType.startsWith('video/')) {
              cacheFileType = 'video';
            }

            const { fileCache } = useSettingsStore.getState();
            const thresholdBytes = fileCache.largeFileThresholdMB * 1024 * 1024;
            await invoke<string>('copy_file_to_cache', {
              sourcePath: localPath,
              fileHash: result.fileHash,
              fileName: fileName,
              fileType: cacheFileType,
              fileSize: file.size,
              largeFileThreshold: thresholdBytes,
            });
          } catch (cacheErr) {
            console.error('[MobileFilesPage] 缓存文件失败:', cacheErr);
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
      console.error('[MobileFilesPage] 文件选择失败:', err);
      setUploadingFile(null);
      resetUpload();
    }
  }, [uploadFile, refresh, resetUpload]);

  const handleCancelUpload = useCallback(() => {
    setUploadingFile(null);
    resetUpload();
  }, [resetUpload]);

  // 预览文件
  const handlePreview = useCallback(
    async (file: FileItem) => {
      const fileCategory = getFileCategory(file.content_type);

      // 文档：走 FilePreviewModal（含下载/打开行为，与桌面端「我的文件」一致）
      if (fileCategory !== 'image' && fileCategory !== 'video') {
        setDocumentPreview(file);
        return;
      }

      if (!session) {
        return;
      }

      let previewUrl: string;
      let downloadUrl = '';

      if (fileCategory === 'video') {
        // 视频：使用 getVideoSource 获取移动端兼容的 URL
        // 本地视频通过 HTTP 服务器提供，远程视频使用预签名 URL
        try {
          const result = await getVideoSource(api, file.file_uuid, file.file_hash, 'user');
          previewUrl = result.src;
          downloadUrl = result.presignedUrl ?? result.src;
          // 与桌面端 useVideoCache.onPlay 行为对齐：非本地 + 有 hash 时触发后台缓存
          // triggerBackgroundDownload 内部对同 fileHash 已下载/下载中会跳过，不会重复触发
          if (!result.isLocal && file.file_hash) {
            // 下载用原始 presignedUrl(非反代 src,否则 directIpUrl 改写后 → 400)
            triggerBackgroundDownload(
              result.presignedUrl ?? result.src,
              file.file_hash,
              file.filename,
              'video',
              file.file_size,
            );
          }
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
          downloadUrl = previewUrl;
        } else {
          // 获取预签名 URL（getPresignedUrl 返回原始 URL，可直接用于下载）
          try {
            const result = await getPresignedUrl(api, file.file_uuid, 'user');
            previewUrl = result.url;
            downloadUrl = result.url;
          } catch (err) {
            console.error('[MobileFilesPage] 获取预签名 URL 失败:', err);
            return;
          }
        }
      }

      setPreviewType(fileCategory as 'image' | 'video');
      setPreviewSrc(previewUrl);
      setPreviewDownloadUrl(downloadUrl);
      setPreviewFilename(file.filename);
      setPreviewFile(file);
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

  // 卡片动画（exit 与桌面端 FilesModal 对齐）
  const cardVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.9 },
  };

  // 页面 mount 期间阻止 body 滚动，避免底层列表被拖动
  // 与 FilePreviewModal / MobileMediaPreview 的弹窗行为对齐
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

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
        <button
          className="mobile-files-upload-btn"
          onClick={handleUploadClick}
          disabled={uploading}
          aria-label="上传文件"
        >
          {uploading ? <LoadingSpinner /> : <UploadIcon />}
        </button>
      </header>

      {/* 上传进度条 */}
      <AnimatePresence>
        {uploading && uploadingFile && progress && (
          <div className="mobile-files-upload-progress">
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
                  exit="exit"
                  whileTap={{ scale: 0.97 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={wrapClick(() => handlePreview(file))}
                  onTouchStart={handleCardTouchStart(file)}
                  onTouchMove={handleCardTouchMove}
                  onTouchEnd={handleCardTouchEnd}
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

      {/* 媒体预览（图片/视频） */}
      <MobileMediaPreview
        isOpen={previewOpen}
        type={previewType}
        src={previewSrc}
        filename={previewFilename}
        localPath={previewCache.localPath}
        downloadProgress={previewDownloadTask?.percent ?? 0}
        isDownloading={previewIsDownloading}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewFile(null);
        }}
        onOpenWith={
          previewCache.localPath
            ? () => previewCache.openInFolder(previewCache.localPath)
            : undefined
        }
        onDownload={
          previewFile?.file_hash && previewDownloadUrl
            ? () => {
              const hash = previewFile.file_hash;
              if (!hash) { return; }
              triggerBackgroundDownload(
                previewDownloadUrl,
                hash,
                previewFile.filename,
                previewType,
                previewFile.file_size,
              );
            }
            : undefined
        }
      />

      {/* 文档预览（下载/打开行为复用 DocumentDownloadAction） */}
      <FilePreviewModal
        isOpen={!!documentPreview}
        onClose={() => setDocumentPreview(null)}
        fileUuid={documentPreview?.file_uuid || ''}
        filename={documentPreview?.filename || ''}
        fileSize={documentPreview?.file_size}
        fileHash={documentPreview?.file_hash}
        urlType="user"
      />

      {/* 长按菜单 */}
      {menuFile && (
        <FileMenuController
          file={menuFile}
          position={menuPos}
          cardRect={menuRect}
          onClose={closeMenu}
          onDelete={() => {
            const f = menuFile;
            closeMenu();
            handleConfirmDelete(f);
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {dialogElement}
    </motion.div>
  );
}
