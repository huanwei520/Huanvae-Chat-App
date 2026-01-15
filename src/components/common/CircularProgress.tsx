/**
 * 圆形进度条组件
 *
 * 通用的圆形进度条，支持两种使用场景：
 * 1. 带子元素：在进度环内部显示自定义内容（如头像上传）
 * 2. 不带子元素：显示百分比文字（如视频下载进度）
 *
 * @example
 * ```tsx
 * // 带子元素（头像上传）
 * <CircularProgress progress={50} size={86}>
 *   <Avatar />
 * </CircularProgress>
 *
 * // 不带子元素（视频下载）
 * <CircularProgress progress={50} size={48} showText />
 * ```
 */

import { memo, type ReactNode } from 'react';

export interface CircularProgressProps {
  /** 进度百分比 (0-100) */
  progress: number;
  /** 圆环大小 (直径)，默认 48 */
  size?: number;
  /** 圆环粗细，默认 4 */
  strokeWidth?: number;
  /** 进度条颜色，默认白色 */
  progressColor?: string;
  /** 背景圆环颜色，默认半透明白色 */
  backgroundColor?: string;
  /** 是否显示百分比文字（无子元素时），默认 true */
  showText?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 子元素（显示在圆环中心） */
  children?: ReactNode;
}

/**
 * 圆形进度条
 *
 * 功能：
 * - SVG 绘制圆环进度
 * - 平滑动画过渡
 * - 可配置大小、粗细和颜色
 * - 支持子元素或百分比文字
 */
export const CircularProgress = memo(function CircularProgress({
  progress,
  size = 48,
  strokeWidth = 4,
  progressColor = 'rgba(255, 255, 255, 0.95)',
  backgroundColor = 'rgba(255, 255, 255, 0.3)',
  showText = true,
  className = '',
  children,
}: CircularProgressProps) {
  // 计算圆环参数
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const center = size / 2;

  return (
    <div
      className={`circular-progress-container ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        className="circular-progress-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* 背景圆环 */}
        <circle
          className="circular-progress-bg"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={backgroundColor}
          strokeWidth={strokeWidth}
        />
        {/* 进度圆环 */}
        <circle
          className="circular-progress-bar"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{
            transition: 'stroke-dashoffset 0.3s ease-out',
          }}
        />
      </svg>

      {/* 子元素（居中显示在圆环内部） */}
      {children && (
        <div
          className="circular-progress-children"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {children}
        </div>
      )}

      {/* 百分比文字（无子元素时显示） */}
      {!children && showText && (
        <span
          className="circular-progress-text"
          style={{
            position: 'absolute',
            fontSize: Math.max(10, size / 4),
            fontWeight: 600,
            color: progressColor,
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
          }}
        >
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
});
