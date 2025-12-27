/**
 * 文件附件按钮组件
 *
 * 功能：
 * - 点击显示文件类型选择菜单（图片、视频、文件）
 * - 使用 Tauri dialog API 打开系统文件选择器
 * - 获取完整本地文件路径用于本地文件映射
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { stat, readFile } from '@tauri-apps/plugin-fs';

// ============================================
// 类型定义
// ============================================

export type AttachmentType = 'image' | 'video' | 'file';

export interface SelectedFileWithPath {
  /** File 对象用于上传 */
  file: File;
  /** 本地完整路径（用于本地映射） */
  localPath: string;
}

export interface FileAttachButtonProps {
  /** 是否禁用 */
  disabled?: boolean;
  /** 文件选择回调（带本地路径） */
  onFileSelect: (file: File, type: AttachmentType, localPath?: string) => void;
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

interface MenuItem {
  type: AttachmentType;
  label: string;
  icon: React.ReactNode;
  extensions: string[];
  mimePrefix: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    type: 'image',
    label: '图片',
    icon: <ImageIcon />,
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
    mimePrefix: 'image/',
  },
  {
    type: 'video',
    label: '视频',
    icon: <VideoIcon />,
    extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'],
    mimePrefix: 'video/',
  },
  {
    type: 'file',
    label: '文件',
    icon: <FileIcon />,
    extensions: [],  // 空表示所有文件
    mimePrefix: 'application/',
  },
];

/**
 * 根据文件扩展名获取 MIME 类型
 */
export function getMimeType(filename: string, typeHint: AttachmentType): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const mimeMap: Record<string, string> = {
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    // 视频
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    // 文档
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
  };

  if (mimeMap[ext]) {
    return mimeMap[ext];
  }

  // 根据类型提示返回默认 MIME
  switch (typeHint) {
    case 'image':
      return 'image/octet-stream';
    case 'video':
      return 'video/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

// ============================================
// 组件实现
// ============================================

export function FileAttachButton({ disabled, onFileSelect }: FileAttachButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 打开菜单
  const handleClick = useCallback(() => {
    if (disabled || isLoading) { return; }

    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      setMenuPosition({
        x: rect.left,
        y: rect.top - 10, // 菜单在按钮上方
      });
    }
    setIsOpen(true);
  }, [disabled, isLoading]);

  // 选择文件类型并打开 Tauri 对话框
  const handleSelectType = useCallback(async (item: MenuItem) => {
    setIsOpen(false);
    setIsLoading(true);

    try {
      // 使用 Tauri dialog API 打开文件选择器
      const selected = await openDialog({
        multiple: false,
        filters: item.extensions.length > 0
          ? [{
            name: item.label,
            extensions: item.extensions,
          }]
          : undefined,
      });

      if (selected && typeof selected === 'string') {
        // 获取文件路径
        const localPath = selected;
        const fileName = localPath.split(/[/\\]/).pop() || 'file';

        // 获取文件信息
        const fileStat = await stat(localPath);

        // 读取文件内容
        const fileContent = await readFile(localPath);

        // 创建 File 对象
        const mimeType = getMimeType(fileName, item.type);
        const blob = new Blob([fileContent], { type: mimeType });
        const file = new File([blob], fileName, {
          type: mimeType,
          lastModified: fileStat.mtime ? new Date(fileStat.mtime).getTime() : Date.now(),
        });

        // 回调，带上本地路径
        onFileSelect(file, item.type, localPath);
      }
    } catch (error) {
      // 用户取消选择时会抛出错误，这是正常的
      if (!String(error).includes('cancelled') && !String(error).includes('Canceled')) {
        console.error('[FileAttach] 选择文件失败:', error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [onFileSelect]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!isOpen) { return; }

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
    if (!isOpen) { return; }

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
        disabled={disabled || isLoading}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="发送文件"
      >
        {isLoading ? (
          <svg className="loading-spinner" width="20" height="20" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <PlusIcon />
        )}
      </motion.button>

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
                  onClick={() => handleSelectType(item)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
