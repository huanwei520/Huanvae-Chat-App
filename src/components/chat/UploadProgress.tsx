/**
 * 上传进度组件
 *
 * 功能：
 * - 显示文件上传进度
 * - 显示当前状态（计算哈希/请求中/上传中/确认中）
 * - 取消上传按钮
 */

import { motion } from 'framer-motion';
import type { UploadProgress as UploadProgressType } from '../../hooks/useFileUpload';
import { formatFileSize } from '../../hooks/useFileUpload';

// ============================================
// 类型定义
// ============================================

export interface UploadProgressProps {
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize: number;
  /** 进度信息 */
  progress: UploadProgressType;
  /** 取消回调 */
  onCancel?: () => void;
}

// ============================================
// 图标组件
// ============================================

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ============================================
// 状态描述
// ============================================

const STATUS_TEXT: Record<UploadProgressType['status'], string> = {
  hashing: '计算文件指纹...',
  requesting: '请求上传...',
  uploading: '上传中...',
  confirming: '确认上传...',
  done: '上传完成',
  error: '上传失败',
};

// ============================================
// 组件实现
// ============================================

export function UploadProgress({
  filename,
  fileSize,
  progress,
  onCancel,
}: UploadProgressProps) {
  const isDone = progress.status === 'done';
  const isError = progress.status === 'error';
  const canCancel = !isDone && !isError && progress.status !== 'confirming';

  return (
    <motion.div
      className="upload-progress"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <div className="upload-progress-header">
        <div className="upload-progress-info">
          <span className="upload-filename" title={filename}>
            {filename.length > 20 ? `${filename.slice(0, 17)  }...` : filename}
          </span>
          <span className="upload-size">{formatFileSize(fileSize)}</span>
        </div>
        {canCancel && onCancel && (
          <button className="upload-cancel-btn" onClick={onCancel} title="取消上传">
            <CloseIcon />
          </button>
        )}
        {isDone && (
          <span className="upload-done-icon">
            <CheckIcon />
          </span>
        )}
      </div>

      <div className="upload-progress-bar-container">
        <motion.div
          className={`upload-progress-bar ${isError ? 'error' : ''} ${isDone ? 'done' : ''}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress.percent}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>

      <div className="upload-progress-footer">
        <span className="upload-status">
          {progress.statusDetail || STATUS_TEXT[progress.status]}
        </span>
        {progress.status === 'uploading' && progress.totalChunks > 1 && (
          <span className="upload-chunks">
            分片 {progress.currentChunk}/{progress.totalChunks}
          </span>
        )}
        <span className="upload-percent">{Math.round(progress.percent)}%</span>
      </div>
    </motion.div>
  );
}
