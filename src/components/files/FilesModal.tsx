/**
 * 个人文件管理弹窗
 *
 * 功能：
 * - 文件列表展示（网格视图）
 * - 分类筛选：总览、图片、视频、文件
 * - 文件名搜索
 * - 文件预览和下载（本地优先；文档卡片含进度环、本地路径展示，与聊天文档消息一致）
 * - 文件上传（复用聊天上传进度条）
 * - 右键 / 长按菜单：在文件夹中显示（已下载）/ 下载文件（未下载）/ 删除文件（含确认弹窗）
 *
 * 使用 useFileCache 服务实现本地优先和自动缓存
 * 图片和视频使用独立窗口预览，文档使用模态框预览（FilePreviewModal）
 * 文档下载/打开行为通过 chat/shared/DocumentDownloadAction 共享组件实现
 * DocumentFileCard 桌面端 click 走三态（已下载→openInFolder / 未下载→triggerBackgroundDownload / 下载中→noop）
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { useFiles, type FileCategory } from '../../hooks/useFiles';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useImageCache, useVideoCache, useFileCache } from '../../hooks/useFileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { getFileCategory, deleteFile } from '../../api/storage';
import { formatFileSize } from '../../utils/format';
import { isMobile } from '../../utils/platform';
import { SearchIcon, CloseIcon, UploadIcon } from '../common/Icons';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorToast } from '../common/ErrorToast';
import { UploadProgress } from '../../chat/shared/UploadProgress';
import { FilePreviewModal } from '../../chat/shared/FilePreviewModal';
import { videoPosterSrc } from '../../chat/shared/videoPosterSrc';
import { DocumentDownloadAction, LocalBadge } from '../../chat/shared/DocumentDownloadAction';
import { openMediaWindow } from '../../media';
import { useSession, useApi } from '../../contexts/SessionContext';
import {
  getPresignedUrl,
  getCachedFilePath,
  triggerBackgroundDownload,
  isFileNotFoundError,
} from '../../services/fileCache';
import { invoke } from '@tauri-apps/api/core';
import { saveFileUuidHash } from '../../db';
import { useConfirmDialog } from '../../lowcode/components/ConfirmDialog';
import { FileMenuController } from './FileMenuController';
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
      {/* 缩略图 src 追 #t=0.1 逼引擎 seek 出封面（WKWebView / Android WebView 不自发画首帧，
          只有 Windows 会）——详见 chat/shared/videoPosterSrc.ts */}
      <video src={videoPosterSrc(src)} preload="metadata" />
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

// ============================================
// 文档文件卡片
// ============================================

/**
 * 文档分类卡片
 *
 * 仅文档（非图片/视频）走此组件，订阅 useFileCache + selectDownloadTask 以渲染：
 * - 缩略图区域的 LocalBadge（已下载时）
 * - 文件信息中的本地路径文本（已下载时）
 * - 卡片底部的 DocumentDownloadAction（下载按钮 / 进度环 / 已下载隐藏，行为同聊天文档消息）
 *
 * 卡片 onClick 三态分支（仿 FileMessageContent.handleDocumentClick）：
 * - 移动端：onPreview（打开 FilePreviewModal）
 * - 桌面端已下载：openInFolder(localPath)
 * - 桌面端下载中：noop（避免重复触发）
 * - 桌面端未下载：triggerBackgroundDownload（与聊天侧一致，不弹 preview modal）
 *
 * 图片/视频走原 FileThumbnail 路径，不调用此组件，避免无谓的文档分类 hook 实例。
 */
export function DocumentFileCard({
  file,
  index,
  onPreview,
  onContextMenu,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  formatDate,
}: {
  file: FileItem;
  index: number;
  onPreview: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  formatDate: (dateStr: string) => string;
}) {
  const { src, presignedUrl, localPath, isLocal, openInFolder } = useFileCache({
    fileUuid: file.file_uuid,
    fileHash: file.file_hash,
    fileName: file.filename,
    fileType: 'document',
    urlType: 'user',
    autoCache: false,
  });
  const downloadTask = useFileCacheStore(selectDownloadTask(file.file_hash ?? ''));
  // 仅依赖 isLocal（useFileCache 内走 Rust stat 校验）；store 的 completed 是内存遗迹，
  // 文件被外部删除后不刷新，OR 进来会让徽章卡住
  const isDownloaded = isLocal;
  const isDownloading =
    downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';
  const actualLocalPath = localPath;

  const handleClick = useCallback(() => {
    if (isMobile()) {
      onPreview();
      return;
    }
    if (isDownloaded && actualLocalPath) {
      openInFolder(actualLocalPath);
      return;
    }
    if (isDownloading) { return; }
    if (src && file.file_hash) {
      triggerBackgroundDownload(
        presignedUrl ?? src,
        file.file_hash,
        file.filename,
        'document',
        file.file_size,
      );
    }
  }, [
    isDownloaded,
    isDownloading,
    actualLocalPath,
    openInFolder,
    src,
    presignedUrl,
    file.file_hash,
    file.filename,
    file.file_size,
    onPreview,
  ]);

  return (
    <motion.div
      key={file.file_uuid || `file-${index}`}
      className="file-card document-file-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ delay: index * 0.03 }}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="file-thumbnail">
        {isDownloaded && <LocalBadge />}
        <div className="thumbnail-placeholder">
          <FileIcon contentType={file.content_type} />
        </div>
      </div>
      <div className="file-info">
        <div className="file-name" title={file.filename}>
          {file.filename}
        </div>
        <div className="file-meta">
          <span className="file-size">{formatFileSize(file.file_size)}</span>
          <span className="file-date">{formatDate(file.created_at)}</span>
        </div>
        {actualLocalPath && (
          <div className="document-local-path" title={actualLocalPath}>
            📁 {actualLocalPath.split(/[/\\]/).pop()}
          </div>
        )}
        <DocumentDownloadAction
          layout="inline"
          fileUuid={file.file_uuid}
          fileHash={file.file_hash}
          filename={file.filename}
          fileSize={file.file_size}
          urlType="user"
        />
      </div>
    </motion.div>
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
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

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

  // 错误 toast（用于服务端 404 等需要用户感知的失败场景）
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); }
  }, []);

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

  // ============================================
  // 菜单 + 长按 + 删除
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

  const handleCardContextMenu = useCallback(
    (file: FileItem) => (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(file, e.clientX, e.clientY, rect);
    },
    [openMenu],
  );

  const handleCardTouchStart = useCallback(
    (file: FileItem) => (e: React.TouchEvent) => {
      if (!isMobile()) { return; }
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
        console.error('[FilesModal] 删除文件失败:', err);
      }
    },
    [api, confirm, refresh],
  );

  // 长按触发菜单后，同次触摸结束的合成 click 应被抑制
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
            // 服务端 404：文件已不可用 → 立即提示并刷新列表，不再打开预览窗口
            if (isFileNotFoundError(err)) {
              showToast(`文件「${file.filename}」已从服务器删除，列表已刷新`);
              await refresh();
              return;
            }
            // 其他错误：继续打开窗口，让窗口内部尝试获取/降级
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

      // 文档使用模态框预览（fileHash 由 FilePreviewModal 内部 useFileCache 自取）
      setPreviewFile(file);
    },
    [localInfoCache, session, api, refresh, showToast],
  );

  // 监听独立媒体预览窗口的"文件已不可用"事件（服务端 404 时由 MediaPreviewPage emit）
  // → 刷新列表清理僵尸条目 + 给用户可见反馈
  useEffect(() => {
    if (!isOpen) { return; }
    let unlisten: (() => void) | null = null;
    listen<{ fileUuid: string; fileHash: string | null }>(
      'media-preview-file-unavailable',
      () => {
        showToast('该文件已从服务器删除，列表已刷新');
        refresh();
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) { unlisten(); }
    };
  }, [isOpen, refresh, showToast]);

  // 关闭预览
  const closePreview = useCallback(() => {
    setPreviewFile(null);
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
                  whileHover={uploading ? undefined : { scale: 1.02 }}
                  whileTap={uploading ? undefined : { scale: 0.98 }}
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
                      {files.map((file, index) => {
                        const fileCategory = getFileCategory(file.content_type);
                        if (fileCategory === 'file') {
                          return (
                            <DocumentFileCard
                              key={file.file_uuid || `file-${index}`}
                              file={file}
                              index={index}
                              onPreview={wrapClick(() => handlePreview(file))}
                              onContextMenu={handleCardContextMenu(file)}
                              onTouchStart={handleCardTouchStart(file)}
                              onTouchMove={handleCardTouchMove}
                              onTouchEnd={handleCardTouchEnd}
                              formatDate={formatDate}
                            />
                          );
                        }
                        return (
                          <motion.div
                            key={file.file_uuid || `file-${index}`}
                            className="file-card"
                            variants={cardVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            transition={{ delay: index * 0.03 }}
                            onClick={wrapClick(() => handlePreview(file))}
                            onContextMenu={handleCardContextMenu(file)}
                            onTouchStart={handleCardTouchStart(file)}
                            onTouchMove={handleCardTouchMove}
                            onTouchEnd={handleCardTouchEnd}
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
                        );
                      })}
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

      {/* 文件预览模态框（fileHash 用于内部 useFileCache 状态订阅） */}
      <FilePreviewModal
        isOpen={!!previewFile}
        onClose={closePreview}
        fileUuid={previewFile?.file_uuid || ''}
        filename={previewFile?.filename || ''}
        fileSize={previewFile?.file_size}
        fileHash={previewFile?.file_hash ?? null}
        urlType="user"
      />

      {/* 右键/长按菜单 */}
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

      {/* 错误 toast（404 等场景反馈） */}
      <AnimatePresence>
        {toastMessage && (
          <ErrorToast
            message={toastMessage}
            onClose={() => setToastMessage(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
