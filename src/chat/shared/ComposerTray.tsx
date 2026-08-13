/**
 * 预发送待发区（输入框上方的缩略图条，Telegram 式）
 *
 * @module chat/shared
 * @location src/chat/shared/ComposerTray.tsx
 *
 * 粘贴 / 选择 / 拖入的附件先落在这里，回车才连同文字一起发出去。
 * 桌面与移动**共用**（挂在同样共用的 ChatInputArea 里），只靠 CSS 适配宽度。
 *
 * ## 两个不肯含糊的点（沿用 AlbumComposer 的同款教训）
 * 1. **被挡下的必须明说**：超体积 / 超数量的项不静默丢弃，`notice` 会把它们的文件名列出来。
 *    用户以为发了 5 个、实际只发 3 个，是最坏的一种"成功"。
 * 2. **缩略图 URL 不归本组件释放**：object URL 由 composerTrayStore 在 add 时创建、
 *    remove/clear 时 revoke。放在组件 unmount 释放会在「待发区还在、只是切了会话」时
 *    把还要用的 URL 提前吊销。
 *
 * ## 视频那一格走 `<VideoThumbnail>`，不是 `<img>`
 *
 * `previewUrl` 是 `URL.createObjectURL(file)` 造的 blob 地址 —— 对图片来说它就是缩略图，
 * 但把一段**视频**的 blob 喂给 `<img>`，浏览器解不出图，画面是**破图图标**。
 * （同一功能区里图片有预览、视频是破图，看着就是半成品。）
 * 这里复用全仓唯一那处视频封面组件 `<VideoThumbnail>`：它内部给 src 追 `#t=0.1`
 * 逼引擎 seek 出首帧当封面（WKWebView / Android WebView 不会自发画首帧），
 * 并带齐 `preload="metadata"` / `muted` / `playsInline`。**不为待发区另写一套截帧。**
 *
 * 🔴 **不传 `fileHash`**：待发区里的东西**还没上传**，`file_hash` 是上传时才算出来的，
 * 此刻根本没有；而 `video_posters` 那张表的键就是 `file_hash`、语义是「**已发出**媒体的封面缓存」。
 * 不传 ⇒ `useVideoPoster` 同步落到 `capture` 分支 ⇒ 纯 `<video>` 显示、**不读也不写封面库**。
 *
 * ## 动画口径
 * 只用 framer-motion 的**内联** initial/animate/exit（不引入 variants 对象），
 * 且配套 CSS 对 `.composer-tray-*` **不声明 transform / opacity 的 transition** ——
 * 两套系统抢同一属性的坑见 .claude/rules/animation.md 规则一。
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { TrayItem } from '../../stores/composerTrayStore';
import { VideoThumbnail } from './VideoThumbnail';

interface ComposerTrayProps {
  items: readonly TrayItem[];
  onRemove: (itemId: string) => void;
  /** 被挡下的提示（超体积 / 超数量）；null 表示无提示 */
  notice: string | null;
  onDismissNotice: () => void;
}

const RemoveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const DocIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

/**
 * 一格里的画面：视频 → 封面组件；图片 → `<img>`；文件 → 图标 + 文件名。
 *
 * 抽成组件而不是就地三元：三分支的嵌套三元会踩 `no-nested-ternary`，
 * 而 `previewUrl` 为空（剪贴板来的文件项）与 `kind === 'video'` 是两个独立维度。
 */
function TrayThumbBody({ item }: { item: TrayItem }) {
  if (item.previewUrl && item.kind === 'video') {
    // 装饰性：这一格的可读名字由旁边的「移除 xxx」按钮承担，读屏再念一遍只是噪音
    return <VideoThumbnail src={item.previewUrl} decorative />;
  }
  if (item.previewUrl) {
    return <img src={item.previewUrl} alt={item.file.name} draggable={false} />;
  }
  return (
    <span className="composer-tray-doc">
      <DocIcon />
      <span className="composer-tray-doc-name" title={item.file.name}>
        {item.file.name}
      </span>
    </span>
  );
}

export function ComposerTray({ items, onRemove, notice, onDismissNotice }: ComposerTrayProps) {
  if (items.length === 0 && !notice) {
    return null;
  }

  return (
    <div className="composer-tray" data-testid="composer-tray">
      {notice && (
        <div className="composer-tray-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="composer-tray-notice-close"
            onClick={onDismissNotice}
            aria-label="关闭提示"
          >
            <RemoveIcon />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="composer-tray-strip">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                className={`composer-tray-thumb composer-tray-thumb--${item.kind}`}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.14 }}
              >
                <TrayThumbBody item={item} />
                {item.kind === 'video' && <span className="composer-tray-badge">视频</span>}
                <button
                  type="button"
                  className="composer-tray-remove"
                  onClick={() => onRemove(item.id)}
                  aria-label={`移除 ${item.file.name}`}
                  title="移除"
                >
                  <RemoveIcon />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
