/**
 * 环形进度条组件
 *
 * 用于显示头像上传进度
 * 使用 SVG 绘制环形进度条
 */

interface CircularProgressProps {
  /** 进度值 0-100 */
  progress: number;
  /** 外圈直径 */
  size?: number;
  /** 环形宽度 */
  strokeWidth?: number;
  /** 进度条颜色 */
  progressColor?: string;
  /** 背景环颜色 */
  backgroundColor?: string;
  /** 子元素（头像） */
  children?: React.ReactNode;
}

export function CircularProgress({
  progress,
  size = 88,
  strokeWidth = 4,
  progressColor = '#3b82f6',
  backgroundColor = 'rgba(147, 197, 253, 0.3)',
  children,
}: CircularProgressProps) {
  // 计算 SVG 参数
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      {/* SVG 环形进度条 */}
      <svg
        width={size}
        height={size}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: 'rotate(-90deg)',
        }}
      >
        {/* 背景环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={backgroundColor}
          strokeWidth={strokeWidth}
        />
        {/* 进度环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.1s ease',
          }}
        />
      </svg>
      {/* 内容区域（头像） */}
      <div
        style={{
          position: 'absolute',
          top: strokeWidth,
          left: strokeWidth,
          width: size - strokeWidth * 2,
          height: size - strokeWidth * 2,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
