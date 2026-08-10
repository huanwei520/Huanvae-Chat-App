/**
 * 移动端下载进度卡片
 *
 * 嵌入消息列表顶部，与消息卡片同级
 * 不使用 Portal，自然地参与文档流，可被侧边栏等遮挡
 */

import { motion } from 'framer-motion';
import { useUpdateStore } from '../store';
import { formatSize } from '../../utils/format';
import './MobileDownloadCard.css';

export function MobileDownloadCard() {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);
  const indeterminate = useUpdateStore((s) => s.indeterminate);

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
            <span className="mobile-download-card-percent">
              {indeterminate ? '下载中' : `${Math.round(progress)}%`}
            </span>
          </div>
          <div className="mobile-download-card-progress">
            {indeterminate ? (
              // 总长未知：纯 CSS keyframes 滚动条（不用 framer-motion，
              // 避免与 CSS 动画抢同一个 transform，见 .claude/rules/animation.md 规则一）
              <div className="mobile-download-card-progress-indeterminate" />
            ) : (
              <motion.div
                className="mobile-download-card-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            )}
          </div>
          <div className="mobile-download-card-meta">
            {/* 总长未知时只报已下载字节，不显示 "x / 0 B" 这种误导文案 */}
            {indeterminate
              ? formatSize(downloaded)
              : `${formatSize(downloaded)} / ${formatSize(total)}`}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
