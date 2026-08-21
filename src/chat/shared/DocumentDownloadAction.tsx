/**
 * 文档下载操作共享组件
 *
 * 封装"未下载 → 下载中 → 已下载"三态切换 + 下载/打开行为，复用方包括：
 * - 聊天文档消息气泡 [FileMessageContent.tsx DocumentMessage]
 * - 我的文件管理弹窗的文档卡片 [FilesModal.tsx DocumentFileCard]
 * - 文件预览弹窗的文档预览 [FilePreviewModal.tsx DocumentPreview]
 *
 * Layout：
 * - inline   : 紧凑布局（28px 圆环 / 32px 按钮），用于卡片右下角
 * - centered : 居中大按钮，用于 FilePreviewModal 全屏预览
 *
 * 行为：
 * - 自身订阅 useFileCacheStore 的下载任务状态，所有调用方共享同一份进度
 * - 下载点击调用 triggerBackgroundDownload，打开点击调用 useFileCache().openInFolder
 *   （hook 内置移动端/桌面端分支与文件不存在自动重新下载兜底）
 * - 按钮 onClick 都执行 e.stopPropagation()，避免冒泡触发外层卡片的点击逻辑
 */

import { useCallback } from 'react';
import { useFileCache } from '../../hooks/useFileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { triggerBackgroundDownload, fileIdentityKey } from '../../services/fileCache';
import { CircularProgress } from '../../components/common/CircularProgress';

// ============================================
// 图标（搬自 FilePreviewModal 的局部定义，集中到此文件）
// ============================================

const DownloadIconLarge = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const DownloadIconSmall = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const OpenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// ============================================
// 本地文件标识 — 全项目唯一来源
//
// 渲染规则：透明白色玻璃质感圆形徽章 + 白色对勾 SVG。
// 任何"已下载到本地"提示一律 import 并渲染 <LocalBadge />，禁止在调用方再定义同名组件
// 或自行拼接 .file-local-badge 的子元素。
//
// 装饰用途：仅作"该文件有本地副本"的视觉提示，不响应点击。
// "打开文件位置"入口由调用方在其他 UI 元素（如预览窗口的菜单按钮）单独提供。
// ============================================

export function LocalBadge() {
  return (
    <span className="file-local-badge" title="已保存到本地" aria-label="已保存到本地">
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
}

// ============================================
// 主组件
// ============================================

export interface DocumentDownloadActionProps {
  /** 文件 UUID —— **下载任务的键**（消息面下载前唯一已知的身份，见 fileIdentityKey） */
  fileUuid: string;
  /**
   * **已知**的内容哈希。只有个人文件面（`GET /api/storage/files`）有；
   * 消息面（聊天文档气泡 / 文档预览）**不传** —— 后端接收面已不再下发 `file_hash`。
   */
  fileHash?: string | null;
  filename: string;
  fileSize?: number | null;
  urlType?: 'user' | 'friend' | 'group';
  /** inline: 紧凑（28px 圆环 + 32px 按钮）；centered: 居中大按钮 */
  layout?: 'inline' | 'centered';
  /** 视觉主题。
   * - 'default': 默认蓝色按钮 + 默认进度环颜色，用于"我的文件"、FilePreviewModal 等
   * - 'chat-document': 聊天文档气泡专用绿色（白底文档卡片可见度更好）
   */
  variant?: 'default' | 'chat-document';
}

export function DocumentDownloadAction({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType = 'user',
  layout = 'inline',
  variant = 'default',
}: DocumentDownloadActionProps) {
  const { src, presignedUrl, isLocal, localPath, openInFolder } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    urlType,
    autoCache: false,
  });

  // 下载任务的键：个人文件面用服务端下发的哈希，消息面用 file_uuid
  const cacheKey = fileIdentityKey(fileUuid, fileHash);
  const downloadTask = useFileCacheStore(selectDownloadTask(cacheKey));

  const isDownloading = !!downloadTask && (
    downloadTask.status === 'pending' || downloadTask.status === 'downloading'
  );
  // 仅依赖 isLocal（useFileCache 走 Rust stat 校验），不 OR downloadTask?.status === 'completed'
  // —— store 中的 completed 是内存遗迹，外部删除后不刷新
  const isDownloaded = isLocal;
  const actualLocalPath = localPath;

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 🔴 这里**不能**再要求"有内容哈希"：消息面下载前根本没有哈希（两层键，哈希是下载完
    // 才自算的）—— 那道旧前置会让聊天里的文档下载按钮**永远点不动**。键改成 cacheKey 即可。
    if (!src || !cacheKey || isDownloaded || isDownloading) { return; }
    // 下载必须用原始 presignedUrl(Rust directIpUrl 改写 host→源站IP);src 是反代 loopback URL,被改写后变无效路径 → 400
    triggerBackgroundDownload(presignedUrl ?? src, cacheKey, filename, 'document', fileSize ?? undefined);
  }, [src, presignedUrl, cacheKey, filename, fileSize, isDownloaded, isDownloading]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (actualLocalPath) {
      openInFolder(actualLocalPath);
    }
  }, [actualLocalPath, openInFolder]);

  // ============================================
  // centered 布局（FilePreviewModal）
  // ============================================
  if (layout === 'centered') {
    if (isDownloaded && actualLocalPath) {
      return (
        <button className="download-btn open" onClick={handleOpen}>
          <OpenIcon />
          打开文件
        </button>
      );
    }
    if (isDownloading) {
      return (
        <button className="download-btn" disabled>
          <CircularProgress
            progress={downloadTask?.percent ?? 0}
            size={28}
            strokeWidth={3}
            showText={false}
            progressColor="var(--white-alpha-95)"
            backgroundColor="var(--white-alpha-30)"
          />
          下载中 {Math.round(downloadTask?.percent ?? 0)}%
        </button>
      );
    }
    return (
      <button className="download-btn" onClick={handleDownload}>
        <DownloadIconLarge />
        下载文件
      </button>
    );
  }

  // ============================================
  // inline 布局（卡片右下角）
  // ============================================
  // chat-document variant 用 --status-success 主题绿（在白底文档气泡上可见度更好）
  const isChatDoc = variant === 'chat-document';
  const progressColor = isChatDoc ? 'var(--status-success)' : undefined;
  const progressBgColor = isChatDoc ? 'var(--status-success-subtle)' : undefined;
  const buttonClass = isChatDoc ? 'document-download chat-document' : 'document-download';

  return (
    <div className="document-actions">
      {isDownloading && downloadTask && (
        <div className="document-download-progress">
          <CircularProgress
            progress={downloadTask.percent}
            size={28}
            strokeWidth={3}
            progressColor={progressColor}
            backgroundColor={progressBgColor}
          />
        </div>
      )}
      {!isDownloaded && !isDownloading && (
        <button className={buttonClass} onClick={handleDownload} title="下载">
          <DownloadIconSmall />
        </button>
      )}
      {/* 已下载状态：不渲染 actions，由外层卡片承担"打开"行为 */}
    </div>
  );
}
