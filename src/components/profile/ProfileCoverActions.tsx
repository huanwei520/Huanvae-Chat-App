/**
 * 资料封面操作（换封面 / 重置封面）
 *
 * 放进 qq-hero-cover 的 .qq-hero-actions 里，与关闭按钮并列。桌面 ProfileModal 与移动
 * MobileProfilePage 共用；封面图本身（background_url 经 resolveServerAvatarUrl 收口后作
 * background-image）由各载体在 .qq-hero-cover 上设置，本组件只负责换/重置入口。
 */

import { useRef } from 'react';

interface ProfileCoverActionsProps {
  /** 当前是否已设自定义封面（有则显示「重置」） */
  hasBackground: boolean;
  /** 上传/重置进行中 */
  saving: boolean;
  /** 选定新封面文件 */
  onSelect: (file: File) => void;
  /** 重置为默认封面 */
  onReset: () => void;
}

export function ProfileCoverActions({ hasBackground, saving, onSelect, onReset }: ProfileCoverActionsProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
      <button
        type="button"
        className="qq-hero-btn qq-hero-btn--icon"
        title="换封面"
        aria-label="换封面"
        onClick={() => inputRef.current?.click()}
        disabled={saving}
      >
        🖼
      </button>
      {hasBackground && (
        <button
          type="button"
          className="qq-hero-btn qq-hero-btn--icon"
          title="重置封面"
          aria-label="重置封面"
          onClick={onReset}
          disabled={saving}
        >
          ↺
        </button>
      )}
    </>
  );
}
