/**
 * 资料封面交互层（更改 / 重置 / 上传进度 / 完成提示）
 *
 * 覆盖整块封面的 hover 交互层（照抄 AvatarUploader 的 .avatar-overlay 模式）：
 * 悬停浮出半透明渐变遮罩 + 相机图标 + "更改背景图片"，点击封面任意处直接换图；
 * 上传时封面底部线性进度条 + "上传中 NN%"；完成后近封面浮出成功提示（2s 自动消失）。
 * 作为 .qq-hero-cover 的直接子元素渲染（不再放进角落的 .qq-hero-actions）。
 * 桌面 ProfileModal 与移动 MobileProfilePage 共用；纯 CSS :hover 浮现（触屏 @media (hover:none)
 * 常驻底部提示），无 framer-motion，不与 motion 抢 transform/opacity（不触发 animation-conflict 注册）。
 */

import { useRef, useEffect } from 'react';
import { CameraIcon } from './ProfileIcons';

interface ProfileCoverActionsProps {
  /** 当前是否已设自定义封面（有则显示「恢复默认」） */
  hasBackground: boolean;
  /** 上传/重置进行中 */
  saving: boolean;
  /** 上传进度 0-100 */
  progress: number;
  /** 完成后的成功提示文案（非空则浮出，2s 后经 onClearNotice 清除） */
  notice: string | null;
  /** 选定新封面文件 */
  onSelect: (file: File) => void;
  /** 恢复默认封面 */
  onReset: () => void;
  /** 清除成功提示 */
  onClearNotice: () => void;
}

export function ProfileCoverActions({
  hasBackground,
  saving,
  progress,
  notice,
  onSelect,
  onReset,
  onClearNotice,
}: ProfileCoverActionsProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 成功提示展示 2s 后自动消失
  useEffect(() => {
    if (!notice) { return; }
    const timer = setTimeout(onClearNotice, 2000);
    return () => clearTimeout(timer);
  }, [notice, onClearNotice]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) { onSelect(file); }
          e.target.value = '';
        }}
      />

      {/* 覆盖整块封面的点击换图层（hover 浮出渐变 + 相机 + 文案） */}
      <button
        type="button"
        className={`cover-change-overlay${saving ? ' is-saving' : ''}`}
        onClick={() => inputRef.current?.click()}
        disabled={saving}
        aria-label="更改背景图片"
      >
        <span className="cover-change-scrim">
          <CameraIcon />
          <span className="cover-change-label">
            {saving ? `上传中 ${Math.round(progress)}%` : '更改背景图片'}
          </span>
        </span>
      </button>

      {/* 恢复默认（仅有自定义封面且非上传中时；随遮罩浮出） */}
      {hasBackground && !saving && (
        <button
          type="button"
          className="cover-reset-btn"
          onClick={onReset}
          aria-label="恢复默认封面"
        >
          恢复默认
        </button>
      )}

      {/* 上传进度线性条（封面底部） */}
      {saving && (
        <div className="cover-progress" aria-hidden="true">
          <div className="cover-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* 完成提示（近封面浮出，自动消失） */}
      {notice && <div className="cover-notice">✓ {notice}</div>}
    </>
  );
}
