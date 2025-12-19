/**
 * 文件附件按钮组件
 *
 * 功能：
 * - 点击显示文件类型选择菜单（图片、视频、文件）
 * - 选择后打开系统文件选择器
 * - 支持拖拽上传
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

// ============================================
// 类型定义
// ============================================

export type AttachmentType = 'image' | 'video' | 'file';

export interface FileAttachButtonProps {
  /** 是否禁用 */
  disabled?: boolean;
  /** 文件选择回调 */
  onFileSelect: (file: File, type: AttachmentType) => void;
}

// ============================================
// 图标组件
// ============================================

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const VideoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const FileIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

// ============================================
// 菜单配置
// ============================================

const MENU_ITEMS: { type: AttachmentType; label: string; icon: React.ReactNode; accept: string }[] = [
  { type: 'image', label: '图片', icon: <ImageIcon />, accept: 'image/*' },
  { type: 'video', label: '视频', icon: <VideoIcon />, accept: 'video/*' },
  { type: 'file', label: '文件', icon: <FileIcon />, accept: '*/*' },
];

// ============================================
// 组件实现
// ============================================

export function FileAttachButton({ disabled, onFileSelect }: FileAttachButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<AttachmentType>('image');

  // 打开菜单
  const handleClick = useCallback(() => {
    if (disabled) return;

    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      setMenuPosition({
        x: rect.left,
        y: rect.top - 10, // 菜单在按钮上方
      });
    }
    setIsOpen(true);
  }, [disabled]);

  // 选择文件类型
  const handleSelectType = useCallback((type: AttachmentType, accept: string) => {
    setSelectedType(type);
    setIsOpen(false);

    // 触发文件选择
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  }, []);

  // 文件选择回调
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file, selectedType);
      }
      // 重置 input 以便再次选择相同文件
      e.target.value = '';
    },
    [onFileSelect, selectedType]
  );

  // 点击外部关闭菜单
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.file-attach-menu') && !target.closest('.file-attach-button')) {
        setIsOpen(false);
      }
    };

    // 延迟添加监听器，防止立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      {/* 附件按钮 */}
      <motion.button
        ref={buttonRef}
        className="file-attach-button"
        onClick={handleClick}
        disabled={disabled}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="发送文件"
      >
        <PlusIcon />
      </motion.button>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 菜单弹出层 */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              className="file-attach-menu"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                left: menuPosition.x,
                bottom: window.innerHeight - menuPosition.y,
              }}
            >
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.type}
                  className="file-attach-menu-item"
                  onClick={() => handleSelectType(item.type, item.accept)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

