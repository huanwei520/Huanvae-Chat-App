/**
 * 已读回执 SVG 图标基元
 *
 * @module chat/shared/ReadReceiptIcons
 * @location src/chat/shared/ReadReceiptIcons.tsx
 *
 * 统一状态槽用到的三个图标，尺寸默认 14px，颜色由 currentColor 控制（由外层 className 决定）：
 * - ClockIcon：发送中（时钟）
 * - DoubleCheckIcon：已送达/已读（双勾，灰=未读 / 绿=已读，由外层着色）
 * - FailedIcon：发送失败（红色圆形感叹号）
 */

interface IconProps {
  /** 像素尺寸，默认 14 */
  size?: number;
}

/** 时钟图标（发送中） */
export function ClockIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
    </svg>
  );
}

/** 双勾图标（已送达/已读，Material done_all） */
export function DoubleCheckIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
    </svg>
  );
}

/** 圆形感叹号（发送失败） */
export function FailedIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
  );
}
