/**
 * 参会人 tile 平台徽章（#9 · owner 选定方案 P1「玻璃圆徽章」）
 *
 * 位置约定：**tile 左上角**（避让 #7 控制胶囊所在的底部、以及左下角已有的人名条）。
 *
 * 渲染口径（三条都不是随手定的，对应对端兼容与「不给旧对端扣帽子」）：
 * 1. **本端 tile 不画自己的徽章** —— 由调用方（ParticipantVideo）保证：只有远程参与者
 *    才渲染本组件。自己那块画面显示自己的平台是噪音（用户知道自己在用什么设备）。
 * 2. **字段缺席 → 什么都不画**（返回 null），不回退成「未知平台」图标。
 *    旧服务端不序列化 `platform`、旧客户端不入房上报，两种缺席都会走到这里；
 *    画一个「未知」只会让用户以为对端平台识别失败。
 * 3. **`ios` / `unknown` 同样不画** —— 本方案只有 Windows/Android/macOS/Linux 四枚图标
 *    （owner 明确列的四端）。字段照发、只是没图标，不等于「不可见」。
 *
 * @module meeting/components
 */

import type { PlatformName } from '../../utils/platform';

/**
 * 四端平台图标（纯几何路径，无外部依赖/无网络加载）
 *
 * 用 currentColor 描边/填充，颜色由外层 .platform-badge 控制，避免图标自带色相
 * 在浅色 tile 上失控。
 */
const PLATFORM_GLYPH: Record<string, { label: string; path: string; fill?: boolean }> = {
  // Windows：四格旗（实心）
  windows: {
    label: 'Windows',
    fill: true,
    path: 'M3 5.5 10.5 4.4v7.1H3zM11.5 4.2 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.2z',
  },
  // Android：机器人头（触角 + 双眼）
  android: {
    label: 'Android',
    fill: true,
    path: 'M7.2 6.2h9.6c1.1 0 2 .9 2 2v5.6c0 1.1-.9 2-2 2H7.2c-1.1 0-2-.9-2-2V8.2c0-1.1.9-2 2-2zm3 5.1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3.6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  },
  // macOS：Apple 剪影
  macos: {
    label: 'macOS',
    fill: true,
    path: 'M16.4 12.7c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2 1-.1 1.4-.6 2.6-.6s1.6.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.1-.8-2.1-3zM14.3 5.6c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.3-.5.6-.9 1.5-.8 2.5.9.1 1.8-.5 2.4-1.2z',
  },
  // Linux：企鹅（简化为头身 + 鳍）
  linux: {
    label: 'Linux',
    fill: true,
    path: 'M12 2.6c-2.2 0-3.4 1.7-3.3 3.9 0 1.2.2 2.2-.3 3.2-1.2 2.3-3.5 4.6-3.5 6.6 0 1.4 1.2 1.9 2.4 1.9.7 0 1.4-.2 2-.2.5 0 1 .2 1.5.5.7.4 1.3.6 2.2.6s1.5-.2 2.2-.6c.5-.3 1-.5 1.5-.5.6 0 1.3.2 2 .2 1.2 0 2.4-.5 2.4-1.9 0-2-2.3-4.3-3.5-6.6-.5-1-.3-2-.3-3.2.1-2.2-1.1-3.9-3.3-3.9z',
  },
};

export interface PlatformBadgeProps {
  /** 对端平台；未上报（undefined）时本组件渲染 null */
  platform?: PlatformName;
  /** 附加类名（桌面/移动端各自的尺寸微调由调用方给） */
  className?: string;
}

export function PlatformBadge({ platform, className = '' }: PlatformBadgeProps) {
  if (!platform) {
    return null;
  }
  const glyph = PLATFORM_GLYPH[platform];
  if (!glyph) {
    // ios / unknown：无图标方案（见文件头口径 3）
    return null;
  }

  return (
    <span
      className={`platform-badge ${className}`.trim()}
      title={`来自 ${glyph.label}`}
      aria-label={`设备平台 ${glyph.label}`}
      data-platform={platform}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={glyph.path}
          fill={glyph.fill ? 'currentColor' : 'none'}
          stroke={glyph.fill ? 'none' : 'currentColor'}
          strokeWidth={glyph.fill ? undefined : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
