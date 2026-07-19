/**
 * 头像裁剪弹窗 + useAvatarCrop Hook
 *
 * 头像设置（个人 / 群）选图后，先在此弹窗内裁剪（1:1 正方形，可缩放/拖动），
 * 确认后导出裁剪好的 jpeg File 再上传，而非直接上传原图。
 *
 * 用法：
 * ```tsx
 * const { requestCrop, cropModal } = useAvatarCrop();
 * // 选图回调里：
 * const cropped = await requestCrop(file); // 取消返回 null
 * if (cropped) { await uploadXxx(..., cropped, ...); }
 * // 渲染：{cropModal}
 * ```
 * @module components/common/AvatarCropModal
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Cropper, { type Area } from 'react-easy-crop';
import { getCroppedBlob } from '../../utils/cropImage';

interface AvatarCropModalProps {
  /** 待裁剪图片地址（本地 blob URL） */
  imageSrc: string;
  /** 确认裁剪：回传裁剪后的 jpeg Blob */
  onConfirm: (blob: Blob) => void | Promise<void>;
  /** 取消裁剪 */
  onCancel: () => void;
}

const BTN_BASE: CSSProperties = { padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 14 };

/** 裁剪弹窗（展示组件）。支持 ESC / 点遮罩关闭；样式走主题 CSS 变量。 */
export function AvatarCropModal({ imageSrc, onConfirm, onCancel }: AvatarCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaInPixels: Area) => {
    setAreaPixels(areaInPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!areaPixels || processing) { return; }
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, areaPixels);
      await onConfirm(blob);
    } finally {
      setProcessing(false);
    }
  }, [areaPixels, processing, imageSrc, onConfirm]);

  // ESC 关闭（处理中不允许关）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processing) { onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onCancel, processing]);

  return createPortal(
    <div
      role="dialog"
      aria-label="裁剪头像"
      onClick={() => { if (!processing) { onCancel(); } }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'var(--black-alpha-60)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); }}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          padding: 20, borderRadius: 12,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-default)',
        }}
      >
        <div style={{ position: 'relative', width: 'min(80vw, 320px)', height: 'min(80vw, 320px)', background: 'var(--bg-secondary)' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <input
          type="range" min={1} max={3} step={0.1} value={zoom}
          aria-label="缩放"
          onChange={(e) => { setZoom(Number(e.target.value)); }}
          style={{ width: 'min(80vw, 320px)' }}
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button" onClick={onCancel} disabled={processing}
            style={{ ...BTN_BASE, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          >
            取消
          </button>
          <button
            type="button" onClick={handleConfirm} disabled={processing || !areaPixels}
            style={{ ...BTN_BASE, border: 'none', background: 'var(--primary)', color: 'var(--text-inverse)', opacity: processing || !areaPixels ? 0.6 : 1 }}
          >
            {processing ? '处理中…' : '确定'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface UseAvatarCropResult {
  /** 选图后打开裁剪弹窗，返回裁剪后的 jpeg File；取消则解析为 null */
  requestCrop: (file: File) => Promise<File | null>;
  /** 需在使用方渲染的裁剪弹窗节点 */
  cropModal: ReactNode;
}

/**
 * useAvatarCrop —— 把"选图 → 裁剪 → 得到裁剪后 File"封装成一个 Promise 流程。
 * 返回 requestCrop(file)（取消解析为 null）+ 要渲染的 cropModal 节点。
 */
export function useAvatarCrop(): UseAvatarCropResult {
  const [src, setSrc] = useState<string | null>(null);
  const srcRef = useRef<string | null>(null);
  const resolverRef = useRef<((file: File | null) => void) | null>(null);

  const finish = useCallback((file: File | null) => {
    if (srcRef.current) {
      URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    }
    setSrc(null);
    resolverRef.current?.(file);
    resolverRef.current = null;
  }, []);

  const requestCrop = useCallback((file: File): Promise<File | null> => {
    const url = URL.createObjectURL(file);
    srcRef.current = url;
    setSrc(url);
    return new Promise<File | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback((blob: Blob) => {
    finish(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
  }, [finish]);

  // 卸载兜底：裁剪框开着时父组件被卸载，回收 objectURL 并解析悬挂的 Promise，防泄漏 + 防卡死
  useEffect(() => () => {
    if (srcRef.current) {
      URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    }
    resolverRef.current?.(null);
    resolverRef.current = null;
  }, []);

  const cropModal = src
    ? <AvatarCropModal imageSrc={src} onConfirm={handleConfirm} onCancel={() => { finish(null); }} />
    : null;

  return { requestCrop, cropModal };
}
