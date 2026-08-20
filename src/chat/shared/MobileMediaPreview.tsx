/**
 * 移动端媒体预览组件
 *
 * 由于移动端不支持 WebviewWindow 多窗口，
 * 使用全屏模态框实现图片和视频的预览功能
 *
 * 功能：
 * - 全屏显示图片/视频
 * - 图片支持双指缩放 / 拖动平移 / 双击放大（由 useImageZoom 用 JS 实现，
 *   浏览器自带的页面级双指缩放在本浮层内被 touch-action: none 关掉 —— 见 useImageZoom 文件头）
 * - 点击背景关闭
 * - 顶部关闭按钮
 * - 顶部右侧 ⋮ 三点菜单（Telegram 风格右对齐下拉）：
 *   - 未下载 → 「下载」（调用 onDownload）
 *   - 下载中 → 「下载中 X%」（disabled，仅展示状态）
 *   - 已下载 → 「保存到相册」+ 「通过其它方式打开」（后者调用 onOpenWith）
 * - 底部进度条：仅下载中显示（被动可见）
 * - 阻止长按触发底层消息气泡的右键菜单
 *
 * 菜单样式：透明毛玻璃 + 主题变量（var(--white-alpha-85) / var(--glass-border-subtle) / var(--text-primary)），
 *           设置 → 主题调色盘改变时自动跟随。
 *
 * @since 2024-01
 * @updated 2026-02-04 添加保存到相册功能，修复长按穿透问题
 * @updated 2026-02-04 添加下载进度条，与视频缓存进度同步显示
 * @updated 2026-05-12 重构：底部保存按钮迁到顶部 ⋮ 菜单 + 新增「下载」「通过其它方式打开」选项
 * @updated 2026-08-16 双指缩放改为 JS 手势层（此前是浏览器页面级缩放，放大的是整个 App）
 * @updated 2026-08-16 新增横向滑动切上一张 / 下一张（序列由 MediaGalleryProvider 递进来）
 *
 * ## 横向切图手势（本文件持有的那一半）
 *
 * **只有传了 `onSwipePrev` / `onSwipeNext` 时才启用** —— 没传的调用方（「我的文件」页、
 * 会话内查找命中项）行为逐字不变：它们本来就是单张预览，没有上一张下一张可言。
 *
 * 判定全部在 chat/shared/mediaSwipe.ts 的纯函数里，本文件只负责把 touch 事件喂给它。
 * 与缩放层的交界是一个布尔量（chat/shared/mediaZoomState.ts）：
 * **放大态下横拖恒归缩放层，本层连跟手位移都不画**（画了就是两个 transform 主人抢帧）。
 *
 * 🔴 监听同样走 `addEventListener` 手挂，**不用 React 的 onTouchMove** ——
 * React 17+ 把它注册成 passive，且 tests/unit/mediaPreviewPinchOwnership.test.ts
 * 明文禁止本文件出现 `onTouchMove=`。
 */

import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMobileBackOverlay } from '../../hooks/useMobileBackHandler';
import { useTopLayer } from '../../hooks/useTopLayer';
import { saveToGallery } from '../../utils/saveToGallery';
import { useImageZoom } from './useImageZoom';
import { isMediaZoomedNow } from './mediaZoomState';
import {
  isHorizontalSwipe,
  resolveSwipeCommit,
  swipeOwnedByZoomLayer,
  swipeTrackOffset,
} from './mediaSwipe';

// 调试日志（Android logcat 不支持 %c 样式，使用 JSON.stringify 显示对象）
function logMedia(action: string, data?: unknown) {
  const dataStr = data ? JSON.stringify(data, null, 0) : '';
  // eslint-disable-next-line no-console
  console.log(`[MobileMedia] ${action}`, dataStr);
}

export interface MobileMediaPreviewProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 媒体源 URL */
  src: string;
  /** 文件名 */
  filename: string;
  /** 本地文件路径（用于保存到相册 + 判断"已下载"菜单分支） */
  localPath?: string | null;
  /** 下载进度百分比 (0-100)，用于显示进度条 */
  downloadProgress?: number;
  /** 是否正在下载 */
  isDownloading?: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** "通过其它方式打开"回调（仅已下载状态显示），通常 wire 到 useFileCache.openInFolder */
  onOpenWith?: () => void;
  /** "下载"回调（仅未下载状态显示），调用方触发 triggerBackgroundDownload */
  onDownload?: () => void;
  /**
   * 切到**上一张**（更旧）。传了才启用横向滑动手势。
   * 只在 `hasPrev` 为 true 时会被调用；到边界时手势层给的是回弹，不是调用。
   */
  onSwipePrev?: () => void;
  /** 切到**下一张**（更新）。同上 */
  onSwipeNext?: () => void;
  /** 序列里还有没有上一张（决定跟手位移是 1:1 还是打折回弹） */
  hasPrev?: boolean;
  /** 序列里还有没有下一张 */
  hasNext?: boolean;
  /** 序列位置指示，如「3 / 12」；不传不显示（单张序列时上层就不传） */
  positionLabel?: string | null;
}

/**
 * 关闭图标
 */
function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={24}
      height={24}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/**
 * 保存图标
 */
function SaveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={20}
      height={20}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

/**
 * 三点垂直菜单图标（Telegram 风格 kebab）
 */
function MoreIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 24 24"
      width={20}
      height={20}
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

/**
 * 下载图标（用于菜单"下载"项）
 */
function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={18}
      height={18}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

/**
 * 外部应用打开图标（用于菜单"通过其它方式打开"项）
 */
function OpenWithIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={18}
      height={18}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

export function MobileMediaPreview({
  isOpen,
  type,
  src,
  filename,
  localPath,
  downloadProgress = 0,
  isDownloading = false,
  onClose,
  onOpenWith,
  onDownload,
  onSwipePrev,
  onSwipeNext,
  hasPrev = false,
  hasNext = false,
  positionLabel,
}: MobileMediaPreviewProps) {
  // 视频/图片加载状态
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  // 保存状态
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  // ⋮ 菜单展开状态
  const [menuOpen, setMenuOpen] = useState(false);

  // 图片缩放 / 平移手势层（视频路径完全不挂监听）。
  // 放大态写进 chat/shared/mediaZoomState.ts —— 那是与「横向切图」层的唯一交界，
  // 切图层读到 true 就把横向手势整个让给本层平移。
  const { stageRef, mediaRef, resetZoom } = useImageZoom(isOpen && type === 'image');

  // 换图 / 重新打开都从 1x 起（否则会带着上一张的缩放进来）
  useEffect(() => {
    resetZoom();
  }, [isOpen, src, resetZoom]);

  // ==================== 横向切图手势 ====================
  // 采集区 = 整个媒体区；被位移的是轨道（与缩放层的 stage 是两个元素，各自单一所有权）。
  const swipeAreaRef = useRef<HTMLDivElement | null>(null);
  const swipeX = useMotionValue(0);

  // 手势启用与否、还有没有上下张 —— 放进 ref，让监听器只挂一次也能读到最新值
  // （否则每次 hasPrev/hasNext 变化都要重挂一遍 addEventListener）
  const swipeCfgRef = useRef({ onSwipePrev, onSwipeNext, hasPrev, hasNext });
  swipeCfgRef.current = { onSwipePrev, onSwipeNext, hasPrev, hasNext };

  const swipeEnabled = !!(onSwipePrev || onSwipeNext);

  useEffect(() => {
    const area = swipeAreaRef.current;
    if (!isOpen || !swipeEnabled || !area) { return; }

    // 一次手势的过程量。horizontal=null 表示方向还没判出来（位移太小）
    let gesture: {
      startX: number;
      startY: number;
      maxTouchCount: number;
      horizontal: boolean | null;
    } | null = null;

    const settleBack = () => {
      animate(swipeX, 0, { type: 'spring', stiffness: 420, damping: 38 });
    };

    /** 放弃本次手势：轨道弹回原位，后续 move/end 不再跟手 */
    const abort = () => {
      gesture = null;
      settleBack();
    };

    const onTouchStart = (e: TouchEvent) => {
      // 放大态整条横向手势归缩放层 —— 连跟手位移都不画
      if (isMediaZoomedNow() || e.touches.length !== 1) {
        gesture = null;
        return;
      }
      const t = e.touches[0];
      gesture = { startX: t.clientX, startY: t.clientY, maxTouchCount: 1, horizontal: null };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gesture) { return; }
      gesture.maxTouchCount = Math.max(gesture.maxTouchCount, e.touches.length);
      if (swipeOwnedByZoomLayer({
        zoomed: isMediaZoomedNow(),
        maxTouchCount: gesture.maxTouchCount,
      })) {
        abort();
        return;
      }

      const t = e.touches[0];
      const dx = t.clientX - gesture.startX;
      const dy = t.clientY - gesture.startY;

      if (gesture.horizontal === null) {
        // 位移还小到看不出方向就先不表态：过早判定会把「刚起步的竖向拖动」误吞成横滑
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { return; }
        gesture.horizontal = isHorizontalSwipe(dx, dy);
        if (!gesture.horizontal) { abort(); return; }
      }

      const { hasPrev: canPrev, hasNext: canNext } = swipeCfgRef.current;
      swipeX.set(swipeTrackOffset(dx, canPrev, canNext));
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (!g || g.horizontal !== true) { settleBack(); return; }

      const t = e.changedTouches[0];
      const cfg = swipeCfgRef.current;
      const direction = resolveSwipeCommit({
        zoomed: isMediaZoomedNow(),
        maxTouchCount: g.maxTouchCount,
        dx: t ? t.clientX - g.startX : 0,
        dy: t ? t.clientY - g.startY : 0,
        containerWidth: area.clientWidth,
        canPrev: cfg.hasPrev,
        canNext: cfg.hasNext,
      });

      if (direction === null) {
        // 没拖够 / 到边界 —— 回弹。回弹本身就是「到头了」的反馈：
        // 完全不动的话，用户分不清"这是最后一张"和"滑动坏了"。
        settleBack();
        return;
      }

      // 切换：新的一张从用户滑来的那一侧滑入（向左滑看下一张 ⇒ 新图从右边进来）
      if (direction === -1) { cfg.onSwipePrev?.(); } else { cfg.onSwipeNext?.(); }
      swipeX.set(direction === -1 ? -area.clientWidth : area.clientWidth);
      animate(swipeX, 0, { duration: 0.22, ease: 'easeOut' });
    };

    const onTouchCancel = () => { abort(); };

    // 与缩放层同款：手挂监听（React 的 onTouch* 是 passive，且静态契约禁止本文件出现
    // onTouchMove=）。本层不 preventDefault —— 浮层的 touch-action: none 已经把浏览器
    // 默认手势全关了，不需要，也不该抢走缩放层的判断权。
    // 写法约束同 useImageZoom（那边注释写了成因）：不写 AddEventListenerOptions 类型标注
    // （eslint no-undef 认不出纯类型名），且必须显式带 capture 键（否则 removeEventListener
    // 的弱类型检测判不可赋值）。
    const options = { passive: true, capture: false };
    area.addEventListener('touchstart', onTouchStart, options);
    area.addEventListener('touchmove', onTouchMove, options);
    area.addEventListener('touchend', onTouchEnd, options);
    area.addEventListener('touchcancel', onTouchCancel, options);

    return () => {
      area.removeEventListener('touchstart', onTouchStart, options);
      area.removeEventListener('touchmove', onTouchMove, options);
      area.removeEventListener('touchend', onTouchEnd, options);
      area.removeEventListener('touchcancel', onTouchCancel, options);
    };
  }, [isOpen, swipeEnabled, swipeX]);
  // 🔴 这里**不能**再加一个「src 变了就把 swipeX 归零」的 effect：切换那一刻正好是
  // 上面那条滑入动画刚起步的时候，归零会把它当场掐断（画面直接跳到位）。
  // 轨道的归位由手势自己负责 —— 提交与放弃两条路径的终点都是 0。

  // 打开期间登记为顶层浮层：底下那些 portal 兄弟（侧边设置面板等）的「点击外部关闭」
  // 据此短路，不再把预览内部的点击当成"点到我外面去了"。见 hooks/useTopLayer.ts。
  useTopLayer(isOpen);

  // 移动端返回手势处理：预览打开时拦截返回操作
  //
  // 必须挂**浮层车道**（useMobileBackOverlay）而不是页面级栈：分发顺序是
  //「①浮层车道恒先问 → ②页面栈」（见 hooks/useMobileBackHandler.ts）。
  // 从侧边面板里打开预览时，ChatMenu 已经在浮层车道上；预览若留在页面栈，
  // 系统返回会被 ChatMenu 抢走（只退回面板主菜单），预览自己的 handler 永远问不到。
  // 挂浮层车道后，预览是**后**注册的那个 ⇒ 栈语义下先被询问 ⇒ 先关预览。
  useMobileBackOverlay(() => {
    if (isOpen) {
      logMedia('返回手势关闭预览');
      onClose();
      return true; // 已处理，不继续传递
    }
    return false; // 未打开，不处理
  });

  // 调试：打印媒体信息
  useEffect(() => {
    if (isOpen) {
      logMedia('预览打开', {
        type,
        filename,
        src: src.substring(0, 100) + (src.length > 100 ? '...' : ''),
        srcLength: src.length,
        isAssetProtocol: src.startsWith('asset://'),
        isHttps: src.startsWith('https://'),
        isHttp: src.startsWith('http://'),
        isBlob: src.startsWith('blob:'),
        isDataUrl: src.startsWith('data:'),
      });
      setLoadState('loading');
      setErrorInfo(null);
    }
  }, [isOpen, type, src, filename]);

  // 禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  // 点击背景关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // 视频事件处理
  const handleVideoLoadStart = useCallback(() => {
    logMedia('视频 loadstart - 开始加载');
    setLoadState('loading');
  }, []);

  const handleVideoLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    logMedia('视频 loadedmetadata - 元数据加载完成', {
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      networkState: video.networkState,
    });
  }, []);

  const handleVideoCanPlay = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    logMedia('视频 canplay - 可以播放', {
      currentTime: video.currentTime,
      readyState: video.readyState,
      paused: video.paused,
    });
    setLoadState('ready');
  }, []);

  const handleVideoPlaying = useCallback(() => {
    logMedia('视频 playing - 正在播放');
  }, []);

  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const error = video.error;

    // MediaError code 含义
    const errorCodeMap: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED - 用户中止',
      2: 'MEDIA_ERR_NETWORK - 网络错误',
      3: 'MEDIA_ERR_DECODE - 解码错误',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - 格式不支持',
    };

    const errorDetail = {
      code: error?.code,
      codeName: error?.code ? errorCodeMap[error.code] : 'Unknown',
      message: error?.message || 'No message',
      networkState: video.networkState,
      readyState: video.readyState,
      src: src.substring(0, 100),
    };

    logMedia('视频 error - 加载失败', errorDetail);
    setLoadState('error');
    setErrorInfo(`${errorCodeMap[error?.code ?? 0] || '未知错误'}: ${error?.message || ''}`);
  }, [src]);

  const handleVideoStalled = useCallback(() => {
    logMedia('视频 stalled - 数据获取停滞');
  }, []);

  const handleVideoWaiting = useCallback(() => {
    logMedia('视频 waiting - 等待数据');
  }, []);

  // 图片事件处理
  const handleImageLoad = useCallback(() => {
    logMedia('图片 load - 加载完成');
    setLoadState('ready');
  }, []);

  const handleImageError = useCallback(() => {
    logMedia('图片 error - 加载失败', { src: src.substring(0, 100) });
    setLoadState('error');
    setErrorInfo('图片加载失败');
  }, [src]);

  // 保存到相册
  const handleSaveToGallery = useCallback(async () => {
    if (!localPath) {
      logMedia('保存失败 - 无本地路径');
      return;
    }

    setSaveStatus('saving');
    logMedia('开始保存到相册', { localPath, type });

    const result = await saveToGallery(localPath, type);

    if (result.success) {
      logMedia('保存成功', { savedPath: result.savedPath });
      setSaveStatus('success');
      // 2秒后重置状态
      setTimeout(() => setSaveStatus('idle'), 2000);
    } else {
      logMedia('保存失败', { message: result.message });
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [localPath, type]);

  // 阻止长按触发上下文菜单（解决穿透问题）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // 阻止事件冒泡，防止触发底层消息气泡的长按菜单
    e.stopPropagation();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // 阻止右键菜单
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 重置保存状态
  useEffect(() => {
    if (!isOpen) {
      setSaveStatus('idle');
      setMenuOpen(false);
    }
  }, [isOpen]);

  // 菜单 action 触发后自动收起
  const handleMenuSaveToGallery = useCallback(() => {
    setMenuOpen(false);
    handleSaveToGallery();
  }, [handleSaveToGallery]);

  const handleMenuOpenWith = useCallback(() => {
    setMenuOpen(false);
    onOpenWith?.();
  }, [onOpenWith]);

  const handleMenuDownload = useCallback(() => {
    setMenuOpen(false);
    onDownload?.();
  }, [onDownload]);

  // 决定菜单展示哪些项的三态分类
  const hasLocalFile = !!localPath;
  let menuState: 'downloading' | 'downloaded' | 'undownloaded';
  if (isDownloading) {
    menuState = 'downloading';
  } else if (hasLocalFile) {
    menuState = 'downloaded';
  } else {
    menuState = 'undownloaded';
  }

  // 判断当前状态是否有可执行的菜单项（用于决定空态保底显示）
  const hasAnyAction =
    menuState === 'downloaded'
    || menuState === 'downloading'
    || (menuState === 'undownloaded' && !!onDownload);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="mobile-media-preview-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
          onTouchStart={handleTouchStart}
          onContextMenu={handleContextMenu}
        >
          {/* 顶部栏 */}
          <div className="mobile-media-preview-header">
            <button
              className="mobile-media-preview-close"
              onClick={onClose}
              type="button"
            >
              <CloseIcon />
            </button>
            <span className="mobile-media-preview-title">{filename}</span>
            {/* 序列位置「3 / 12」：只有能左右切时才有（单张序列上层传 null）。
                它同时是验收判据 —— 光看画面换了没换，分不清"切图生效"与"图片自己重载了"。 */}
            {positionLabel && (
              <span className="mobile-media-preview-position">{positionLabel}</span>
            )}
            {/* ⋮ 始终渲染，菜单展开后内部根据状态显示对应项；无项时显示"暂无可用操作" */}
            <button
              className="mobile-media-preview-more"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              type="button"
              aria-label="更多操作"
            >
              <MoreIcon />
            </button>
          </div>

          {/* ⋮ 下拉菜单（右对齐，从 ⋮ 下方滑入；点击外部 backdrop 收起） */}
          <AnimatePresence>
            {menuOpen && (
              <>
                <div
                  className="mobile-media-preview-menu-backdrop"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                  }}
                />
                <motion.div
                  className="mobile-media-preview-menu"
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {menuState === 'undownloaded' && onDownload && (
                    <button
                      className="mobile-media-preview-menu-item"
                      onClick={handleMenuDownload}
                      type="button"
                    >
                      <DownloadIcon />
                      <span>下载</span>
                    </button>
                  )}
                  {menuState === 'downloading' && (
                    <button
                      className="mobile-media-preview-menu-item"
                      disabled
                      type="button"
                    >
                      <DownloadIcon />
                      <span>下载中 {Math.round(downloadProgress)}%</span>
                    </button>
                  )}
                  {menuState === 'downloaded' && (
                    <>
                      <button
                        className={`mobile-media-preview-menu-item ${saveStatus}`}
                        onClick={handleMenuSaveToGallery}
                        disabled={saveStatus === 'saving'}
                        type="button"
                      >
                        <SaveIcon />
                        <span>
                          {saveStatus === 'idle' && '保存到相册'}
                          {saveStatus === 'saving' && '保存中...'}
                          {saveStatus === 'success' && '已保存'}
                          {saveStatus === 'error' && '保存失败'}
                        </span>
                      </button>
                      {onOpenWith && (
                        <button
                          className="mobile-media-preview-menu-item"
                          onClick={handleMenuOpenWith}
                          type="button"
                        >
                          <OpenWithIcon />
                          <span>通过其它方式打开</span>
                        </button>
                      )}
                    </>
                  )}
                  {!hasAnyAction && (
                    <div className="mobile-media-preview-menu-empty">
                      暂无可用操作
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* 媒体内容 —— 整块也是「左右滑动切图」的手势采集区（手指落在图片周围留白里也算） */}
          <div className="mobile-media-preview-content" ref={swipeAreaRef}>
            {/* 加载状态指示 */}
            {loadState === 'loading' && (
              <div className="mobile-media-preview-loading">
                <span>加载中...</span>
              </div>
            )}

            {/* 错误状态显示 */}
            {loadState === 'error' && (
              <div className="mobile-media-preview-error">
                <span>加载失败</span>
                {errorInfo && <span className="error-detail">{errorInfo}</span>}
                <span className="error-src">src: {src.substring(0, 50)}...</span>
              </div>
            )}

            {/* 横向切图的轨道：跟手位移 / 回弹 / 切换后的滑入都写在**它**的 transform 上。
                与 stage（缩放层的 transform）分属两个元素 ⇒ 各自单一所有权，互不抢帧
                （.claude/rules/animation.md 规则一）。CSS 里绝不给它声明 transition。
                🔴 src 为空串时一个媒体元素都不渲染 —— 上层切位次时新源还没解析出来，
                这时候若把上一张的画面留着配这一张的标题，用户看到的是「滑动没生效」。 */}
            <motion.div className="mobile-media-preview-track" style={{ x: swipeX }}>
              {src && (type === 'image' ? (
                /* stage 同时是缩放手势的采集区与被变换的那一层：它铺满整个媒体区，
                   所以双指落在图片周围的留白里也算。transform 由 useImageZoom 逐帧独占写入
                   （CSS 不得声明 transition）；图片自己的入场 scale 仍归 framer-motion ——
                   两个属性主人在**不同元素**上，互不抢帧。 */
                <div className="mobile-media-preview-image-stage" ref={stageRef}>
                  <motion.img
                    ref={mediaRef}
                    src={src}
                    alt={filename}
                    className="mobile-media-preview-image"
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    style={{ display: loadState === 'error' ? 'none' : 'block' }}
                  />
                </div>
              ) : (
                <motion.video
                  src={src}
                  className="mobile-media-preview-video"
                  controls
                  autoPlay
                  playsInline
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  onLoadStart={handleVideoLoadStart}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onCanPlay={handleVideoCanPlay}
                  onPlaying={handleVideoPlaying}
                  onError={handleVideoError}
                  onStalled={handleVideoStalled}
                  onWaiting={handleVideoWaiting}
                  style={{ display: loadState === 'error' ? 'none' : 'block' }}
                />
              ))}
            </motion.div>
          </div>

          {/* 底部进度条 - 仅下载中显示（被动可见，无需打开菜单） */}
          {isDownloading && (
            <div className="mobile-media-preview-actions">
              <div className="mobile-media-preview-progress">
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.min(downloadProgress, 100)}%` }}
                  />
                </div>
                <span className="progress-text">
                  缓存中 {Math.round(downloadProgress)}%
                </span>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 使用 Portal 渲染到 body
  return createPortal(content, document.body);
}
