/**
 * 会话媒体序列的上下文 + 全屏预览宿主（移动端「左右滑动切上一张 / 下一张」的接线层）
 *
 * @module chat/shared
 * @location src/chat/shared/MediaGalleryProvider.tsx
 *
 * ## 为什么全屏预览要从气泡里搬出来
 *
 * 原先每一条图片 / 视频消息各自渲染一个 `<MobileMediaPreview>`（气泡自己的 src、
 * 自己的开关）。那个形态下「切到上一张」在结构上不可达：打开的那个浮层只认识自己那一张，
 * 邻居的 src 在**别的组件实例**的 hook 里，拿不到。
 *
 * 所以改成：**整条会话共用一个浮层**，由本 Provider 持有（序列 + 当前位次），
 * 气泡点击时只负责说"打开我这一张"。序列由消息列表层算好递进来（见 mediaGallery.ts）。
 *
 * ## 序列在打开那一刻**快照**，不随新消息变动
 *
 * 打开后对方又发来一张图 ⇒ 序列若跟着变长，当前位次就会在用户手指底下漂移
 * （更糟：如果新消息插在前面，index 指向的会变成另一张）。故 `openAt` 把 `items`
 * 拷进 state，关闭前不再跟随。这不是性能取舍，是正确性取舍。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../../contexts/SessionContext';
import {
  getFileSource,
  getVideoSource,
  startProgressListener,
  triggerBackgroundDownload,
  type FileSourceResult,
} from '../../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { openWithExternalApp } from '../../utils/openWithExternalApp';
import { MobileMediaPreview } from './MobileMediaPreview';
import { galleryPositionLabel, locateInGallery, type MediaGalleryItem } from './mediaGallery';

// ============================================
// Context
// ============================================

export interface MediaGalleryApi {
  /** 当前会话的媒体序列（升序，旧 → 新）；宿主没挂 Provider 时为空数组 */
  items: MediaGalleryItem[];
  /** 打开全屏预览并定位到这一项（仅移动端调用；桌面端走独立预览窗） */
  openAt: (item: MediaGalleryItem) => void;
}

const NO_GALLERY: MediaGalleryApi = { items: [], openAt: () => {} };

const MediaGalleryContext = createContext<MediaGalleryApi>(NO_GALLERY);

/**
 * 读当前会话的媒体序列。
 *
 * 默认值是**空序列 + 空操作**：单测直接渲染气泡、或将来有别的宿主复用
 * FileMessageContent 时不会崩。此时点图片打开的是"只有这一张的序列"
 * —— 与「会话里确实只有这一张图」走的是**同一条**代码路径（见 openAt），
 * 不是为了兼容而多出来的分支。
 */
export function useMediaGallery(): MediaGalleryApi {
  return useContext(MediaGalleryContext);
}

// ============================================
// Provider
// ============================================

/** 打开态：序列快照 + 当前位次 */
interface OpenState {
  list: MediaGalleryItem[];
  index: number;
}

export function MediaGalleryProvider({
  items,
  children,
}: {
  items: MediaGalleryItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState<OpenState | null>(null);
  // 关闭只把 visible 置 false、**不把 open 清成 null** —— 清了浮层当场从 DOM 消失，
  // AnimatePresence 的退场淡出没有内容可画（旧形态下每条消息各有一个常驻实例，
  // 靠的就是"实例还在、只是 isOpen=false"）。留着的代价是一个已解析好的 item，
  // 比原先每条图片消息各挂一个实例还省。
  const [visible, setVisible] = useState(false);

  // 定位口径与桌面独立窗 handoff 共用同一个函数（见 mediaGallery.locateInGallery）
  const openAt = useCallback((item: MediaGalleryItem) => {
    setOpen(locateInGallery(items, item));
    setVisible(true);
  }, [items]);

  const api = useMemo<MediaGalleryApi>(() => ({ items, openAt }), [items, openAt]);

  const handleStep = useCallback((delta: number) => {
    setOpen((prev) => {
      if (!prev) { return prev; }
      const next = prev.index + delta;
      // 越界在手势层就被挡住了（resolveSwipeCommit 返回 null ⇒ 回弹），
      // 这里再钉一次：状态机不接受越界位次。
      if (next < 0 || next >= prev.list.length) { return prev; }
      return { ...prev, index: next };
    });
  }, []);

  const handleClose = useCallback(() => setVisible(false), []);

  return (
    <MediaGalleryContext.Provider value={api}>
      {children}
      {open && (
        <MediaGalleryViewer
          item={open.list[open.index]}
          index={open.index}
          total={open.list.length}
          isOpen={visible}
          onStep={handleStep}
          onClose={handleClose}
        />
      )}
    </MediaGalleryContext.Provider>
  );
}

// ============================================
// 全屏预览宿主
// ============================================

/**
 * 当前这一项的取源结果 —— **必须与 item 成对**，所以不用 useFileCache。
 *
 * `useFileCache` 只吐 `src`，不说这个 src 属于哪个 file_uuid：切换位次那一刻
 * 它内部的 loadSource 要等一次 effect 才重跑，中间那几帧 `src` 还是**上一张**的 ——
 * 配上已经变成新一张的标题，画面就是"滑动没生效"。这里自己解析，item 一变立刻
 * 把 source 清成 null（显示「加载中」），拿到结果时 uuid 必然对得上。
 *
 * 取源函数用的仍是 services/fileCache 那两个（同一条安全反代通路，不新增显示点）。
 */
function useGalleryItemSource(item: MediaGalleryItem): FileSourceResult | null {
  const api = useApi();
  const [source, setSource] = useState<FileSourceResult | null>(null);
  const downloadTask = useFileCacheStore(selectDownloadTask(item.fileUuid));
  // 下载完成后重新解析一次，让本地徽章 / 「保存到相册」菜单切到已下载态
  const completedAt = downloadTask?.status === 'completed' ? downloadTask.localPath : null;

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    startProgressListener();

    // 视频在移动端 / macOS 走本地 HTTP 服务器（asset:// 播不了 / WKWebView 不转发 Range），
    // 与气泡侧 useVideoCache 是同一条判据 —— 这里只是换了个调用点，没有第二套规则。
    const load = item.type === 'video'
      ? getVideoSource(api, item.fileUuid, null, item.urlType)
      : getFileSource(api, item.fileUuid, null, item.urlType);

    load
      .then((result) => { if (!cancelled) { setSource(result); } })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[MediaGallery] 取源失败:', err);
        }
      });

    return () => { cancelled = true; };
  }, [api, item.fileUuid, item.type, item.urlType, completedAt]);

  return source;
}

function MediaGalleryViewer({
  item,
  index,
  total,
  isOpen,
  onStep,
  onClose,
}: {
  item: MediaGalleryItem;
  index: number;
  total: number;
  /** false = 正在播退场淡出（组件仍挂着，见 Provider 里 visible 的注释） */
  isOpen: boolean;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const source = useGalleryItemSource(item);
  const downloadTask = useFileCacheStore(selectDownloadTask(item.fileUuid));
  const isDownloading =
    downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';

  const localPath = source?.localPath ?? null;

  const handleOpenWith = useCallback(() => {
    if (!localPath) { return; }
    openWithExternalApp(localPath).catch((err) => {
      console.warn('[MediaGallery] 用外部应用打开失败:', err);
    });
  }, [localPath]);

  const handleDownload = useCallback(() => {
    const url = source?.presignedUrl ?? source?.src;
    if (!url) { return; }
    triggerBackgroundDownload(url, item.fileUuid, item.filename, item.type, item.fileSize);
  }, [source, item]);

  const handlePrev = useCallback(() => onStep(-1), [onStep]);
  const handleNext = useCallback(() => onStep(1), [onStep]);

  return (
    <MobileMediaPreview
      isOpen={isOpen}
      type={item.type}
      // 还没解析出来时给空串：MobileMediaPreview 见空 src 就停在「加载中」，
      // 绝不会拿上一张的画面配这一张的标题。
      src={source?.src ?? ''}
      filename={item.filename}
      localPath={localPath}
      downloadProgress={downloadTask?.percent ?? 0}
      isDownloading={isDownloading}
      onClose={onClose}
      onOpenWith={localPath ? handleOpenWith : undefined}
      onDownload={source && !source.isLocal ? handleDownload : undefined}
      hasPrev={index > 0}
      hasNext={index < total - 1}
      onSwipePrev={handlePrev}
      onSwipeNext={handleNext}
      positionLabel={galleryPositionLabel(index, total)}
    />
  );
}
