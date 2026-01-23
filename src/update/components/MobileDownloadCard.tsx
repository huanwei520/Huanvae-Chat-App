/**
 * 移动端下载进度卡片
 *
 * 嵌入消息列表顶部，与消息卡片同级
 * 不使用 Portal，自然地参与文档流，可被侧边栏等遮挡
 */

import { motion } from 'framer-motion';
import { useUpdateStore } from '../store';
import './MobileDownloadCard.css';

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export function MobileDownloadCard() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);

  // 仅在下载状态时显示
  if (status !== 'downloading') {
    return null;
  }

  return (
    <motion.div
      className="mobile-download-card"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mobile-download-card-inner">
        {/* 加载动画 */}
        <div className="mobile-download-card-spinner" />

        {/* 信息区域 */}
        <div className="mobile-download-card-info">
          <div className="mobile-download-card-title">
            正在更新 v{version}
            <span className="mobile-download-card-percent">{Math.round(progress)}%</span>
          </div>
          <div className="mobile-download-card-progress">
            <motion.div
              className="mobile-download-card-progress-fill"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="mobile-download-card-meta">
            {formatSize(downloaded)} / {formatSize(total)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
