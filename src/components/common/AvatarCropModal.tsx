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

import { useCallback, useRef, useState, type ReactNode } from 'react';
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

/** 裁剪弹窗（展示组件） */
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

  return createPortal(
    <div
      role="dialog"
      aria-label="裁剪头像"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }}
    >
      <div style={{ position: 'relative', width: 'min(80vw, 320px)', height: 'min(80vw, 320px)', background: '#1a1a1a' }}>
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
          style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #555', background: '#333', color: '#fff', cursor: 'pointer' }}
        >
          取消
        </button>
        <button
          type="button" onClick={handleConfirm} disabled={processing || !areaPixels}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', opacity: processing || !areaPixels ? 0.6 : 1 }}
        >
          {processing ? '处理中…' : '确定'}
        </button>
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
  const resolverRef = useRef<((file: File | null) => void) | null>(null);

  const finish = useCallback((file: File | null) => {
    setSrc((cur) => {
      if (cur) { URL.revokeObjectURL(cur); }
      return null;
    });
    resolverRef.current?.(file);
    resolverRef.current = null;
  }, []);

  const requestCrop = useCallback((file: File): Promise<File | null> => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return new Promise<File | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback((blob: Blob) => {
    finish(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
  }, [finish]);

  const cropModal = src
    ? <AvatarCropModal imageSrc={src} onConfirm={handleConfirm} onCancel={() => { finish(null); }} />
    : null;

  return { requestCrop, cropModal };
}
