/**
 * 文档下载进度环 —— Telegram 式（owner 2026-09-14 细则）
 *
 * ## 为什么必须与图片/视频的进度环**分开**
 *
 * owner 原话：「下载进度圈要类似Telegram而不是现在同一的图片视频进度圈套用在文件上」。
 * 现状是文档卡与图片/视频共用 `components/common/CircularProgress`，于是：
 * - 图片/视频那圈是**深色遮罩上的粗白环**（`--white-alpha-95` / `--white-alpha-30`），
 *   它们的宿主是黑底媒体格，白环才看得见；
 * - 文档卡的宿主是**白底卡片**（`--white-alpha-80`），同一套白环**在白底上几乎不可见**，
 *   这是「文件进度看不出在走」的直接原因。
 *
 * 所以本组件不是 CircularProgress 的换色调用，而是一套**为白底卡片设计**的环：
 * - 细环（2.5px）+ primary 蓝（`--primary`，与文档卡的蓝系边框同源）
 * - 环内是**下载箭头**（不是百分比数字）——Telegram 的文档气泡就是箭头+环，
 *   百分比在 32px 的按钮尺寸里塞不下且读不出
 * - 它**取代**下载按钮的位置（同尺寸同圆），进度走完自然过渡成「已下载」态
 *
 * CircularProgress 保持原样，继续服务图片/视频/头像上传等深底场景（不动既有调用点）。
 *
 * @module chat/shared
 */

export interface DocumentProgressRingProps {
  /** 进度百分比 (0-100)；非有限值按 0 处理（对外部输入保守） */
  progress: number;
  /** 直径，默认 32（与 .document-download 按钮同尺寸） */
  size?: number;
  /** 环粗，默认 2.5 */
  strokeWidth?: number;
}

/** 32px 直径下的下载箭头（居中，随 size 等比缩放由 SVG viewBox 承担） */
function DownloadArrow() {
  return (
    <svg
      className="document-progress-ring-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v11" />
      <polyline points="7.5 10.5 12 15 16.5 10.5" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function DocumentProgressRing({
  progress,
  size = 32,
  strokeWidth = 2.5,
}: DocumentProgressRingProps) {
  // 外部输入保守处理：NaN / Infinity / 越界一律夹到 [0,100]
  const safe = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / 100) * circumference;

  return (
    <span
      className="document-progress-ring"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`下载中 ${Math.round(safe)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* 底环（浅蓝，白底卡片上可见） */}
        <circle
          className="document-progress-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />
        {/* 进度弧：起于 12 点方向（rotate -90），顺时针增长 */}
        <circle
          className="document-progress-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {/* 环内箭头（Telegram 式：进度用环表达，中心留动作语义） */}
      <span className="document-progress-ring-glyph" aria-hidden="true">
        <DownloadArrow />
      </span>
    </span>
  );
}
