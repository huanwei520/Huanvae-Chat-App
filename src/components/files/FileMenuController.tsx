/**
 * 我的文件菜单的状态解析器
 *
 * 当菜单打开（file 非空）时，订阅当前文件的 useFileCache + selectDownloadTask
 * 以决定渲染哪些菜单项：
 * - 已下载（任意类型）→ 「在文件夹中显示」
 * - 文档未下载且未在下载中 → 「下载文件」（lazy 获取 presigned URL）
 * - 删除项始终渲染（由调用方传 onDelete）
 *
 * 关于「下载文件」菜单项的 lazy 模式：
 * useFileCache 的 src 是异步加载（loadSource → getPresignedUrl）。如果在右键瞬间
 * 把 onDownload 条件挂在 `src` 上，src 还没 ready 时菜单项不渲染，用户体验是"右键
 * 没有下载选项"。改为 lazy：菜单项立即显示（条件不依赖 src），点击时再调用
 * getPresignedUrl + triggerBackgroundDownload。getPresignedUrl 内部有 store 缓存，
 * 二次点击命中即返。
 *
 * 单独抽出（独立组件）的目的：避免在主页面/弹窗组件内订阅 useFileCache 引发不必要的重渲染。
 * 同时让 FilesModal（桌面端）和 MobileFilesPage（移动端）共用同一段决议逻辑。
 */

import { useFileCache } from '../../hooks/useFileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { triggerBackgroundDownload, getPresignedUrl } from '../../services/fileCache';
import { getFileCategory } from '../../api/storage';
import { useApi } from '../../contexts/SessionContext';
import { FileContextMenu } from './FileContextMenu';
import type { FileItem } from '../../api/storage';

interface FileMenuControllerProps {
  file: FileItem;
  position: { x: number; y: number };
  cardRect: DOMRect | null;
  onClose: () => void;
  onDelete: () => void;
}

export function FileMenuController({
  file,
  position,
  cardRect,
  onClose,
  onDelete,
}: FileMenuControllerProps) {
  const api = useApi();
  const category = getFileCategory(file.content_type);
  // category 已经是 'image' | 'video' | 'file'；map 到 useFileCache 期望的 fileType
  let fileType: 'image' | 'video' | 'document';
  if (category === 'image') {
    fileType = 'image';
  } else if (category === 'video') {
    fileType = 'video';
  } else {
    fileType = 'document';
  }

  const { localPath, isLocal, openInFolder } = useFileCache({
    fileUuid: file.file_uuid,
    fileHash: file.file_hash,
    fileName: file.filename,
    fileType,
    urlType: 'user',
    autoCache: false,
  });
  const downloadTask = useFileCacheStore(selectDownloadTask(file.file_hash ?? ''));

  const isDownloaded = isLocal || downloadTask?.status === 'completed';
  const isDownloading =
    downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';
  const actualLocalPath = downloadTask?.localPath ?? localPath;

  const onOpenInFolder =
    isDownloaded && actualLocalPath ? () => openInFolder(actualLocalPath) : undefined;

  // 仅文档分类提供「下载文件」菜单项；图片/视频通过查看自动缓存，不需要菜单触发
  // lazy 模式：菜单项条件不依赖 src（避免异步加载导致首次右键时菜单项不渲染）；
  // 点击时才调 getPresignedUrl（带缓存）+ triggerBackgroundDownload
  const fileHash = file.file_hash;
  const onDownload =
    category === 'file' && !isDownloaded && !isDownloading && fileHash
      ? async () => {
        try {
          const result = await getPresignedUrl(api, file.file_uuid, 'user');
          triggerBackgroundDownload(
            result.url,
            fileHash,
            file.filename,
            'document',
            file.file_size,
          );
        } catch (err) {
          console.error('[FileMenuController] 触发下载失败:', err);
        }
      }
      : undefined;

  return (
    <FileContextMenu
      isOpen={true}
      position={position}
      cardRect={cardRect}
      onOpenInFolder={onOpenInFolder}
      onDownload={onDownload}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
